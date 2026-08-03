#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const ARTICLES_FILE = path.join(ROOT, "data", "articles.json");
const FETCH_TIMEOUT_MS = Number(process.env.TITLE_FETCH_TIMEOUT_MS || 12000);
const CONCURRENCY = Number(process.env.TITLE_FIX_CONCURRENCY || 3);

const GENERIC_TITLE_PATTERNS = [
  /^أخبار\s+/i,
  /الأخبار العاجلة/i,
  /آخر الأخبار/i,
  /أخبار اليوم/i,
  /الرئيسية/i,
  /بوابة الأخبار/i,
  /موقع إخباري/i,
  /صحيفة إلكترونية/i,
  /^untitled$/i,
  /^no title$/i
];

function decodeHtml(value = "") {
  return String(value)
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&lrm;|&rlm;/gi, " ")
    .replace(/&#8206;|&#8207;|&#x200e;|&#x200f;/gi, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, " ");
}

function stripTags(value = "") {
  return decodeHtml(String(value).replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeEmail(value = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(stripTags(value));
}

function looksLikeUrl(value = "") {
  const text = stripTags(value);
  return /^(?:https?:\/\/|www\.)\S+$/i.test(text);
}

function hasArabic(value = "") {
  return /[\u0600-\u06FF]/.test(String(value));
}

function isUsableTitle(title = "") {
  const value = stripTags(title);
  if (!value || value.length < 12 || value.length > 320) return false;
  if (looksLikeEmail(value) || looksLikeUrl(value)) return false;
  if (!hasArabic(value)) return false;
  return !GENERIC_TITLE_PATTERNS.some((pattern) => pattern.test(value));
}

function isGenericTitle(title = "") {
  return !isUsableTitle(title);
}

function extractMeta(html = "", key = "") {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, "i")
  ];
  for (const pattern of patterns) {
    const match = String(html).match(pattern);
    if (match?.[1]) return stripTags(match[1]);
  }
  return "";
}

function walkJson(value, output = []) {
  if (!value) return output;
  if (Array.isArray(value)) {
    for (const item of value) walkJson(item, output);
    return output;
  }
  if (typeof value === "object") {
    output.push(value);
    for (const child of Object.values(value)) walkJson(child, output);
  }
  return output;
}

function articleTypes(node = {}) {
  const raw = Array.isArray(node?.["@type"]) ? node["@type"] : [node?.["@type"]];
  return raw.map((value) => String(value || "").trim()).filter(Boolean);
}

function extractJsonLdHeadline(html = "") {
  for (const match of String(html).matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(decodeHtml(match[1]).trim());
      for (const node of walkJson(parsed)) {
        const isArticle = articleTypes(node).some((type) =>
          /^(?:NewsArticle|Article|ReportageNewsArticle)$/i.test(type)
        );
        if (!isArticle) continue;
        const candidate = typeof node?.headline === "string" ? stripTags(node.headline) : "";
        if (isUsableTitle(candidate)) return candidate;
      }
    } catch {}
  }
  return "";
}

function extractH1Candidates(html = "") {
  return [...String(html).matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)]
    .map((match) => stripTags(match[1]))
    .filter(isUsableTitle)
    .sort((a, b) => b.length - a.length);
}

function getArticle(article = {}) {
  return article.article && typeof article.article === "object" ? article.article : article;
}

function getTitle(article = {}) {
  const nested = getArticle(article);
  return nested.originalTitleArabic || article.originalTitleArabic || "";
}

function getUrl(article = {}) {
  const nested = getArticle(article);
  return nested.articleUrl || nested.canonicalUrl || article.articleUrl || article.canonicalUrl || "";
}

function setTitle(article = {}, title = "") {
  if (article.article && typeof article.article === "object") {
    return { ...article, article: { ...article.article, originalTitleArabic: title } };
  }
  return { ...article, originalTitleArabic: title };
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.7",
        "accept-language": "ar-IQ,ar;q=0.9,en;q=0.4"
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function repair(article) {
  const currentTitle = getTitle(article);
  const url = getUrl(article);
  if (!isGenericTitle(currentTitle) || !url) return { article, changed: false };

  try {
    const html = await fetchHtml(url);
    const jsonLd = extractJsonLdHeadline(html);
    const h1 = extractH1Candidates(html)[0] || "";
    const og = extractMeta(html, "og:title");
    const twitter = extractMeta(html, "twitter:title");
    const candidate = [jsonLd, h1, og, twitter]
      .map(stripTags)
      .find(isUsableTitle);

    if (!candidate || candidate === currentTitle) return { article, changed: false };
    return {
      article: {
        ...setTitle(article, candidate),
        titleCorrection: {
          previousTitleArabic: currentTitle,
          correctedTitleArabic: candidate,
          method: jsonLd === candidate
            ? "JSON_LD_HEADLINE"
            : h1 === candidate
              ? "ARTICLE_H1"
              : og === candidate
                ? "OG_TITLE"
                : "TWITTER_TITLE",
          correctedAt: new Date().toISOString()
        }
      },
      changed: true
    };
  } catch (error) {
    return { article, changed: false, error: String(error.message || error) };
  }
}

async function mapLimit(items, limit, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, run));
  return output;
}

const payload = JSON.parse(await fs.readFile(ARTICLES_FILE, "utf8"));
const articles = Array.isArray(payload.articles) ? payload.articles : [];
const candidates = articles.filter((article) => isGenericTitle(getTitle(article)) && getUrl(article));
const repaired = await mapLimit(candidates, CONCURRENCY, repair);
const repairedByUrl = new Map(repaired.map((item) => [getUrl(item.article), item]));
let correctedCount = 0;
let failedCount = 0;

const nextArticles = articles.map((article) => {
  const result = repairedByUrl.get(getUrl(article));
  if (!result) return article;
  if (result.changed) correctedCount += 1;
  if (result.error) failedCount += 1;
  return result.article;
});

await fs.writeFile(ARTICLES_FILE, `${JSON.stringify({
  ...payload,
  generatedAt: new Date().toISOString(),
  titleCorrectionRun: {
    checkedCount: candidates.length,
    correctedCount,
    failedCount
  },
  articles: nextArticles
}, null, 2)}\n`, "utf8");

console.log(`[title-fix] checked=${candidates.length}, corrected=${correctedCount}, failed=${failedCount}`);
