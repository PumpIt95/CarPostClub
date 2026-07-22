#!/usr/bin/env python3
"""Fail-closed decision gate for rebuilding one unusable publisher handoff."""

from __future__ import annotations

import argparse
import json
import pathlib
from typing import Any


PUBLISHER_IDS = frozenset({
    "facebook-ready-publisher",
    "facebook-ready-publisher-saturday",
})
MIN_SUPPORTED_CLAIM_FAILURES = 2


def load_json(path: pathlib.Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def int_or_zero(value: Any) -> int:
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return 0


def exact_ready_match(owner: dict[str, Any], summary: dict[str, Any]) -> dict[str, Any] | None:
    ready_items = summary.get("readyToPublishItems")
    if not isinstance(ready_items, list):
        return None
    expected = {
        "albumId": str(owner.get("albumId") or "").strip(),
        "stockNumber": str(owner.get("stockNumber") or owner.get("stock") or "").strip().upper(),
        "vin": str(owner.get("vin") or "").strip().upper(),
    }
    if not any(expected.values()):
        return None
    matches: list[dict[str, Any]] = []
    for raw in ready_items:
        if not isinstance(raw, dict):
            continue
        current = {
            "albumId": str(raw.get("albumId") or "").strip(),
            "stockNumber": str(raw.get("stockNumber") or "").strip().upper(),
            "vin": str(raw.get("vin") or "").strip().upper(),
        }
        if all(not value or current[key] == value for key, value in expected.items()):
            matches.append(raw)
    return matches[0] if len(matches) == 1 else None


def classify_rebuild(
    owner: dict[str, Any],
    summary: dict[str, Any],
    *,
    visible_state: str,
    duplicate_state: str,
    original_session_state: str,
) -> dict[str, Any]:
    blockers: list[str] = []
    owner_id = str(owner.get("owner") or owner.get("automationId") or "")
    if owner_id not in PUBLISHER_IDS:
        blockers.append("wrong_owner")
    if owner.get("handoff") is not True:
        blockers.append("not_handoff")
    if owner.get("publishClicked") is True:
        blockers.append("publish_already_clicked")
    if owner.get("backendLiveStatusWritten") is True:
        blockers.append("backend_already_written")
    composer_url = str(owner.get("protectedComposerUrl") or owner.get("composerUrl") or "")
    if "facebook.com/marketplace/create/vehicle" not in composer_url:
        blockers.append("not_vehicle_composer")
    if int_or_zero(owner.get("supportedClaimFailureCount")) < MIN_SUPPORTED_CLAIM_FAILURES:
        blockers.append("supported_claim_failures_below_threshold")
    if owner.get("rebuildAttempted") is True:
        blockers.append("rebuild_already_attempted")
    ready = exact_ready_match(owner, summary)
    if ready is None:
        blockers.append("exact_target_not_currently_ready")
    if visible_state != "blank_or_unusable":
        blockers.append(f"composer_visible_state_{visible_state}")
    if duplicate_state != "none":
        blockers.append(f"duplicate_state_{duplicate_state}")
    if original_session_state != "inactive":
        blockers.append(f"original_session_{original_session_state}")

    allowed = not blockers
    return {
        "status": "rebuild_once_allowed" if allowed else "preserve_handoff",
        "allowed": allowed,
        "blockers": blockers,
        "stockNumber": str((ready or {}).get("stockNumber") or owner.get("stockNumber") or owner.get("stock") or ""),
        "vin": str((ready or {}).get("vin") or owner.get("vin") or ""),
        "albumId": str((ready or {}).get("albumId") or owner.get("albumId") or ""),
        "requiredAction": (
            "archive old lock and claim, close only the exact unusable composer, set rebuildAttempted=true, then run one fresh normal composer cycle"
            if allowed
            else "preserve the handoff and do not open a second composer"
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--owner-json", type=pathlib.Path, required=True)
    parser.add_argument("--operations-summary-json", type=pathlib.Path, required=True)
    parser.add_argument(
        "--visible-state",
        choices=("blank_or_unusable", "recoverable", "unknown"),
        required=True,
    )
    parser.add_argument(
        "--duplicate-state",
        choices=("none", "live", "unknown"),
        required=True,
    )
    parser.add_argument(
        "--original-session-state",
        choices=("inactive", "active", "unknown"),
        required=True,
    )
    args = parser.parse_args()
    result = classify_rebuild(
        load_json(args.owner_json),
        load_json(args.operations_summary_json),
        visible_state=args.visible_state,
        duplicate_state=args.duplicate_state,
        original_session_state=args.original_session_state,
    )
    print(json.dumps(result, sort_keys=True))
    return 0 if result["allowed"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
