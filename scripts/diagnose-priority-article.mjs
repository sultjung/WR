#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

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
