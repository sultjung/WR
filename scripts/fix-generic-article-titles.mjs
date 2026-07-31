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
  /صحيفة إلكترونية/i
];

function decodeHtml(value = "") {
  return String(value)
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
  return decodeHtml(String(value).replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function isGenericTitle(title = "") {
  const value = stripTags(title);
  if (!value || value.length < 12) return true;
  return GENERIC_TITLE_PATTERNS.some((pattern) => pattern.test(value));
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

function extractJsonLdHeadline(html = "") {
  for (const match of String(html).matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(decodeHtml(match[1]).trim());
      for (const node of walkJson(parsed)) {
        for (const key of ["headline", "name"]) {
          const candidate = typeof node?.[key] === "string" ? stripTags(node[key]) : "";
          if (candidate && !isGenericTitle(candidate)) return candidate;
        }
      }
    } catch {}
  }
  return "";
}

function extractH1Candidates(html = "") {
  return [...String(html).matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)]
    .map((match) => stripTags(match[1]))
    .filter((title) => title && !isGenericTitle(title))
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
    const twitter = extractMeta(html, "twitter:title");
    const og = extractMeta(html, "og:title");
    const candidate = [jsonLd, h1, twitter, og]
      .map(stripTags)
      .find((title) => title && !isGenericTitle(title));

    if (!candidate || candidate === currentTitle) return { article, changed: false };
    return {
      article: {
        ...setTitle(article, candidate),
        titleCorrection: {
          previousTitleArabic: currentTitle,
          correctedTitleArabic: candidate,
          method: jsonLd === candidate ? "JSON_LD_HEADLINE" : h1 === candidate ? "ARTICLE_H1" : twitter === candidate ? "TWITTER_TITLE" : "OG_TITLE_FALLBACK",
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
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
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
