#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { cardIsCurrent, factsAreCurrent } from "./article-card-core.mjs";

const ROOT = process.cwd();
const ARTICLES_FILE = path.resolve(process.env.CARD_ARTICLES_FILE || path.join(ROOT, "data", "articles.json"));
const payload = JSON.parse(await fs.readFile(ARTICLES_FILE, "utf8"));
const articles = Array.isArray(payload) ? payload : (payload.articles || []);
let errors = 0;
let completedFacts = 0;
let completedCards = 0;

for (const [index, article] of articles.entries()) {
  const factsStatus = String(article.cardFacts?.status || "").toUpperCase();
  const cardStatus = String(article.card?.status || "").toUpperCase();
  if (factsStatus === "COMPLETED") {
    completedFacts += 1;
    if (!factsAreCurrent(article)) {
      console.error(`[validate-cards] articles[${index}]: completed cardFacts are stale or incomplete`);
      errors += 1;
    }
  }
  if (cardStatus === "COMPLETED") {
    completedCards += 1;
    if (!cardIsCurrent(article)) {
      console.error(`[validate-cards] articles[${index}]: completed card is stale or incomplete`);
      errors += 1;
    }
    if (article.card.fullTranslationGenerated !== false) {
      console.error(`[validate-cards] articles[${index}]: card must not claim a full translation`);
      errors += 1;
    }
    if (Object.hasOwn(article.card, "fullTextKo")) {
      console.error(`[validate-cards] articles[${index}]: fullTextKo is prohibited in card data`);
      errors += 1;
    }
  }
}

if (errors) {
  console.error(`[validate-cards] failed with ${errors} error(s)`);
  process.exit(1);
}
console.log(`[validate-cards] passed facts=${completedFacts}, cards=${completedCards}`);
