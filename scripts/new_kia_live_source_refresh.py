#!/usr/bin/env python3
"""Refresh the complete O'Regan's Kia Halifax new-Kia inventory evidence."""

from __future__ import annotations

import argparse
import hashlib
import html as html_lib
import json
import re
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any


API_BASE = "https://oserv3.oreganscdn.com/api/vehicle-inventory-search/"
SOURCE_PAGE = (
    "https://www.oregans.com/inventory/"
    "?search.vehicle-inventory-type-ids.0=1"
    "&search.vehicle-make-ids.0=24"
    "&search.lot-location-ids.0=15"
)
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"


def now_local_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def strip_tags(value: str | None) -> str | None:
    if not value:
        return None
    text = re.sub(r"<[^>]+>", " ", value)
    text = html_lib.unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    return text or None


def first(pattern: str, value: str, flags: int = 0) -> str | None:
    match = re.search(pattern, value, flags)
    return html_lib.unescape(match.group(1)).strip() if match else None


def class_text(class_name: str, value: str) -> str | None:
    raw = first(
        rf'<[^>]+class="[^"]*\b{re.escape(class_name)}\b[^"]*"[^>]*>(.*?)</[^>]+>',
        value,
        re.DOTALL,
    )
    return strip_tags(raw)


def spec_text(class_name: str, value: str) -> str | None:
    block = first(
        rf'<div[^>]+class="[^"]*\b{re.escape(class_name)}\b[^"]*"[^>]*>(.*?)</div>\s*</li>',
        value,
        re.DOTALL,
    )
    if not block:
        return None
    raw = first(r'<span[^>]+class="[^"]*\bouvsrValue\b[^"]*"[^>]*>(.*?)</span>', block, re.DOTALL)
    return strip_tags(raw)


def parse_vehicle(result: dict[str, Any], source_index: int) -> dict[str, Any]:
    markup = result.get("html") or ""
    stock = first(r'data-vehicle-stock="([^"]+)"', markup) or spec_text("ouvsrStockNumber", markup)
    year_text = class_text("ouvsrYear", markup)
    price_text = class_text("currencyValue", markup)
    price = int(re.sub(r"\D", "", price_text)) if price_text and re.sub(r"\D", "", price_text) else None
    detail_path = first(r'<a[^>]+href="([^"]+)"[^>]+class="[^"]*\bouvsrHeadingLink\b', markup)
    if not detail_path:
        detail_path = first(r'<a[^>]+href="([^"]+)"[^>]+class="[^"]*\bouvsrPhoto\b', markup)
    detail_url = urllib.parse.urljoin("https://www.oregans.com", detail_path or "") or None
    contact_path = first(r'href="([^"]*check-availability/\?vehicle\.vin=[^"]+)"', markup)
    contact_url = urllib.parse.urljoin("https://www.oregans.com", contact_path or "") or None
    vin = None
    if contact_url:
        vin = urllib.parse.parse_qs(urllib.parse.urlparse(contact_url).query).get("vehicle.vin", [None])[0]
    make = class_text("ouvsrMake", markup)
    model = class_text("ouvsrModel", markup)
    trim = class_text("ouvsrTrimAndPackage", markup)
    title = " ".join(part for part in (year_text, make, model, trim) if part)
    vehicle = result.get("vehicle") or {}
    return {
        "sourceIndex": source_index,
        "vehicleId": vehicle.get("id"),
        "stock": stock,
        "stockNumber": stock,
        "vin": vin,
        "year": int(year_text) if year_text and year_text.isdigit() else year_text,
        "make": make,
        "model": model,
        "trim": trim,
        "title": title or None,
        "price": price,
        "priceNumber": price,
        "priceText": f"$ {price:,}" if price is not None else None,
        "detailUrl": detail_url,
        "url": detail_url,
        "contactUrl": contact_url,
        "dealership": class_text("ouvsrOwnerLocationLink", markup),
        "inventoryType": class_text("ouvsrInventoryType", markup),
        "colour": spec_text("ouvsrExteriorColor", markup),
        "color": spec_text("ouvsrExteriorColor", markup),
        "engine": spec_text("ouvsrEngine", markup),
        "transmission": spec_text("ouvsrTransmission", markup),
        "drivetrain": spec_text("ouvsrDrivetrain", markup),
        "fuelType": spec_text("ouvsrFuelType", markup),
        "rawHtmlLength": len(markup),
    }


def fetch_page(offset: int, limit: int) -> tuple[dict[str, Any], str]:
    params = {
        "search.vehicle-inventory-type-ids.0": "1",
        "search.vehicle-make-ids.0": "24",
        "search.lot-location-ids.0": "15",
        "do-search": "1",
        "search.results-offset": str(offset),
        "search.results-limit": str(limit),
        "app.widgetProfile.id": "5626e7e6-430b-41dc-a52c-3a425f529ee1.searchResults.search",
        "app.referrer": SOURCE_PAGE,
    }
    url = API_BASE + "?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=45) as response:
        data = json.load(response)
        status = response.status
    if status != 200:
        raise RuntimeError(f"O'Regan's search returned HTTP {status}")
    return data, url


def build_output(limit: int) -> dict[str, Any]:
    first_page, first_url = fetch_page(0, limit)
    search = first_page.get("search") or {}
    total = int(((search.get("stats") or {}).get("totalResultsCount") or 0))
    raw_results = list(search.get("results") or [])
    offset = len(raw_results)
    while offset < total:
        page, _ = fetch_page(offset, limit)
        page_results = list(((page.get("search") or {}).get("results") or []))
        if not page_results:
            break
        raw_results.extend(page_results)
        offset += len(page_results)

    vehicles = [parse_vehicle(row, index) for index, row in enumerate(raw_results)]
    missing_stock = sum(not row.get("stock") for row in vehicles)
    missing_vin = sum(not row.get("vin") for row in vehicles)
    missing_price = sum(row.get("price") is None for row in vehicles)
    fingerprint_rows = [
        {
            "stock": row.get("stock"),
            "vin": row.get("vin"),
            "title": row.get("title"),
            "price": row.get("price"),
            "detailUrl": row.get("detailUrl"),
        }
        for row in vehicles
    ]
    fingerprint = hashlib.sha256(
        json.dumps(fingerprint_rows, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    healthy = total > 0 and len(vehicles) == total and missing_stock == 0 and missing_vin == 0
    return {
        "source": "O'Regan's Kia Halifax New Kia live inventory",
        "sourcePage": SOURCE_PAGE,
        "searchApiUrl": first_url,
        "fetchedAt": now_local_iso(),
        "httpStatus": 200,
        "count": len(vehicles),
        "totalResultsCount": total,
        "resultsReturned": len(vehicles),
        "missingStockCount": missing_stock,
        "missingVinCount": missing_vin,
        "missingVisiblePriceCount": missing_price,
        "sourceHealthy": healthy,
        "fingerprint": fingerprint,
        "vehicles": vehicles,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--latest", type=Path)
    parser.add_argument("--page-size", type=int, default=100)
    args = parser.parse_args()
    output = build_output(args.page_size)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    if args.latest:
        args.latest.parent.mkdir(parents=True, exist_ok=True)
        args.latest.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({key: output[key] for key in (
        "fetchedAt", "count", "totalResultsCount", "resultsReturned", "missingStockCount",
        "missingVinCount", "missingVisiblePriceCount", "sourceHealthy", "fingerprint"
    )}, indent=2))
    return 0 if output["sourceHealthy"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
