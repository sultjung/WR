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
import { translateArabicBodyChunk, translateArabicTitle } from "./article-translation-ai.mjs";

const ROOT = process.cwd();
const ARTICLES_FILE = path.resolve(process.env.TRANSLATION_ARTICLES_FILE || path.join(ROOT, "data", "articles.json"));
const required = /^(1|true|yes)$/i.test(process.env.TRANSLATION_AI_REQUIRED || "false");
const maxArticles = Math.max(0, Number(process.env.TRANSLATION_AI_MAX_ARTICLES || 60));
const chunkChars = Math.max(3000, Number(process.env.TRANSLATION_CHUNK_CHARS || 7000));
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

function splitLongPiece(piece, limit) {
  const chunks = [];
  let rest = piece.trim();
  while (rest.length > limit) {
    let cut = rest.lastIndexOf(" ", limit);
    if (cut < Math.floor(limit * 0.65)) cut = limit;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function splitArabicText(text, limit = chunkChars) {
  const normalized = String(text || "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];
  if (normalized.length <= limit) return [normalized];

  const units = normalized
    .split(/(?<=[.!?؟])\s+|\n{2,}/u)
    .map((value) => value.trim())
    .filter(Boolean)
    .flatMap((value) => value.length > limit ? splitLongPiece(value, limit) : [value]);

  const chunks = [];
  let current = "";
  for (const unit of units) {
    if (!current) {
      current = unit;
      continue;
    }
    if ((current.length + 2 + unit.length) <= limit) {
      current += `\n\n${unit}`;
    } else {
      chunks.push(current);
      current = unit;
    }
  }
  if (current) chunks.push(current);
  return chunks;
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
  const chunks = splitArabicText(bodyArabic);
  if (!chunks.length) throw new Error(`${id}: Arabic body is empty`);

  const titleResult = await withRetry(`${id}:title`, () => translateArabicTitle(titleArabic, preferredTerms));
  const translatedChunks = [];
  const models = new Set([titleResult.model]);

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const result = await withRetry(
      `${id}:body:${chunkIndex + 1}/${chunks.length}`,
      () => translateArabicBodyChunk(chunks[chunkIndex], preferredTerms)
    );
    models.add(result.model);
    translatedChunks.push(result.text.trim());
  }

  return normalizeTranslationResult({
    titleKo: titleResult.text,
    fullTextKo: translatedChunks.join("\n\n"),
    model: [...models].join(","),
    chunkCount: chunks.length
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

const candidates = articles
  .map((article, index) => ({ article, index, id: articleIdOf(article, index) }))
  .filter(({ article }) => needsTranslation(article))
  .sort((a, b) => importanceScore(b.article) - importanceScore(a.article) || publishedTime(b.article) - publishedTime(a.article))
  .slice(0, maxArticles || undefined);

const stats = {
  candidateCount: candidates.length,
  translatedCount: 0,
  failedCount: 0,
  resetCount,
  cachedCount: Math.max(0, articles.length - candidates.length)
};

if (!String(process.env.OPENAI_API_KEY || "").trim()) {
  const message = "OPENAI_API_KEY is unavailable to full article translation";
  if (required && candidates.length) throw new Error(message);
  await writePayload(payload, articles, stats);
  console.warn(`[article-translation] ${message}; stale states reconciled without AI generation`);
  process.exit(0);
}

for (const candidate of candidates) {
  try {
    articles[candidate.index] = {
      ...articles[candidate.index],
      translation: await translateArticle(articles[candidate.index], candidate.index)
    };
    stats.translatedCount += 1;
  } catch (error) {
    stats.failedCount += 1;
    console.error(`[article-translation] ${candidate.id} failed: ${error.message}`);
    if (required) throw error;
  }
  await writePayload(payload, articles, stats);
  console.log(`[article-translation] progress=${stats.translatedCount + stats.failedCount}/${candidates.length}, translated=${stats.translatedCount}, failed=${stats.failedCount}`);
}

if (!candidates.length) await writePayload(payload, articles, stats);
if (required && candidates.length && stats.translatedCount === 0) {
  throw new Error("full article translation was required but generated no translations");
}
console.log(`[article-translation] complete candidates=${stats.candidateCount}, translated=${stats.translatedCount}, failed=${stats.failedCount}, reset=${stats.resetCount}`);
