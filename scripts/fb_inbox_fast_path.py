#!/usr/bin/env python3
"""Decide whether FB Marketplace inbox triage can use the no-op fast path.

The automation still has to read the live inbox through Chrome. This helper
keeps the decision after that first shallow capture deterministic and cheap.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_BASELINE = Path(
    "/Users/konnerhaas/Documents/CPC2/automation-runs/"
    "fb-inbox-triage-and-reply-current-capture.json"
)

DATE_LABEL_RE = re.compile(
    r"\s(?:"
    r"\d{1,2}:\d{2}\s*(?:AM|PM)|"
    r"Mon|Tue|Wed|Thu|Fri|Sat|Sun|"
    r"Jan\s+\d{1,2}|Feb\s+\d{1,2}|Mar\s+\d{1,2}|Apr\s+\d{1,2}|"
    r"May\s+\d{1,2}|Jun\s+\d{1,2}|Jul\s+\d{1,2}|Aug\s+\d{1,2}|"
    r"Sep\s+\d{1,2}|Oct\s+\d{1,2}|Nov\s+\d{1,2}|Dec\s+\d{1,2}|"
    r"\d{2}/\d{2}/\d{2}"
    r")$"
)

WAITING_RE = re.compile(r"\bis waiting for your response\.?$", re.IGNORECASE)
CONTROL_ROW_RE = re.compile(
    r"^(?:Mark as pending|Mark as sold|Mark as available|Delete listing|View listing|Boost listing)$",
    re.IGNORECASE,
)


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def rows_from_payload(payload: Any) -> list[str]:
    if isinstance(payload, list):
        return [str(row) for row in payload if str(row).strip()]
    if not isinstance(payload, dict):
        raise ValueError("rows payload must be a JSON list or capture object")
    if isinstance(payload.get("row_strings"), list):
        return [str(row) for row in payload["row_strings"] if str(row).strip()]
    if isinstance(payload.get("rows"), list):
        return [str(row) for row in payload["rows"] if str(row).strip()]
    threads = payload.get("threads")
    if isinstance(threads, list):
        ordered = sorted(
            threads,
            key=lambda row: row.get("row_order")
            if isinstance(row, dict) and row.get("row_order") is not None
            else 999999,
        )
        rows = []
        for thread in ordered:
            if not isinstance(thread, dict):
                continue
            raw = thread.get("raw_text")
            if raw:
                rows.append(str(raw))
        if rows:
            return rows
    raise ValueError(
        "capture object has no rows list, row_strings list, or threads[].raw_text values"
    )


def baseline_rows(path: Path) -> tuple[list[str], dict[str, Any]]:
    if not path.exists():
        return [], {}
    payload = load_json(path)
    return rows_from_payload(payload), payload if isinstance(payload, dict) else {}


def normalize_row(row: str) -> str:
    text = row.replace("Label and manage the chat thread", " ")
    text = text.translate(str.maketrans({"’": "'", "‘": "'", "“": '"', "”": '"'}))
    text = re.sub(r"\s+·\s+", " ", text)
    text = text.replace("2024 Buick Buick Envista", "2024 Buick Envista")
    text = re.sub(r"\s+", " ", text).strip()
    text = DATE_LABEL_RE.sub("", text).strip()
    if CONTROL_ROW_RE.fullmatch(text):
        return ""
    return text


def is_ordered_subsequence(needles: list[str], haystack: list[str]) -> bool:
    cursor = 0
    for candidate in haystack:
        if cursor < len(needles) and needles[cursor] == candidate:
            cursor += 1
    return cursor == len(needles)


def response_needed_signatures(rows: list[str]) -> set[str]:
    return {normalize_row(row) for row in rows if WAITING_RE.search(DATE_LABEL_RE.sub("", row).strip())}


def row_equivalent(current: str, prior: str) -> bool:
    if current == prior:
        return True
    current_parts = current.split(" ", 1)
    prior_parts = prior.split(" ", 1)
    if not current_parts or not prior_parts or current_parts[0] != prior_parts[0]:
        return False
    current_rest = current_parts[1] if len(current_parts) > 1 else ""
    prior_rest = prior_parts[1] if len(prior_parts) > 1 else ""
    return bool(current_rest and prior_rest and (current_rest.endswith(prior_rest) or prior_rest.endswith(current_rest)))


def capture_age_hours(payload: dict[str, Any], now: datetime) -> float | None:
    raw = payload.get("captured_at_utc")
    if not raw:
        return None
    try:
        captured = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return None
    return (now - captured.astimezone(timezone.utc)).total_seconds() / 3600


def decide(
    *,
    current_rows: list[str],
    prior_rows: list[str],
    prior_payload: dict[str, Any],
    top_n: int,
    max_full_age_hours: float,
    force_full_if_baseline_stale: bool,
) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    reasons: list[str] = []
    current_top = current_rows[:top_n]
    prior_top = prior_rows[:top_n]
    current_sig = [normalize_row(row) for row in current_top if normalize_row(row)]
    prior_sig = [normalize_row(row) for row in prior_top if normalize_row(row)]

    if not current_sig:
        reasons.append("no_current_rows")
    if not prior_sig:
        reasons.append("missing_baseline")

    compare_len = min(len(current_sig), len(prior_sig), top_n)
    top_changed = len(current_sig) < min(8, top_n)
    if not top_changed:
        top_changed = any(
            not row_equivalent(current, prior)
            for current, prior in zip(current_sig[:compare_len], prior_sig[:compare_len])
        )
    if top_changed and current_sig and prior_sig:
        stable_prefix_len = min(8, len(current_sig), len(prior_sig), top_n)
        stable_prefix = all(
            row_equivalent(current, prior)
            for current, prior in zip(current_sig[:stable_prefix_len], prior_sig[:stable_prefix_len])
        )
        ordered_subset = is_ordered_subsequence(current_sig, prior_sig) or is_ordered_subsequence(prior_sig, current_sig)
        small_virtualization_delta = abs(len(current_sig) - len(prior_sig)) <= 2
        if stable_prefix and ordered_subset and small_virtualization_delta:
            top_changed = False
    if top_changed and current_sig and prior_sig:
        reasons.append("top_fingerprint_changed")

    current_waiting = response_needed_signatures(current_top)
    prior_waiting = response_needed_signatures(prior_rows)
    new_waiting = sorted(current_waiting - prior_waiting)
    if new_waiting:
        reasons.append("new_response_needed_marker")

    age_hours = capture_age_hours(prior_payload, now)
    stale_baseline = age_hours is None or age_hours > max_full_age_hours
    if force_full_if_baseline_stale and stale_baseline:
        reasons.append("baseline_stale")

    decision = "full_path_required" if reasons else "fast_path_noop"
    return {
        "decision": decision,
        "reasons": reasons,
        "current_top_count": len(current_top),
        "prior_top_count": len(prior_top),
        "top_n": top_n,
        "baseline_age_hours": age_hours,
        "new_response_needed": new_waiting,
        "current_top_signatures": current_sig[:top_n],
        "prior_top_signatures": prior_sig[:top_n],
        "summary": (
            "Shallow inbox fingerprint unchanged; full scroll/inventory/Telegram can be skipped."
            if decision == "fast_path_noop"
            else "Run the full inbox triage path."
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("rows_json", type=Path, help="JSON list of shallow row strings, or a capture JSON file.")
    parser.add_argument("--baseline", type=Path, default=DEFAULT_BASELINE)
    parser.add_argument("--top-n", type=int, default=24)
    parser.add_argument("--max-full-age-hours", type=float, default=6.0)
    parser.add_argument(
        "--allow-stale-baseline",
        action="store_true",
        help="Do not require a full pass only because the saved baseline is old.",
    )
    args = parser.parse_args()

    try:
        current_rows = rows_from_payload(load_json(args.rows_json))
        prior_rows, prior_payload = baseline_rows(args.baseline)
        result = decide(
            current_rows=current_rows,
            prior_rows=prior_rows,
            prior_payload=prior_payload,
            top_n=max(1, args.top_n),
            max_full_age_hours=args.max_full_age_hours,
            force_full_if_baseline_stale=not args.allow_stale_baseline,
        )
    except Exception as exc:
        result = {
            "decision": "full_path_required",
            "reasons": ["helper_error"],
            "error": str(exc),
            "summary": "Run the full inbox triage path.",
        }

    json.dump(result, sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0 if result["decision"] == "fast_path_noop" else 2


if __name__ == "__main__":
    raise SystemExit(main())
