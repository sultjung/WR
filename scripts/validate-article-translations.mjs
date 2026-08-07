#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { isRepresentative, translationIsCurrent } from "./article-translation-core.mjs";
import { relatedTitleIsCurrent } from "./article-card-core.mjs";

const ROOT = process.cwd();
const ARTICLES_FILE = path.resolve(process.env.TRANSLATION_ARTICLES_FILE || path.join(ROOT, "data", "articles.json"));
const payload = JSON.parse(await fs.readFile(ARTICLES_FILE, "utf8"));
const articles = Array.isArray(payload) ? payload : (payload.articles || []);
const errors = [];
let completedTranslations = 0;
let completedRelatedTitles = 0;

function addError(index, message) {
  errors.push(`articles[${index}]: ${message}`);
}

for (const [index, article] of articles.entries()) {
  const translation = article.translation || {};
  const translationStatus = String(translation.status || translation.translationStatus || "").toUpperCase();
  const relatedTitleStatus = String(article.relatedTitle?.status || "").toUpperCase();

  if (translationStatus === "COMPLETED") {
    completedTranslations += 1;
    if (!isRepresentative(article)) addError(index, "non-representative article should not carry a completed full translation");
    if (!translationIsCurrent(article)) addError(index, "completed full translation is stale or incomplete");
    if (translation.fullTranslationGenerated !== true) addError(index, "completed translation must mark fullTranslationGenerated=true");
    if (Object.hasOwn(translation, "summaryKo") || Object.hasOwn(translation, "previewKo")) {
      addError(index, "full translation data must not contain AI summary fields");
    }
  }

  if (relatedTitleStatus === "COMPLETED") {
    completedRelatedTitles += 1;
    if (!relatedTitleIsCurrent(article)) addError(index, "completed related title is stale or incomplete");
  }
}

if (errors.length) {
  for (const message of errors.slice(0, 15)) console.error(`[validate-translations] ${message}`);
  if (errors.length > 15) console.error(`[validate-translations] ... ${errors.length - 15} additional error(s) omitted`);
  console.error(`[validate-translations] failed with ${errors.length} error(s)`);
  process.exit(1);
}

console.log(`[validate-translations] passed translations=${completedTranslations}, relatedTitles=${completedRelatedTitles}`);
