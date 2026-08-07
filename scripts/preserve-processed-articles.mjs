#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const ROOT = process.cwd();
const ARTICLES_FILE = path.join(ROOT, "data", "articles.json");
const SNAPSHOT_FILE = path.join(ROOT, "data", ".articles-before-collect.json");
const TRANSLATION_PIPELINE_VERSION = "FULL_TRANSLATION_V1";

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return fallback; }
}

function normalizeUrl(value = "") {
  try {
    const url = new URL(String(value));
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_)/i.test(key)) url.searchParams.delete(key);
    }
    url.hash = "";
    return url.toString();
  } catch { return ""; }
}

function articleKey(item = {}) {
  return normalizeUrl(item.canonicalUrl || item.articleUrl || item.article?.canonicalUrl || item.article?.articleUrl)
    || String(item.articleId || item.id || "");
}

function originalText(item = {}) {
  return String(item.originalTextArabic || item.article?.originalTextArabic || "").trim();
}

function sourceTitle(item = {}) {
  return String(item.originalTitleArabic || item.article?.originalTitleArabic || "").replace(/\s+/g, " ").trim();
}

function contentHash(item = {}) {
  const source = `${sourceTitle(item)}\n${originalText(item)}`.trim();
  return source ? createHash("sha256").update(source).digest("hex") : "";
}

function pendingTranslation(reason) {
  return {
    status: "PENDING",
    translationStatus: "PENDING",
    pipelineVersion: TRANSLATION_PIPELINE_VERSION,
    titleKo: "",
    fullTextKo: "",
    resetReason: reason
  };
}

function withoutLegacyCardData(item = {}) {
  const {
    card,
    cardFacts,
    translationStatus,
    fullTextKo,
    titleKo,
    previewKo,
    ...rest
  } = item;
  return rest;
}

const currentPayload = await readJson(ARTICLES_FILE, { articles: [] });
const previousPayload = await readJson(SNAPSHOT_FILE, { articles: [] });
const current = Array.isArray(currentPayload) ? currentPayload : (currentPayload.articles || []);
const previous = Array.isArray(previousPayload) ? previousPayload : (previousPayload.articles || []);
const previousByKey = new Map(previous.map((item) => [articleKey(item), item]).filter(([key]) => key));

let unchanged = 0;
let changed = 0;
let newCount = 0;

const articles = current.map((rawItem) => {
  const item = withoutLegacyCardData(rawItem);
  const oldRaw = previousByKey.get(articleKey(rawItem));
  const old = oldRaw ? withoutLegacyCardData(oldRaw) : null;
  const newHash = contentHash(rawItem);

  if (!old) {
    newCount += 1;
    return {
      ...item,
      translation: item.translation || pendingTranslation("NEW_SOURCE"),
      relatedTitle: item.relatedTitle,
      contentHash: newHash || item.contentHash || "",
      contentCheckedAt: item.fetchedAt || new Date().toISOString(),
      contentChanged: false
    };
  }

  const oldHash = old.contentHash || contentHash(oldRaw);
  if (oldHash && newHash && oldHash === newHash) {
    unchanged += 1;
    return {
      ...item,
      translation: old.translation || item.translation || pendingTranslation("TRANSLATION_MISSING"),
      relatedTitle: old.relatedTitle || item.relatedTitle,
      analysis: old.analysis || item.analysis,
      importance: old.importance || item.importance,
      eventGroup: old.eventGroup || item.eventGroup,
      selected: old.selected ?? item.selected,
      contentHash: newHash,
      contentCheckedAt: item.fetchedAt || new Date().toISOString(),
      contentChanged: false,
      processingReused: true
    };
  }

  if (oldHash && newHash && oldHash !== newHash) {
    changed += 1;
    return {
      ...item,
      translation: pendingTranslation("SOURCE_CONTENT_CHANGED"),
      relatedTitle: old.relatedTitle || item.relatedTitle,
      analysis: { ...(item.analysis || {}), status: "PENDING", resetReason: "SOURCE_CONTENT_CHANGED" },
      importance: undefined,
      contentHash: newHash,
      previousContentHash: oldHash,
      contentCheckedAt: item.fetchedAt || new Date().toISOString(),
      contentChanged: true,
      processingReused: false
    };
  }

  unchanged += 1;
  return {
    ...item,
    translation: old.translation || item.translation || pendingTranslation("TRANSLATION_MISSING"),
    relatedTitle: old.relatedTitle || item.relatedTitle,
    analysis: old.analysis || item.analysis,
    importance: old.importance || item.importance,
    eventGroup: old.eventGroup || item.eventGroup,
    selected: old.selected ?? item.selected,
    contentHash: newHash || oldHash || "",
    contentCheckedAt: item.fetchedAt || old.contentCheckedAt || new Date().toISOString(),
    contentChanged: false,
    processingReused: true
  };
});

const output = Array.isArray(currentPayload)
  ? articles
  : {
      ...currentPayload,
      generatedAt: new Date().toISOString(),
      articles,
      incrementalPreservation: {
        unchangedCount: unchanged,
        changedCount: changed,
        newCount,
        generatedAt: new Date().toISOString(),
        retainedProcessing: ["translation", "relatedTitle", "analysis", "importance", "eventGroup"],
        removedLegacyProcessing: ["cardFacts", "card"]
      }
    };

await fs.writeFile(ARTICLES_FILE, `${JSON.stringify(output, null, 2)}\n`, "utf8");
await fs.rm(SNAPSHOT_FILE, { force: true });
console.log(`[incremental:preserve] unchanged=${unchanged}, changed=${changed}, new=${newCount}`);
