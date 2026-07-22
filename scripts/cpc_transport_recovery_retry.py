#!/usr/bin/env python3
"""Safely retry one deferred CPC publisher immediately after Codex transport recovery."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pathlib
import subprocess
import sys
import time
from collections.abc import Callable
from typing import Any


PUBLISHER_ID = "facebook-ready-publisher"
PROJECT_ROOT = pathlib.Path(
    os.environ.get("CPC2_ROOT", pathlib.Path(__file__).resolve().parents[1])
).expanduser()
DEFAULT_PYTHON = pathlib.Path(os.environ.get("CPC2_PYTHON", sys.executable))
DEFAULT_DISPATCHER = pathlib.Path(__file__).with_name("cpc_change_event_dispatcher.py")
DEFAULT_ROUTER = pathlib.Path(__file__).with_name("cpc_change_event_router.py")
DEFAULT_STATE = pathlib.Path.home() / ".codex/automation-watchdog/cpc-change-router-state.json"
DEFAULT_RUNNER_LOCK = pathlib.Path.home() / ".codex/automation-watchdog/catchup-runner.lock"
DEFAULT_SINGLETON = pathlib.Path(
    os.environ.get(
        "CPC2_AUTOMATION_SINGLETON",
        str(pathlib.Path.home() / ".codex/skills/konner-ops-automation/scripts/automation_singleton.sh"),
    )
)
DEFAULT_LANE = pathlib.Path(
    os.environ.get(
        "CPC2_AUTOMATION_LANE",
        str(pathlib.Path.home() / ".codex/skills/konner-ops-automation/scripts/automation_lane.sh"),
    )
)
DEFAULT_PRESSURE_GATE = pathlib.Path(
    os.environ.get(
        "CPC2_PRESSURE_GATE",
        str(pathlib.Path.home() / ".codex/skills/chrome-load-guard/scripts/pressure_gate.sh"),
    )
)
DEFAULT_MAINTENANCE_FLAG = PROJECT_ROOT / ".automation_maintenance_mode"
DEFAULT_PUBLISH_LOCK = PROJECT_ROOT / ".automation-locks/facebook-publish.lock"
DEFAULT_WAIT_SECONDS = 180
DEFAULT_POLL_SECONDS = 2
DEFAULT_MARKER_AGE_SECONDS = 15 * 60
DEFAULT_MAX_OWNER_RUNS = 6


def load_json(path: pathlib.Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def parse_timestamp(value: Any) -> dt.datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = dt.datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc)


def validate_marker(
    marker: dict[str, Any],
    now: dt.datetime,
    max_age_seconds: int,
) -> tuple[bool, str]:
    if marker.get("managedTransportStatus") != "closed":
        return False, "marker_not_transport_closed"
    if marker.get("recoveryStatus") != "scheduled_codex_restart":
        return False, "restart_not_scheduled"
    if marker.get("postRestartCpcRetry") is not True:
        return False, "immediate_retry_not_requested"
    if marker.get("retryOwner") != PUBLISHER_ID:
        return False, "wrong_retry_owner"
    if not str(marker.get("retryTargetSignature") or "").strip():
        return False, "missing_retry_target_signature"
    if str(marker.get("protectedState")) != "0" or marker.get("activeLocks") != "none":
        return False, "marker_not_safe"
    checked_at = parse_timestamp(marker.get("checkedAt"))
    if checked_at is None:
        return False, "invalid_marker_time"
    age = (now.astimezone(dt.timezone.utc) - checked_at).total_seconds()
    if age < -30 or age > max_age_seconds:
        return False, "marker_expired"
    return True, "ready"


def command_is_free(command: list[str], expected: str) -> tuple[bool, str]:
    try:
        result = subprocess.run(command, text=True, capture_output=True, check=False, timeout=10)
    except (OSError, subprocess.TimeoutExpired) as error:
        return False, f"command_failed:{type(error).__name__}"
    output = f"{result.stdout}\n{result.stderr}"
    return result.returncode == 0 and expected in output, output.strip()[-500:]


def pending_retry_status(
    state: dict[str, Any],
    target_signature: str,
) -> tuple[str, str]:
    if state.get("identityMode") != "ready-item-identities":
        return "stop", "publisher_identity_not_exact"
    pending = state.get("pending") if isinstance(state.get("pending"), dict) else {}
    item = pending.get(PUBLISHER_ID) if isinstance(pending.get(PUBLISHER_ID), dict) else None
    if item is None:
        return "stop", "publisher_no_longer_pending"
    if str(item.get("targetSignature") or "") != target_signature:
        return "stop", "publisher_target_changed"
    status = str(item.get("lastRunStatus") or "")
    if status in {"starting", "pending", "busy", "covered", ""}:
        return "wait", f"publisher_status_{status or 'unknown'}"
    if status != "deferred":
        return "stop", f"publisher_status_{status}"
    try:
        attempts = max(0, int(item.get("immediateRecoveryAttempts") or 0))
    except (TypeError, ValueError):
        attempts = 0
    if attempts >= 1:
        return "stop", "immediate_retry_limit_reached"
    return "ready", "publisher_deferred_and_eligible"


def coordination_status(args: argparse.Namespace, target_signature: str) -> tuple[str, str]:
    if args.maintenance_flag.exists():
        return "wait", "maintenance_mode"
    if args.publish_lock.exists():
        return "wait", "facebook_publish_lock_present"
    if args.runner_lock.exists():
        return "wait", "original_runner_active"

    state_status, state_reason = pending_retry_status(load_json(args.state_path), target_signature)
    if state_status != "ready":
        return state_status, state_reason

    singleton_free, _ = command_is_free(
        [str(args.singleton), "status", PUBLISHER_ID],
        "singleton_status=free",
    )
    if not singleton_free:
        return "wait", "publisher_singleton_not_free"
    lane_free, _ = command_is_free(
        [str(args.lane), "status", "facebook-browser"],
        "lane_status=free",
    )
    if not lane_free:
        return "wait", "facebook_browser_lane_not_free"
    return "ready", "coordination_released"


def pressure_is_safe(pressure_gate: pathlib.Path) -> tuple[bool, str]:
    try:
        result = subprocess.run(
            [str(pressure_gate)],
            text=True,
            capture_output=True,
            check=False,
            timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        return False, f"pressure_gate_failed:{type(error).__name__}"
    output = f"{result.stdout}\n{result.stderr}"
    values: dict[str, str] = {}
    for line in output.splitlines():
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        values.setdefault(key.strip(), value.strip())
    safe = (
        result.returncode == 0
        and values.get("protected_state") == "0"
        and values.get("active_locks") == "none"
        and values.get("chrome_pressure") != "severe"
    )
    reason = (
        "safe"
        if safe
        else "pressure_or_protected_state:"
        f"pressure={values.get('chrome_pressure', 'unknown')},"
        f"protected={values.get('protected_state', 'unknown')},"
        f"locks={values.get('active_locks', 'unknown')}"
    )
    return safe, reason


def wait_for_coordination(
    args: argparse.Namespace,
    target_signature: str,
    *,
    monotonic: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
) -> tuple[str, str]:
    deadline = monotonic() + args.wait_seconds
    last_reason = "not_checked"
    while True:
        status, reason = coordination_status(args, target_signature)
        last_reason = reason
        if status != "wait":
            return status, reason
        if monotonic() >= deadline:
            return "timeout", last_reason
        sleep(args.poll_seconds)


def dispatch_command(args: argparse.Namespace, target_signature: str) -> list[str]:
    return [
        str(args.python),
        str(args.dispatcher),
        "--python",
        str(args.python),
        "--router",
        str(args.router),
        "--max-owner-runs",
        str(args.max_owner_runs),
        "--immediate-deferred-owner",
        PUBLISHER_ID,
        "--immediate-target-signature",
        target_signature,
    ]


def save_result(run_dir: pathlib.Path | None, payload: dict[str, Any]) -> None:
    if run_dir is None:
        return
    run_dir.mkdir(parents=True, exist_ok=True)
    temporary = run_dir / ".cpc-transport-recovery-retry.json.tmp"
    destination = run_dir / "cpc-transport-recovery-retry.json"
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(destination)


def emit(run_dir: pathlib.Path | None, payload: dict[str, Any]) -> None:
    save_result(run_dir, payload)
    print(json.dumps(payload, sort_keys=True))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--marker", type=pathlib.Path, required=True)
    parser.add_argument("--run-dir", type=pathlib.Path)
    parser.add_argument("--python", type=pathlib.Path, default=DEFAULT_PYTHON)
    parser.add_argument("--dispatcher", type=pathlib.Path, default=DEFAULT_DISPATCHER)
    parser.add_argument("--router", type=pathlib.Path, default=DEFAULT_ROUTER)
    parser.add_argument("--state-path", type=pathlib.Path, default=DEFAULT_STATE)
    parser.add_argument("--runner-lock", type=pathlib.Path, default=DEFAULT_RUNNER_LOCK)
    parser.add_argument("--singleton", type=pathlib.Path, default=DEFAULT_SINGLETON)
    parser.add_argument("--lane", type=pathlib.Path, default=DEFAULT_LANE)
    parser.add_argument("--pressure-gate", type=pathlib.Path, default=DEFAULT_PRESSURE_GATE)
    parser.add_argument("--maintenance-flag", type=pathlib.Path, default=DEFAULT_MAINTENANCE_FLAG)
    parser.add_argument("--publish-lock", type=pathlib.Path, default=DEFAULT_PUBLISH_LOCK)
    parser.add_argument("--wait-seconds", type=int, default=DEFAULT_WAIT_SECONDS)
    parser.add_argument("--poll-seconds", type=int, default=DEFAULT_POLL_SECONDS)
    parser.add_argument("--max-marker-age-seconds", type=int, default=DEFAULT_MARKER_AGE_SECONDS)
    parser.add_argument("--max-owner-runs", type=int, default=DEFAULT_MAX_OWNER_RUNS)
    args = parser.parse_args()

    if args.wait_seconds < 0 or args.poll_seconds < 1 or args.max_marker_age_seconds < 60:
        parser.error("invalid wait, poll, or marker-age setting")
    if not 1 <= args.max_owner_runs <= 12:
        parser.error("--max-owner-runs must be between 1 and 12")

    marker = load_json(args.marker)
    marker_ok, marker_reason = validate_marker(
        marker,
        dt.datetime.now(dt.timezone.utc),
        args.max_marker_age_seconds,
    )
    if not marker_ok:
        emit(args.run_dir, {"status": "blocked", "reason": marker_reason, "dispatched": False})
        return 2

    target_signature = str(marker["retryTargetSignature"])
    coordination, reason = wait_for_coordination(args, target_signature)
    if coordination == "stop":
        emit(args.run_dir, {"status": "no_retry", "reason": reason, "dispatched": False})
        return 0
    if coordination != "ready":
        emit(args.run_dir, {"status": "deferred", "reason": reason, "dispatched": False})
        return 0

    safe, pressure_reason = pressure_is_safe(args.pressure_gate)
    if not safe:
        emit(args.run_dir, {"status": "deferred", "reason": pressure_reason, "dispatched": False})
        return 0

    try:
        result = subprocess.run(
            dispatch_command(args, target_signature),
            text=True,
            capture_output=True,
            check=False,
        )
    except OSError as error:
        emit(args.run_dir, {
            "status": "failed",
            "reason": "dispatcher_launch_failed",
            "error": str(error)[:300],
            "dispatched": False,
        })
        return 2

    payload = {
        "status": "dispatched" if result.returncode == 0 else "failed",
        "reason": "immediate_post_recovery_retry",
        "dispatched": True,
        "dispatcherReturnCode": result.returncode,
        "dispatcherStdout": result.stdout.strip()[-4000:],
        "dispatcherStderr": result.stderr.strip()[-1000:],
    }
    emit(args.run_dir, payload)
    return 0 if result.returncode == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
