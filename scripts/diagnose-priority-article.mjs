#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const file = path.resolve("data/articles.json");
const payload = JSON.parse(await fs.readFile(file, "utf8"));
const articles = Array.isArray(payload.articles) ? payload.articles : [];
const normalize = (value = "") => String(value)
  .normalize("NFKC")
  .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
  .replace(/\u0640/g, "")
  .replace(/[إأآٱ]/g, "ا")
  .replace(/ى/g, "ي")
  .replace(/ة/g, "ه")
  .replace(/\s+/g, " ")
  .trim()
  .toLowerCase();

const summary = (article) => ({
  articleId: article.articleId,
  category: article.category,
  priority: article.priority,
  publishedAt: article.publishedAt,
  originalTitleArabic: article.originalTitleArabic,
  articleUrl: article.articleUrl,
  canonicalUrl: article.canonicalUrl,
  discoveryUrl: article.discoveryUrl,
  priorityAggregatorUrl: article.priorityAggregatorUrl,
  recoveredSourceId: article.recoveredSourceId,
  allowAggregatorFallback: article.allowAggregatorFallback,
  urlRecoveryMethod: article.urlRecoveryMethod,
  urlResolutionMethod: article.urlResolutionMethod,
  contentStatus: article.contentStatus,
  errorCode: article.errorCode,
  eventId: article.eventId,
  isPrimaryEventArticle: article.isPrimaryEventArticle,
  relatedArticleCount: Array.isArray(article.relatedArticles) ? article.relatedArticles.length : null,
  importanceScore: article.importanceScore,
  importanceCategoryScore: article.importanceCategoryScore,
  importanceFloorReason: article.importanceFloorReason,
  titleKo: article.articleCard?.titleKo || article.translation?.titleKo || article.titleKo || "",
  cardStatus: article.articleCard?.status || article.cardStatus || "",
  translationStatus: article.translation?.status || "",
  selected: article.selection?.selected,
  reportSection: article.selection?.reportSection
});

const exact = articles.filter((article) => {
  const urls = [article.articleUrl, article.canonicalUrl, article.discoveryUrl, article.priorityAggregatorUrl];
  return urls.some((url) => String(url || "").includes("4207696"));
});
const terms = ["هانوا", "بسمايه", "عادل الياسري", "يونغ جاي بارك"];
const related = articles.filter((article) => {
  const text = normalize(`${article.originalTitleArabic || ""}\n${article.originalTextArabic || ""}`);
  return terms.some((term) => text.includes(normalize(term)));
});

console.log(`[diagnose-priority-article] total=${articles.length} exact=${exact.length} related=${related.length}`);
console.log(`[diagnose-priority-article] exact=${JSON.stringify(exact.map(summary), null, 2)}`);
console.log(`[diagnose-priority-article] related=${JSON.stringify(related.map(summary).slice(0, 30), null, 2)}`);

const temp = await fs.mkdtemp(path.join(os.tmpdir(), "wr-priority-fetch-"));
try {
  await fs.mkdir(path.join(temp, "data"), { recursive: true });
  await fs.writeFile(path.join(temp, "data", "resolved-articles.json"), JSON.stringify({
    schemaVersion: "1.0",
    count: 1,
    resolvedCount: 1,
    failedCount: 0,
    articles: [{
      articleId: "diagnostic-4207696",
      keywordId: "bismayah-priority-source-001",
      category: "bismayah",
      priority: 100,
      originalTitleArabic: "الاستثمار تبحث مع هانوا الكورية استكمال مشروع بسماية وتعد بحل العقبات المالية",
      articleUrl: "https://hathalyoum.net/articles/4207696",
      discoveryUrl: "https://hathalyoum.net/articles/4207696",
      priorityAggregatorUrl: "https://hathalyoum.net/articles/4207696",
      recoveredSourceId: "hathalyoum",
      allowAggregatorFallback: true,
      urlRecoveryMethod: "priority-source-index",
      urlResolutionMethod: "PRIORITY_AGGREGATOR_FALLBACK",
      urlStatus: "RESOLVED",
      contentStatus: "PENDING",
      publishedAt: "2026-08-05T00:00:00.000Z",
      requiredTerms: [],
      excludedTerms: []
    }]
  }, null, 2));

  const run = spawnSync(process.execPath, [path.resolve("scripts/fetch-arabic-content.mjs")], {
    cwd: temp,
    env: {
      ...process.env,
      CONTENT_FETCH_TIMEOUT_MS: "20000",
      CONTENT_FETCH_CONCURRENCY: "1",
      MIN_ARABIC_CONTENT_CHARS: "300",
      MIN_ARABIC_RATIO: "0.35",
      ARTICLE_RETENTION_DAYS: "30"
    },
    encoding: "utf8",
    timeout: 30000
  });
  let fetched = null;
  try {
    fetched = JSON.parse(await fs.readFile(path.join(temp, "data", "articles.json"), "utf8"));
  } catch {}
  console.log(`[diagnose-priority-fetch] status=${run.status} signal=${run.signal || ""}`);
  console.log(`[diagnose-priority-fetch] stdout=${String(run.stdout || "").trim()}`);
  console.log(`[diagnose-priority-fetch] stderr=${String(run.stderr || "").trim()}`);
  console.log(`[diagnose-priority-fetch] stats=${JSON.stringify(fetched?.collectionStats || null)}`);
  console.log(`[diagnose-priority-fetch] articles=${JSON.stringify((fetched?.articles || []).map(summary), null, 2)}`);
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
