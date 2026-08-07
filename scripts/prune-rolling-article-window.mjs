#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const RETENTION_DAYS = Math.max(1, Number(process.env.ARTICLE_RETENTION_DAYS || 7));
const DEFAULT_FILES = [
  "data/discovered-articles.json",
  "data/recovered-articles.json",
  "data/resolved-articles.json",
  "data/articles.json"
];
const FILES = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_FILES;

function kstDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function shiftDateKey(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function articleDate(item = {}) {
  return item.publishedAt
    || item.article?.publishedAt
    || item.publicationDate
    || item.pubDate
    || item.datePublished
    || "";
}

function countCategories(articles = []) {
  return articles.reduce((acc, article) => {
    if (!article?.category) return acc;
    acc[article.category] = (acc[article.category] || 0) + 1;
    return acc;
  }, {});
}

function updateStageMetadata(payload, articles, generatedAt) {
  const output = {
    ...payload,
    generatedAt,
    count: articles.length,
    articles
  };

  if (Object.hasOwn(payload, "categoryCounts")) output.categoryCounts = countCategories(articles);
  if (Object.hasOwn(payload, "lookbackDays")) output.lookbackDays = RETENTION_DAYS;
  if (Object.hasOwn(payload, "recoveredCount")) {
    output.recoveredCount = articles.filter((article) => article.urlStatus === "RECOVERED" && article.articleUrl).length;
  }
  if (Object.hasOwn(payload, "resolvedCount")) {
    output.resolvedCount = articles.filter((article) => article.urlStatus === "RESOLVED" && article.articleUrl).length;
  }
  if (Object.hasOwn(payload, "failedCount")) {
    if (Object.hasOwn(payload, "resolvedCount")) {
      output.failedCount = articles.filter((article) => article.urlStatus !== "RESOLVED" || !article.articleUrl).length;
    } else if (Object.hasOwn(payload, "recoveredCount")) {
      output.failedCount = articles.filter((article) => article.urlStatus !== "RECOVERED" || !article.articleUrl).length;
    }
  }

  return output;
}

const periodEnd = kstDateKey();
const periodStart = shiftDateKey(periodEnd, -(RETENTION_DAYS - 1));
const generatedAt = new Date().toISOString();
let totalBefore = 0;
let totalAfter = 0;
let totalRemoved = 0;

for (const relativeFile of FILES) {
  const file = path.resolve(ROOT, relativeFile);
  let raw;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      console.log(`[rolling-prune] skip missing ${relativeFile}`);
      continue;
    }
    throw error;
  }

  const payload = JSON.parse(raw);
  const sourceArticles = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.articles)
      ? payload.articles
      : null;

  if (!sourceArticles) throw new Error(`${relativeFile}: expected an array or an object with articles[]`);

  const kept = [];
  const removed = [];
  for (const article of sourceArticles) {
    const dateKey = kstDateKey(articleDate(article));
    if (dateKey && dateKey >= periodStart && dateKey <= periodEnd) {
      kept.push(article);
    } else {
      removed.push({
        id: article.articleId || article.id || "",
        date: dateKey || "INVALID",
        title: article.originalTitleArabic || article.title || ""
      });
    }
  }

  const output = Array.isArray(payload)
    ? kept
    : updateStageMetadata(payload, kept, generatedAt);

  await fs.writeFile(file, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  totalBefore += sourceArticles.length;
  totalAfter += kept.length;
  totalRemoved += removed.length;
  console.log(`[rolling-prune] ${relativeFile} KST=${periodStart}..${periodEnd} before=${sourceArticles.length} kept=${kept.length} removed=${removed.length}`);
  if (removed.length) console.log(`[rolling-prune] ${relativeFile} removed sample=${JSON.stringify(removed.slice(0, 5))}`);
}

console.log(`[rolling-prune] done retentionDays=${RETENTION_DAYS} KST=${periodStart}..${periodEnd} before=${totalBefore} kept=${totalAfter} removed=${totalRemoved}`);
