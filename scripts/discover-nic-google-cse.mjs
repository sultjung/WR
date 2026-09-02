#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const ROOT = process.cwd();
const INPUT = path.resolve(process.env.GOOGLE_CSE_INPUT_FILE || path.join(ROOT, "data", "recovered-articles.json"));
const OUTPUT = path.resolve(process.env.GOOGLE_CSE_OUTPUT_FILE || INPUT);
const ENDPOINT = process.env.GOOGLE_CSE_ENDPOINT || "https://customsearch.googleapis.com/customsearch/v1";
const API_KEY = process.env.GOOGLE_CSE_API_KEY || "";
const SEARCH_ENGINE_ID = process.env.GOOGLE_CSE_ID || "";
const DATE_RESTRICT = process.env.GOOGLE_CSE_DATE_RESTRICT || "d14";
const TIMEOUT = Number(process.env.GOOGLE_CSE_TIMEOUT_MS || 15000);
const REQUIRED = process.env.GOOGLE_CSE_REQUIRED === "true";
const QUERIES = [
  "بسماية",
  '"مدينة بسماية"',
  '"شركة هانوا"',
  '"عادل الياسري" بسماية',
  '"السفير الكوري" بسماية',
  '"إطلاق القروض الفردية" بسماية',
  '"مصرف الرافدين" بسماية',
  'site:facebook.com/profile.php?id=100090604137582',
  'site:web.facebook.com "100090604137582" "الهيئة الوطنية للاستثمار"'
];

const NIC_FACEBOOK_PROFILE_ID = "100090604137582";
const NIC_FACEBOOK_PROFILE_URL = `https://www.facebook.com/profile.php?id=${NIC_FACEBOOK_PROFILE_ID}`;

const cleanUrl = (value = "") => {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return "";
  }
};

const normalize = (value = "") => String(value)
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

function isNicUrl(value = "") {
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase() === "investpromo.gov.iq";
  } catch {
    return false;
  }
}

function isNicFacebookPostUrl(value = "") {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    if (!/(^|\.)facebook\.com$/i.test(host)) return false;
    const id = url.searchParams.get("id") || "";
    const pathname = url.pathname.toLowerCase();
    return id === NIC_FACEBOOK_PROFILE_ID
      && (url.searchParams.has("story_fbid") || /\/(?:posts|permalink)\//.test(pathname) || /permalink\.php$/.test(pathname));
  } catch {
    return false;
  }
}

function publishedAt(item = {}) {
  const meta = item.pagemap?.metatags?.[0] || {};
  const candidate = meta["article:published_time"] || meta.date || meta["datepublished"] || "";
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

async function search(query) {
  const params = new URLSearchParams({
    key: API_KEY,
    cx: SEARCH_ENGINE_ID,
    q: query,
    dateRestrict: DATE_RESTRICT,
    num: "10",
    lr: "lang_ar",
    gl: "iq",
    safe: "off"
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const response = await fetch(`${ENDPOINT}?${params}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const data = await response.json();
    return Array.isArray(data.items) ? data.items : [];
  } finally {
    clearTimeout(timer);
  }
}

if (!API_KEY || !SEARCH_ENGINE_ID) {
  const message = "GOOGLE_CSE_API_KEY or GOOGLE_CSE_ID is missing";
  if (REQUIRED) throw new Error(message);
  console.warn(`[google-cse] skipped: ${message}`);
  process.exit(0);
}

const input = JSON.parse(await fs.readFile(INPUT, "utf8"));
const articles = [...(input.articles || [])];
const byUrl = new Map(articles.map((article, index) => [cleanUrl(article.articleUrl || article.discoveryUrl), index]).filter(([url]) => url));
const byTitle = new Map(articles.map((article, index) => [normalize(article.originalTitleArabic), index]).filter(([title]) => title));
const debug = [];
let added = 0;
let existing = 0;

for (const query of QUERIES) {
  try {
    const items = await search(query);
    debug.push({ query, ok: true, count: items.length });
    console.log(`[google-cse] query=${JSON.stringify(query)} results=${items.length}`);
    for (const item of items) {
      const articleUrl = cleanUrl(item.link);
      const title = String(item.title || "").trim();
      const nicOfficialSite = isNicUrl(articleUrl);
      const nicFacebookPost = isNicFacebookPostUrl(articleUrl);
      if (!articleUrl || !title || (!nicOfficialSite && !nicFacebookPost)) continue;
      const duplicate = byUrl.get(articleUrl) ?? byTitle.get(normalize(title));
      if (duplicate !== undefined) {
        articles[duplicate] = {
          ...articles[duplicate],
          googleCseDiscovery: { query, detectedAt: new Date().toISOString() }
        };
        existing += 1;
        continue;
      }
      const candidate = {
        schemaVersion: "1.0",
        articleId: `google-cse-${createHash("sha256").update(articleUrl).digest("base64url").slice(0, 24)}`,
        keywordId: nicFacebookPost ? "bismayah-nic-facebook-search-001" : "bismayah-nic-google-cse-001",
        category: "bismayah",
        priority: 100,
        queryArabic: query,
        requiredTerms: [],
        optionalTerms: ["بسماية", "شركة هانوا", "عادل الياسري", "السفير الكوري"],
        excludedTerms: [],
        originalTitleArabic: title,
        descriptionArabic: String(item.snippet || "").trim(),
        sourceArabic: nicFacebookPost ? "الهيئة الوطنية للاستثمار · Facebook" : "الهيئة الوطنية للاستثمار",
        sourceHomepage: nicFacebookPost ? NIC_FACEBOOK_PROFILE_URL : "https://investpromo.gov.iq/ar/",
        publishedAt: publishedAt(item),
        discoveryUrl: articleUrl,
        articleUrl,
        discoveryMethod: "google-programmable-search",
        language: "ar",
        discoveryStatus: "DISCOVERED",
        urlStatus: "RECOVERED",
        urlRecoveryMethod: "GOOGLE_PROGRAMMABLE_SEARCH",
        recoveredSourceId: nicFacebookPost ? "nic-facebook" : "nic",
        facebookSearchSnippetOnly: nicFacebookPost,
        contentStatus: "PENDING",
        officialSource: true,
        sourceReliability: "OFFICIAL",
        errorCode: null,
        discoveredAt: new Date().toISOString(),
        googleCseDiscovery: { query, detectedAt: new Date().toISOString() }
      };
      byUrl.set(articleUrl, articles.length);
      byTitle.set(normalize(title), articles.length);
      articles.push(candidate);
      added += 1;
    }
  } catch (error) {
    const message = String(error.message || error).slice(0, 300);
    debug.push({ query, ok: false, error: message });
    console.warn(`[google-cse] query=${JSON.stringify(query)} failed=${message}`);
    if (REQUIRED) throw error;
  }
}

articles.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0) || Number(b.priority || 0) - Number(a.priority || 0));
const payload = {
  ...input,
  generatedAt: new Date().toISOString(),
  count: articles.length,
  googleCseDiscovery: { queryCount: QUERIES.length, added, existing, debug },
  articles
};
await fs.writeFile(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`[google-cse] queries=${QUERIES.length} added=${added} existing=${existing} total=${articles.length}`);
