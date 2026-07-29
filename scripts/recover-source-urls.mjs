#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const INPUT_FILE = path.join(ROOT, "data", "discovered-articles.json");
const OUTPUT_FILE = path.join(ROOT, "data", "recovered-articles.json");
const SOURCES_FILE = path.join(ROOT, "config", "arabic-sources.json");
const FETCH_TIMEOUT_MS = Number(process.env.SOURCE_INDEX_TIMEOUT_MS || 15000);
const MAX_INDEX_ENDPOINTS = Number(process.env.MAX_SOURCE_INDEX_ENDPOINTS || 6);
const MAX_INDEX_ITEMS = Number(process.env.MAX_SOURCE_INDEX_ITEMS || 1200);
const MIN_TITLE_SIMILARITY = Number(process.env.MIN_TITLE_SIMILARITY || 0.54);
const CONCURRENCY = Number(process.env.SOURCE_INDEX_CONCURRENCY || 3);

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
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function stripTags(value = "") {
  return decodeHtml(String(value).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function normalizeArabic(value = "") {
  return stripTags(value)
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/\u0640/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hostnameOf(url = "") {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
}

function normalizeUrl(url = "") {
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) if (/^(utm_|fbclid|gclid|mc_)/i.test(key)) parsed.searchParams.delete(key);
    parsed.hash = "";
    return parsed.toString();
  } catch { return ""; }
}

function isArticleLike(url = "") {
  try {
    const parsed = new URL(url);
    const p = decodeURIComponent(parsed.pathname || "");
    if (!/^https?:$/.test(parsed.protocol) || !p || p === "/") return false;
    if (/\.(?:jpg|jpeg|png|gif|webp|svg|ico|css|js|pdf|zip|mp4|mp3)(?:$|[?#])/i.test(p)) return false;
    if (/\/(?:tag|tags|category|categories|section|author|login|privacy|about|contact|feed|rss)(?:\/|$)/i.test(p)) return false;
    return true;
  } catch { return false; }
}

function sourceMatchesItem(source, item) {
  const homepageHost = hostnameOf(item.sourceHomepage || "");
  const aliases = source.hostAliases || [];
  if (homepageHost && aliases.some((host) => homepageHost === host || homepageHost.endsWith(`.${host}`) || host.endsWith(`.${homepageHost}`))) return true;
  const sourceText = normalizeArabic(`${item.sourceArabic || ""} ${item.originalTitleArabic || ""}`);
  return [source.displayName, source.arabicName].filter(Boolean).some((name) => sourceText.includes(normalizeArabic(name)));
}

function titleTokens(value = "") {
  const stop = new Set(["في", "من", "الى", "إلى", "على", "عن", "مع", "هذا", "هذه", "بعد", "قبل", "العراق", "العراقي", "العراقية"]);
  return new Set(normalizeArabic(value).split(" ").filter((token) => token.length >= 3 && !stop.has(token)));
}

function similarity(a = "", b = "") {
  const A = titleTokens(a);
  const B = titleTokens(b);
  if (!A.size || !B.size) return 0;
  let intersection = 0;
  for (const token of A) if (B.has(token)) intersection += 1;
  const containment = intersection / Math.min(A.size, B.size);
  const jaccard = intersection / new Set([...A, ...B]).size;
  return Number((containment * 0.7 + jaccard * 0.3).toFixed(4));
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; WR-Source-Recovery/1.0)",
        accept: "application/xml,text/xml,application/rss+xml,text/html;q=0.8,*/*;q=0.5",
        "accept-language": "ar-IQ,ar;q=0.9"
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { text: await response.text(), finalUrl: response.url || url, contentType: response.headers.get("content-type") || "" };
  } finally {
    clearTimeout(timer);
  }
}

function extractXmlItems(xml = "", source) {
  const items = [];
  for (const block of String(xml).match(/<(?:item|entry)>[\s\S]*?<\/(?:item|entry)>/gi) || []) {
    const title = stripTags(block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
    const link = decodeHtml(block.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] || block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1] || "");
    if (title && isArticleLike(link)) items.push({ title, url: normalizeUrl(link), sourceId: source.sourceId, method: "feed" });
  }
  for (const block of String(xml).match(/<url>[\s\S]*?<\/url>/gi) || []) {
    const loc = decodeHtml(block.match(/<loc[^>]*>([\s\S]*?)<\/loc>/i)?.[1] || "").trim();
    const newsTitle = stripTags(block.match(/<(?:news:)?title[^>]*>([\s\S]*?)<\/(?:news:)?title>/i)?.[1] || "");
    if (loc && isArticleLike(loc)) items.push({ title: newsTitle, url: normalizeUrl(loc), sourceId: source.sourceId, method: "sitemap" });
  }
  return items;
}

function extractHtmlLinks(html = "", baseUrl = "", source) {
  const items = [];
  for (const match of String(html).matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url;
    try { url = new URL(decodeHtml(match[1]), baseUrl).toString(); } catch { continue; }
    const title = stripTags(match[2]);
    const host = hostnameOf(url);
    if (!title || title.length < 18 || !(source.hostAliases || []).some((h) => host === h || host.endsWith(`.${h}`)) || !isArticleLike(url)) continue;
    items.push({ title, url: normalizeUrl(url), sourceId: source.sourceId, method: "listing" });
  }
  return items;
}

async function buildSourceIndex(source) {
  const base = new URL(source.baseUrl);
  const endpoints = [...new Set([
    source.baseUrl,
    ...(source.indexHints || []).map((hint) => new URL(hint, base).toString()),
    new URL("/robots.txt", base).toString()
  ])].slice(0, MAX_INDEX_ENDPOINTS);
  const items = [];
  const debug = [];
  for (const endpoint of endpoints) {
    try {
      const response = await fetchText(endpoint);
      let parsed = [];
      if (/xml|rss|atom/i.test(response.contentType) || /^\s*<\?xml|<rss|<feed|<urlset|<sitemapindex/i.test(response.text)) parsed = extractXmlItems(response.text, source);
      else if (/robots\.txt/i.test(endpoint)) {
        const sitemapUrls = [...response.text.matchAll(/^sitemap:\s*(\S+)/gim)].map((m) => m[1]).slice(0, 3);
        for (const sitemapUrl of sitemapUrls) {
          try {
            const sitemap = await fetchText(sitemapUrl);
            parsed.push(...extractXmlItems(sitemap.text, source));
          } catch {}
        }
      } else parsed = extractHtmlLinks(response.text, response.finalUrl, source);
      items.push(...parsed);
      debug.push({ endpoint, ok: true, count: parsed.length });
    } catch (error) {
      debug.push({ endpoint, ok: false, error: String(error.message || error).slice(0, 160) });
    }
    if (items.length >= MAX_INDEX_ITEMS) break;
  }
  const deduped = new Map();
  for (const item of items) if (item.url && !deduped.has(item.url)) deduped.set(item.url, item);
  return { sourceId: source.sourceId, items: [...deduped.values()].slice(0, MAX_INDEX_ITEMS), debug };
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
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, run));
  return output;
}

const input = JSON.parse(await fs.readFile(INPUT_FILE, "utf8"));
const config = JSON.parse(await fs.readFile(SOURCES_FILE, "utf8"));
const publisherSources = (config.sources || []).filter((s) => s.enabled && s.arabicEnabled && s.collectionMode === "publisher");
const indexes = await mapLimit(publisherSources, CONCURRENCY, buildSourceIndex);
const bySource = new Map(indexes.map((index) => [index.sourceId, index]));

let recoveredCount = 0;
const articles = (input.articles || []).map((item) => {
  const sources = publisherSources.filter((source) => sourceMatchesItem(source, item));
  let best = null;
  for (const source of sources) {
    const index = bySource.get(source.sourceId);
    for (const candidate of index?.items || []) {
      const score = similarity(item.originalTitleArabic || "", candidate.title || "");
      if (!best || score > best.score) best = { ...candidate, score, sourceId: source.sourceId };
    }
  }
  if (best && best.score >= MIN_TITLE_SIMILARITY) {
    recoveredCount += 1;
    return {
      ...item,
      articleUrl: best.url,
      urlStatus: "RECOVERED",
      urlRecoveryMethod: `source-${best.method}`,
      recoveredSourceId: best.sourceId,
      titleSimilarity: best.score,
      errorCode: null,
      recoveredAt: new Date().toISOString()
    };
  }
  return { ...item, articleUrl: "", urlStatus: "PENDING", urlRecoveryMethod: null, titleSimilarity: best?.score || null };
});

const payload = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  lookbackDays: input.lookbackDays || 14,
  count: articles.length,
  recoveredCount,
  failedCount: articles.length - recoveredCount,
  sourceIndexCounts: Object.fromEntries(indexes.map((index) => [index.sourceId, index.items.length])),
  articles,
  debug: indexes.map(({ items, ...rest }) => rest)
};

await fs.writeFile(OUTPUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`[recover] recovered=${recoveredCount}, failed=${payload.failedCount}, total=${articles.length}`);
