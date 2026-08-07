#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import {
  articleIdOf,
  needsTranslation,
  normalizeTranslationResult,
  reconcileTranslationState,
  sourceTextOf,
  sourceTitleOf,
  translationContextOf
} from "./article-translation-core.mjs";
import { translateArabicArticle } from "./article-translation-ai.mjs";

const ROOT = process.cwd();
const ARTICLES_FILE = path.resolve(process.env.TRANSLATION_ARTICLES_FILE || path.join(ROOT, "data", "articles.json"));
const required = /^(1|true|yes)$/i.test(process.env.TRANSLATION_AI_REQUIRED || "false");
const maxArticles = Math.max(0, Number(process.env.TRANSLATION_AI_MAX_ARTICLES || 200));
const concurrency = Math.max(1, Math.min(4, Number(process.env.TRANSLATION_CONCURRENCY || 4)));
const retryAttempts = Math.max(1, Math.min(3, Number(process.env.TRANSLATION_AI_RETRY_ATTEMPTS || 2)));

function importanceScore(article = {}) {
  const stored = article.importance || article.analysis?.importance || {};
  const score = Number(stored.score ?? stored.finalScore ?? stored.ruleScore ?? article.importanceScore ?? 0);
  return Number.isFinite(score) ? score : 0;
}

function publishedTime(article = {}) {
  const value = new Date(article.publishedAt || article.article?.publishedAt || 0).getTime();
  return Number.isFinite(value) ? value : 0;
}

async function withRetry(label, fn) {
  let lastError;
  for (let attempt = 1; attempt <= retryAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      console.warn(`[article-translation] ${label} attempt=${attempt}/${retryAttempts} failed: ${error.message}`);
    }
  }
  throw lastError;
}

async function translateArticle(article, index) {
  const id = articleIdOf(article, index);
  const titleArabic = sourceTitleOf(article);
  const bodyArabic = sourceTextOf(article);
  const { preferredTerms } = translationContextOf(article);

  const result = await withRetry(
    `${id}:article`,
    () => translateArabicArticle(titleArabic, bodyArabic, preferredTerms)
  );

  return normalizeTranslationResult({
    titleKo: result.titleKo,
    fullTextKo: result.fullTextKo,
    model: result.model,
    chunkCount: 1
  }, article);
}

async function writePayload(payload, articles, stats) {
  const output = Array.isArray(payload)
    ? articles
    : {
        ...payload,
        generatedAt: new Date().toISOString(),
        articles,
        fullTranslationGeneration: {
          pipelineVersion: "FULL_TRANSLATION_V1",
          generatedAt: new Date().toISOString(),
          ...stats
        }
      };
  await fs.writeFile(ARTICLES_FILE, `${JSON.stringify(output, null, 2)}\n`, "utf8");
}

const payload = JSON.parse(await fs.readFile(ARTICLES_FILE, "utf8"));
const rawArticles = Array.isArray(payload) ? payload : (payload.articles || []);
let resetCount = 0;
const articles = rawArticles.map((article) => {
  const reconciled = reconcileTranslationState(article);
  if (reconciled.reset) resetCount += 1;
  return reconciled.article;
});

const eligible = articles
  .map((article, index) => ({ article, index, id: articleIdOf(article, index) }))
  .filter(({ article }) => needsTranslation(article))
  .sort((a, b) => importanceScore(b.article) - importanceScore(a.article) || publishedTime(b.article) - publishedTime(a.article));
const candidates = eligible.slice(0, maxArticles || undefined);

const stats = {
  eligibleCount: eligible.length,
  candidateCount: candidates.length,
  translatedCount: 0,
  failedCount: 0,
  deferredCount: Math.max(0, eligible.length - candidates.length),
  resetCount,
  concurrency,
  requestMode: "ONE_REQUEST_PER_ARTICLE"
};

if (!String(process.env.OPENAI_API_KEY || "").trim()) {
  const message = "OPENAI_API_KEY is unavailable to full article translation";
  if (required && candidates.length) throw new Error(message);
  await writePayload(payload, articles, stats);
  console.warn(`[article-translation] ${message}; stale states reconciled without AI generation`);
  process.exit(0);
}

for (let offset = 0; offset < candidates.length; offset += concurrency) {
  const batch = candidates.slice(offset, offset + concurrency);
  await Promise.all(batch.map(async (candidate) => {
    try {
      const translation = await translateArticle(articles[candidate.index], candidate.index);
      articles[candidate.index] = { ...articles[candidate.index], translation };
      stats.translatedCount += 1;
    } catch (error) {
      stats.failedCount += 1;
      console.error(`[article-translation] ${candidate.id} failed and will be retried next run: ${error.message}`);
    }
  }));
  await writePayload(payload, articles, stats);
  console.log(`[article-translation] progress=${Math.min(offset + batch.length, candidates.length)}/${candidates.length}, translated=${stats.translatedCount}, failed=${stats.failedCount}, deferred=${stats.deferredCount}`);
}

if (!candidates.length) await writePayload(payload, articles, stats);
if (required && candidates.length && stats.translatedCount === 0) {
  throw new Error("full article translation was required but generated no translations");
}
console.log(`[article-translation] complete eligible=${stats.eligibleCount}, candidates=${stats.candidateCount}, translated=${stats.translatedCount}, failed=${stats.failedCount}, deferred=${stats.deferredCount}, reset=${stats.resetCount}, concurrency=${stats.concurrency}`);
