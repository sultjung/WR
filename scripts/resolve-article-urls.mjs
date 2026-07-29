#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const RECOVERED_FILE = path.join(ROOT, "data", "recovered-articles.json");
const FALLBACK_FILE = path.join(ROOT, "data", "discovered-articles.json");
const OUTPUT_FILE = path.join(ROOT, "data", "resolved-articles.json");
const FETCH_TIMEOUT_MS = Number(process.env.URL_RESOLVE_TIMEOUT_MS || 15000);
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
  return !host || host === "news.google.com" || /(^|\.)google\.[a-z.]+$/i.test(host) || /gstatic\.com$/i.test(host) || /googleusercontent\.com$/i.test(host) || /youtube\.com$/i.test(host) || /facebook\.com$/i.test(host) || /instagram\.com$/i.test(host) || /(?:^|\.)x\.com$/i.test(host) || /twitter\.com$/i.test(host) || /w3\.org$/i.test(host) || /schema\.org$/i.test(host) || /xmlsoft\.org$/i.test(host);
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

async function resolveOne(item) {
  if (item.urlStatus === "RECOVERED" && isLikelyArticleUrl(item.articleUrl)) {
    try {
      const page = await fetchPage(item.articleUrl);
      const finalUrl = normalizeUrl(page.finalUrl || item.articleUrl);
      if (!isLikelyArticleUrl(finalUrl)) throw new Error("INVALID_ARTICLE_PAGE");
      return { ...item, articleUrl: finalUrl, urlStatus: "RESOLVED", errorCode: null, resolvedAt: new Date().toISOString() };
    } catch (error) {
      return { ...item, articleUrl: "", urlStatus: "FAILED", errorCode: /HTTP 401|HTTP 403|HTTP 429/.test(String(error.message || error)) ? "ACCESS_BLOCKED" : "URL_RESOLUTION_FAILED", resolutionError: String(error.message || error).slice(0, 300), resolvedAt: new Date().toISOString() };
    }
  }

  const discoveryUrl = String(item.discoveryUrl || "").trim();
  if (!discoveryUrl) return { ...item, articleUrl: "", urlStatus: "FAILED", errorCode: "URL_RESOLUTION_FAILED" };
  try {
    const first = await fetchPage(discoveryUrl);
    if (isLikelyArticleUrl(first.finalUrl)) return { ...item, articleUrl: normalizeUrl(first.finalUrl), urlStatus: "RESOLVED", errorCode: null, resolvedAt: new Date().toISOString() };
    const articleUrl = chooseBestCandidate(extractCandidates(first.html, first.finalUrl));
    if (!articleUrl) return { ...item, articleUrl: "", urlStatus: "FAILED", errorCode: "URL_RESOLUTION_FAILED", resolvedAt: new Date().toISOString() };
    return { ...item, articleUrl, urlStatus: "RESOLVED", errorCode: null, resolvedAt: new Date().toISOString() };
  } catch (error) {
    const message = String(error.message || error);
    const errorCode = /abort|timeout/i.test(message) ? "FETCH_TIMEOUT" : /HTTP 404|HTTP 410/.test(message) ? "ARTICLE_REMOVED" : /HTTP 401|HTTP 403|HTTP 429/.test(message) ? "ACCESS_BLOCKED" : "URL_RESOLUTION_FAILED";
    return { ...item, articleUrl: "", urlStatus: "FAILED", errorCode, resolutionError: message.slice(0, 300), resolvedAt: new Date().toISOString() };
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
const articles = await mapLimit(input.articles || [], CONCURRENCY, resolveOne);
const resolvedCount = articles.filter((item) => item.urlStatus === "RESOLVED" && item.articleUrl).length;
const payload = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  lookbackDays: input.lookbackDays || 14,
  count: articles.length,
  recoveredInputCount: input.recoveredCount || 0,
  resolvedCount,
  failedCount: articles.length - resolvedCount,
  articles
};
await fs.writeFile(OUTPUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`[resolve] recoveredInput=${payload.recoveredInputCount}, resolved=${resolvedCount}, failed=${payload.failedCount}, total=${articles.length}`);
