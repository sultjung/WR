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
  normalizeFactsResult
} from "./article-card-core.mjs";
import { createKoreanCards, extractArabicFacts } from "./article-card-ai.mjs";

const ROOT = process.cwd();
const ARTICLES_FILE = path.resolve(process.env.CARD_ARTICLES_FILE || path.join(ROOT, "data", "articles.json"));
const required = /^(1|true|yes)$/i.test(process.env.CARD_AI_REQUIRED || "false");
const batchSize = Math.max(1, Math.min(5, Number(process.env.CARD_AI_BATCH_SIZE || 3)));
const maxArticles = Math.max(0, Number(process.env.CARD_AI_MAX_ARTICLES || 60));
const maxSourceChars = Math.max(3000, Number(process.env.CARD_SOURCE_MAX_CHARS || 16000));

function importanceScore(article = {}) {
  const stored = article.importance || article.analysis?.importance || {};
  const score = Number(stored.score ?? stored.finalScore ?? stored.ruleScore ?? article.importanceScore ?? 0);
  return Number.isFinite(score) ? score : 0;
}

function publishedTime(article = {}) {
  const value = new Date(article.publishedAt || article.article?.publishedAt || 0).getTime();
  return Number.isFinite(value) ? value : 0;
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
const articles = Array.isArray(payload) ? payload : (payload.articles || []);
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
  skippedCached: Math.max(0, articles.filter((article) => factsAreCurrent(article) && !needsCard(article)).length)
};

if (!String(process.env.OPENAI_API_KEY || "").trim()) {
  const message = "OPENAI_API_KEY is unavailable to article-card generation";
  if (required && candidates.length) throw new Error(message);
  console.warn(`[article-card] ${message}; no changes`);
  process.exit(0);
}

for (let offset = 0; offset < candidates.length; offset += batchSize) {
  const batch = candidates.slice(offset, offset + batchSize);
  const factsTargets = batch.filter(({ article }) => needsFacts(article));

  if (factsTargets.length) {
    try {
      const { results, model } = await extractArabicFacts(
        factsTargets.map(({ article, index }) => factsInputOf(article, index, maxSourceChars))
      );
      const expected = new Map(factsTargets.map((target) => [target.id, target]));
      for (const result of results) {
        const target = expected.get(String(result?.id || ""));
        if (!target) continue;
        const liveIndex = indexById.get(target.id);
        articles[liveIndex] = {
          ...articles[liveIndex],
          cardFacts: normalizeFactsResult(result, articles[liveIndex], model),
          card: {
            status: "PENDING",
            pipelineVersion: "FACTS_FIRST_V1",
            resetReason: "FACTS_REFRESHED"
          }
        };
        target.article = articles[liveIndex];
        stats.factsGenerated += 1;
      }
      const accepted = results.filter((result) => expected.has(String(result?.id || ""))).length;
      stats.factsFailed += Math.max(0, factsTargets.length - accepted);
    } catch (error) {
      stats.factsFailed += factsTargets.length;
      console.warn(`[article-card] fact extraction failed: ${error.message}`);
      if (required) throw error;
    }
  }

  const cardTargets = batch.filter(({ id }) => needsCard(articles[indexById.get(id)]));

  if (cardTargets.length) {
    try {
      const inputs = cardTargets.map(({ id, index }) => cardInputOf(articles[indexById.get(id)], index));
      const serialized = JSON.stringify(inputs);
      if (/originalTextArabic|bodyArabic|fullTextKo/.test(serialized)) {
        throw new Error("card stage received prohibited full-text fields");
      }
      const { results, model } = await createKoreanCards(inputs);
      const expected = new Map(cardTargets.map((target) => [target.id, target]));
      for (const result of results) {
        const target = expected.get(String(result?.id || ""));
        if (!target) continue;
        const liveIndex = indexById.get(target.id);
        articles[liveIndex] = {
          ...articles[liveIndex],
          card: normalizeCardResult(result, articles[liveIndex], model)
        };
        stats.cardsGenerated += 1;
      }
      const accepted = results.filter((result) => expected.has(String(result?.id || ""))).length;
      stats.cardsFailed += Math.max(0, cardTargets.length - accepted);
    } catch (error) {
      stats.cardsFailed += cardTargets.length;
      console.warn(`[article-card] Korean card generation failed: ${error.message}`);
      if (required) throw error;
    }
  }

  await writePayload(payload, articles, stats);
  console.log(`[article-card] ${Math.min(offset + batch.length, candidates.length)}/${candidates.length} facts=${stats.factsGenerated}, cards=${stats.cardsGenerated}`);
}

if (!candidates.length) await writePayload(payload, articles, stats);
if (required && candidates.length && stats.cardsGenerated === 0 && stats.factsGenerated === 0) {
  throw new Error("article-card AI was required but generated no facts or cards");
}
console.log(`[article-card] complete candidates=${stats.candidateCount}, facts=${stats.factsGenerated}, cards=${stats.cardsGenerated}, factsFailed=${stats.factsFailed}, cardsFailed=${stats.cardsFailed}`);
