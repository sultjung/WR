#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const ROOT = process.cwd();
const RESOLVED_FILE = path.resolve(
  process.env.PRIORITY_FALLBACK_RESOLVED_FILE || path.join(ROOT, "data", "resolved-articles.json")
);
const ARTICLES_FILE = path.resolve(
  process.env.PRIORITY_FALLBACK_ARTICLES_FILE || path.join(ROOT, "data", "articles.json")
);
const SEEDS_FILE = path.resolve(
  process.env.PRIORITY_FALLBACK_SEEDS_FILE || path.join(ROOT, "config", "priority-news-seeds.json")
);
const MIN_CONTENT_CHARS = Number(process.env.MIN_ARABIC_CONTENT_CHARS || 300);
const MIN_ARABIC_RATIO = Number(process.env.MIN_ARABIC_RATIO || 0.35);

function normalizeUrl(value = "") {
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_)/i.test(key)) parsed.searchParams.delete(key);
    }
    return parsed.toString();
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

function arabicRatio(value = "") {
  const letters = String(value).match(/[\p{L}\p{N}]/gu) || [];
  if (!letters.length) return 0;
  const arabic = String(value).match(/[\u0600-\u06FF]/g) || [];
  return Number((arabic.length / letters.length).toFixed(4));
}

function articleUrls(article = {}) {
  return [article.articleUrl, article.canonicalUrl, article.discoveryUrl, article.priorityAggregatorUrl]
    .map(normalizeUrl)
    .filter(Boolean);
}

function seedMatchesArticle(seed = {}, article = {}) {
  const seedUrl = normalizeUrl(seed.url);
  if (seedUrl && articleUrls(article).includes(seedUrl)) return true;
  const seedTitle = normalizeArabic(seed.titleArabic || "");
  const articleTitle = normalizeArabic(article.originalTitleArabic || "");
  return Boolean(seedTitle && articleTitle && seedTitle === articleTitle);
}

function validSeed(seed = {}) {
  const text = String(seed.fallbackTextArabic || "").trim();
  return seed.enabled !== false
    && seed.allowContentFallback === true
    && seed.category === "bismayah"
    && Boolean(seed.url)
    && Boolean(seed.titleArabic)
    && text.length >= MIN_CONTENT_CHARS
    && arabicRatio(`${seed.titleArabic}\n${text}`) >= MIN_ARABIC_RATIO;
}

const resolved = JSON.parse(await fs.readFile(RESOLVED_FILE, "utf8"));
const current = JSON.parse(await fs.readFile(ARTICLES_FILE, "utf8"));
const seedConfig = JSON.parse(await fs.readFile(SEEDS_FILE, "utf8"));
const seeds = (seedConfig.urls || []).filter(validSeed);
const articles = [...(current.articles || [])];
let appliedCount = 0;
let skippedExistingCount = 0;

for (const seed of seeds) {
  const source = (resolved.articles || []).find((article) => seedMatchesArticle(seed, article));
  const existing = articles.find((article) =>
    (source?.articleId && article.articleId === source.articleId) || seedMatchesArticle(seed, article)
  );
  if (existing) {
    skippedExistingCount += 1;
    continue;
  }

  const originalTextArabic = String(seed.fallbackTextArabic).trim();
  const originalTitleArabic = String(seed.titleArabic).trim();
  const seedUrl = normalizeUrl(seed.url);
  const publishedAt = seed.publishedAt || source?.publishedAt || new Date().toISOString();
  const articleId = source?.articleId
    || `priority-seed-${createHash("sha256").update(seedUrl).digest("base64url").slice(0, 24)}`;
  const articleUrl = normalizeUrl(source?.articleUrl || seedUrl);
  const ratio = arabicRatio(`${originalTitleArabic}\n${originalTextArabic}`);

  articles.push({
    ...(source || {}),
    articleId,
    keywordId: source?.keywordId || "bismayah-priority-source-001",
    category: "bismayah",
    priority: 100,
    originalTitleArabic,
    originalTextArabic,
    descriptionArabic: source?.descriptionArabic || originalTextArabic.slice(0, 500),
    sourceArabic: seed.sourceArabic || source?.sourceArabic || "هذا اليوم",
    sourceHomepage: source?.sourceHomepage || "https://hathalyoum.net/",
    articleUrl,
    canonicalUrl: articleUrl,
    discoveryUrl: source?.discoveryUrl || seedUrl,
    priorityAggregatorUrl: source?.priorityAggregatorUrl || seedUrl,
    recoveredSourceId: source?.recoveredSourceId || "hathalyoum",
    urlRecoveryMethod: "PRIORITY_AGGREGATOR_FALLBACK",
    allowAggregatorFallback: true,
    allowPriorityContentFallback: true,
    publishedAt,
    language: "ar",
    contentChars: originalTextArabic.length,
    arabicRatio: ratio,
    contentStatus: "FULL_TEXT",
    contentSourceMethod: "PRIORITY_SEED_FALLBACK",
    contentFallbackReason: source?.errorCode || "SOURCE_ACCESS_BLOCKED_OR_UNAVAILABLE",
    errorCode: null,
    fetchedAt: new Date().toISOString(),
    relevanceNote: "비스마야·NIC·한화 직접 관련 우선기사의 검증된 시드 요약 사용",
    translation: { status: "PENDING", titleKo: "", fullTextKo: "" },
    analysis: {
      status: "PENDING",
      category: "bismayah",
      recommendation: "USER_REVIEW_REQUIRED",
      relevanceScore: null,
      recommendationReason: ""
    },
    selection: { selected: false, reportSection: null, displayOrder: null, userNote: "" },
    priorityDiscovery: source?.priorityDiscovery || {
      sourceId: "priority-seed",
      sourceUrl: seedUrl,
      detectedAt: new Date().toISOString()
    }
  });
  appliedCount += 1;
}

articles.sort((left, right) =>
  new Date(right.publishedAt || 0) - new Date(left.publishedAt || 0)
  || Number(right.priority || 0) - Number(left.priority || 0)
);

const categoryCounts = articles.reduce((acc, article) => {
  const key = article.category || "unknown";
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});
const payload = {
  ...current,
  generatedAt: new Date().toISOString(),
  count: articles.length,
  categoryCounts,
  collectionRun: {
    ...(current.collectionRun || {}),
    prioritySeedFallbacksApplied: appliedCount,
    prioritySeedFallbacksSkippedExisting: skippedExistingCount
  },
  articles
};

await fs.writeFile(ARTICLES_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`[priority-content-fallback] applied=${appliedCount} skippedExisting=${skippedExistingCount} total=${articles.length}`);
