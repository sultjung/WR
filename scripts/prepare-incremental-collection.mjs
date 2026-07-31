#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const RESOLVED_FILE = path.join(ROOT, "data", "resolved-articles.json");
const ARTICLES_FILE = path.join(ROOT, "data", "articles.json");
const SNAPSHOT_FILE = path.join(ROOT, "data", ".articles-before-collect.json");
const RECHECK_DAYS = Number(process.env.CONTENT_RECHECK_DAYS || 7);
const FORCE_RECHECK = /^(1|true|yes)$/i.test(String(process.env.FORCE_CONTENT_RECHECK || ""));

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return fallback; }
}

function normalizeUrl(value = "") {
  try {
    const url = new URL(String(value));
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_)/i.test(key)) url.searchParams.delete(key);
    }
    url.hash = "";
    return url.toString();
  } catch { return ""; }
}

function articleKey(item = {}) {
  return normalizeUrl(item.canonicalUrl || item.articleUrl || item.article?.canonicalUrl || item.article?.articleUrl)
    || String(item.articleId || item.id || "");
}

function hasFullText(item = {}) {
  return Boolean(String(item.originalTextArabic || item.article?.originalTextArabic || "").trim())
    && String(item.contentStatus || item.article?.contentStatus || "FULL_TEXT").toUpperCase() !== "FAILED";
}

function lastCheckedAt(item = {}) {
  return item.contentCheckedAt || item.fetchedAt || item.updatedAt || item.discoveredAt || item.publishedAt || "";
}

function dueForRecheck(item = {}) {
  if (FORCE_RECHECK) return true;
  const checked = new Date(lastCheckedAt(item)).getTime();
  if (!Number.isFinite(checked)) return true;
  return Date.now() - checked >= RECHECK_DAYS * 86400000;
}

const resolvedPayload = await readJson(RESOLVED_FILE, { articles: [] });
const previousPayload = await readJson(ARTICLES_FILE, { articles: [] });
const resolved = Array.isArray(resolvedPayload) ? resolvedPayload : (resolvedPayload.articles || []);
const previous = Array.isArray(previousPayload) ? previousPayload : (previousPayload.articles || []);
const previousByKey = new Map(previous.map((item) => [articleKey(item), item]).filter(([key]) => key));

await fs.writeFile(SNAPSHOT_FILE, `${JSON.stringify(previousPayload, null, 2)}\n`, "utf8");

let reused = 0;
let recheck = 0;
let newOrIncomplete = 0;
const pending = [];

for (const item of resolved) {
  const existing = previousByKey.get(articleKey(item));
  if (existing && hasFullText(existing) && !dueForRecheck(existing)) {
    reused += 1;
    continue;
  }
  if (existing && hasFullText(existing)) recheck += 1;
  else newOrIncomplete += 1;
  pending.push(item);
}

const output = Array.isArray(resolvedPayload)
  ? pending
  : {
      ...resolvedPayload,
      count: pending.length,
      articles: pending,
      incrementalRun: {
        generatedAt: new Date().toISOString(),
        inputCount: resolved.length,
        reusedCount: reused,
        recheckCount: recheck,
        newOrIncompleteCount: newOrIncomplete,
        contentRecheckDays: RECHECK_DAYS,
        forceRecheck: FORCE_RECHECK
      }
    };

await fs.writeFile(RESOLVED_FILE, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`[incremental:prepare] input=${resolved.length}, reused=${reused}, recheck=${recheck}, fetch=${pending.length}`);
