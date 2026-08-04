#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import {
  articleIdOf,
  needsRelatedTitle,
  normalizeRelatedTitleResult,
  relatedTitleInputOf
} from "./article-card-core.mjs";
import { translateRelatedTitles } from "./article-card-ai.mjs";

const ROOT = process.cwd();
const ARTICLES_FILE = path.resolve(process.env.CARD_ARTICLES_FILE || path.join(ROOT, "data", "articles.json"));
const required = /^(1|true|yes)$/i.test(process.env.RELATED_TITLE_AI_REQUIRED || "false");
const batchSize = Math.max(1, Math.min(10, Number(process.env.RELATED_TITLE_AI_BATCH_SIZE || 8)));
const maxArticles = Math.max(0, Number(process.env.RELATED_TITLE_MAX_ARTICLES || 300));
const retryAttempts = Math.max(1, Math.min(3, Number(process.env.RELATED_TITLE_AI_RETRY_ATTEMPTS || 2)));

function publishedTime(article = {}) {
  const value = new Date(article.publishedAt || article.article?.publishedAt || 0).getTime();
  return Number.isFinite(value) ? value : 0;
}

function pendingLabel(pending) {
  return [...pending.values()].slice(0, 8).map((target) => target.articleId).join(",");
}

async function writePayload(payload, articles, stats) {
  const generatedAt = new Date().toISOString();
  const output = Array.isArray(payload)
    ? articles
    : {
        ...payload,
        generatedAt,
        articles,
        relatedTitleGeneration: {
          pipelineVersion: "RELATED_TITLE_V1",
          generatedAt,
          ...stats
        }
      };
  await fs.writeFile(ARTICLES_FILE, `${JSON.stringify(output, null, 2)}\n`, "utf8");
}

const payload = JSON.parse(await fs.readFile(ARTICLES_FILE, "utf8"));
const articles = Array.isArray(payload) ? payload : (payload.articles || []);
const candidates = articles
  .map((article, index) => ({
    article,
    index,
    articleId: articleIdOf(article, index),
    requestId: `rt-${index.toString(36)}`
  }))
  .filter(({ article }) => needsRelatedTitle(article))
  .sort((a, b) => publishedTime(b.article) - publishedTime(a.article))
  .slice(0, maxArticles || undefined);

const stats = {
  candidateCount: candidates.length,
  titlesGenerated: 0,
  titlesFailed: 0,
  retryRounds: 0
};

if (!String(process.env.OPENAI_API_KEY || "").trim()) {
  const message = "OPENAI_API_KEY is unavailable to related-title generation";
  if (required && candidates.length) throw new Error(message);
  console.warn(`[related-title] ${message}; no changes`);
  process.exit(0);
}

for (let offset = 0; offset < candidates.length; offset += batchSize) {
  const batch = candidates.slice(offset, offset + batchSize);
  const pending = new Map(batch.map((target) => [target.requestId, target]));
  let lastError = null;

  for (let attempt = 1; attempt <= retryAttempts && pending.size; attempt += 1) {
    if (attempt > 1) stats.retryRounds += 1;
    const currentTargets = [...pending.values()];
    try {
      const inputs = currentTargets.map(({ article, index, requestId }) => relatedTitleInputOf(article, index, requestId));
      const { results, model } = await translateRelatedTitles(inputs);
      for (const result of results) {
        const requestId = String(result?.id || "");
        const target = pending.get(requestId);
        if (!target) continue;
        articles[target.index] = {
          ...articles[target.index],
          relatedTitle: normalizeRelatedTitleResult(result, articles[target.index], model)
        };
        pending.delete(requestId);
        stats.titlesGenerated += 1;
      }
      if (pending.size) {
        console.warn(`[related-title] incomplete response attempt=${attempt}/${retryAttempts}, missing=${pendingLabel(pending)}`);
      }
    } catch (error) {
      lastError = error;
      console.warn(`[related-title] attempt=${attempt}/${retryAttempts} failed: ${error.message}`);
    }
  }

  if (pending.size) {
    stats.titlesFailed += pending.size;
    console.warn(`[related-title] unresolved=${pending.size}, ids=${pendingLabel(pending)}${lastError ? `, lastError=${lastError.message}` : ""}`);
  }

  await writePayload(payload, articles, stats);
  console.log(`[related-title] ${Math.min(offset + batch.length, candidates.length)}/${candidates.length}, generated=${stats.titlesGenerated}`);
}

if (!candidates.length) await writePayload(payload, articles, stats);
if (required && candidates.length && stats.titlesGenerated === 0) {
  throw new Error("related-title AI was required but generated no Korean titles");
}
console.log(`[related-title] complete candidates=${stats.candidateCount}, generated=${stats.titlesGenerated}, failed=${stats.titlesFailed}, retryRounds=${stats.retryRounds}`);
