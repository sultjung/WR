#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const MODE = String(process.argv[2] || "").trim().toLowerCase();
const INPUT_FILE = path.resolve(
  process.env.PRIORITY_ORIGIN_INPUT_FILE || path.join(ROOT, "data", "recovered-articles.json")
);
const SNAPSHOT_FILE = path.resolve(
  process.env.PRIORITY_ORIGIN_SNAPSHOT_FILE || path.join(ROOT, "data", "priority-discovery-origin-snapshot.json")
);

function hostnameOf(url = "") {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function normalizeArabic(value = "") {
  return String(value)
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/\u0640/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function snapshotKey(article = {}) {
  return normalizeArabic(article.originalTitleArabic || "");
}

function isExplicitHathaFallback(article = {}) {
  return article.allowAggregatorFallback === true
    && article.recoveredSourceId === "hathalyoum"
    && hostnameOf(article.priorityAggregatorUrl || article.articleUrl) === "hathalyoum.net";
}

function recalculate(payload, articles) {
  const recoveredCount = articles.filter(
    (article) => article.urlStatus === "RECOVERED" && article.articleUrl
  ).length;
  return {
    ...payload,
    generatedAt: new Date().toISOString(),
    count: articles.length,
    recoveredCount,
    failedCount: articles.length - recoveredCount,
    articles
  };
}

if (!MODE || !["snapshot", "restore"].includes(MODE)) {
  throw new Error("usage: node preserve-priority-discovery-origins.mjs <snapshot|restore>");
}

if (MODE === "snapshot") {
  const payload = JSON.parse(await fs.readFile(INPUT_FILE, "utf8"));
  const entries = (payload.articles || []).map((article) => ({
    articleId: article.articleId,
    titleKey: snapshotKey(article),
    discoveryUrl: article.discoveryUrl || "",
    articleUrl: article.articleUrl || "",
    urlStatus: article.urlStatus || "PENDING",
    urlRecoveryMethod: article.urlRecoveryMethod || null,
    recoveredSourceId: article.recoveredSourceId || null,
    errorCode: article.errorCode || null
  }));
  await fs.writeFile(SNAPSHOT_FILE, `${JSON.stringify({ schemaVersion: "1.0", entries }, null, 2)}\n`, "utf8");
  console.log(`[priority-origin] snapshot=${entries.length}`);
  process.exit(0);
}

const payload = JSON.parse(await fs.readFile(INPUT_FILE, "utf8"));
const snapshot = JSON.parse(await fs.readFile(SNAPSHOT_FILE, "utf8"));
const byId = new Map((snapshot.entries || []).filter((entry) => entry.articleId).map((entry) => [entry.articleId, entry]));
const byTitle = new Map((snapshot.entries || []).filter((entry) => entry.titleKey).map((entry) => [entry.titleKey, entry]));
let restoredCount = 0;

const articles = (payload.articles || []).map((article) => {
  if (!isExplicitHathaFallback(article)) return article;
  const origin = byId.get(article.articleId) || byTitle.get(snapshotKey(article));
  if (!origin || hostnameOf(origin.discoveryUrl) !== "news.google.com") return article;

  restoredCount += 1;
  const hasRecoveredPublisher = Boolean(origin.articleUrl && origin.urlStatus === "RECOVERED");
  return {
    ...article,
    discoveryUrl: origin.discoveryUrl,
    articleUrl: hasRecoveredPublisher ? origin.articleUrl : "",
    urlStatus: hasRecoveredPublisher ? "RECOVERED" : "PENDING",
    urlRecoveryMethod: hasRecoveredPublisher ? origin.urlRecoveryMethod : null,
    primaryRecoveredSourceId: hasRecoveredPublisher ? origin.recoveredSourceId : null,
    errorCode: null,
    priorityOriginPreserved: true,
    priorityOriginPreservedAt: new Date().toISOString()
  };
});

await fs.writeFile(INPUT_FILE, `${JSON.stringify(recalculate(payload, articles), null, 2)}\n`, "utf8");
console.log(`[priority-origin] restored=${restoredCount} total=${articles.length}`);
