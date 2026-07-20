#!/Users/konnerhaas/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3
"""Run CPC change-router cycles back-to-back after successful owner completion."""

from __future__ import annotations

import argparse
import json
import pathlib
import subprocess
from collections.abc import Callable
from typing import Any


DEFAULT_PYTHON = pathlib.Path(
    "/Users/konnerhaas/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"
)
DEFAULT_ROUTER = pathlib.Path(__file__).with_name("cpc_change_event_router.py")
DEFAULT_MAX_OWNER_RUNS = 6
MAX_OWNER_RUNS_LIMIT = 12


def parse_router_output(stdout: str, returncode: int) -> dict[str, Any]:
    for line in reversed((stdout or "").splitlines()):
        try:
            payload = json.loads(line)
        except (json.JSONDecodeError, TypeError):
            continue
        if isinstance(payload, dict) and payload.get("status"):
            payload["routerReturnCode"] = returncode
            return payload
    return {
        "status": "run_failed",
        "runStatus": "unreadable_router_output",
        "routerReturnCode": returncode,
    }


def run_router_cycle(python_bin: pathlib.Path, router: pathlib.Path) -> dict[str, Any]:
    try:
        result = subprocess.run(
            [str(python_bin), str(router)],
            text=True,
            capture_output=True,
            check=False,
        )
    except OSError as error:
        return {
            "status": "run_failed",
            "runStatus": "router_launch_failed",
            "routerReturnCode": 1,
            "error": str(error)[:300],
        }
    payload = parse_router_output(result.stdout, result.returncode)
    if result.stderr.strip():
        payload["routerStderrTail"] = result.stderr.strip()[-500:]
    return payload


def compact_cycle(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        key: payload[key]
        for key in (
            "status",
            "owner",
            "signal",
            "runStatus",
            "exitCode",
            "reason",
            "readyCount",
            "stocks",
            "pendingOwners",
            "routerReturnCode",
        )
        if key in payload
    }


def dispatch_completion_chain(
    cycle_runner: Callable[[], dict[str, Any]],
    max_owner_runs: int,
) -> dict[str, Any]:
    if max_owner_runs < 1:
        raise ValueError("max_owner_runs must be at least 1")
    cycle_results: list[dict[str, Any]] = []
    owners_run: list[str] = []
    completed_owner_runs = 0
    terminal_status = "idle"

    while True:
        try:
            payload = cycle_runner()
        except Exception as error:  # noqa: BLE001 - convert dispatcher faults to a bounded status
            payload = {
                "status": "run_failed",
                "runStatus": "dispatcher_cycle_failed",
                "routerReturnCode": 1,
                "error": str(error)[:300],
            }
        cycle_results.append(compact_cycle(payload))
        status = str(payload.get("status") or "run_failed")
        run_status = str(payload.get("runStatus") or "")
        try:
            router_returncode = int(payload.get("routerReturnCode") or 0)
        except (TypeError, ValueError):
            router_returncode = 1

        if status == "triggered" and run_status == "done" and router_returncode == 0:
            completed_owner_runs += 1
            owner = str(payload.get("owner") or "")
            if owner:
                owners_run.append(owner)
            if completed_owner_runs >= max_owner_runs:
                terminal_status = "chain_limit"
                break
            # The owner has finished and its runner cleanup has returned. Start a
            # fresh router cycle immediately; that cycle rechecks every lock and
            # current production state before selecting at most one next owner.
            continue

        terminal_status = status
        break

    if terminal_status in {"run_failed", "summary_error", "deferred"}:
        overall_status = terminal_status
    elif completed_owner_runs:
        overall_status = "triggered"
    else:
        overall_status = terminal_status

    return {
        "status": overall_status,
        "finalStatus": terminal_status,
        "completionDriven": True,
        "completedOwnerRuns": completed_owner_runs,
        "completionFollowups": max(0, completed_owner_runs - 1),
        "ownersRun": owners_run,
        "maxOwnerRuns": max_owner_runs,
        "cycleCount": len(cycle_results),
        "cycleResults": cycle_results,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--python", type=pathlib.Path, default=DEFAULT_PYTHON)
    parser.add_argument("--router", type=pathlib.Path, default=DEFAULT_ROUTER)
    parser.add_argument("--max-owner-runs", type=int, default=DEFAULT_MAX_OWNER_RUNS)
    args = parser.parse_args()

    if not 1 <= args.max_owner_runs <= MAX_OWNER_RUNS_LIMIT:
        parser.error(f"--max-owner-runs must be between 1 and {MAX_OWNER_RUNS_LIMIT}")

    result = dispatch_completion_chain(
        lambda: run_router_cycle(args.python, args.router),
        args.max_owner_runs,
    )
    print(json.dumps(result, sort_keys=True))
    return 2 if result["status"] in {"run_failed", "summary_error"} else 0


if __name__ == "__main__":
    raise SystemExit(main())
