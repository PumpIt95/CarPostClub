#!/usr/bin/env python3
"""Clean safe, rebuildable CarPostClub automation run artifacts.

This intentionally avoids automation memory, configs, credentials, browser
profiles, current package caches, production data, and proof JSON/screenshots.
It only works inside CPC2's automation-runs directory.
"""

from __future__ import annotations

import argparse
import json
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path


TEMP_FILE_SUFFIXES = (".base64",)
TEMP_FILE_NAMES = {
    "album-package.zip",
    "album-download.zip",
}
PUBLISH_PROOF_GLOBS = (
    "facebook-selling-after-publish-proof.*",
    "facebook-listing-status-response-*.json",
    "facebook-live-*-detail-proof.json",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Clean safe CPC2 automation temp artifacts."
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=Path.cwd(),
        help="CPC2 workspace root. Defaults to the current directory.",
    )
    parser.add_argument(
        "--min-age-hours",
        type=float,
        default=6,
        help="Only clean files/directories older than this many hours. Default: 6.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually remove files. Without this flag, prints a dry-run plan.",
    )
    parser.add_argument(
        "--no-manifest",
        action="store_true",
        help="Do not write an apply manifest under automation-runs.",
    )
    return parser.parse_args()


def is_inside(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
    except ValueError:
        return False
    return True


def is_old(path: Path, cutoff: float) -> bool:
    try:
        return path.stat().st_mtime < cutoff
    except FileNotFoundError:
        return False


def file_size(path: Path) -> int:
    try:
        return path.stat().st_size
    except FileNotFoundError:
        return 0


def tree_size(path: Path) -> int:
    if path.is_file():
        return file_size(path)
    total = 0
    for child in path.rglob("*"):
        if child.is_file():
            total += file_size(child)
    return total


def has_publish_decision(run_dir: Path) -> bool:
    summary_path = run_dir / "run-decision-summary.final.json"
    if not summary_path.exists():
        return False
    try:
        summary = json.loads(summary_path.read_text())
    except (OSError, json.JSONDecodeError):
        return False
    decision = str(summary.get("decision", "")).lower()
    published = summary.get("published")
    return "published" in decision or bool(published)


def has_publish_proof(run_dir: Path) -> bool:
    if has_publish_decision(run_dir):
        return True
    return all(any(run_dir.glob(pattern)) for pattern in PUBLISH_PROOF_GLOBS[:2])


def is_temp_payload(path: Path) -> bool:
    if path.name.endswith(TEMP_FILE_SUFFIXES):
        return True
    return any(path.name.endswith(name) for name in TEMP_FILE_NAMES)


def collect_cleanup_items(runs_dir: Path, cutoff: float) -> list[dict[str, object]]:
    items: list[dict[str, object]] = []
    for path in sorted(runs_dir.rglob("*")):
        if not path.is_file() or not is_old(path, cutoff):
            continue
        if path.name.endswith(".err") and file_size(path) == 0:
            items.append({"kind": "zero-byte-err", "path": path, "bytes": 0})
            continue
        if is_temp_payload(path):
            items.append({"kind": "temp-payload", "path": path, "bytes": file_size(path)})

    for run_dir in sorted(p for p in runs_dir.iterdir() if p.is_dir()):
        if not is_old(run_dir, cutoff) or not has_publish_proof(run_dir):
            continue
        for child in sorted(run_dir.iterdir()):
            if not child.is_dir() or not is_old(child, cutoff):
                continue
            if child.name.endswith("-package") or child.name.endswith("-package-reordered"):
                items.append(
                    {"kind": "published-temp-package-dir", "path": child, "bytes": tree_size(child)}
                )
    return items


def remove_item(path: Path) -> None:
    if path.is_dir():
        shutil.rmtree(path)
    else:
        path.unlink(missing_ok=True)


def main() -> int:
    args = parse_args()
    root = args.root.expanduser().resolve()
    runs_dir = root / "automation-runs"
    if not runs_dir.is_dir():
        raise SystemExit(f"automation-runs directory not found: {runs_dir}")

    cutoff = time.time() - (args.min_age_hours * 3600)
    items = collect_cleanup_items(runs_dir, cutoff)

    unsafe = [item for item in items if not is_inside(item["path"], runs_dir)]
    if unsafe:
        raise SystemExit("Refusing to clean paths outside automation-runs")

    total_bytes = sum(int(item["bytes"]) for item in items)
    result = {
        "mode": "apply" if args.apply else "dry-run",
        "runsDir": str(runs_dir),
        "minAgeHours": args.min_age_hours,
        "count": len(items),
        "bytes": total_bytes,
        "items": [
            {
                "kind": item["kind"],
                "path": str(Path(item["path"]).relative_to(root)),
                "bytes": item["bytes"],
            }
            for item in items
        ],
    }

    if args.apply:
        for item in items:
            remove_item(Path(item["path"]))
        if not args.no_manifest:
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            manifest = runs_dir / f"artifact-cleanup-{stamp}.json"
            manifest.write_text(json.dumps(result, indent=2) + "\n")
            result["manifest"] = str(manifest.relative_to(root))

    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
