#!/usr/bin/env python3
"""Tune UCA cron offsets from observed automation run durations.

The Codex automation scheduler is cron/rrule based, so UCA jobs cannot natively
trigger each other on completion. This helper measures recent run artifact
durations and recommends tighter minute offsets for the fixed cron schedule.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import statistics
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path("/Users/konnerhaas/Documents/CPC2")
AUTOMATIONS = Path("/Users/konnerhaas/.codex/automations")
RUNS = ROOT / "automation-runs"
BASELINE_PATH = RUNS / "uca-schedule-tuning-baseline.json"
REPORT_PATH = RUNS / "uca-schedule-tuning-report.json"
MANUAL_MINUTE_OVERRIDES = {
    # Konner requested the Facebook-ready publisher run at :15 after each hour.
    "facebook-ready-publisher": 15,
}

UCA = {
    "photo-package-readiness-monitor": {
        "weekday": AUTOMATIONS / "photo-package-readiness-monitor" / "automation.toml",
        "saturday": AUTOMATIONS / "photo-package-readiness-monitor-saturday" / "automation.toml",
        "default_minutes": 8,
    },
    "live-facebook-listing-sync": {
        "weekday": AUTOMATIONS / "live-facebook-listing-sync" / "automation.toml",
        "saturday": AUTOMATIONS / "live-facebook-listing-sync-saturday" / "automation.toml",
        "default_minutes": 15,
    },
    "facebook-ready-publisher": {
        "weekday": AUTOMATIONS / "facebook-ready-publisher" / "automation.toml",
        "saturday": AUTOMATIONS / "facebook-ready-publisher-saturday" / "automation.toml",
        "default_minutes": 12,
    },
    "listing-disclosure-audit-and-fix": {
        "weekday": AUTOMATIONS / "listing-disclosure-audit-and-fix" / "automation.toml",
        "saturday": AUTOMATIONS / "listing-disclosure-audit-and-fix-saturday" / "automation.toml",
        "default_minutes": 20,
    },
}


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return None


def percentile(values: list[float], pct: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = math.ceil((pct / 100) * len(ordered)) - 1
    return ordered[max(0, min(index, len(ordered) - 1))]


def ceil_to_step(value: float, step: int = 5) -> int:
    return int(math.ceil(value / step) * step)


def parse_json_generated_at(path: Path) -> datetime | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return None
    value = data.get("generatedAt") if isinstance(data, dict) else None
    return parse_iso(value)


def run_times(path: Path, automation_id: str) -> tuple[datetime, datetime] | None:
    """Estimate run duration from automation-owned top-level artifacts.

    Do not recurse into downloaded package/media folders. Those files can keep
    source/archive mtimes that are unrelated to the automation run and can make
    schedule recommendations wildly too conservative.
    """
    started = parse_run_timestamp(path.name, automation_id)
    file_mtimes: list[float] = []
    generated_times: list[datetime] = []
    for item in path.iterdir():
        if not item.is_file():
            continue
        try:
            file_mtimes.append(item.stat().st_mtime)
        except OSError:
            continue
        if item.suffix == ".json":
            generated = parse_json_generated_at(item)
            if generated:
                generated_times.append(generated)
    if not file_mtimes:
        return None
    first_file = datetime.fromtimestamp(min(file_mtimes), timezone.utc)
    if not started:
        started = first_file
    top_level_ended = datetime.fromtimestamp(max(file_mtimes), timezone.utc)
    generated_ended = max(generated_times) if generated_times else None
    ended = max([value for value in [top_level_ended, generated_ended] if value is not None])
    return started, ended


def file_times(path: Path) -> tuple[datetime, datetime] | None:
    times: list[float] = []
    for item in path.rglob("*"):
        if not item.is_file():
            continue
        try:
            times.append(item.stat().st_mtime)
        except OSError:
            continue
    if not times:
        return None
    return (
        datetime.fromtimestamp(min(times), timezone.utc),
        datetime.fromtimestamp(max(times), timezone.utc),
    )


def parse_run_timestamp(name: str, automation_id: str) -> datetime | None:
    prefix = f"{automation_id}-"
    if not name.startswith(prefix):
        return None
    stamp = name[len(prefix) : len(prefix) + 16]
    try:
        return datetime.strptime(stamp, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def collect_runs(automation_id: str, since: datetime | None, limit: int) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    if not RUNS.exists():
        return rows
    for path in RUNS.iterdir():
        if not path.is_dir():
            continue
        name = path.name
        if not name.startswith(f"{automation_id}-"):
            continue
        if name.endswith("-current") or name == f"{automation_id}-current":
            continue
        times = run_times(path, automation_id)
        if not times:
            continue
        started, ended = times
        if since and started < since:
            continue
        duration = max(0.0, (ended - started).total_seconds() / 60)
        if duration > 240:
            continue
        rows.append(
            {
                "path": str(path),
                "startedAt": iso(started),
                "endedAt": iso(ended),
                "durationMinutes": round(duration, 2),
            }
        )
    rows.sort(key=lambda row: row["endedAt"], reverse=True)
    return rows[:limit]


def summarize(rows: list[dict[str, Any]], default_minutes: float) -> dict[str, Any]:
    durations = [float(row["durationMinutes"]) for row in rows]
    if not durations:
        return {
            "sampleCount": 0,
            "medianMinutes": None,
            "p75Minutes": None,
            "p90Minutes": None,
            "defaultMinutes": default_minutes,
            "estimateMinutes": default_minutes,
        }
    p75 = percentile(durations, 75)
    p90 = percentile(durations, 90)
    return {
        "sampleCount": len(durations),
        "medianMinutes": round(statistics.median(durations), 2),
        "p75Minutes": round(p75 or default_minutes, 2),
        "p90Minutes": round(p90 or default_minutes, 2),
        "defaultMinutes": default_minutes,
        "estimateMinutes": round(max(p75 or 0, default_minutes), 2),
    }


def current_minute(path: Path) -> int | None:
    text = path.read_text(encoding="utf-8")
    match = re.search(r"BYMINUTE=(\d+)", text)
    return int(match.group(1)) if match else None


def replace_minute(path: Path, minute: int) -> None:
    text = path.read_text(encoding="utf-8")
    updated = re.sub(r"BYMINUTE=\d+", f"BYMINUTE={minute}", text, count=1)
    if updated != text:
        path.write_text(updated, encoding="utf-8")


def load_baseline() -> datetime | None:
    if not BASELINE_PATH.exists():
        return None
    try:
        data = json.loads(BASELINE_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    return parse_iso(data.get("baselineAt"))


def write_baseline(reason: str) -> dict[str, Any]:
    data = {
        "baselineAt": iso(datetime.now(timezone.utc)),
        "reason": reason,
    }
    BASELINE_PATH.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    return data


def load_groups() -> dict[str, Any]:
    path = AUTOMATIONS / "automation-groups.json"
    return json.loads(path.read_text(encoding="utf-8"))


def save_groups(groups: dict[str, Any], recommendation: dict[str, int]) -> None:
    path = AUTOMATIONS / "automation-groups.json"
    uca = groups.setdefault("groups", {}).setdefault("UCA", {})
    uca["source"] = (
        "Konner provided this grouping on 2026-06-15; adaptive offsets last "
        f"tuned on {iso(datetime.now(timezone.utc))} from observed run durations."
    )
    uca["weekdaySequence"] = [
        {"automationId": "photo-package-readiness-monitor", "minute": recommendation["photo-package-readiness-monitor"]},
        {"automationId": "live-facebook-listing-sync", "minute": recommendation["live-facebook-listing-sync"]},
        {"automationId": "facebook-ready-publisher", "minute": recommendation["facebook-ready-publisher"]},
        {"automationId": "listing-disclosure-audit-and-fix", "minute": recommendation["listing-disclosure-audit-and-fix"]},
    ]
    uca["saturdaySequence"] = [
        {"automationId": "photo-package-readiness-monitor-saturday", "minute": recommendation["photo-package-readiness-monitor"]},
        {"automationId": "live-facebook-listing-sync-saturday", "minute": recommendation["live-facebook-listing-sync"]},
        {"automationId": "facebook-ready-publisher-saturday", "minute": recommendation["facebook-ready-publisher"]},
        {"automationId": "listing-disclosure-audit-and-fix-saturday", "minute": recommendation["listing-disclosure-audit-and-fix"]},
    ]
    path.write_text(json.dumps(groups, indent=2) + "\n", encoding="utf-8")


def build_recommendation(summaries: dict[str, dict[str, Any]], min_samples: int) -> tuple[dict[str, int], list[str]]:
    warnings: list[str] = []
    photo = summaries["photo-package-readiness-monitor"]
    live = summaries["live-facebook-listing-sync"]
    for key in ["photo-package-readiness-monitor", "live-facebook-listing-sync"]:
        if summaries[key]["sampleCount"] < min_samples:
            warnings.append(f"{key} has fewer than {min_samples} post-baseline samples")

    prep_estimate = max(float(photo["estimateMinutes"]), float(live["estimateMinutes"]))
    publisher_minute = ceil_to_step(prep_estimate + 5, 5)
    publisher_minute = max(10, min(45, publisher_minute))
    publisher_minute = MANUAL_MINUTE_OVERRIDES.get("facebook-ready-publisher", publisher_minute)

    disclosure_minute = min(55, publisher_minute + 10)
    return (
        {
            "photo-package-readiness-monitor": 0,
            "live-facebook-listing-sync": 0,
            "facebook-ready-publisher": publisher_minute,
            "listing-disclosure-audit-and-fix": disclosure_minute,
        },
        warnings,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Recommend UCA automation minute offsets from observed run durations.")
    parser.add_argument("--include-history", action="store_true", help="ignore the baseline and use all recent artifacts")
    parser.add_argument("--mark-baseline", action="store_true", help="write the current time as the tuning baseline and exit")
    parser.add_argument("--apply", action="store_true", help="apply recommended BYMINUTE offsets to UCA automation TOML")
    parser.add_argument("--dry-run", action="store_true", help="compatibility alias; default behavior already does not apply changes")
    parser.add_argument("--min-samples", type=int, default=2)
    parser.add_argument("--limit", type=int, default=8)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    if args.mark_baseline:
        data = write_baseline("Start measuring UCA schedule after compressed scheduling change.")
        print(json.dumps(data, indent=2))
        return 0

    since = None if args.include_history else load_baseline()
    runs: dict[str, list[dict[str, Any]]] = {}
    summaries: dict[str, dict[str, Any]] = {}
    current: dict[str, int | None] = {}
    for automation_id, config in UCA.items():
        rows = collect_runs(automation_id, since, args.limit)
        runs[automation_id] = rows
        summaries[automation_id] = summarize(rows, float(config["default_minutes"]))
        current[automation_id] = current_minute(config["weekday"])

    recommendation, warnings = build_recommendation(summaries, args.min_samples)
    insufficient = any(
        summaries[key]["sampleCount"] < args.min_samples
        for key in ["photo-package-readiness-monitor", "live-facebook-listing-sync"]
    )

    applied = False
    if args.apply and not insufficient:
        for automation_id, minute in recommendation.items():
            replace_minute(UCA[automation_id]["weekday"], minute)
            replace_minute(UCA[automation_id]["saturday"], minute)
        save_groups(load_groups(), recommendation)
        applied = True
    elif args.apply and insufficient:
        warnings.append("not applying because post-baseline prep samples are insufficient")

    report = {
        "generatedAt": iso(datetime.now(timezone.utc)),
        "baselineAt": iso(since) if since else None,
        "includeHistory": args.include_history,
        "minSamples": args.min_samples,
        "currentMinutes": current,
        "recommendedMinutes": recommendation,
        "applied": applied,
        "warnings": warnings,
        "summaries": summaries,
        "runs": runs,
    }
    REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(f"report={REPORT_PATH}")
        print(f"baselineAt={report['baselineAt'] or 'none'} includeHistory={args.include_history}")
        print(f"currentMinutes={current}")
        print(f"recommendedMinutes={recommendation} applied={applied}")
        if warnings:
            print("warnings=" + "; ".join(warnings))
        for automation_id, summary in summaries.items():
            print(f"{automation_id}: samples={summary['sampleCount']} p75={summary['p75Minutes']} estimate={summary['estimateMinutes']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
