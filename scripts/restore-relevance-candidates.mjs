#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const BASE_FILE = path.resolve(process.env.BASE_ARTICLES_FILE || "");
const CURRENT_FILE = path.resolve(
  process.env.CURRENT_ARTICLES_FILE || path.join(ROOT, "data", "articles.json")
);

if (!process.env.BASE_ARTICLES_FILE) {
  throw new Error("BASE_ARTICLES_FILE is required");
}

const [basePayload, currentPayload] = await Promise.all([
  fs.readFile(BASE_FILE, "utf8").then(JSON.parse),
  fs.readFile(CURRENT_FILE, "utf8").then(JSON.parse)
]);
const baseArticles = Array.isArray(basePayload.articles) ? basePayload.articles : [];
const currentArticles = Array.isArray(currentPayload.articles) ? currentPayload.articles : [];
const currentById = new Map(currentArticles.map((article) => [article.articleId, article]));
const restored = [];

for (const article of baseArticles) {
  if (!article.articleId || currentById.has(article.articleId)) continue;
  currentById.set(article.articleId, article);
  restored.push(article.articleId);
}

const baseIds = new Set(baseArticles.map((article) => article.articleId));
const merged = [
  ...baseArticles.map((article) => currentById.get(article.articleId)).filter(Boolean),
  ...currentArticles.filter((article) => !baseIds.has(article.articleId))
];

await fs.writeFile(CURRENT_FILE, `${JSON.stringify({
  ...currentPayload,
  generatedAt: new Date().toISOString(),
  count: merged.length,
  articles: merged
}, null, 2)}\n`, "utf8");

console.log(`[restore-relevance-candidates] base=${baseArticles.length} current=${currentArticles.length} restored=${restored.length} merged=${merged.length}`);
