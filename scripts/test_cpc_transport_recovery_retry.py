from __future__ import annotations

import contextlib
import datetime as dt
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock


SUBJECT_PATH = Path(__file__).with_name("cpc_transport_recovery_retry.py")
SPEC = importlib.util.spec_from_file_location("cpc_transport_recovery_retry", SUBJECT_PATH)
assert SPEC and SPEC.loader
SUBJECT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SUBJECT)


def safe_marker(now: dt.datetime) -> dict:
    return {
        "checkedAt": now.isoformat().replace("+00:00", "Z"),
        "managedTransportStatus": "closed",
        "recoveryStatus": "scheduled_codex_restart",
        "postRestartCpcRetry": True,
        "retryOwner": SUBJECT.PUBLISHER_ID,
        "retryTargetSignature": "target-123",
        "protectedState": "0",
        "activeLocks": "none",
    }


def args_for(root: Path) -> SimpleNamespace:
    return SimpleNamespace(
        state_path=root / "state.json",
        runner_lock=root / "runner.lock",
        singleton=root / "singleton.sh",
        lane=root / "lane.sh",
        maintenance_flag=root / "maintenance",
        publish_lock=root / "publish.lock",
        wait_seconds=10,
        poll_seconds=1,
        python=Path("/python"),
        dispatcher=Path("/dispatcher.py"),
        router=Path("/router.py"),
        max_owner_runs=6,
    )


class TransportRecoveryRetryTests(unittest.TestCase):
    def test_marker_requires_safe_fresh_one_shot_publisher_request(self) -> None:
        now = dt.datetime(2026, 7, 20, 20, 0, tzinfo=dt.timezone.utc)
        self.assertEqual(SUBJECT.validate_marker(safe_marker(now), now, 900), (True, "ready"))

        protected = safe_marker(now)
        protected["protectedState"] = "1"
        self.assertEqual(SUBJECT.validate_marker(protected, now, 900)[1], "marker_not_safe")

        stale = safe_marker(now - dt.timedelta(minutes=16))
        self.assertEqual(SUBJECT.validate_marker(stale, now, 900)[1], "marker_expired")

        no_target = safe_marker(now)
        no_target["retryTargetSignature"] = ""
        self.assertEqual(
            SUBJECT.validate_marker(no_target, now, 900)[1],
            "missing_retry_target_signature",
        )

    def test_pending_retry_requires_same_deferred_target_and_unused_attempt(self) -> None:
        state = {
            "identityMode": "ready-item-identities",
            "pending": {
                SUBJECT.PUBLISHER_ID: {
                    "targetSignature": "target-123",
                    "lastRunStatus": "deferred",
                    "immediateRecoveryAttempts": 0,
                },
            },
        }
        self.assertEqual(
            SUBJECT.pending_retry_status(state, "target-123"),
            ("ready", "publisher_deferred_and_eligible"),
        )
        self.assertEqual(
            SUBJECT.pending_retry_status(state, "different-target"),
            ("stop", "publisher_target_changed"),
        )
        count_only = dict(state, identityMode="count-fallback")
        self.assertEqual(
            SUBJECT.pending_retry_status(count_only, "target-123"),
            ("stop", "publisher_identity_not_exact"),
        )
        state["pending"][SUBJECT.PUBLISHER_ID]["lastRunStatus"] = "starting"
        self.assertEqual(SUBJECT.pending_retry_status(state, "target-123")[0], "wait")
        state["pending"][SUBJECT.PUBLISHER_ID].update({
            "lastRunStatus": "deferred",
            "immediateRecoveryAttempts": 1,
        })
        self.assertEqual(
            SUBJECT.pending_retry_status(state, "target-123"),
            ("stop", "immediate_retry_limit_reached"),
        )

    def test_coordination_waits_for_original_runner_then_requires_free_owners(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            args = args_for(root)
            args.state_path.write_text(json.dumps({
                "identityMode": "ready-item-identities",
                "pending": {
                    SUBJECT.PUBLISHER_ID: {
                        "targetSignature": "target-123",
                        "lastRunStatus": "deferred",
                    },
                },
            }), encoding="utf-8")
            args.runner_lock.mkdir()
            self.assertEqual(
                SUBJECT.coordination_status(args, "target-123"),
                ("wait", "original_runner_active"),
            )
            args.runner_lock.rmdir()
            with mock.patch.object(
                SUBJECT,
                "command_is_free",
                side_effect=[(True, "singleton_status=free"), (True, "lane_status=free")],
            ):
                self.assertEqual(
                    SUBJECT.coordination_status(args, "target-123"),
                    ("ready", "coordination_released"),
                )

    def test_pressure_gate_blocks_protected_state(self) -> None:
        completed = mock.Mock(
            returncode=0,
            stdout="chrome_pressure=ok\nprotected_state=1\nactive_locks=none\n",
            stderr="",
        )
        with mock.patch.object(SUBJECT.subprocess, "run", return_value=completed):
            safe, reason = SUBJECT.pressure_is_safe(Path("/pressure-gate"))
        self.assertFalse(safe)
        self.assertIn("protected=1", reason)

    def test_dispatch_command_requests_only_the_publisher_immediate_retry(self) -> None:
        args = args_for(Path("/tmp/test"))
        self.assertEqual(SUBJECT.dispatch_command(args, "target-123"), [
            "/python",
            "/dispatcher.py",
            "--python",
            "/python",
            "--router",
            "/router.py",
            "--max-owner-runs",
            "6",
            "--immediate-deferred-owner",
            SUBJECT.PUBLISHER_ID,
            "--immediate-target-signature",
            "target-123",
        ])

    def test_main_dispatches_the_exact_marker_target_once(self) -> None:
        now = dt.datetime.now(dt.timezone.utc)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            marker_path = root / "marker.json"
            marker_path.write_text(json.dumps(safe_marker(now)), encoding="utf-8")
            argv = [
                str(SUBJECT_PATH),
                "--marker", str(marker_path),
                "--run-dir", str(root / "run"),
                "--python", "/python",
                "--dispatcher", "/dispatcher.py",
                "--router", "/router.py",
            ]
            completed = mock.Mock(returncode=0, stdout='{"status":"triggered"}\n', stderr="")
            stdout = io.StringIO()
            with mock.patch.object(sys, "argv", argv), mock.patch.object(
                SUBJECT, "wait_for_coordination", return_value=("ready", "coordination_released")
            ), mock.patch.object(
                SUBJECT, "pressure_is_safe", return_value=(True, "safe")
            ), mock.patch.object(
                SUBJECT.subprocess, "run", return_value=completed
            ) as run, contextlib.redirect_stdout(stdout):
                self.assertEqual(SUBJECT.main(), 0)

            payload = json.loads(stdout.getvalue())
            self.assertEqual(payload["status"], "dispatched")
            self.assertIn("--immediate-target-signature", run.call_args.args[0])
            self.assertEqual(run.call_args.args[0][-1], "target-123")
            self.assertTrue((root / "run" / "cpc-transport-recovery-retry.json").exists())


if __name__ == "__main__":
    unittest.main()
