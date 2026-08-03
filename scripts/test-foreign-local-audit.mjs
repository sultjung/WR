#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const AUDIT_SCRIPT = path.join(SCRIPT_DIR, "audit-foreign-local-leakage.mjs");
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "wr-foreign-local-audit-"));
const articlesFile = path.join(tempDir, "articles.json");
const outputFile = path.join(tempDir, "audit.json");

const articles = [
  {
    articleId: "iraq-gaza-bridge",
    category: "economy",
    sourceArabic: "المعلومة",
    originalTitleArabic: "الإعمار تعلن إنجاز تثبيت جسر غزة في موقعه النهائي تمهيداً لافتتاحه",
    originalTextArabic: "أعلنت وزارة الإعمار والإسكان والبلديات العامة تثبيت جسر غزة فوق نهر دجلة ضمن مشاريع الطرق والجسور في بغداد."
  },
  {
    articleId: "palestine-gaza-bridge",
    category: "economy",
    sourceArabic: "fixture",
    originalTitleArabic: "افتتاح جسر جديد في قطاع غزة",
    originalTextArabic: "افتتحت الجهات المحلية الجسر لخدمة سكان القطاع."
  },
  {
    articleId: "egypt-local-construction",
    category: "economy",
    sourceArabic: "fixture",
    originalTitleArabic: "مصر تعلن افتتاح مشروع إسكان جديد في القاهرة",
    originalTextArabic: "افتتحت وزارة الإسكان المصرية المشروع الجديد في العاصمة."
  },
  {
    articleId: "iraq-egypt-investment",
    category: "economy",
    sourceArabic: "fixture",
    originalTitleArabic: "مصر والعراق تبحثان تعزيز الاستثمارات المشتركة",
    originalTextArabic: "بحثت الهيئة الوطنية للاستثمار العراقية التعاون مع التمثيل التجاري المصري في بغداد."
  }
];

try {
  await fs.writeFile(articlesFile, `${JSON.stringify({ articles }, null, 2)}\n`, "utf8");
  const run = spawnSync(process.execPath, [AUDIT_SCRIPT], {
    cwd: ROOT,
    env: {
      ...process.env,
      FOREIGN_LOCAL_AUDIT_ARTICLES_FILE: articlesFile,
      FOREIGN_LOCAL_AUDIT_OUTPUT_FILE: outputFile
    },
    encoding: "utf8"
  });

  assert.equal(run.status, 0, run.stderr || run.stdout || "audit script failed");
  const result = JSON.parse(await fs.readFile(outputFile, "utf8"));
  const suspects = new Set(result.suspects.map((item) => item.articleId));

  assert.ok(!suspects.has("iraq-gaza-bridge"), "Baghdad Gaza Bridge must not be flagged");
  assert.ok(suspects.has("palestine-gaza-bridge"), "Gaza Strip local bridge must be flagged");
  assert.ok(suspects.has("egypt-local-construction"), "Egypt-only construction story must be flagged");
  assert.ok(!suspects.has("iraq-egypt-investment"), "Iraq-linked bilateral investment story must not be flagged");

  console.log("[test:audit] Iraqi Gaza Bridge accepted; foreign-local leaks detected");
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}
