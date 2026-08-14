#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const ROOT = process.cwd();
const KEYWORDS_FILE = path.join(ROOT, "config", "arabic-keywords.json");
const OUTPUT_FILE = path.join(ROOT, "data", "discovered-articles.json");
const LOOKBACK_DAYS = Number(process.env.NEWS_DISCOVERY_DAYS || 7);
const MAX_PER_QUERY = Number(process.env.MAX_PER_QUERY || 30);
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 15000);
const CONCURRENCY = Number(process.env.DISCOVERY_CONCURRENCY || 3);
const ENABLED_CATEGORIES = new Set(
  String(process.env.COLLECT_CATEGORIES || "bismayah,politics,economy,security,international")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);

const BISMAYAH_KEYWORDS = [
  {
    keywordId: "bismayah-nic-official-site-001",
    category: "bismayah",
    arabicQuery: "site:investpromo.gov.iq",
    requiredTerms: [],
    optionalTerms: ["الهيئة الوطنية للاستثمار", "رئيس الهيئة", "بسماية", "مشروع", "فرص استثمارية"],
    excludedTerms: ["تهنئة", "تعزية", "احتفالية"],
    requiredSourceHosts: ["investpromo.gov.iq"],
    officialSource: true,
    priority: 100,
    description: "NIC 공식 홈페이지 신규 게시물",
    enabled: true
  },
  {
    keywordId: "bismayah-nic-001",
    category: "bismayah",
    arabicQuery: '"الهيئة الوطنية للاستثمار"',
    requiredTerms: ["الهيئة الوطنية للاستثمار"],
    optionalTerms: ["رئيس", "مشروع", "استثمار", "بسماية"],
    excludedTerms: ["تهنئة", "تعزية", "احتفالية"],
    priority: 100,
    description: "NIC 직접 관련 뉴스",
    enabled: true
  },
  {
    keywordId: "bismayah-direct-001",
    category: "bismayah",
    arabicQuery: "بسماية OR بسمايه",
    requiredTerms: [],
    optionalTerms: ["بسماية", "بسمايه", "مجمع بسماية", "مدينة بسماية"],
    excludedTerms: ["بسما", "بسماه"],
    priority: 100,
    description: "비스마야 직접 언급 뉴스",
    enabled: true
  },
  {
    keywordId: "bismayah-hanwha-iraq-001",
    category: "bismayah",
    arabicQuery: '("شركة هانوا" OR هانوا) العراق',
    requiredTerms: ["العراق"],
    optionalTerms: ["شركة هانوا", "هانوا", "بسماية", "مشروع"],
    excludedTerms: [],
    priority: 100,
    description: "한화와 이라크 직접 관련 뉴스",
    enabled: true
  }
];

function decodeHtml(value = "") {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .trim();
}

function stripTags(value = "") {
  return decodeHtml(String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function extractTag(xml = "", tag = "") {
  const match = String(xml).match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeHtml(match[1]) : "";
}

function stableId(value = "") {
  return `discovery-${createHash("sha256").update(String(value)).digest("base64url").slice(0, 24)}`;
}

function normalizeTitle(value = "") {
  return stripTags(value).replace(/\s+/g, " ").trim();
}

function normalizeArabic(value = "") {
  return String(value)
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/\u0640/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}

function hasTerm(text = "", term = "") {
  const haystack = normalizeArabic(text);
  const needle = normalizeArabic(term);
  if (!needle) return false;
  return haystack.includes(needle);
}

function looksCeremonial(item = {}, keyword = {}) {
  const text = `${item.originalTitleArabic || ""}\n${item.descriptionArabic || ""}`;
  const ceremonial = ["تهنئة", "تعزية", "برقية تهنئة", "برقية تعزية", "استقبال المهنئين", "ذكرى تأسيس", "حفل تكريم"];
  const excluded = [...ceremonial, ...(keyword.excludedTerms || [])];
  return excluded.some((term) => hasTerm(text, term));
}

function matchesRequiredSource(item = {}, keyword = {}) {
  const requiredHosts = keyword.requiredSourceHosts || [];
  if (!requiredHosts.length) return true;
  try {
    const hostname = new URL(item.sourceHomepage || "").hostname.replace(/^www\./, "").toLowerCase();
    return requiredHosts.some((required) => hostname === required || hostname.endsWith(`.${required}`));
  } catch {
    return false;
  }
}

function isSocialSource(sourceHomepage = "", sourceArabic = "") {
  const value = `${sourceHomepage} ${sourceArabic}`.toLowerCase();
  return /facebook\.com|instagram\.com|youtube\.com|twitter\.com|(^|\s)x\.com|tiktok\.com/.test(value);
}

function googleNewsRssUrl(query) {
  const params = new URLSearchParams({ q: `${query} when:${LOOKBACK_DAYS}d`, hl: "ar", gl: "IQ", ceid: "IQ:ar" });
  return `https://news.google.com/rss/search?${params.toString()}`;
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; WR-Arabic-News-Collector/2.1)",
        accept: "application/rss+xml,application/xml,text/xml,text/html;q=0.8,*/*;q=0.5",
        "accept-language": "ar-IQ,ar;q=0.9"
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseItems(xml, keyword) {
  const blocks = String(xml).match(/<item>[\s\S]*?<\/item>/gi) || [];
  return blocks.slice(0, MAX_PER_QUERY).map((block) => {
    const rawTitle = normalizeTitle(extractTag(block, "title"));
    const link = extractTag(block, "link");
    const guid = extractTag(block, "guid");
    const pubDate = extractTag(block, "pubDate");
    const description = stripTags(extractTag(block, "description"));
    const sourceMatch = block.match(/<source(?:\s+url=["']([^"']+)["'])?[^>]*>([\s\S]*?)<\/source>/i);
    const sourceHomepage = sourceMatch?.[1] ? decodeHtml(sourceMatch[1]) : "";
    const sourceArabic = sourceMatch?.[2] ? stripTags(sourceMatch[2]) : (rawTitle.split(" - ").pop() || "");
    const title = sourceArabic
      ? rawTitle.replace(new RegExp(`\\s+-\\s+${sourceArabic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), "").trim()
      : rawTitle;
    const publishedAt = pubDate && !Number.isNaN(new Date(pubDate).getTime()) ? new Date(pubDate).toISOString() : "";
    const discoveryUrl = link || guid;
    return {
      schemaVersion: "1.0",
      articleId: stableId(discoveryUrl || `${title}|${publishedAt}|${sourceArabic}`),
      keywordId: keyword.keywordId,
      category: keyword.category,
      priority: keyword.priority,
      queryArabic: keyword.arabicQuery,
      requiredTerms: keyword.requiredTerms || [],
      optionalTerms: keyword.optionalTerms || [],
      excludedTerms: keyword.excludedTerms || [],
      originalTitleArabic: title,
      sourceArabic,
      sourceHomepage,
      publishedAt,
      descriptionArabic: description,
      discoveryUrl,
      articleUrl: "",
      discoveryMethod: "google-news-rss",
      language: "ar",
      discoveryStatus: "DISCOVERED",
      urlStatus: "PENDING",
      contentStatus: "PENDING",
      officialSource: keyword.officialSource === true,
      sourceReliability: keyword.officialSource === true ? "OFFICIAL" : "PUBLISHER",
      errorCode: null,
      discoveredAt: new Date().toISOString()
    };
  }).filter((item) => item.originalTitleArabic
    && item.discoveryUrl
    && matchesRequiredSource(item, keyword)
    && !isSocialSource(item.sourceHomepage, item.sourceArabic)
    && !looksCeremonial(item, keyword));
}

async function mapLimit(items, limit, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return output;
}

const config = JSON.parse(await fs.readFile(KEYWORDS_FILE, "utf8"));
const configuredKeywords = (config.keywords || []).filter((item) => item.enabled && item.category !== "bismayah");
const keywordPool = [...BISMAYAH_KEYWORDS, ...configuredKeywords];
const keywords = keywordPool.filter((item) => item.enabled && ENABLED_CATEGORIES.has(item.category));
if (!keywords.length) throw new Error(`No enabled keywords found for categories: ${[...ENABLED_CATEGORIES].join(", ")}`);

const results = await mapLimit(keywords, CONCURRENCY, async (keyword) => {
  try {
    const xml = await fetchText(googleNewsRssUrl(keyword.arabicQuery));
    const articles = parseItems(xml, keyword);
    console.log(`[discover:${keyword.category}] ${keyword.keywordId}: ${articles.length}`);
    return { keywordId: keyword.keywordId, category: keyword.category, ok: true, count: articles.length, articles };
  } catch (error) {
    console.warn(`[discover:${keyword.category}] ${keyword.keywordId}: ${error.message || error}`);
    return { keywordId: keyword.keywordId, category: keyword.category, ok: false, count: 0, error: String(error.message || error), articles: [] };
  }
});

const deduped = new Map();
for (const article of results.flatMap((result) => result.articles)) {
  const key = article.discoveryUrl || `${article.originalTitleArabic}|${article.sourceArabic}|${article.publishedAt}`;
  const previous = deduped.get(key);
  if (!previous || Number(article.priority || 0) > Number(previous.priority || 0)) deduped.set(key, article);
}

const articles = [...deduped.values()].sort((a, b) =>
  new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0) || Number(b.priority || 0) - Number(a.priority || 0)
);

const categoryCounts = articles.reduce((acc, article) => {
  acc[article.category] = (acc[article.category] || 0) + 1;
  return acc;
}, {});

const payload = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  lookbackDays: LOOKBACK_DAYS,
  categories: [...ENABLED_CATEGORIES],
  queryCount: keywords.length,
  count: articles.length,
  categoryCounts,
  articles,
  debug: results.map(({ articles: omitted, ...rest }) => rest)
};

await fs.writeFile(OUTPUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`[discover] completed: ${payload.count} unique articles`, categoryCounts);
