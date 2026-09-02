#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { decodeGoogleNewsUrl } from "./decode-google-news-url.mjs";

const ROOT = process.cwd();
const RECOVERED_FILE = path.join(ROOT, "data", "recovered-articles.json");
const FALLBACK_FILE = path.join(ROOT, "data", "discovered-articles.json");
const OUTPUT_FILE = path.join(ROOT, "data", "resolved-articles.json");
const FETCH_TIMEOUT_MS = Number(process.env.URL_RESOLVE_TIMEOUT_MS || 15000);
const ITEM_TIMEOUT_MS = Number(process.env.URL_RESOLVE_ITEM_TIMEOUT_MS || Math.max(FETCH_TIMEOUT_MS * 6, 90000));
const CONCURRENCY = Number(process.env.URL_RESOLVE_CONCURRENCY || 4);

function decodeHtml(value = "") {
  return String(value).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\\u0026/g, "&").replace(/\\u003d/g, "=").replace(/\\u002f/g, "/").replace(/\\\//g, "/").trim();
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

function isBlockedHost(host = "") {
  return !host || host === "news.google.com" || /(^|\.)google\.[a-z.]+$/i.test(host) || /gstatic\.com$/i.test(host) || /googleusercontent\.com$/i.test(host) || /youtube\.com$/i.test(host) || /facebook\.com$/i.test(host) || /instagram\.com$/i.test(host) || /(?:^|\.)x\.com$/i.test(host) || /twitter\.com$/i.test(host) || /w3\.org$/i.test(host) || /schema\.org$/i.test(host) || /xmlsoft\.org$/i.test(host) || /(^|\.)nabd(?:app)?\.com$/i.test(host) || /hathalyoum\.net$/i.test(host);
}

function isLikelyArticleUrl(url = "") {
  try {
    const parsed = new URL(url);
    const host = hostnameOf(url);
    const p = decodeURIComponent(parsed.pathname || "");
    if (isBlockedHost(host) || !/^https?:$/.test(parsed.protocol) || !p || p === "/" || p.length < 5) return false;
    if (/\.(?:jpg|jpeg|png|gif|webp|svg|ico|css|js|pdf|zip|mp4|mp3)(?:$|[?#])/i.test(p)) return false;
    if (/\/(?:search|tag|tags|category|categories|section|author|login|privacy|about|contact|feed|rss)(?:\/|$)/i.test(p)) return false;
    if (/\/XML\/|\/namespace|\/schema\b/i.test(p)) return false;
    return true;
  } catch { return false; }
}

async function fetchPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.7",
        "accept-language": "ar-IQ,ar;q=0.9,en;q=0.5"
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { html: await response.text(), finalUrl: response.url || url };
  } finally { clearTimeout(timer); }
}

function extractCandidates(html = "", baseUrl = "") {
  const candidates = [];
  const patterns = [
    /data-n-au=["']([^"']+)["']/gi,
    /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/gi,
    /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:url["']/gi,
    /<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"']+)["']/gi
  ];
  for (const pattern of patterns) {
    for (const match of String(html).matchAll(pattern)) {
      let raw = decodeHtml(match[1]);
      try { raw = new URL(raw, baseUrl).toString(); } catch { continue; }
      const normalized = normalizeUrl(raw);
      if (normalized && isLikelyArticleUrl(normalized)) candidates.push(normalized);
    }
  }
  return [...new Set(candidates)];
}

function chooseBestCandidate(candidates) {
  return candidates.map((url) => {
    const p = new URL(url).pathname;
    let score = 0;
    if (/\d{4,}/.test(p)) score += 20;
    if (/\/(news|article|story|details?|politics|economy|iraq|local)\//i.test(p)) score += 15;
    if (p.split("/").filter(Boolean).length >= 2) score += 10;
    score += Math.min(p.length, 100) / 25;
    return { url, score };
  }).filter((item) => item.score >= 20).sort((a, b) => b.score - a.score)[0]?.url || "";
}

async function verifyPublisherUrl(item, candidateUrl, resolutionMethod) {
  const page = await fetchPage(candidateUrl);
  const finalUrl = normalizeUrl(page.finalUrl || candidateUrl);
  if (!isLikelyArticleUrl(finalUrl)) throw new Error("INVALID_ARTICLE_PAGE");
  return {
    ...item,
    articleUrl: finalUrl,
    urlStatus: "RESOLVED",
    urlResolutionMethod: resolutionMethod,
    errorCode: null,
    resolvedAt: new Date().toISOString()
  };
}

async function resolveOne(item) {
  // Facebook blocks unattended publisher-page fetches.  NIC Facebook matches
  // are intentionally retained as search-snippet records and never treated as
  // publisher full text.
  if (item.facebookSearchSnippetOnly === true && item.articleUrl) {
    return {
      ...item,
      urlStatus: "RESOLVED",
      urlResolutionMethod: "GOOGLE_SEARCH_NIC_FACEBOOK_SNIPPET",
      errorCode: null,
      resolvedAt: new Date().toISOString()
    };
  }
  if (item.urlStatus === "RECOVERED" && isLikelyArticleUrl(item.articleUrl)) {
    try {
      return await verifyPublisherUrl(item, item.articleUrl, item.urlRecoveryMethod || "SOURCE_INDEX_TITLE_MATCH");
    } catch (error) {
      // Continue to Google News decoding instead of failing immediately.
    }
  }

  const discoveryUrl = String(item.discoveryUrl || "").trim();
  if (!discoveryUrl) return { ...item, articleUrl: "", urlStatus: "FAILED", errorCode: "URL_RESOLUTION_FAILED" };

  let googleDecodeError = "";
  if (hostnameOf(discoveryUrl) === "news.google.com") {
    try {
      const decodedUrl = normalizeUrl(await decodeGoogleNewsUrl(discoveryUrl, { timeoutMs: FETCH_TIMEOUT_MS }));
      if (isLikelyArticleUrl(decodedUrl)) {
        return await verifyPublisherUrl(item, decodedUrl, "GOOGLE_NEWS_BATCHEXECUTE");
      }
      googleDecodeError = "GOOGLE_DECODE_RETURNED_NON_ARTICLE_URL";
    } catch (error) {
      googleDecodeError = String(error.message || error).slice(0, 300);
    }
  }

  try {
    const first = await fetchPage(discoveryUrl);
    if (isLikelyArticleUrl(first.finalUrl)) return await verifyPublisherUrl(item, first.finalUrl, "HTTP_REDIRECT");
    const articleUrl = chooseBestCandidate(extractCandidates(first.html, first.finalUrl));
    if (!articleUrl) {
      return {
        ...item,
        articleUrl: "",
        urlStatus: "FAILED",
        errorCode: googleDecodeError ? "GOOGLE_NEWS_DECODE_FAILED" : "URL_RESOLUTION_FAILED",
        resolutionError: googleDecodeError || undefined,
        resolvedAt: new Date().toISOString()
      };
    }
    return await verifyPublisherUrl(item, articleUrl, "PAGE_METADATA");
  } catch (error) {
    const message = String(error.message || error);
    const errorCode = /abort|timeout/i.test(message)
      ? "FETCH_TIMEOUT"
      : /HTTP 404|HTTP 410/.test(message)
        ? "ARTICLE_REMOVED"
        : /HTTP 401|HTTP 403|HTTP 429/.test(message)
          ? "ACCESS_BLOCKED"
          : googleDecodeError
            ? "GOOGLE_NEWS_DECODE_FAILED"
            : "URL_RESOLUTION_FAILED";
    return {
      ...item,
      articleUrl: "",
      urlStatus: "FAILED",
      errorCode,
      resolutionError: `${googleDecodeError ? `${googleDecodeError}; ` : ""}${message}`.slice(0, 300),
      resolvedAt: new Date().toISOString()
    };
  }
}

async function withHardTimeout(task, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(task),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("ITEM_RESOLUTION_TIMEOUT")), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function resolveOneSafely(item) {
  try {
    return await withHardTimeout(() => resolveOne(item), ITEM_TIMEOUT_MS);
  } catch (error) {
    const message = String(error.message || error);
    return {
      ...item,
      articleUrl: "",
      urlStatus: "FAILED",
      errorCode: /ITEM_RESOLUTION_TIMEOUT/.test(message) ? "ITEM_RESOLUTION_TIMEOUT" : "URL_RESOLUTION_FAILED",
      resolutionError: message.slice(0, 300),
      resolvedAt: new Date().toISOString()
    };
  }
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

async function loadInput() {
  try { return JSON.parse(await fs.readFile(RECOVERED_FILE, "utf8")); }
  catch { return JSON.parse(await fs.readFile(FALLBACK_FILE, "utf8")); }
}

const input = await loadInput();
const inputArticles = input.articles || [];
let completedCount = 0;
const articles = await mapLimit(inputArticles, CONCURRENCY, async (item) => {
  const result = await resolveOneSafely(item);
  completedCount += 1;
  if (completedCount % 50 === 0 || completedCount === inputArticles.length) {
    console.log(`[resolve] progress=${completedCount}/${inputArticles.length}`);
  }
  return result;
});
const resolvedCount = articles.filter((item) => item.urlStatus === "RESOLVED" && item.articleUrl).length;
const resolutionMethods = articles.reduce((acc, item) => {
  const key = item.urlResolutionMethod || item.errorCode || "UNKNOWN";
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});
const payload = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  lookbackDays: input.lookbackDays || 14,
  count: articles.length,
  recoveredInputCount: input.recoveredCount || 0,
  resolvedCount,
  failedCount: articles.length - resolvedCount,
  resolutionMethods,
  articles
};
await fs.writeFile(OUTPUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`[resolve] recoveredInput=${payload.recoveredInputCount}, resolved=${resolvedCount}, failed=${payload.failedCount}, total=${articles.length}`, resolutionMethods);
