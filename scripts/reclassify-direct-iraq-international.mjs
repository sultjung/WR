#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import {
  applyDirectIraqInternationalRouting,
  classifyDirectIraqInternational,
  routingSummaryLabel
} from "./direct-iraq-category-routing.mjs";

const ROOT = process.cwd();
const ARTICLES_FILE = path.resolve(
  process.env.DIRECT_IRAQ_ROUTING_ARTICLES_FILE || path.join(ROOT, "data", "articles.json")
);
const SUMMARY_FILE = process.env.DIRECT_IRAQ_ROUTING_SUMMARY_FILE
  ? path.resolve(process.env.DIRECT_IRAQ_ROUTING_SUMMARY_FILE)
  : null;

const payload = JSON.parse(await fs.readFile(ARTICLES_FILE, "utf8"));
const articles = Array.isArray(payload) ? payload : (Array.isArray(payload.articles) ? payload.articles : []);
const routed = [];
const outputArticles = articles.map((article) => {
  const result = classifyDirectIraqInternational(article);
  if (!result.changed) return article;
  routed.push({
    articleId: article.articleId || article.article?.articleId || null,
    titleArabic: article.originalTitleArabic || article.article?.originalTitleArabic || "",
    from: "international",
    to: result.category,
    reason: result.reason,
    label: routingSummaryLabel(result),
    scores: result.scores
  });
  return applyDirectIraqInternationalRouting(article);
});

const categoryCounts = outputArticles.reduce((counts, article) => {
  const category = String(article.category || article.analysis?.category || "unknown");
  counts[category] = (counts[category] || 0) + 1;
  return counts;
}, {});
const generatedAt = new Date().toISOString();
const output = Array.isArray(payload)
  ? outputArticles
  : {
      ...payload,
      generatedAt,
      count: outputArticles.length,
      categoryCounts,
      articles: outputArticles
    };

await fs.writeFile(ARTICLES_FILE, `${JSON.stringify(output, null, 2)}\n`, "utf8");

if (SUMMARY_FILE) {
  await fs.mkdir(path.dirname(SUMMARY_FILE), { recursive: true });
  await fs.writeFile(SUMMARY_FILE, `${JSON.stringify({
    schemaVersion: "1.0",
    generatedAt,
    method: "DIRECT_IRAQ_INTERNATIONAL_ROUTER_V1",
    before: articles.length,
    routedCount: routed.length,
    categoryCounts,
    routed
  }, null, 2)}\n`, "utf8");
}

const routedCounts = routed.reduce((counts, item) => {
  counts[item.to] = (counts[item.to] || 0) + 1;
  return counts;
}, {});
console.log(`[direct-iraq-routing] articles=${articles.length} routed=${routed.length} byCategory=${JSON.stringify(routedCounts)}`);
for (const item of routed.slice(0, 20)) {
  console.log(`[direct-iraq-routing] ${item.articleId || "unknown"}: international -> ${item.to} (${item.label})`);
}
