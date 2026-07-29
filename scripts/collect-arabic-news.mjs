#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const ROOT = process.cwd();
const KEYWORDS_FILE = path.join(ROOT, "config", "arabic-keywords.json");
const OUTPUT_FILE = path.join(ROOT, "data", "discovered-articles.json");
const LOOKBACK_DAYS = Number(process.env.NEWS_DISCOVERY_DAYS || 14);
const MAX_PER_QUERY = Number(process.env.MAX_PER_QUERY || 30);
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 15000);
const CONCURRENCY = Number(process.env.DISCOVERY_CONCURRENCY || 3);

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
  return decodeHtml(String(value).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
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
        "user-agent": "Mozilla/5.0 (compatible; WR-Arabic-News-Collector/1.0)",
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
    const title = sourceArabic ? rawTitle.replace(new RegExp(`\\s+-\\s+${sourceArabic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), "").trim() : rawTitle;
    const publishedAt = pubDate && !Number.isNaN(new Date(pubDate).getTime()) ? new Date(pubDate).toISOString() : "";
    const discoveryUrl = link || guid;
    return {
      schemaVersion: "1.0",
      articleId: stableId(discoveryUrl || `${title}|${publishedAt}|${sourceArabic}`),
      keywordId: keyword.keywordId,
      category: keyword.category,
      priority: keyword.priority,
      queryArabic: keyword.arabicQuery,
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
      errorCode: null,
      discoveredAt: new Date().toISOString()
    };
  }).filter((item) => item.originalTitleArabic && item.discoveryUrl);
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
const keywords = (config.keywords || []).filter((item) => item.enabled && item.category === "bismayah");
if (!keywords.length) throw new Error("No enabled Bismayah keywords found in config/arabic-keywords.json");

const results = await mapLimit(keywords, CONCURRENCY, async (keyword) => {
  try {
    const xml = await fetchText(googleNewsRssUrl(keyword.arabicQuery));
    const articles = parseItems(xml, keyword);
    console.log(`[discover] ${keyword.keywordId}: ${articles.length}`);
    return { keywordId: keyword.keywordId, ok: true, count: articles.length, articles };
  } catch (error) {
    console.warn(`[discover] ${keyword.keywordId}: ${error.message || error}`);
    return { keywordId: keyword.keywordId, ok: false, count: 0, error: String(error.message || error), articles: [] };
  }
});

const deduped = new Map();
for (const article of results.flatMap((result) => result.articles)) {
  const key = article.discoveryUrl || `${article.originalTitleArabic}|${article.sourceArabic}|${article.publishedAt}`;
  if (!deduped.has(key)) deduped.set(key, article);
}

const payload = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  lookbackDays: LOOKBACK_DAYS,
  queryCount: keywords.length,
  count: deduped.size,
  articles: [...deduped.values()].sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0)),
  debug: results.map(({ articles, ...rest }) => rest)
};

await fs.writeFile(OUTPUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`[discover] completed: ${payload.count} unique articles`);
