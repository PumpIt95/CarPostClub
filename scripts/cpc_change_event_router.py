#!/Users/konnerhaas/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3
"""Route CPC and O'Regan's changes to the one automation that owns each action."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import pathlib
import re
import subprocess
import tempfile
from typing import Any
from zoneinfo import ZoneInfo


LOCAL_TZ = ZoneInfo("America/Halifax")
ALLOWED_DEALERSHIP_IDS = frozenset({"2", "3", "15", "18"})
USED_INVENTORY_TYPE_ID = "2"
PUBLISHER_ID = "facebook-ready-publisher"
OWNER_TARGETS = {
    "live-facebook-listing-sync": "oregans_membership",
    "listing-disclosure-audit-and-fix": "oregans_details",
    "photo-package-readiness-monitor": "cpc_package",
}
OWNER_PRIORITY = (
    "live-facebook-listing-sync",
    PUBLISHER_ID,
    "listing-disclosure-audit-and-fix",
    "photo-package-readiness-monitor",
)
DEFAULT_STATE_PATH = pathlib.Path.home() / ".codex/automation-watchdog/cpc-change-router-state.json"
DEFAULT_HELPER = pathlib.Path(
    "/Users/konnerhaas/.codex/skills/konner-production-access/scripts/konner_production_access.py"
)
DEFAULT_RUNNER = pathlib.Path("/Users/konnerhaas/.codex/launchd/run_missed_automation.sh")
DEFAULT_SINGLETON = pathlib.Path(
    "/Users/konnerhaas/.codex/skills/konner-ops-automation/scripts/automation_singleton.sh"
)
DEFAULT_LANE = pathlib.Path(
    "/Users/konnerhaas/.codex/skills/konner-ops-automation/scripts/automation_lane.sh"
)
DEFAULT_RUNNER_LOCK = pathlib.Path.home() / ".codex/automation-watchdog/catchup-runner.lock"
DEFAULT_MAINTENANCE_FLAG = pathlib.Path("/Users/konnerhaas/Documents/CPC2/.automation_maintenance_mode")
PYTHON_BIN = pathlib.Path(
    "/Users/konnerhaas/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"
)
WINDOW_START_MINUTE = 9 * 60
WINDOW_END_MINUTE = 19 * 60
PUBLISHER_UNCHANGED_RETRY_SECONDS = 90 * 60
FAILED_RETRY_SECONDS = 30 * 60
DEFERRED_RETRY_SECONDS = 5 * 60
SUMMARY_TIMEOUT_SECONDS = 45
RUNNER_TIMEOUT_SECONDS = 5_700


def int_or_zero(value: Any) -> int:
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return 0


def within_daily_window(now: dt.datetime) -> bool:
    local = now.astimezone(LOCAL_TZ)
    minute = local.hour * 60 + local.minute
    return WINDOW_START_MINUTE <= minute < WINDOW_END_MINUTE


def stable_hash(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def candidate_view(summary: dict[str, Any]) -> dict[str, Any]:
    raw_items = summary.get("readyToPublishItems")
    identity_mode = isinstance(raw_items, list)
    selected: list[dict[str, Any]] = []
    if identity_mode:
        for raw in raw_items:
            if not isinstance(raw, dict):
                continue
            dealership_id = str(raw.get("dealershipId") or "").strip()
            inventory_type_id = str(raw.get("inventoryTypeId") or "").strip()
            if dealership_id not in ALLOWED_DEALERSHIP_IDS or inventory_type_id != USED_INVENTORY_TYPE_ID:
                continue
            selected.append({
                "albumId": str(raw.get("albumId") or "").strip(),
                "stockNumber": str(raw.get("stockNumber") or "").strip().upper(),
                "vin": str(raw.get("vin") or "").strip().upper(),
                "dealershipId": dealership_id,
                "inventoryTypeId": inventory_type_id,
                "mediaCount": int_or_zero(raw.get("mediaCount")),
                "updatedAt": str(raw.get("updatedAt") or "").strip(),
            })
        selected.sort(key=lambda item: (
            item["albumId"], item["stockNumber"], item["vin"], item["updatedAt"], item["mediaCount"]
        ))
        ready_count = len(selected)
        payload: Any = selected
        mode = "ready-item-identities"
    else:
        ready_count = int_or_zero(summary.get("readyToPublish"))
        payload = {"legacyReadyCount": ready_count}
        mode = "count-fallback"
    return {
        "readyCount": ready_count,
        "stocks": [item["stockNumber"] for item in selected if item["stockNumber"]],
        "signature": stable_hash(payload),
        "identityMode": mode,
    }


def owner_targets(summary: dict[str, Any]) -> dict[str, str]:
    signals = summary.get("automationSignals")
    if not isinstance(signals, dict) or int_or_zero(signals.get("version")) < 1:
        return {}
    cpc = signals.get("cpc") if isinstance(signals.get("cpc"), dict) else {}
    oregans = signals.get("oregans") if isinstance(signals.get("oregans"), dict) else {}
    package = str(cpc.get("packageFingerprint") or "").strip()
    membership = str(oregans.get("membershipFingerprint") or "").strip()
    price = str(oregans.get("priceFingerprint") or "").strip()
    details = str(oregans.get("detailsFingerprint") or "").strip()
    membership_change_run = str(oregans.get("latestMembershipChangeRunId") or "").strip()
    price_change_run = str(oregans.get("latestPriceChangeRunId") or "").strip()
    details_change_run = str(oregans.get("latestDetailsChangeRunId") or "").strip()
    targets: dict[str, str] = {}
    if package:
        targets["photo-package-readiness-monitor"] = package
    if membership:
        targets["live-facebook-listing-sync"] = (
            stable_hash({"membership": membership, "latestChangeRun": membership_change_run})
            if membership_change_run else membership
        )
    if price or details:
        targets["listing-disclosure-audit-and-fix"] = stable_hash({
            "latestPriceChangeRun": price_change_run,
            "latestDetailsChangeRun": details_change_run,
        })
    return targets


def sync_change_pending(
    pending: dict[str, Any],
    previous_targets: dict[str, Any],
    current_targets: dict[str, str],
    now: dt.datetime,
) -> list[str]:
    changed: list[str] = []
    for owner, target in current_targets.items():
        previous = str(previous_targets.get(owner) or "")
        if not previous or previous == target:
            continue
        signal = OWNER_TARGETS[owner]
        existing = pending.get(owner) if isinstance(pending.get(owner), dict) else {}
        if str(existing.get("targetSignature") or "") == target:
            continue
        pending[owner] = {
            "owner": owner,
            "signal": signal,
            "targetSignature": target,
            "detectedAt": now.isoformat(),
            "attempts": 0,
            "lastRunStatus": "pending",
            "lastAttemptEpoch": 0,
        }
        changed.append(owner)
    return changed


def publisher_should_queue(candidate: dict[str, Any], publisher: dict[str, Any], now_epoch: int) -> bool:
    if int_or_zero(candidate.get("readyCount")) == 0:
        return False
    signature = str(candidate.get("signature") or "")
    last_signature = str(publisher.get("lastAttemptSignature") or "")
    if not last_signature or last_signature != signature:
        return True
    elapsed = max(0, now_epoch - int_or_zero(publisher.get("lastAttemptEpoch")))
    last_status = str(publisher.get("lastRunStatus") or "")
    if last_status in {"failed", "timeout", "error"}:
        retry = FAILED_RETRY_SECONDS
    elif last_status in {"deferred", "busy", "covered"}:
        retry = DEFERRED_RETRY_SECONDS
    else:
        retry = PUBLISHER_UNCHANGED_RETRY_SECONDS
    return elapsed >= retry


def sync_publisher_pending(
    pending: dict[str, Any],
    publisher: dict[str, Any],
    candidate: dict[str, Any],
    now: dt.datetime,
) -> bool:
    if int_or_zero(candidate.get("readyCount")) == 0:
        pending.pop(PUBLISHER_ID, None)
        return False
    signature = str(candidate.get("signature") or "")
    existing = pending.get(PUBLISHER_ID) if isinstance(pending.get(PUBLISHER_ID), dict) else {}
    if str(existing.get("targetSignature") or "") == signature:
        return False
    if not publisher_should_queue(candidate, publisher, int(now.timestamp())):
        return False
    pending[PUBLISHER_ID] = {
        "owner": PUBLISHER_ID,
        "signal": "ready_to_publish",
        "targetSignature": signature,
        "detectedAt": now.isoformat(),
        "attempts": 0,
        "lastRunStatus": "pending",
        "lastAttemptEpoch": 0,
        "readyCount": candidate["readyCount"],
        "stocks": candidate["stocks"],
    }
    return True


def coalesce_ready_package_work(
    pending: dict[str, Any],
    changed_owners: list[str],
    publisher_queued: bool,
) -> None:
    if not publisher_queued or "photo-package-readiness-monitor" not in changed_owners:
        return
    # The publisher performs the same current-package/readiness gates. Keep the
    # separate readiness owner for non-ready changes, but avoid a duplicate AI
    # run when this exact poll already queued actionable publishing work.
    pending.pop("photo-package-readiness-monitor", None)
    changed_owners.remove("photo-package-readiness-monitor")


def pending_ready(item: dict[str, Any], now_epoch: int) -> bool:
    last_attempt = int_or_zero(item.get("lastAttemptEpoch"))
    if not last_attempt:
        return True
    status = str(item.get("lastRunStatus") or "")
    retry = FAILED_RETRY_SECONDS if status in {"failed", "timeout", "error"} else DEFERRED_RETRY_SECONDS
    return now_epoch - last_attempt >= retry


def next_pending_owner(pending: dict[str, Any], now_epoch: int) -> tuple[str, dict[str, Any]] | None:
    for owner in OWNER_PRIORITY:
        item = pending.get(owner)
        if isinstance(item, dict) and pending_ready(item, now_epoch):
            return owner, item
    return None


def load_state(path: pathlib.Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def save_state(path: pathlib.Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(state, handle, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def run_checked(command: list[str], timeout: int) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, text=True, capture_output=True, timeout=timeout, check=False)


def fetch_summary(helper: pathlib.Path, summary_file: pathlib.Path | None) -> dict[str, Any]:
    if summary_file:
        value = json.loads(summary_file.read_text(encoding="utf-8"))
        if not isinstance(value, dict):
            raise RuntimeError("summary fixture is not an object")
        return value
    result = run_checked([str(PYTHON_BIN), str(helper), "operations-summary", "--json"], SUMMARY_TIMEOUT_SECONDS)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip() or f"exit {result.returncode}"
        raise RuntimeError(f"production summary failed: {detail[:400]}")
    value = json.loads(result.stdout)
    if not isinstance(value, dict) or value.get("ok") is not True:
        raise RuntimeError("production summary was not healthy")
    return value


def availability_blocker(args: argparse.Namespace, owner: str) -> str:
    if args.maintenance_flag.exists():
        return "maintenance_mode"
    if args.runner_lock.exists():
        return "another_codex_runner_active"
    singleton = run_checked([str(args.singleton), "status", owner], 10)
    if singleton.returncode != 0 or "singleton_status=free" not in singleton.stdout:
        return f"{owner}_singleton_not_free"
    lane = run_checked([str(args.lane), "status", "facebook-browser"], 10)
    if lane.returncode != 0 or "lane_status=free" not in lane.stdout:
        return "facebook_browser_lane_not_free"
    return ""


def parse_runner_status(stdout: str, returncode: int) -> str:
    matches = re.findall(r"^automation_run_status=([^\s]+)", stdout, flags=re.MULTILINE)
    if matches:
        return matches[-1]
    return "done" if returncode == 0 else "failed"


def emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, sort_keys=True))


def parse_now(value: str | None) -> dt.datetime:
    if not value:
        return dt.datetime.now(LOCAL_TZ)
    parsed = dt.datetime.fromisoformat(value)
    return parsed.replace(tzinfo=LOCAL_TZ) if parsed.tzinfo is None else parsed.astimezone(LOCAL_TZ)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-path", type=pathlib.Path, default=DEFAULT_STATE_PATH)
    parser.add_argument("--helper", type=pathlib.Path, default=DEFAULT_HELPER)
    parser.add_argument("--runner", type=pathlib.Path, default=DEFAULT_RUNNER)
    parser.add_argument("--singleton", type=pathlib.Path, default=DEFAULT_SINGLETON)
    parser.add_argument("--lane", type=pathlib.Path, default=DEFAULT_LANE)
    parser.add_argument("--runner-lock", type=pathlib.Path, default=DEFAULT_RUNNER_LOCK)
    parser.add_argument("--maintenance-flag", type=pathlib.Path, default=DEFAULT_MAINTENANCE_FLAG)
    parser.add_argument("--summary-file", type=pathlib.Path)
    parser.add_argument("--now")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    now = parse_now(args.now)
    now_epoch = int(now.timestamp())
    state = load_state(args.state_path)
    state.update({"version": 2, "lastCheckedAt": now.isoformat()})
    pending = state.get("pending") if isinstance(state.get("pending"), dict) else {}
    publisher = state.get("publisher") if isinstance(state.get("publisher"), dict) else {}
    previous_targets = state.get("observedOwnerTargets") if isinstance(state.get("observedOwnerTargets"), dict) else {}
    state["pending"] = pending
    state["publisher"] = publisher

    if not within_daily_window(now):
        state["lastCheckStatus"] = "outside_daily_window"
        save_state(args.state_path, state)
        emit({"status": "outside_daily_window", "window": "09:00-19:00 America/Halifax"})
        return 0

    try:
        summary = fetch_summary(args.helper, args.summary_file)
        candidate = candidate_view(summary)
        targets = owner_targets(summary)
    except Exception as error:  # noqa: BLE001 - bounded watchdog diagnostic
        consecutive = int_or_zero(state.get("consecutiveSummaryErrors")) + 1
        state.update({
            "lastCheckStatus": "summary_error",
            "lastError": str(error)[:500],
            "consecutiveSummaryErrors": consecutive,
        })
        save_state(args.state_path, state)
        emit({"status": "summary_error", "consecutiveErrors": consecutive, "error": str(error)[:300]})
        return 2 if consecutive >= 3 else 0

    changed_owners = sync_change_pending(pending, previous_targets, targets, now)
    publisher_queued = sync_publisher_pending(pending, publisher, candidate, now)
    coalesce_ready_package_work(pending, changed_owners, publisher_queued)
    state.update({
        "lastGeneratedAt": summary.get("generatedAt"),
        "lastReadyCount": candidate["readyCount"],
        "lastReadySignature": candidate["signature"],
        "lastReadyStocks": candidate["stocks"],
        "identityMode": candidate["identityMode"],
        "consecutiveSummaryErrors": 0,
        "lastError": "",
    })
    if targets:
        state["observedOwnerTargets"] = targets

    selected = next_pending_owner(pending, now_epoch)
    if not selected:
        state["lastCheckStatus"] = "healthy"
        save_state(args.state_path, state)
        emit({
            "status": "idle",
            "signalMode": "fingerprints" if targets else "ready-only-fallback",
            "readyCount": candidate["readyCount"],
            "pendingOwners": sorted(pending),
        })
        return 0

    owner, item = selected
    blocker = availability_blocker(args, owner)
    if blocker:
        item.update({
            "lastRunStatus": "deferred",
            "lastAttemptEpoch": now_epoch,
            "lastDeferredAt": now.isoformat(),
            "lastDeferredReason": blocker,
        })
        state["lastCheckStatus"] = "deferred"
        save_state(args.state_path, state)
        emit({"status": "deferred", "owner": owner, "signal": item.get("signal"), "reason": blocker})
        return 0

    if args.dry_run:
        state["lastCheckStatus"] = "would_trigger"
        save_state(args.state_path, state)
        emit({
            "status": "would_trigger",
            "owner": owner,
            "signal": item.get("signal"),
            "changedOwners": changed_owners,
            "publisherQueued": publisher_queued,
            "readyCount": candidate["readyCount"],
            "stocks": candidate["stocks"],
            "pendingOwners": [candidate_owner for candidate_owner in OWNER_PRIORITY if candidate_owner in pending],
        })
        return 0

    item.update({
        "lastRunStatus": "starting",
        "lastAttemptAt": now.isoformat(),
        "lastAttemptEpoch": now_epoch,
        "attempts": int_or_zero(item.get("attempts")) + 1,
    })
    state["lastCheckStatus"] = "triggering"
    save_state(args.state_path, state)

    try:
        result = run_checked(
            [str(args.runner), owner, now.isoformat(), "cpc-change-event"],
            RUNNER_TIMEOUT_SECONDS,
        )
        run_status = parse_runner_status(result.stdout, result.returncode)
        returncode = result.returncode
    except subprocess.TimeoutExpired:
        result = None
        run_status = "timeout"
        returncode = 124
    except Exception as error:  # noqa: BLE001 - persisted and surfaced below
        result = None
        run_status = "failed"
        returncode = 1
        state["lastError"] = str(error)[:500]

    if run_status in {"busy", "covered", "deferred"}:
        item.update({
            "lastRunStatus": "deferred",
            "lastDeferredAt": dt.datetime.now(LOCAL_TZ).isoformat(),
            "lastDeferredReason": run_status,
        })
        state["lastCheckStatus"] = "deferred"
        save_state(args.state_path, state)
        emit({"status": "deferred", "owner": owner, "signal": item.get("signal"), "reason": run_status})
        return 0

    finished_at = dt.datetime.now(LOCAL_TZ).isoformat()
    if returncode == 0:
        pending.pop(owner, None)
        if owner == PUBLISHER_ID:
            publisher.update({
                "lastAttemptAt": now.isoformat(),
                "lastAttemptEpoch": now_epoch,
                "lastAttemptSignature": candidate["signature"],
                "lastRunStatus": run_status,
                "lastRunFinishedAt": finished_at,
            })
        state["lastCheckStatus"] = "run_finished"
    else:
        item.update({"lastRunStatus": run_status, "lastRunFinishedAt": finished_at})
        if owner == PUBLISHER_ID:
            publisher.update({
                "lastAttemptAt": now.isoformat(),
                "lastAttemptEpoch": now_epoch,
                "lastAttemptSignature": candidate["signature"],
                "lastRunStatus": run_status,
                "lastRunFinishedAt": finished_at,
            })
        state["lastCheckStatus"] = "run_failed"
    save_state(args.state_path, state)
    emit({
        "status": "triggered" if returncode == 0 else "run_failed",
        "owner": owner,
        "signal": item.get("signal"),
        "runStatus": run_status,
        "exitCode": returncode,
        "readyCount": candidate["readyCount"],
        "stocks": candidate["stocks"],
        "pendingOwners": [candidate_owner for candidate_owner in OWNER_PRIORITY if candidate_owner in pending],
    })
    return 0 if returncode == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
