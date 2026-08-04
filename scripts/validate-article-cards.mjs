#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { cardIsCurrent, factsAreCurrent, relatedTitleIsCurrent } from "./article-card-core.mjs";

const ROOT = process.cwd();
const ARTICLES_FILE = path.resolve(process.env.CARD_ARTICLES_FILE || path.join(ROOT, "data", "articles.json"));
const payload = JSON.parse(await fs.readFile(ARTICLES_FILE, "utf8"));
const articles = Array.isArray(payload) ? payload : (payload.articles || []);
const errors = [];
let completedFacts = 0;
let completedCards = 0;
let completedRelatedTitles = 0;

function addError(index, message) {
  errors.push(`articles[${index}]: ${message}`);
}

for (const [index, article] of articles.entries()) {
  const factsStatus = String(article.cardFacts?.status || "").toUpperCase();
  const cardStatus = String(article.card?.status || "").toUpperCase();
  const relatedTitleStatus = String(article.relatedTitle?.status || "").toUpperCase();

  if (factsStatus === "COMPLETED") {
    completedFacts += 1;
    if (!factsAreCurrent(article)) addError(index, "completed cardFacts are stale or incomplete");
  }

  if (cardStatus === "COMPLETED") {
    completedCards += 1;
    if (!cardIsCurrent(article)) addError(index, "completed card is stale or incomplete");
    if (article.card.fullTranslationGenerated !== false) addError(index, "card must not claim a full translation");
    if (Object.hasOwn(article.card, "fullTextKo")) addError(index, "fullTextKo is prohibited in card data");
  }

  if (relatedTitleStatus === "COMPLETED") {
    completedRelatedTitles += 1;
    if (!relatedTitleIsCurrent(article)) addError(index, "completed related title is stale or incomplete");
  }
}

if (errors.length) {
  for (const message of errors.slice(0, 12)) console.error(`[validate-cards] ${message}`);
  if (errors.length > 12) console.error(`[validate-cards] ... ${errors.length - 12} additional error(s) omitted`);
  console.error(`[validate-cards] failed with ${errors.length} error(s)`);
  process.exit(1);
}
console.log(`[validate-cards] passed facts=${completedFacts}, cards=${completedCards}, relatedTitles=${completedRelatedTitles}`);
