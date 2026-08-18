#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { translationIsCurrent } from "./article-translation-core.mjs";
import { articleIdOf, relatedTitleIsCurrent } from "./article-card-core.mjs";
import { importanceFingerprint } from "./importance-business-rules.mjs";
import { IMPORTANCE_SCORING_VERSION } from "./importance-category-rules.mjs";

const ROOT = process.cwd();
const ARTICLES_FILE = path.resolve(process.env.CHECKPOINT_ARTICLES_FILE || path.join(ROOT, "data", "articles.json"));
const CHECKPOINT_FILE = String(process.env.AI_CHECKPOINT_FILE || "").trim();

function articlesOf(payload) {
  return Array.isArray(payload) ? payload : (Array.isArray(payload?.articles) ? payload.articles : []);
}

function keyOf(article = {}, index = 0) {
  return articleIdOf(article, index)
    || article.canonicalUrl
    || article.articleUrl
    || article.discoveryUrl
    || "";
}

function importanceIsCurrent(article = {}, importance = {}) {
  return Number(importance.scoringVersion || 0) === IMPORTANCE_SCORING_VERSION
    && importance.scoreFingerprint === importanceFingerprint(article)
    && typeof importance.aiScore === "number"
    && Number.isFinite(importance.aiScore)
    && Boolean(String(importance.aiModel || "").trim());
}

if (!CHECKPOINT_FILE) {
  console.log("[ai-checkpoint] no checkpoint file configured");
  process.exit(0);
}

let checkpointPayload;
try {
  checkpointPayload = JSON.parse(await fs.readFile(CHECKPOINT_FILE, "utf8"));
} catch (error) {
  if (error?.code === "ENOENT") {
    console.log("[ai-checkpoint] checkpoint not found; continuing without restore");
    process.exit(0);
  }
  throw error;
}

const payload = JSON.parse(await fs.readFile(ARTICLES_FILE, "utf8"));
const articles = articlesOf(payload);
const checkpointArticles = articlesOf(checkpointPayload);
const savedByKey = new Map(checkpointArticles.map((article, index) => [keyOf(article, index), article]).filter(([key]) => key));
const stats = { translations: 0, relatedTitles: 0, importance: 0 };

const restored = articles.map((article, index) => {
  const saved = savedByKey.get(keyOf(article, index));
  if (!saved) return article;
  let next = article;

  if (saved.translation) {
    const candidate = { ...next, translation: saved.translation };
    if (translationIsCurrent(candidate)) {
      next = candidate;
      stats.translations += 1;
    }
  }

  if (saved.relatedTitle) {
    const candidate = { ...next, relatedTitle: saved.relatedTitle };
    if (relatedTitleIsCurrent(candidate)) {
      next = candidate;
      stats.relatedTitles += 1;
    }
  }

  if (saved.importance && importanceIsCurrent(next, saved.importance)) {
    next = {
      ...next,
      importance: {
        ...(next.importance || {}),
        aiScore: saved.importance.aiScore,
        aiModel: saved.importance.aiModel,
        aiReportPriority: saved.importance.aiReportPriority || "REFERENCE",
        scoreFingerprint: saved.importance.scoreFingerprint,
        scoringVersion: saved.importance.scoringVersion
      }
    };
    stats.importance += 1;
  }

  return next;
});

const output = Array.isArray(payload) ? restored : { ...payload, articles: restored };
await fs.writeFile(ARTICLES_FILE, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`[ai-checkpoint] restored translations=${stats.translations}, relatedTitles=${stats.relatedTitles}, importance=${stats.importance}`);
