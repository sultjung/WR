#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const RECOVERED_FILE = path.resolve(process.env.PRIORITY_RECOVERED_FILE || path.join(ROOT, "data", "recovered-articles.json"));
const RESOLVED_FILE = path.resolve(process.env.PRIORITY_RESOLVED_FILE || path.join(ROOT, "data", "resolved-articles.json"));

function normalizeUrl(value = "") {
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    return parsed.toString();
  } catch { return ""; }
}

const recovered = JSON.parse(await fs.readFile(RECOVERED_FILE, "utf8"));
const resolved = JSON.parse(await fs.readFile(RESOLVED_FILE, "utf8"));
const fallbackById = new Map((recovered.articles || [])
  .filter((item) => item.allowAggregatorFallback === true && item.articleUrl)
  .map((item) => [item.articleId, item]));
let restoredCount = 0;
const articles = (resolved.articles || []).map((item) => {
  const fallback = fallbackById.get(item.articleId);
  if (!fallback || (item.urlStatus === "RESOLVED" && item.articleUrl)) return item;
  restoredCount += 1;
  return {
    ...item,
    articleUrl: normalizeUrl(fallback.articleUrl),
    discoveryUrl: fallback.discoveryUrl || item.discoveryUrl,
    urlStatus: "RESOLVED",
    urlResolutionMethod: "PRIORITY_AGGREGATOR_FALLBACK",
    allowAggregatorFallback: true,
    errorCode: null,
    resolutionError: undefined,
    resolvedAt: new Date().toISOString()
  };
});
const resolutionMethods = articles.reduce((acc, item) => {
  const key = item.urlResolutionMethod || item.errorCode || "UNKNOWN";
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});
const resolvedCount = articles.filter((item) => item.urlStatus === "RESOLVED" && item.articleUrl).length;
const payload = {
  ...resolved,
  generatedAt: new Date().toISOString(),
  count: articles.length,
  resolvedCount,
  failedCount: articles.length - resolvedCount,
  resolutionMethods,
  priorityAggregatorFallbackRestored: restoredCount,
  articles
};
await fs.writeFile(RESOLVED_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`[priority-aggregator-fallback] restored=${restoredCount} resolved=${resolvedCount} total=${articles.length}`);
