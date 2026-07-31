#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const ROOT = process.cwd();
const ARTICLES_FILE = path.join(ROOT, "data", "articles.json");
const SNAPSHOT_FILE = path.join(ROOT, "data", ".articles-before-collect.json");

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
  return String(item.originalTextArabic || item.article?.originalTextArabic || "")
    .replace(/\s+/g, " ")
    .trim();
}

function contentHash(item = {}) {
  const text = originalText(item);
  return text ? createHash("sha256").update(text).digest("hex") : "";
}

function completedTranslation(item = {}) {
  const translation = item.translation || {};
  const status = String(translation.translationStatus || translation.status || item.translationStatus || "").toUpperCase();
  return status === "COMPLETED" || Boolean(translation.fullTextKo || item.fullTextKo);
}

const currentPayload = await readJson(ARTICLES_FILE, { articles: [] });
const previousPayload = await readJson(SNAPSHOT_FILE, { articles: [] });
const current = Array.isArray(currentPayload) ? currentPayload : (currentPayload.articles || []);
const previous = Array.isArray(previousPayload) ? previousPayload : (previousPayload.articles || []);
const previousByKey = new Map(previous.map((item) => [articleKey(item), item]).filter(([key]) => key));

let unchanged = 0;
let changed = 0;
let newCount = 0;

const articles = current.map((item) => {
  const old = previousByKey.get(articleKey(item));
  const newHash = contentHash(item);
  if (!old) {
    newCount += 1;
    return {
      ...item,
      contentHash: newHash || item.contentHash || "",
      contentCheckedAt: item.fetchedAt || new Date().toISOString(),
      contentChanged: false
    };
  }

  const oldHash = old.contentHash || contentHash(old);
  if (oldHash && newHash && oldHash === newHash) {
    unchanged += 1;
    return {
      ...item,
      translation: old.translation || item.translation,
      translationStatus: old.translationStatus || item.translationStatus,
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
      translation: completedTranslation(old)
        ? { status: "PENDING", translationStatus: "PENDING", titleKo: "", previewKo: "", fullTextKo: "", resetReason: "SOURCE_CONTENT_CHANGED" }
        : (item.translation || old.translation),
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
    translation: old.translation || item.translation,
    translationStatus: old.translationStatus || item.translationStatus,
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
        generatedAt: new Date().toISOString()
      }
    };

await fs.writeFile(ARTICLES_FILE, `${JSON.stringify(output, null, 2)}\n`, "utf8");
await fs.rm(SNAPSHOT_FILE, { force: true });
console.log(`[incremental:preserve] unchanged=${unchanged}, changed=${changed}, new=${newCount}`);
