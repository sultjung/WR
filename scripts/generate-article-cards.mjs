#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import {
  articleIdOf,
  cardInputOf,
  factsInputOf,
  factsAreCurrent,
  needsCard,
  needsFacts,
  normalizeCardResult,
  normalizeFactsResult,
  reconcileArticleCardState
} from "./article-card-core.mjs";
import { createKoreanCards, extractArabicFacts } from "./article-card-ai.mjs";

const ROOT = process.cwd();
const ARTICLES_FILE = path.resolve(process.env.CARD_ARTICLES_FILE || path.join(ROOT, "data", "articles.json"));
const required = /^(1|true|yes)$/i.test(process.env.CARD_AI_REQUIRED || "false");
const batchSize = Math.max(1, Math.min(5, Number(process.env.CARD_AI_BATCH_SIZE || 3)));
const maxArticles = Math.max(0, Number(process.env.CARD_AI_MAX_ARTICLES || 60));
const maxSourceChars = Math.max(3000, Number(process.env.CARD_SOURCE_MAX_CHARS || 16000));
const retryAttempts = Math.max(1, Math.min(3, Number(process.env.CARD_AI_RETRY_ATTEMPTS || 2)));

function importanceScore(article = {}) {
  const stored = article.importance || article.analysis?.importance || {};
  const score = Number(stored.score ?? stored.finalScore ?? stored.ruleScore ?? article.importanceScore ?? 0);
  return Number.isFinite(score) ? score : 0;
}

function publishedTime(article = {}) {
  const value = new Date(article.publishedAt || article.article?.publishedAt || 0).getTime();
  return Number.isFinite(value) ? value : 0;
}

function pendingLabel(pending) {
  return [...pending.keys()].slice(0, 8).join(",");
}

async function writePayload(payload, articles, stats) {
  const output = Array.isArray(payload)
    ? articles
    : {
        ...payload,
        generatedAt: new Date().toISOString(),
        articles,
        cardGeneration: {
          pipelineVersion: "FACTS_FIRST_V1",
          generatedAt: new Date().toISOString(),
          ...stats
        }
      };
  await fs.writeFile(ARTICLES_FILE, `${JSON.stringify(output, null, 2)}\n`, "utf8");
}

const payload = JSON.parse(await fs.readFile(ARTICLES_FILE, "utf8"));
const rawArticles = Array.isArray(payload) ? payload : (payload.articles || []);
let factsReset = 0;
let cardsReset = 0;
const articles = rawArticles.map((article) => {
  const reconciled = reconcileArticleCardState(article);
  if (reconciled.factsReset) factsReset += 1;
  if (reconciled.cardReset) cardsReset += 1;
  return reconciled.article;
});
const indexById = new Map(articles.map((article, index) => [articleIdOf(article, index), index]));
const candidates = articles
  .map((article, index) => ({ article, index, id: articleIdOf(article, index) }))
  .filter(({ article }) => needsFacts(article) || needsCard(article))
  .sort((a, b) => importanceScore(b.article) - importanceScore(a.article) || publishedTime(b.article) - publishedTime(a.article))
  .slice(0, maxArticles || undefined);

const stats = {
  candidateCount: candidates.length,
  factsGenerated: 0,
  cardsGenerated: 0,
  factsFailed: 0,
  cardsFailed: 0,
  factsReset,
  cardsReset,
  factRetryRounds: 0,
  cardRetryRounds: 0,
  skippedCached: Math.max(0, articles.filter((article) => factsAreCurrent(article) && !needsCard(article)).length)
};

function applyFactResult(result, model, pending) {
  const id = String(result?.id || "");
  const target = pending.get(id);
  if (!target) return false;
  const liveIndex = indexById.get(id);
  if (!Number.isInteger(liveIndex)) return false;
  articles[liveIndex] = {
    ...articles[liveIndex],
    cardFacts: normalizeFactsResult(result, articles[liveIndex], model),
    card: {
      ...(articles[liveIndex].card || {}),
      status: "PENDING",
      pipelineVersion: "FACTS_FIRST_V1",
      resetReason: "FACTS_REFRESHED"
    }
  };
  target.article = articles[liveIndex];
  pending.delete(id);
  stats.factsGenerated += 1;
  return true;
}

function applyCardResult(result, model, pending) {
  const id = String(result?.id || "");
  const target = pending.get(id);
  if (!target) return false;
  const liveIndex = indexById.get(id);
  if (!Number.isInteger(liveIndex)) return false;
  articles[liveIndex] = {
    ...articles[liveIndex],
    card: normalizeCardResult(result, articles[liveIndex], model)
  };
  pending.delete(id);
  stats.cardsGenerated += 1;
  return true;
}

async function processFacts(targets) {
  const pending = new Map(targets.map((target) => [target.id, target]));
  let lastError = null;

  for (let attempt = 1; attempt <= retryAttempts && pending.size; attempt += 1) {
    if (attempt > 1) stats.factRetryRounds += 1;
    const currentTargets = [...pending.values()];
    try {
      const { results, model } = await extractArabicFacts(
        currentTargets.map(({ article, index }) => factsInputOf(article, index, maxSourceChars))
      );
      for (const result of results) applyFactResult(result, model, pending);
      if (pending.size) {
        console.warn(`[article-card] incomplete fact response attempt=${attempt}/${retryAttempts}, missing=${pendingLabel(pending)}`);
      }
    } catch (error) {
      lastError = error;
      console.warn(`[article-card] fact extraction attempt=${attempt}/${retryAttempts} failed: ${error.message}`);
    }
  }

  if (pending.size) {
    stats.factsFailed += pending.size;
    console.warn(`[article-card] fact extraction unresolved=${pending.size}, ids=${pendingLabel(pending)}${lastError ? `, lastError=${lastError.message}` : ""}`);
  }
}

async function processCards(targets) {
  const pending = new Map(targets.map((target) => [target.id, target]));
  let lastError = null;

  for (let attempt = 1; attempt <= retryAttempts && pending.size; attempt += 1) {
    if (attempt > 1) stats.cardRetryRounds += 1;
    const currentTargets = [...pending.values()];
    try {
      const inputs = currentTargets.map(({ id, index }) => cardInputOf(articles[indexById.get(id)], index));
      const serialized = JSON.stringify(inputs);
      if (/originalTextArabic|bodyArabic|fullTextKo/.test(serialized)) {
        throw new Error("card stage received prohibited full-text fields");
      }
      const { results, model } = await createKoreanCards(inputs);
      for (const result of results) applyCardResult(result, model, pending);
      if (pending.size) {
        console.warn(`[article-card] incomplete card response attempt=${attempt}/${retryAttempts}, missing=${pendingLabel(pending)}`);
      }
    } catch (error) {
      lastError = error;
      console.warn(`[article-card] Korean card attempt=${attempt}/${retryAttempts} failed: ${error.message}`);
    }
  }

  if (pending.size) {
    stats.cardsFailed += pending.size;
    console.warn(`[article-card] Korean card unresolved=${pending.size}, ids=${pendingLabel(pending)}${lastError ? `, lastError=${lastError.message}` : ""}`);
  }
}

if (!String(process.env.OPENAI_API_KEY || "").trim()) {
  const message = "OPENAI_API_KEY is unavailable to article-card generation";
  if (required && candidates.length) throw new Error(message);
  await writePayload(payload, articles, stats);
  console.warn(`[article-card] ${message}; stale states reconciled without AI generation`);
  process.exit(0);
}

for (let offset = 0; offset < candidates.length; offset += batchSize) {
  const batch = candidates.slice(offset, offset + batchSize);
  const factsTargets = batch.filter(({ article }) => needsFacts(article));
  if (factsTargets.length) await processFacts(factsTargets);

  const cardTargets = batch.filter(({ id }) => needsCard(articles[indexById.get(id)]));
  if (cardTargets.length) await processCards(cardTargets);

  await writePayload(payload, articles, stats);
  console.log(`[article-card] ${Math.min(offset + batch.length, candidates.length)}/${candidates.length} facts=${stats.factsGenerated}, cards=${stats.cardsGenerated}`);
}

if (!candidates.length) await writePayload(payload, articles, stats);
if (required && candidates.length && stats.cardsGenerated === 0 && stats.factsGenerated === 0) {
  throw new Error("article-card AI was required but generated no facts or cards");
}
console.log(`[article-card] complete candidates=${stats.candidateCount}, facts=${stats.factsGenerated}, cards=${stats.cardsGenerated}, factsReset=${stats.factsReset}, cardsReset=${stats.cardsReset}, factsFailed=${stats.factsFailed}, cardsFailed=${stats.cardsFailed}, factRetryRounds=${stats.factRetryRounds}, cardRetryRounds=${stats.cardRetryRounds}`);
