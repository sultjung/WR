#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const ROOT = process.cwd();
const INPUT_FILE = path.resolve(
  process.env.BAGHDAD_TODAY_PRIORITY_INPUT_FILE || path.join(ROOT, "data", "recovered-articles.json")
);
const OUTPUT_FILE = path.resolve(process.env.BAGHDAD_TODAY_PRIORITY_OUTPUT_FILE || INPUT_FILE);
const BASE_URL = new URL(process.env.BAGHDAD_TODAY_BASE_URL || "https://baghdadtoday.news/");
const TIMEOUT_MS = Number(process.env.BAGHDAD_TODAY_TIMEOUT_MS || 18000);
const MAX_DETAIL_FETCHES = Number(process.env.BAGHDAD_TODAY_MAX_DETAIL_FETCHES || 40);
const SOURCE_ID = "baghdadtoday";
const SOURCE_NAME = "بغداد اليوم";

function decodeHtml(value = "") {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))
    .replace(/&#x([0-9a-f]+);/gi, (_, number) => String.fromCodePoint(parseInt(number, 16)))
    .trim();
}

function stripHtml(value = "") {
  return decodeHtml(String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeArabic(value = "") {
  return stripHtml(value)
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

function normalizeUrl(value = "") {
  try {
    const parsed = new URL(value, BASE_URL);
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_)/i.test(key)) parsed.searchParams.delete(key);
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

function hostnameOf(value = "") {
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function isOwnUrl(value = "") {
  const host = hostnameOf(value);
  const sourceHost = BASE_URL.hostname.replace(/^www\./, "").toLowerCase();
  return host === sourceHost || host.endsWith(`.${sourceHost}`);
}

function isArticleUrl(value = "") {
  try {
    const parsed = new URL(value);
    return isOwnUrl(value)
      && parsed.pathname !== "/"
      && /\/\d{5,}-.+\.html$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isPriorityText(value = "") {
  const text = normalizeArabic(value);
  const bismayah = /(?:^|\s)بسمايه(?:\s|$)/u.test(text);
  const hanwha = ["هانوا", "هانهوا", "hanwha", "한화"]
    .some((term) => text.includes(normalizeArabic(term)));
  const nic = [
    "الهيئة الوطنية للاستثمار",
    "الهيأة الوطنية للاستثمار",
    "رئيس الهيئة الوطنية للاستثمار",
    "عادل الياسري",
    "عادل داخل الياسري",
    "حيدر مكية"
  ].some((term) => text.includes(normalizeArabic(term)));
  return bismayah || (hanwha && (nic || text.includes(normalizeArabic("العراق"))));
}

function meta(html = "", name = "") {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const forward = String(html).match(
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i")
  );
  const reverse = String(html).match(
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, "i")
  );
  return decodeHtml(forward?.[1] || reverse?.[1] || "");
}

function parsePublishedAt(html = "") {
  const explicit = meta(html, "article:published_time")
    || String(html).match(/<time[^>]+datetime=["']([^"']+)["']/i)?.[1]
    || "";
  if (explicit && !Number.isNaN(new Date(explicit).getTime())) return new Date(explicit).toISOString();

  const local = stripHtml(html).match(/(?:^|\s)(\d{1,2})-(\d{1,2})-(\d{4}),\s*(\d{1,2}):(\d{2})(?:\s|$)/);
  if (!local) return "";
  const [, day, month, year, hour, minute] = local;
  const value = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${hour.padStart(2, "0")}:${minute}:00+03:00`;
  return Number.isNaN(new Date(value).getTime()) ? "" : new Date(value).toISOString();
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; WR-Baghdad-Today-Priority/1.0)",
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        "accept-language": "ar-IQ,ar;q=0.9"
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { body: await response.text(), url: response.url || url };
  } finally {
    clearTimeout(timer);
  }
}

function discoverLinks(html = "", baseUrl = BASE_URL) {
  const output = [];
  for (const match of String(html).matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = normalizeUrl(new URL(decodeHtml(match[1]), baseUrl).toString());
    const title = stripHtml(match[2]);
    if (title.length < 12 || !isArticleUrl(url)) continue;
    output.push({ url, title });
  }
  return [...new Map(output.map((item) => [item.url, item])).values()];
}

function detailInfo(html = "", fallbackTitle = "", fallbackUrl = "") {
  const title = stripHtml(
    String(html).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
      || meta(html, "og:title")
      || meta(html, "twitter:title")
      || fallbackTitle
  );
  const description = stripHtml(meta(html, "og:description") || meta(html, "description"));
  const canonical = normalizeUrl(
    String(html).match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1]
      || meta(html, "og:url")
      || fallbackUrl
  );
  return {
    title,
    description,
    publishedAt: parsePublishedAt(html),
    canonical: isArticleUrl(canonical) ? canonical : fallbackUrl
  };
}

const payload = JSON.parse(await fs.readFile(INPUT_FILE, "utf8"));
const articles = [...(payload.articles || [])];
const endpoints = [BASE_URL, new URL("/lastnews", BASE_URL)];
const discovered = [];
const debug = [];

for (const endpoint of endpoints) {
  try {
    const response = await fetchText(endpoint);
    const links = discoverLinks(response.body, response.url);
    discovered.push(...links);
    debug.push({ endpoint: endpoint.toString(), ok: true, count: links.length });
  } catch (error) {
    debug.push({ endpoint: endpoint.toString(), ok: false, error: String(error.message || error).slice(0, 160) });
  }
}

const unique = [...new Map(discovered.map((item) => [item.url, item])).values()];
const priorityCandidates = unique.filter((item) => isPriorityText(item.title));
const enriched = [];
for (const item of priorityCandidates.slice(0, MAX_DETAIL_FETCHES)) {
  try {
    const response = await fetchText(item.url);
    enriched.push({ ...item, ...detailInfo(response.body, item.title, response.url) });
  } catch {
    enriched.push({ ...item, canonical: item.url, description: "", publishedAt: "" });
  }
}

const byUrl = new Map(articles
  .map((article, index) => [normalizeUrl(article.articleUrl || article.discoveryUrl), index])
  .filter(([key]) => key));
const byTitle = new Map(articles
  .map((article, index) => [normalizeArabic(article.originalTitleArabic), index])
  .filter(([key]) => key));

let added = 0;
let upgraded = 0;
for (const item of enriched) {
  const articleUrl = normalizeUrl(item.canonical || item.url);
  if (!articleUrl || !isPriorityText(`${item.title} ${item.description}`)) continue;
  const titleKey = normalizeArabic(item.title);
  const index = byUrl.get(articleUrl) ?? byTitle.get(titleKey);
  const old = index === undefined ? null : articles[index];
  const oldUrl = normalizeUrl(old?.articleUrl || old?.discoveryUrl);
  const oldIsAggregator = hostnameOf(oldUrl) === "hathalyoum.net" || old?.allowAggregatorFallback === true;
  const priorityAggregatorUrl = old?.priorityAggregatorUrl
    || (hostnameOf(oldUrl) === "hathalyoum.net" ? oldUrl : "");
  const articleId = old?.articleId
    || `priority-${createHash("sha256").update(articleUrl).digest("base64url").slice(0, 24)}`;
  const candidate = {
    ...(old || {}),
    schemaVersion: old?.schemaVersion || "1.0",
    articleId,
    keywordId: "bismayah-priority-source-001",
    category: "bismayah",
    priority: Math.max(100, Number(old?.priority || 0)),
    queryArabic: "بسماية OR الهيئة الوطنية للاستثمار OR شركة هانوا",
    requiredTerms: [],
    optionalTerms: [...new Set([...(old?.optionalTerms || []), "بسماية", "الهيئة الوطنية للاستثمار", "شركة هانوا", "هانوا"])],
    excludedTerms: [],
    originalTitleArabic: item.title,
    sourceArabic: SOURCE_NAME,
    sourceHomepage: BASE_URL.toString(),
    publishedAt: item.publishedAt || old?.publishedAt || new Date().toISOString(),
    descriptionArabic: item.description || old?.descriptionArabic || "",
    discoveryUrl: articleUrl,
    priorityAggregatorUrl,
    articleUrl,
    discoveryMethod: "priority-direct-publisher-index",
    language: "ar",
    discoveryStatus: "DISCOVERED",
    urlStatus: "RECOVERED",
    urlRecoveryMethod: "priority-direct-publisher-index",
    recoveredSourceId: SOURCE_ID,
    allowAggregatorFallback: false,
    contentStatus: old?.contentStatus || "PENDING",
    errorCode: null,
    discoveredAt: old?.discoveredAt || new Date().toISOString(),
    priorityDiscovery: {
      sourceId: SOURCE_ID,
      sourceUrl: articleUrl,
      detectedAt: new Date().toISOString()
    }
  };

  if (index === undefined) {
    byUrl.set(articleUrl, articles.length);
    byTitle.set(titleKey, articles.length);
    articles.push(candidate);
    added += 1;
  } else if (oldIsAggregator || !oldUrl) {
    articles[index] = candidate;
    byUrl.set(articleUrl, index);
    byTitle.set(titleKey, index);
    upgraded += 1;
  }
}

articles.sort((left, right) =>
  new Date(right.publishedAt || 0) - new Date(left.publishedAt || 0)
  || Number(right.priority || 0) - Number(left.priority || 0)
);

const output = {
  ...payload,
  generatedAt: new Date().toISOString(),
  count: articles.length,
  recoveredCount: articles.filter((article) => article.urlStatus === "RECOVERED" && article.articleUrl).length,
  failedCount: articles.filter((article) => article.urlStatus !== "RECOVERED" || !article.articleUrl).length,
  baghdadTodayPriorityDiscovery: {
    matched: enriched.length,
    added,
    upgraded,
    debug
  },
  articles
};

await fs.writeFile(OUTPUT_FILE, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`[baghdad-today-priority] matched=${enriched.length} added=${added} upgraded=${upgraded} total=${articles.length}`);
