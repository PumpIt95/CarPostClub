from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path
from unittest import mock


SUBJECT_PATH = Path(__file__).with_name("cpc_change_event_dispatcher.py")
SPEC = importlib.util.spec_from_file_location("cpc_change_event_dispatcher", SUBJECT_PATH)
assert SPEC and SPEC.loader
SUBJECT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SUBJECT)


def sequence_runner(items: list[dict]):
    remaining = list(items)

    def run() -> dict:
        if not remaining:
            raise AssertionError("dispatcher requested an unexpected extra cycle")
        return remaining.pop(0)

    return run


class CompletionDispatcherTests(unittest.TestCase):
    def test_router_command_includes_immediate_recovery_owner(self) -> None:
        completed = mock.Mock(stdout='{"status":"idle"}\n', stderr="", returncode=0)
        with mock.patch.object(SUBJECT.subprocess, "run", return_value=completed) as run:
            payload = SUBJECT.run_router_cycle(
                Path("/python"),
                Path("/router.py"),
                SUBJECT.PUBLISHER_ID,
                "target-123",
            )
        self.assertEqual(payload["status"], "idle")
        self.assertEqual(
            run.call_args.args[0],
            [
                "/python",
                "/router.py",
                "--immediate-deferred-owner",
                SUBJECT.PUBLISHER_ID,
                "--immediate-target-signature",
                "target-123",
            ],
        )

    def test_recovery_owner_is_retained_until_router_consumes_it(self) -> None:
        side_effect = [
            {
                "status": "triggered",
                "runStatus": "done",
                "owner": "live-facebook-listing-sync",
                "immediateRetryConsumed": False,
            },
            {
                "status": "triggered",
                "runStatus": "done",
                "owner": SUBJECT.PUBLISHER_ID,
                "immediateRetryConsumed": True,
            },
            {"status": "idle", "immediateRetryConsumed": False},
        ]
        with mock.patch.object(SUBJECT, "run_router_cycle", side_effect=side_effect) as cycle:
            runner = SUBJECT.recovery_aware_cycle_runner(
                Path("/python"),
                Path("/router.py"),
                SUBJECT.PUBLISHER_ID,
                "target-123",
            )
            runner()
            runner()
            runner()

        self.assertEqual(cycle.call_args_list[0].args[2], SUBJECT.PUBLISHER_ID)
        self.assertEqual(cycle.call_args_list[1].args[2], SUBJECT.PUBLISHER_ID)
        self.assertEqual(cycle.call_args_list[2].args[2], "")
        self.assertEqual(cycle.call_args_list[0].args[3], "target-123")
        self.assertEqual(cycle.call_args_list[1].args[3], "target-123")
        self.assertEqual(cycle.call_args_list[2].args[3], "")

    def test_idle_cycle_does_not_start_a_followup(self) -> None:
        result = SUBJECT.dispatch_completion_chain(
            sequence_runner([{"status": "idle", "routerReturnCode": 0}]),
            max_owner_runs=6,
        )
        self.assertEqual(result["status"], "idle")
        self.assertEqual(result["completedOwnerRuns"], 0)
        self.assertEqual(result["cycleCount"], 1)

    def test_successful_owner_completion_immediately_runs_the_next_cycle(self) -> None:
        result = SUBJECT.dispatch_completion_chain(
            sequence_runner([
                {
                    "status": "triggered",
                    "runStatus": "done",
                    "routerReturnCode": 0,
                    "owner": "live-facebook-listing-sync",
                },
                {
                    "status": "triggered",
                    "runStatus": "done",
                    "routerReturnCode": 0,
                    "owner": "facebook-ready-publisher",
                },
                {"status": "idle", "routerReturnCode": 0},
            ]),
            max_owner_runs=6,
        )
        self.assertEqual(result["status"], "triggered")
        self.assertEqual(result["finalStatus"], "idle")
        self.assertEqual(result["completedOwnerRuns"], 2)
        self.assertEqual(result["completionFollowups"], 1)
        self.assertEqual(
            result["ownersRun"],
            ["live-facebook-listing-sync", "facebook-ready-publisher"],
        )
        self.assertEqual(result["cycleCount"], 3)

    def test_deferred_cycle_stops_without_spinning(self) -> None:
        result = SUBJECT.dispatch_completion_chain(
            sequence_runner([
                {
                    "status": "deferred",
                    "reason": "facebook_browser_lane_not_free",
                    "routerReturnCode": 0,
                },
            ]),
            max_owner_runs=6,
        )
        self.assertEqual(result["status"], "deferred")
        self.assertEqual(result["cycleCount"], 1)

    def test_failure_after_a_completed_owner_is_preserved(self) -> None:
        result = SUBJECT.dispatch_completion_chain(
            sequence_runner([
                {
                    "status": "triggered",
                    "runStatus": "done",
                    "routerReturnCode": 0,
                    "owner": "live-facebook-listing-sync",
                },
                {
                    "status": "run_failed",
                    "runStatus": "failed",
                    "routerReturnCode": 2,
                    "owner": "facebook-ready-publisher",
                },
            ]),
            max_owner_runs=6,
        )
        self.assertEqual(result["status"], "run_failed")
        self.assertEqual(result["completedOwnerRuns"], 1)
        self.assertEqual(result["cycleCount"], 2)

    def test_unexpected_cycle_error_becomes_a_bounded_failure(self) -> None:
        def fail() -> dict:
            raise RuntimeError("test cycle failure")

        result = SUBJECT.dispatch_completion_chain(fail, max_owner_runs=6)
        self.assertEqual(result["status"], "run_failed")
        self.assertEqual(result["cycleResults"][0]["runStatus"], "dispatcher_cycle_failed")
        self.assertEqual(result["cycleCount"], 1)

    def test_chain_limit_bounds_consecutive_owner_runs(self) -> None:
        result = SUBJECT.dispatch_completion_chain(
            sequence_runner([
                {
                    "status": "triggered",
                    "runStatus": "done",
                    "routerReturnCode": 0,
                    "owner": "facebook-ready-publisher",
                },
                {
                    "status": "triggered",
                    "runStatus": "done",
                    "routerReturnCode": 0,
                    "owner": "facebook-ready-publisher",
                },
            ]),
            max_owner_runs=2,
        )
        self.assertEqual(result["status"], "triggered")
        self.assertEqual(result["finalStatus"], "chain_limit")
        self.assertEqual(result["completedOwnerRuns"], 2)
        self.assertEqual(result["cycleCount"], 2)


if __name__ == "__main__":
    unittest.main()
