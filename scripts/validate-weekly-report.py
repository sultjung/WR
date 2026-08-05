#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

from docx import Document

REQUIRED_HEADINGS = [
    "1. 이라크 국내 상황",
    "1) 정국 / 치안",
    "· 정치권 동향",
    "· 이라크 주간 테러 상황",
    "2) 경제",
    "· 국제유가 관련 동향",
    "2. 국제사회",
    "3. 그룹 / 건설에 미치는 영향",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--docx", default="work/weekly-report.docx")
    parser.add_argument("--content", default="work/report-content.json")
    parser.add_argument("--metadata", default="work/report-metadata.json")
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def all_text(document: Document) -> str:
    parts = [paragraph.text for paragraph in document.paragraphs]
    for table in document.tables:
        for row in table.rows:
            parts.extend(cell.text for cell in row.cells)
    return "\n".join(parts)


def validate(docx_path: Path, content_path: Path) -> dict:
    if not docx_path.exists():
        raise RuntimeError("Word output does not exist")
    if docx_path.stat().st_size < 25_000:
        raise RuntimeError(f"Word output is unexpectedly small: {docx_path.stat().st_size} bytes")

    content = json.loads(content_path.read_text(encoding="utf-8"))
    document = Document(docx_path)
    text = all_text(document)

    if "{{" in text or "}}" in text:
        raise RuntimeError("unresolved template placeholder remains in Word output")
    if re.search(r"\bAI\b|프롬프트|자동\s*생성|선택\s*기사|모델", text, flags=re.I):
        raise RuntimeError("production-process wording leaked into the report")
    for heading in REQUIRED_HEADINGS:
        if heading not in text:
            raise RuntimeError(f"required heading missing: {heading}")

    request = content["request"]
    report = content["report"]
    oil = content["oil"]
    expected_title = "건설, 이라크 주간 종합 상황보고"
    if expected_title not in text:
        raise RuntimeError("report title is missing")
    report_date = request["reportDate"]
    y, m, d = (int(part) for part in report_date.split("-"))
    if f"{y}. {m}. {d}." not in text:
        raise RuntimeError("report date is missing or malformed")

    # Terror table + oil table + optional cabinet tables.
    if len(document.tables) < 2:
        raise RuntimeError(f"expected at least 2 tables, found {len(document.tables)}")
    terror = report["terrorStats"]
    terror_sum = sum(terror[key] for key in ("armedAttack", "ied", "assassination", "protest", "shooting", "suicideBombing"))
    if terror["total"] != terror_sum:
        raise RuntimeError("terror total does not equal category sum")

    for row in oil["prices"]:
        md = f"{int(row['date'][5:7])}.{int(row['date'][8:10])}"
        expected_values = [md, f"${row['dubai']:.2f}", f"${row['brent']:.2f}", f"${row['wti']:.2f}"]
        for value in expected_values:
            if value not in text:
                raise RuntimeError(f"oil table value missing: {value}")

    selected = set(request["selectedArticleIds"])
    used = set()
    for section in ("politicsItems", "securityItems", "economyItems", "internationalItems"):
        for item in report.get(section, []):
            used.update(item.get("articleIds", []))
    if used != selected:
        missing = sorted(selected - used)
        extra = sorted(used - selected)
        raise RuntimeError(f"selected article usage mismatch; missing={missing}, extra={extra}")

    metadata = {
        "pipelineVersion": content.get("pipelineVersion"),
        "generatedAt": content.get("generatedAt"),
        "reportDate": report_date,
        "periodStart": request["periodStart"],
        "periodEnd": request["periodEnd"],
        "issueNumber": request.get("issueNumber"),
        "selectedArticleCount": len(selected),
        "model": content.get("model"),
        "responseId": content.get("responseId"),
        "oilSource": oil.get("source"),
        "oilSourceUrl": oil.get("sourceUrl"),
        "oilTargetDates": oil.get("targetDates"),
        "docxSha256": sha256(docx_path),
        "docxBytes": docx_path.stat().st_size,
        "tableCount": len(document.tables),
        "paragraphCount": len(document.paragraphs),
    }
    return metadata


def main() -> int:
    args = parse_args()
    docx_path = Path(args.docx)
    content_path = Path(args.content)
    metadata_path = Path(args.metadata)
    metadata = validate(docx_path, content_path)
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"[report-validate] passed bytes={metadata['docxBytes']} tables={metadata['tableCount']} "
        f"paragraphs={metadata['paragraphCount']} sha256={metadata['docxSha256'][:12]}"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        print(f"[report-validate] ERROR: {error}", file=sys.stderr)
        raise
