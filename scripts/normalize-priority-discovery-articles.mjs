#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const INPUT_FILE = path.resolve(
  process.env.PRIORITY_NORMALIZER_INPUT_FILE
    || path.join(ROOT, "data", "recovered-articles.json")
);
const OUTPUT_FILE = path.resolve(process.env.PRIORITY_NORMALIZER_OUTPUT_FILE || INPUT_FILE);
const PRIORITY_SOURCE_IDS = new Set(["nic", "hathalyoum"]);
const PRIORITY_OPTIONAL_TERMS = ["بسماية", "الهيئة الوطنية للاستثمار", "شركة هانوا", "هانوا"];

function isPriorityDiscoveryMatch(article = {}) {
  return PRIORITY_SOURCE_IDS.has(article.priorityDiscovery?.sourceId || "");
}

function uniqueTerms(...groups) {
  return [...new Set(groups.flat().filter(Boolean))];
}

const payload = JSON.parse(await fs.readFile(INPUT_FILE, "utf8"));
if (!Array.isArray(payload.articles)) {
  throw new Error("priority discovery payload must contain an articles array");
}

let normalizedCount = 0;
const articles = payload.articles.map((article) => {
  if (!isPriorityDiscoveryMatch(article)) return article;

  const normalized = {
    ...article,
    keywordId: "bismayah-priority-source-001",
    category: "bismayah",
    priority: Math.max(100, Number(article.priority || 0)),
    queryArabic: "بسماية OR الهيئة الوطنية للاستثمار OR شركة هانوا",
    requiredTerms: [],
    optionalTerms: uniqueTerms(article.optionalTerms || [], PRIORITY_OPTIONAL_TERMS),
    excludedTerms: [],
    priorityClassificationNormalizedAt: new Date().toISOString()
  };

  if (
    article.category !== normalized.category
    || article.keywordId !== normalized.keywordId
    || Number(article.priority || 0) !== normalized.priority
  ) normalizedCount += 1;

  return normalized;
});

const output = {
  ...payload,
  generatedAt: new Date().toISOString(),
  priorityClassificationNormalized: normalizedCount,
  articles
};

await fs.writeFile(OUTPUT_FILE, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`[priority-normalize] normalized=${normalizedCount}, total=${articles.length}`);
