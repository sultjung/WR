#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const ROOT = process.cwd();
const OUTPUT_FILE = path.join(ROOT, "data", "discovered-articles.json");
const HOST = "investpromo.gov.iq";
const BASE = `https://${HOST}`;
const LOOKBACK_DAYS = Number(process.env.NIC_LOOKBACK_DAYS || 14);
const PER_PAGE = Math.min(100, Math.max(1, Number(process.env.NIC_PER_PAGE || 100)));
const TIMEOUT_MS = Number(process.env.NIC_API_TIMEOUT_MS || 20000);

function stripTags(value = "") {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

function isoDateDaysAgo(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
}

function stableId(id, link) {
  return `nic-rest-${id || createHash("sha256").update(link).digest("base64url").slice(0, 24)}`;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "WR-NIC-REST-Collector/1.0 (+https://sultjung.github.io/WR/)",
        accept: "application/json"
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function normalizePost(post) {
  const link = String(post.link || post.guid?.rendered || "").trim();
  const title = stripTags(post.title?.rendered || post.title || "");
  const content = stripTags(post.content?.rendered || post.content || post.excerpt?.rendered || "");
  const publishedAt = post.date_gmt || post.date || post.modified_gmt || post.modified || "";
  const language = /[\u0600-\u06ff]/.test(`${title} ${content}`) ? "ar" : "en";
  return {
    schemaVersion: "1.0",
    articleId: stableId(post.id, link),
    keywordId: "bismayah-nic-rest-api-001",
    category: "bismayah",
    priority: 100,
    queryArabic: "NIC WordPress REST API",
    requiredTerms: [],
    optionalTerms: ["الهيئة الوطنية للاستثمار", "رئيس الهيئة", "بسماية", "استثمار"],
    excludedTerms: [],
    originalTitleArabic: title,
    sourceArabic: "الهيئة الوطنية للاستثمار",
    sourceHomepage: `${BASE}/ar/`,
    publishedAt: new Date(publishedAt).toISOString(),
    descriptionArabic: stripTags(post.excerpt?.rendered || ""),
    discoveryUrl: link,
    articleUrl: link,
    canonicalUrl: link,
    discoveryMethod: "nic-wordpress-rest-api",
    urlRecoveryMethod: "nic-wordpress-rest-api",
    language,
    discoveryStatus: "DISCOVERED",
    urlStatus: "VALID",
    contentStatus: "FETCHED",
    originalTextArabic: content,
    fullTextArabic: content,
    officialSource: true,
    sourceReliability: "OFFICIAL",
    recoveredSourceId: "nic",
    nicPostId: post.id ?? null,
    errorCode: null,
    discoveredAt: new Date().toISOString()
  };
}

const existing = JSON.parse(await fs.readFile(OUTPUT_FILE, "utf8").catch(() => '{"articles":[]}'));
const articles = Array.isArray(existing) ? existing : (existing.articles || []);
const after = encodeURIComponent(isoDateDaysAgo(LOOKBACK_DAYS));
const endpoint = `${BASE}/wp-json/wp/v2/posts?per_page=${PER_PAGE}&orderby=date&order=desc&after=${after}&_fields=id,date,date_gmt,modified,modified_gmt,link,guid,title,content,excerpt`;

let posts;
try {
  posts = await fetchJson(endpoint);
  if (!Array.isArray(posts)) throw new Error("NIC REST response was not an array");
} catch (error) {
  // Cloudflare or a temporary NIC outage must not erase the successful
  // discovery payload produced by the other collectors.
  console.warn(`[nic-rest] skipped: ${error.message || error}`);
  console.log(`[nic-rest] endpoint=${endpoint}`);
  process.exit(0);
}

const byId = new Map(articles.map((article) => [article.articleId || article.articleUrl || article.discoveryUrl, article]));
let added = 0;
let refreshed = 0;
for (const post of posts) {
  const article = normalizePost(post);
  if (!article.articleUrl || !article.originalTitleArabic || !article.originalTextArabic) continue;
  const key = [...byId.entries()].find(([, existingArticle]) =>
    existingArticle.articleId === article.articleId
    || existingArticle.nicPostId === article.nicPostId
    || existingArticle.articleUrl === article.articleUrl
    || existingArticle.canonicalUrl === article.canonicalUrl
    || existingArticle.discoveryUrl === article.discoveryUrl
  )?.[0] || article.articleId;
  if (byId.has(key)) {
    byId.set(key, { ...byId.get(key), ...article });
    refreshed += 1;
  } else {
    byId.set(key, article);
    added += 1;
  }
}

const merged = [...byId.values()].sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
if (Array.isArray(existing)) {
  await fs.writeFile(OUTPUT_FILE, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
} else {
  await fs.writeFile(OUTPUT_FILE, `${JSON.stringify({ ...existing, generatedAt: new Date().toISOString(), articles: merged }, null, 2)}\n`, "utf8");
}
console.log(`[nic-rest] fetched=${posts.length} added=${added} refreshed=${refreshed} total=${merged.length}`);
