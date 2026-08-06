#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const ROOT = process.cwd();
const INPUT = path.resolve(process.env.PRIORITY_DISCOVERY_INPUT_FILE || path.join(ROOT, "data", "recovered-articles.json"));
const OUTPUT = path.resolve(process.env.PRIORITY_DISCOVERY_OUTPUT_FILE || INPUT);
const SEEDS = path.resolve(process.env.PRIORITY_DISCOVERY_SEEDS_FILE || path.join(ROOT, "config", "priority-news-seeds.json"));
const TIMEOUT = Number(process.env.PRIORITY_DISCOVERY_TIMEOUT_MS || 18000);
const LOOKBACK = Number(process.env.NEWS_DISCOVERY_DAYS || 14);
const MAX_DETAILS = Number(process.env.PRIORITY_DISCOVERY_MAX_DETAIL_FETCHES || 60);

const SOURCES = String(process.env.PRIORITY_DISCOVERY_TEST_BASE || "") ? [
  {
    id: "nic",
    name: "الهيئة الوطنية للاستثمار",
    type: "official",
    base: `${process.env.PRIORITY_DISCOVERY_TEST_BASE}/nic/`,
    hosts: ["127.0.0.1"],
    pathPrefix: "/nic/",
    endpoints: ["feed"]
  },
  {
    id: "hathalyoum",
    name: "هذا اليوم",
    type: "aggregator",
    base: `${process.env.PRIORITY_DISCOVERY_TEST_BASE}/hatha/`,
    hosts: ["127.0.0.1"],
    pathPrefix: "/hatha/",
    endpoints: []
  }
] : [
  {
    id: "nic",
    name: "الهيئة الوطنية للاستثمار",
    type: "official",
    base: "https://investpromo.gov.iq/ar/",
    hosts: ["investpromo.gov.iq"],
    endpoints: ["/ar/feed/", "/ar/category/arabic-news/", "/wp-sitemap.xml"]
  },
  {
    id: "hathalyoum",
    name: "هذا اليوم",
    type: "aggregator",
    base: "https://hathalyoum.net/",
    hosts: ["hathalyoum.net"],
    endpoints: ["/rss", "/sitemap.xml"]
  }
];

const decode = (value = "") => String(value)
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&nbsp;/gi, " ")
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&amp;/gi, "&")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">")
  .trim();

const strip = (value = "") => decode(String(value)
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " "))
  .replace(/\s+/g, " ")
  .trim();

const norm = (value = "") => strip(value)
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

const host = (url = "") => {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};

const cleanUrl = (url = "") => {
  try {
    const parsed = new URL(decode(url));
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid)/i.test(key)) parsed.searchParams.delete(key);
    }
    return parsed.toString();
  } catch {
    return "";
  }
};

const own = (source, url) => {
  try {
    const parsed = new URL(url);
    const currentHost = host(url);
    const hostMatch = source.hosts.some((sourceHost) => currentHost === sourceHost || currentHost.endsWith(`.${sourceHost}`));
    return hostMatch && (!source.pathPrefix || parsed.pathname.startsWith(source.pathPrefix));
  } catch {
    return false;
  }
};

const articleLike = (url = "") => {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname || "";
    return /^https?:$/.test(parsed.protocol)
      && pathname !== "/"
      && !/\/(?:feed|rss|category|tag|author)(?:\/|$)/i.test(pathname)
      && !/\.(?:jpg|png|pdf|mp4)$/i.test(pathname)
      && (/\d{4,}/.test(pathname) || pathname.split("/").filter(Boolean).length >= 2);
  } catch {
    return false;
  }
};

const forbiddenPublisherUrl = (url = "") => {
  const currentHost = host(url);
  if (!currentHost) return true;
  return currentHost === "news.google.com"
    || /(^|\.)google\.[a-z.]+$/i.test(currentHost)
    || /gstatic\.com$/i.test(currentHost)
    || /googleusercontent\.com$/i.test(currentHost)
    || /facebook\.com$/i.test(currentHost)
    || /instagram\.com$/i.test(currentHost)
    || /youtube\.com$/i.test(currentHost)
    || /twitter\.com$/i.test(currentHost)
    || /(?:^|\.)x\.com$/i.test(currentHost)
    || /tiktok\.com$/i.test(currentHost)
    || /w3\.org$/i.test(currentHost)
    || /schema\.org$/i.test(currentHost)
    || /xmlsoft\.org$/i.test(currentHost);
};

const parseDate = (value = "") => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
};

const recent = (value = "") => !value || new Date(value).getTime() >= Date.now() - LOOKBACK * 86400000;
const tag = (block, name) => decode(String(block).match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1] || "");
const meta = (html, name) => decode(String(html).match(new RegExp(`<meta[^>]+(?:property|name)=["']${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]+content=["']([^"']+)["']`, "i"))?.[1] || "");

const priority = (value, source) => {
  const text = norm(value);
  const bismayah = /(?:^|\s)بسمايه(?:\s|$)/u.test(text);
  const hanwha = ["هانوا", "هانهوا", "hanwha", "한화"].some((term) => text.includes(norm(term)));
  const nic = [
    "الهيئة الوطنية للاستثمار",
    "الهيأة الوطنية للاستثمار",
    "رئيس الهيئة الوطنية للاستثمار",
    "عادل الياسري",
    "عادل داخل الياسري",
    "حيدر مكية"
  ].some((term) => text.includes(norm(term)));
  return bismayah || (hanwha && (nic || text.includes(norm("العراق")))) || (source.id === "nic" && nic);
};

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; WR-Priority-Discovery/1.0)",
        "accept-language": "ar-IQ,ar;q=0.9"
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return {
      body: await response.text(),
      url: response.url || url,
      type: response.headers.get("content-type") || ""
    };
  } finally {
    clearTimeout(timer);
  }
}

function parseIndex(body, baseUrl, source) {
  const output = [];
  for (const block of String(body).match(/<(?:item|entry)>[\s\S]*?<\/(?:item|entry)>/gi) || []) {
    const url = cleanUrl(block.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] || tag(block, "link") || tag(block, "guid"));
    if (articleLike(url) && own(source, url)) {
      output.push({
        title: strip(tag(block, "title")),
        url,
        date: parseDate(tag(block, "pubDate") || tag(block, "published") || tag(block, "updated")),
        desc: strip(tag(block, "description") || tag(block, "summary"))
      });
    }
  }
  for (const block of String(body).match(/<url>[\s\S]*?<\/url>/gi) || []) {
    const url = cleanUrl(tag(block, "loc"));
    if (articleLike(url) && own(source, url)) {
      output.push({
        title: strip(tag(block, "news:title") || tag(block, "title")),
        url,
        date: parseDate(tag(block, "lastmod")),
        desc: ""
      });
    }
  }
  for (const match of String(body).matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url;
    try {
      url = new URL(decode(match[1]), baseUrl).toString();
    } catch {
      continue;
    }
    const title = strip(match[2]);
    if (title.length >= 12 && own(source, url) && articleLike(url)) {
      output.push({ title, url: cleanUrl(url), date: "", desc: "" });
    }
  }
  return output;
}

function pageInfo(html, fallback) {
  return {
    title: strip(String(html).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || meta(html, "og:title") || meta(html, "twitter:title")),
    date: parseDate(meta(html, "article:published_time") || String(html).match(/<time[^>]+datetime=["']([^"']+)["']/i)?.[1] || ""),
    desc: strip(meta(html, "og:description") || meta(html, "description")),
    canonical: cleanUrl(String(html).match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1] || meta(html, "og:url") || fallback)
  };
}

function external(html, base, source) {
  const links = [];
  for (const match of String(html).matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url;
    try {
      url = new URL(decode(match[1]), base).toString();
    } catch {
      continue;
    }
    if (own(source, url) || forbiddenPublisherUrl(url) || !articleLike(url)) continue;
    links.push({
      url: cleanUrl(url),
      score: /المصدر|الخبر كاملا|اقرا الخبر/.test(norm(match[2])) ? 50 : 0
    });
  }
  return links.sort((left, right) => right.score - left.score)[0]?.url || "";
}

async function discover(source, seedUrls) {
  const endpoints = [source.base, ...source.endpoints.map((endpoint) => new URL(endpoint, source.base).toString())];
  const found = seedUrls
    .filter((url) => own(source, url))
    .map((url) => ({ title: "", url: cleanUrl(url), date: "", desc: "", seed: true }));
  const debug = [];

  for (const endpoint of endpoints) {
    try {
      const response = await fetchText(endpoint);
      const items = parseIndex(response.body, response.url, source);
      found.push(...items);
      debug.push({ endpoint, ok: true, count: items.length });
    } catch (error) {
      debug.push({ endpoint, ok: false, error: String(error.message || error).slice(0, 120) });
    }
  }

  const unique = [...new Map(found
    .filter((item) => item.url && recent(item.date))
    .map((item) => [item.url, item])).values()]
    .sort((left, right) => Number(right.seed) - Number(left.seed) || new Date(right.date || 0) - new Date(left.date || 0));

  const ready = unique.filter((item) => priority(`${item.title} ${item.desc}`, source));
  const details = [];
  for (const item of unique.filter((candidate) => !ready.includes(candidate)).slice(0, MAX_DETAILS)) {
    try {
      const response = await fetchText(item.url);
      const info = pageInfo(response.body, response.url);
      const pageUrl = own(source, info.canonical) ? info.canonical : cleanUrl(item.url);
      details.push({
        ...item,
        title: info.title || item.title,
        date: info.date || item.date,
        desc: info.desc || item.desc,
        pageUrl,
        publisherUrl: source.type === "aggregator" ? external(response.body, response.url, source) : ""
      });
    } catch {}
  }

  return {
    source,
    debug,
    matched: [...ready, ...details].filter((item) => priority(`${item.title} ${item.desc}`, source) && recent(item.date))
  };
}

let seedConfig = { urls: [] };
try {
  seedConfig = JSON.parse(await fs.readFile(SEEDS, "utf8"));
} catch {}

const seedUrls = (seedConfig.urls || [])
  .filter((item) => item.enabled !== false && item.url)
  .map((item) => item.url);

const discoveries = [];
for (const source of SOURCES) discoveries.push(await discover(source, seedUrls));

const input = JSON.parse(await fs.readFile(INPUT, "utf8"));
const articles = [...(input.articles || [])];
const byUrl = new Map(articles
  .map((article, index) => [cleanUrl(article.articleUrl || article.discoveryUrl), index])
  .filter(([key]) => key));
const byTitle = new Map(articles
  .map((article, index) => [norm(article.originalTitleArabic), index])
  .filter(([key]) => key));

let added = 0;
let upgraded = 0;
for (const { source, matched } of discoveries) {
  for (const item of matched) {
    const sourceUrl = item.pageUrl || item.url;
    const publisherUrl = forbiddenPublisherUrl(item.publisherUrl) ? "" : cleanUrl(item.publisherUrl);
    const articleUrl = publisherUrl || sourceUrl;
    const fallback = source.type === "aggregator" && !publisherUrl;
    const priorityAggregatorUrl = source.type === "aggregator" ? sourceUrl : "";
    const candidate = {
      schemaVersion: "1.0",
      articleId: `priority-${createHash("sha256").update(articleUrl).digest("base64url").slice(0, 24)}`,
      keywordId: "bismayah-priority-source-001",
      category: "bismayah",
      priority: 100,
      queryArabic: "بسماية OR الهيئة الوطنية للاستثمار OR شركة هانوا",
      requiredTerms: [],
      optionalTerms: ["بسماية", "الهيئة الوطنية للاستثمار", "شركة هانوا", "هانوا"],
      excludedTerms: [],
      originalTitleArabic: item.title,
      sourceArabic: source.name,
      sourceHomepage: source.base,
      publishedAt: item.date || new Date().toISOString(),
      descriptionArabic: item.desc || "",
      discoveryUrl: sourceUrl,
      priorityAggregatorUrl,
      articleUrl,
      discoveryMethod: publisherUrl ? "priority-aggregator-source-link" : "priority-source-index",
      language: "ar",
      discoveryStatus: "DISCOVERED",
      urlStatus: "RECOVERED",
      urlRecoveryMethod: publisherUrl ? "priority-aggregator-source-link" : "priority-source-index",
      recoveredSourceId: source.id,
      allowAggregatorFallback: fallback,
      contentStatus: "PENDING",
      errorCode: null,
      discoveredAt: new Date().toISOString()
    };

    const index = byUrl.get(cleanUrl(articleUrl)) ?? byTitle.get(norm(candidate.originalTitleArabic));
    if (index !== undefined) {
      const old = articles[index];
      const upgrade = (!old.articleUrl || old.urlStatus !== "RECOVERED") && candidate.articleUrl;
      articles[index] = {
        ...old,
        ...(upgrade ? {
          discoveryUrl: candidate.discoveryUrl,
          priorityAggregatorUrl: candidate.priorityAggregatorUrl,
          articleUrl: candidate.articleUrl,
          urlStatus: "RECOVERED",
          urlRecoveryMethod: candidate.urlRecoveryMethod,
          recoveredSourceId: candidate.recoveredSourceId,
          allowAggregatorFallback: candidate.allowAggregatorFallback,
          errorCode: null
        } : {}),
        priorityDiscovery: {
          sourceId: source.id,
          sourceUrl,
          detectedAt: new Date().toISOString()
        }
      };
      if (upgrade) upgraded += 1;
    } else {
      byUrl.set(cleanUrl(articleUrl), articles.length);
      byTitle.set(norm(candidate.originalTitleArabic), articles.length);
      articles.push(candidate);
      added += 1;
    }
  }
}

articles.sort((left, right) => new Date(right.publishedAt || 0) - new Date(left.publishedAt || 0) || Number(right.priority || 0) - Number(left.priority || 0));

const payload = {
  ...input,
  generatedAt: new Date().toISOString(),
  count: articles.length,
  recoveredCount: articles.filter((article) => article.urlStatus === "RECOVERED" && article.articleUrl).length,
  failedCount: articles.filter((article) => article.urlStatus !== "RECOVERED" || !article.articleUrl).length,
  priorityDiscovery: {
    matched: discoveries.reduce((count, discovery) => count + discovery.matched.length, 0),
    added,
    upgraded,
    sources: discoveries.map((discovery) => ({
      sourceId: discovery.source.id,
      matched: discovery.matched.length,
      debug: discovery.debug
    }))
  },
  articles
};

await fs.writeFile(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`[priority-discovery] matched=${payload.priorityDiscovery.matched} added=${added} upgraded=${upgraded} total=${articles.length}`);
