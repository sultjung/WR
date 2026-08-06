#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const SCRIPT = process.env.PRIORITY_CONTENT_FALLBACK_SCRIPT
  || path.resolve("scripts/apply-priority-seed-content-fallback.mjs");
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "wr-priority-content-"));
const resolvedFile = path.join(temp, "resolved.json");
const articlesFile = path.join(temp, "articles.json");
const seedsFile = path.join(temp, "seeds.json");
const url = "https://hathalyoum.net/articles/4207696";
const title = "الاستثمار تبحث مع هانوا الكورية استكمال مشروع بسماية وتعد بحل العقبات المالية";
const text = "بحث رئيس الهيئة الوطنية للاستثمار عادل الياسري مع ممثل شركة هانوا الكورية ورئيس مشروع مدينة بسماية سير العمل وآفاق التعاون المشترك. وأكد اطلاعه على تحديات التمويل وإنجاز الأعمال المتبقية، وأن مقترحات ستطرح على الجهات الحكومية لتوفير الدعم والتسهيلات وضمان الالتزام بالجداول الزمنية. وأكد وفد شركة هانوا استعداده لمواصلة العمل، كما وجه رئيس الهيئة بالتنسيق مع وزارة المالية والمصرف المعني لاستكمال عقود الإقراض وإطلاق القروض للمستفيدين.";

function run() {
  return spawnSync(process.execPath, [SCRIPT], {
    env: {
      ...process.env,
      PRIORITY_FALLBACK_RESOLVED_FILE: resolvedFile,
      PRIORITY_FALLBACK_ARTICLES_FILE: articlesFile,
      PRIORITY_FALLBACK_SEEDS_FILE: seedsFile,
      MIN_ARABIC_CONTENT_CHARS: "300",
      MIN_ARABIC_RATIO: "0.35"
    },
    encoding: "utf8"
  });
}

try {
  await fs.writeFile(resolvedFile, JSON.stringify({
    schemaVersion: "1.0",
    articles: [{
      articleId: "priority-4207696",
      category: "bismayah",
      priority: 100,
      originalTitleArabic: title,
      articleUrl: url,
      discoveryUrl: "https://news.google.com/rss/articles/example",
      priorityAggregatorUrl: url,
      recoveredSourceId: "hathalyoum",
      allowAggregatorFallback: true,
      urlStatus: "RESOLVED",
      urlResolutionMethod: "PRIORITY_AGGREGATOR_FALLBACK",
      contentStatus: "PENDING",
      publishedAt: "2026-08-05T00:00:00.000Z",
      priorityDiscovery: { sourceId: "hathalyoum", sourceUrl: url }
    }]
  }, null, 2));
  await fs.writeFile(articlesFile, JSON.stringify({
    schemaVersion: "1.0",
    count: 0,
    categoryCounts: {},
    collectionRun: {},
    articles: []
  }, null, 2));
  await fs.writeFile(seedsFile, JSON.stringify({
    schemaVersion: "1.0",
    urls: [{
      url,
      category: "bismayah",
      enabled: true,
      allowContentFallback: true,
      titleArabic: title,
      sourceArabic: "بغداد اليوم عبر هذا اليوم",
      publishedAt: "2026-08-05T00:00:00.000Z",
      fallbackTextArabic: text
    }]
  }, null, 2));

  const first = run();
  assert.equal(first.status, 0, first.stderr || first.stdout);
  let output = JSON.parse(await fs.readFile(articlesFile, "utf8"));
  assert.equal(output.articles.length, 1);
  assert.equal(output.articles[0].articleId, "priority-4207696");
  assert.equal(output.articles[0].category, "bismayah");
  assert.equal(output.articles[0].priority, 100);
  assert.equal(output.articles[0].contentStatus, "FULL_TEXT");
  assert.equal(output.articles[0].contentSourceMethod, "PRIORITY_SEED_FALLBACK");
  assert.equal(output.articles[0].originalTextArabic, text);
  assert.equal(output.collectionRun.prioritySeedFallbacksApplied, 1);

  const second = run();
  assert.equal(second.status, 0, second.stderr || second.stdout);
  output = JSON.parse(await fs.readFile(articlesFile, "utf8"));
  assert.equal(output.articles.length, 1, "fallback application must be idempotent");
  assert.equal(output.collectionRun.prioritySeedFallbacksApplied, 0);
  assert.equal(output.collectionRun.prioritySeedFallbacksSkippedExisting, 1);
  console.log("[test-priority-content-fallback] blocked priority seed retained once as full-text fallback");
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
