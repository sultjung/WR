#!/usr/bin/env python3
"""Fetch report-date D-2/D-1 crude prices from the official Opinet crude page.

The script deliberately fails when either requested date is unavailable. It never
substitutes a nearby date or fabricates a price.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from datetime import date
from pathlib import Path
from typing import Any

import requests
from bs4 import BeautifulSoup

DEFAULT_URL = "https://www.opinet.co.kr/gloptotSelect.do"
DATE_RE = re.compile(r"(?P<year>\d{2}|\d{4})\s*년\s*(?P<month>\d{1,2})\s*월\s*(?P<day>\d{1,2})\s*일")
NUMBER_RE = re.compile(r"-?\d+(?:,\d{3})*(?:\.\d+)?")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", default="work/report-request.json")
    parser.add_argument("--output", default="work/oil-prices.json")
    parser.add_argument("--url", default=DEFAULT_URL)
    return parser.parse_args()


def normalize_date(text: str) -> str | None:
    match = DATE_RE.search(text.replace("\xa0", " "))
    if not match:
        return None
    year = int(match.group("year"))
    if year < 100:
        year += 2000
    try:
        return date(year, int(match.group("month")), int(match.group("day"))).isoformat()
    except ValueError:
        return None


def parse_number(text: str) -> float | None:
    match = NUMBER_RE.search(text.replace("$", "").strip())
    if not match:
        return None
    try:
        return float(match.group(0).replace(",", ""))
    except ValueError:
        return None


def extract_rows(html: str) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html, "lxml")
    rows: list[dict[str, Any]] = []
    for tr in soup.find_all("tr"):
        cells = [" ".join(cell.get_text(" ", strip=True).split()) for cell in tr.find_all(["th", "td"])]
        if len(cells) < 4:
            continue
        day = normalize_date(cells[0])
        values = [parse_number(value) for value in cells[1:4]]
        if not day or any(value is None for value in values):
            continue
        dubai, brent, wti = (float(value) for value in values)
        rows.append({"date": day, "dubai": dubai, "brent": brent, "wti": wti, "cells": cells[:4]})

    # Some server-rendered versions expose the result table as plain text but not
    # conventional rows. Scan the visible text as a secondary parser.
    text = " ".join(soup.stripped_strings)
    pattern = re.compile(
        r"(?P<date>\d{2,4}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일)\s+"
        r"(?P<dubai>\d+(?:\.\d+)?)\s+(?P<brent>\d+(?:\.\d+)?)\s+(?P<wti>\d+(?:\.\d+)?)"
    )
    for match in pattern.finditer(text):
        day = normalize_date(match.group("date"))
        if not day:
            continue
        rows.append(
            {
                "date": day,
                "dubai": float(match.group("dubai")),
                "brent": float(match.group("brent")),
                "wti": float(match.group("wti")),
                "cells": [match.group("date"), match.group("dubai"), match.group("brent"), match.group("wti")],
            }
        )
    return rows


def select_usd_rows(rows: list[dict[str, Any]], targets: list[str]) -> dict[str, dict[str, Any]]:
    selected: dict[str, dict[str, Any]] = {}
    for target in targets:
        candidates = [row for row in rows if row["date"] == target]
        # Opinet pages can carry both KRW-converted and USD/Bbl rows. Crude USD
        # prices are selected by a deliberately broad but realistic range.
        usd = [row for row in candidates if all(10 <= row[key] <= 250 for key in ("dubai", "brent", "wti"))]
        if usd:
            selected[target] = usd[-1]
    return selected


def fetch_html(url: str) -> str:
    headers = {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131 Safari/537.36 WR-Report/1.0",
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.7",
        "Cache-Control": "no-cache",
    }
    last_error: Exception | None = None
    for attempt in range(1, 4):
        try:
            response = requests.get(url, headers=headers, timeout=30, params={"_": int(time.time() * 1000)})
            response.raise_for_status()
            response.encoding = response.apparent_encoding or "utf-8"
            if "Dubai" not in response.text or "Brent" not in response.text or "WTI" not in response.text:
                raise RuntimeError("Opinet response does not contain the crude-price table")
            return response.text
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            if attempt < 3:
                time.sleep(attempt * 2)
    raise RuntimeError(f"Opinet request failed after 3 attempts: {last_error}")


def main() -> int:
    args = parse_args()
    request_path = Path(args.request)
    output_path = Path(args.output)
    request_data = json.loads(request_path.read_text(encoding="utf-8"))
    targets = [str(value) for value in request_data.get("oilTargetDates", [])]
    if len(targets) != 2:
        raise RuntimeError("report request must contain exactly two oilTargetDates")

    html = fetch_html(args.url)
    rows = extract_rows(html)
    selected = select_usd_rows(rows, targets)
    missing = [target for target in targets if target not in selected]
    if missing:
        available = sorted({row["date"] for row in rows if all(10 <= row[key] <= 250 for key in ("dubai", "brent", "wti"))})
        raise RuntimeError(
            "Opinet does not expose the required USD/Bbl rows for "
            f"{', '.join(missing)}. Available parsed dates: {', '.join(available[-10:]) or 'none'}"
        )

    result = {
        "source": "오피넷(한국석유공사) 국제유가-원유",
        "sourceUrl": args.url,
        "unit": "USD/Bbl",
        "reportDate": request_data["reportDate"],
        "targetDates": targets,
        "prices": [
            {
                "date": target,
                "dubai": round(selected[target]["dubai"], 2),
                "brent": round(selected[target]["brent"], 2),
                "wti": round(selected[target]["wti"], 2),
            }
            for target in targets
        ],
        "retrievedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        "[opinet] "
        + ", ".join(
            f"{row['date']} Dubai={row['dubai']:.2f} Brent={row['brent']:.2f} WTI={row['wti']:.2f}"
            for row in result["prices"]
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        print(f"[opinet] ERROR: {error}", file=sys.stderr)
        raise
