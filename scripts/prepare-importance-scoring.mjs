#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const ARTICLES_FILE = path.join(ROOT, "data", "articles.json");

const payload = JSON.parse(await fs.readFile(ARTICLES_FILE, "utf8"));
const articles = Array.isArray(payload.articles) ? payload.articles : [];

const normalized = articles.map((item) => {
  const article = item.article && typeof item.article === "object" ? item.article : {};
  const analysis = item.analysis && typeof item.analysis === "object" ? item.analysis : {};
  const source = item.source && typeof item.source === "object" ? item.source : {};

  return {
    ...item,
    category: analysis.category || item.category || article.category || "",
    articleId: item.articleId || article.articleId || "",
    articleUrl: item.articleUrl || article.articleUrl || article.canonicalUrl || "",
    canonicalUrl: item.canonicalUrl || article.canonicalUrl || article.articleUrl || "",
    publishedAt: item.publishedAt || article.publishedAt || "",
    originalTitleArabic: item.originalTitleArabic || article.originalTitleArabic || "",
    descriptionArabic: item.descriptionArabic || article.descriptionArabic || "",
    originalTextArabic: item.originalTextArabic || article.originalTextArabic || "",
    sourceArabic: item.sourceArabic || source.arabicName || article.sourceArabic || ""
  };
});

await fs.writeFile(ARTICLES_FILE, `${JSON.stringify({
  ...payload,
  articles: normalized
}, null, 2)}\n`, "utf8");

console.log(`[importance-prepare] normalized=${normalized.length}`);
