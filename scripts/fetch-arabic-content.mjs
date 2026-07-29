#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const INPUT_FILE = path.join(ROOT, "data", "resolved-articles.json");
const OUTPUT_FILE = path.join(ROOT, "data", "articles.json");
const FETCH_TIMEOUT_MS = Number(process.env.CONTENT_FETCH_TIMEOUT_MS || 18000);
const CONCURRENCY = Number(process.env.CONTENT_FETCH_CONCURRENCY || 3);
const MIN_CONTENT_CHARS = Number(process.env.MIN_ARABIC_CONTENT_CHARS || 300);
const MIN_ARABIC_RATIO = Number(process.env.MIN_ARABIC_RATIO || 0.35);
const RETENTION_DAYS = Number(process.env.ARTICLE_RETENTION_DAYS || 30);

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
  return decodeHtml(String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(?:p|div|li|h1|h2|h3|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

function normalizeArabic(value = "") {
  return String(value)
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/\u0640/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}

function containsExactBismayah(value = "") {
  return /(?<![\u0600-\u06FF])بسمايه(?![\u0600-\u06FF])/.test(normalizeArabic(value));
}

function hasAny(value = "", terms = []) {
  const normalized = normalizeArabic(value);
  return terms.some((term) => normalized.includes(normalizeArabic(term)));
}

function hasAll(value = "", terms = []) {
  const normalized = normalizeArabic(value);
  return terms.every((term) => normalized.includes(normalizeArabic(term)));
}

function arabicRatio(value = "") {
  const letters = String(value).match(/[\p{L}\p{N}]/gu) || [];
  if (!letters.length) return 0;
  const arabic = String(value).match(/[\u0600-\u06FF]/g) || [];
  return Number((arabic.length / letters.length).toFixed(4));
}

function hostnameOf(url = "") {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
}

function normalizeUrl(url = "") {
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_)/i.test(key)) parsed.searchParams.delete(key);
    }
    parsed.hash = "";
    return parsed.toString();
  } catch { return ""; }
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
        "accept-language": "ar-IQ,ar;q=0.9,en;q=0.4"
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { html: await response.text(), finalUrl: response.url || url };
  } finally {
    clearTimeout(timer);
  }
}

function extractMeta(html = "", key = "") {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, "i")
  ];
  for (const pattern of patterns) {
    const match = String(html).match(pattern);
    if (match?.[1]) return decodeHtml(match[1]).trim();
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

function extractJsonLdCandidates(html = "") {
  const candidates = [];
  for (const match of String(html).matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(decodeHtml(match[1]).trim());
      for (const node of walkJson(parsed)) {
        for (const key of ["articleBody", "text", "description"]) {
          if (typeof node?.[key] === "string") candidates.push(node[key]);
        }
      }
    } catch {}
  }
  return candidates;
}

function extractSelectorCandidates(html = "") {
  const candidates = [];
  const patterns = [
    /<article\b[^>]*>([\s\S]*?)<\/article>/gi,
    /<main\b[^>]*>([\s\S]*?)<\/main>/gi,
    /<(?:div|section)[^>]+(?:id|class)=["'][^"']*(?:article-body|article_body|articleBody|article-content|article_content|story-body|news-body|news_body|details-content|entry-content|post-content|content-body|field--name-body|news-details|article-text|article_txt)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|section)>/gi
  ];
  for (const pattern of patterns) {
    for (const match of String(html).matchAll(pattern)) candidates.push(match[1]);
  }
  return candidates;
}

function cleanArticleText(value = "") {
  return stripTags(value)
    .replace(/حقوق النشر[^\n]*|جميع الحقوق محفوظة[^\n]*|اشترك في النشرة[^\n]*|تابعنا على[^\n]*/gi, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

function extractBestText(html = "") {
  const candidates = [
    ...extractJsonLdCandidates(html),
    ...extractSelectorCandidates(html),
    extractMeta(html, "og:description"),
    extractMeta(html, "description")
  ].map(cleanArticleText).filter(Boolean);
  return candidates.sort((a, b) => b.length - a.length)[0] || "";
}

function extractCanonicalUrl(html = "", fallback = "") {
  const link = String(html).match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1];
  const og = extractMeta(html, "og:url");
  return normalizeUrl(link || og || fallback);
}

function extractTitle(html = "", fallback = "") {
  return extractMeta(html, "og:title") || extractMeta(html, "twitter:title") || stripTags(String(html).match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "") || fallback;
}

function politicalValidation(item = {}, text = "") {
  const requiredTerms = Array.isArray(item.requiredTerms) ? item.requiredTerms : [];
  const excludedTerms = Array.isArray(item.excludedTerms) ? item.excludedTerms : [];
  const ceremonialTerms = ["تهنئة", "تعزية", "برقية تهنئة", "برقية تعزية", "استقبال المهنئين", "ذكرى تأسيس", "حفل تكريم", "زيارة مجاملة"];
  const iraqAnchors = ["العراق", "العراقي", "بغداد", "الحكومة العراقية", "مجلس الوزراء", "مجلس النواب", "رئيس مجلس الوزراء", "رئيس الوزراء", "الإطار التنسيقي", "اللجنة المالية النيابية", "هيئة النزاهة"];
  const substantiveSignals = ["قرار", "قرارات", "توجيه", "توجيهات", "سياسة", "برنامج حكومي", "جلسة", "اجتماع", "تصويت", "قانون", "مشروع قانون", "استجواب", "إقالة", "إعفاء", "تعيين", "تشكيل الحكومة", "التشكيلة الوزارية", "الموازنة", "تخصيصات", "تمويل", "مكافحة الفساد", "حصر السلاح", "منح الثقة", "إحالة إلى القضاء", "اتفاق", "مذكرة تفاهم", "تنفيذ", "خطة", "إصلاح"];
  if (hasAny(text, [...ceremonialTerms, ...excludedTerms])) return { ok: false, errorCode: "CEREMONIAL_POLITICS", note: "축하·조문·기념식 등 의례성 정치기사" };
  if (!hasAny(text, iraqAnchors)) return { ok: false, errorCode: "NON_IRAQ_RELATED", note: "이라크 정치 주체 또는 기관 확인 불가" };
  if (requiredTerms.length && !hasAll(text, requiredTerms)) return { ok: false, errorCode: "KEYWORD_CONTEXT_MISMATCH", note: "검색 키워드의 필수 정치 주체가 본문에서 확인되지 않음" };
  if (!hasAny(text, substantiveSignals)) return { ok: false, errorCode: "LOW_INFORMATION_POLITICS", note: "정책·결정·회의·법률·인사 등 실질 내용 부족" };
  return { ok: true, errorCode: null, note: "이라크 정치권의 실질 정책·결정 기사" };
}

function economyValidation(item = {}, text = "") {
  const requiredTerms = Array.isArray(item.requiredTerms) ? item.requiredTerms : [];
  const excludedTerms = Array.isArray(item.excludedTerms) ? item.excludedTerms : [];
  const iraqAnchors = ["العراق", "العراقي", "بغداد", "وزارة الإعمار", "وزارة المالية", "وزارة التخطيط", "الهيئة الوطنية للاستثمار", "البنك المركزي العراقي", "مجلس الوزراء"];
  const businessSignals = ["مشروع", "مشاريع", "سكني", "وحدات سكنية", "مدن جديدة", "بنى تحتية", "مقاول", "مقاولين", "مستحقات", "تمويل", "تخصيصات", "الموازنة", "الإنفاق الاستثماري", "عقد", "عقود", "استثمار", "مستثمر", "قانون الاستثمار", "إعفاءات جمركية", "مواد البناء", "استئناف", "المشاريع المتلكئة", "نسب الإنجاز", "تحويلات خارجية", "امتثال مصرفي", "مصارف"];
  const lowValueSignals = ["أسعار الخضروات", "أسعار الفواكه", "الأسواق المحلية", "مهرجان تسوق", "معرض تجاري صغير", "رواتب المتقاعدين", "البطاقة التموينية"];
  if (hasAny(text, [...excludedTerms, ...lowValueSignals])) return { ok: false, errorCode: "LOW_RELEVANCE_ECONOMY", note: "비스마야 사업과 직접 연결되지 않는 생활·소비경제 기사" };
  if (!hasAny(text, iraqAnchors)) return { ok: false, errorCode: "NON_IRAQ_RELATED", note: "이라크 정부·기관·사업 연결점 확인 불가" };
  if (requiredTerms.length && !hasAll(text, requiredTerms)) return { ok: false, errorCode: "KEYWORD_CONTEXT_MISMATCH", note: "검색 키워드의 필수 경제·건설 주체가 본문에서 확인되지 않음" };
  if (!hasAny(text, businessSignals)) return { ok: false, errorCode: "LOW_INFORMATION_ECONOMY", note: "건설·투자·정부재정·금융 관련 실질 내용 부족" };
  return { ok: true, errorCode: null, note: "비스마야 사업환경과 연관 가능한 이라크 경제·건설·투자 기사" };
}

function validateCategory(item = {}, text = "") {
  if (item.category === "bismayah") {
    return containsExactBismayah(text)
      ? { ok: true, errorCode: null, note: "정확한 비스마야 표기 확인" }
      : { ok: false, errorCode: "NON_IRAQ_RELATED", note: "정확한 비스마야 표기(بسماية/بسمايه) 미확인" };
  }
  if (item.category === "politics") return politicalValidation(item, text);
  if (item.category === "economy") return economyValidation(item, text);
  return { ok: true, errorCode: null, note: "카테고리 전용 검증 미적용" };
}

async function hydrate(item) {
  if (item.urlStatus !== "RESOLVED" || !item.articleUrl) return { ...item, contentStatus: "NOT_ATTEMPTED" };
  try {
    const page = await fetchPage(item.articleUrl);
    const originalTextArabic = extractBestText(page.html);
    const originalTitleArabic = extractTitle(page.html, item.originalTitleArabic || "");
    const combinedText = `${originalTitleArabic}\n${originalTextArabic}`;
    const ratio = arabicRatio(combinedText);
    const canonicalUrl = extractCanonicalUrl(page.html, page.finalUrl || item.articleUrl);

    if (originalTextArabic.length < MIN_CONTENT_CHARS) {
      return { ...item, articleUrl: normalizeUrl(page.finalUrl || item.articleUrl), canonicalUrl, originalTitleArabic, originalTextArabic: "", contentChars: originalTextArabic.length, arabicRatio: ratio, contentStatus: "FAILED", errorCode: "CONTENT_EXTRACTION_FAILED", fetchedAt: new Date().toISOString() };
    }
    if (ratio < MIN_ARABIC_RATIO) {
      return { ...item, articleUrl: normalizeUrl(page.finalUrl || item.articleUrl), canonicalUrl, originalTitleArabic, originalTextArabic: "", contentChars: originalTextArabic.length, arabicRatio: ratio, contentStatus: "FAILED", errorCode: "NON_ARABIC_ARTICLE", fetchedAt: new Date().toISOString() };
    }

    const categoryResult = validateCategory(item, combinedText);
    if (!categoryResult.ok) {
      return { ...item, articleUrl: normalizeUrl(page.finalUrl || item.articleUrl), canonicalUrl, originalTitleArabic, originalTextArabic: "", contentChars: originalTextArabic.length, arabicRatio: ratio, contentStatus: "FAILED", errorCode: categoryResult.errorCode, relevanceNote: categoryResult.note, fetchedAt: new Date().toISOString() };
    }

    return {
      ...item,
      articleUrl: normalizeUrl(page.finalUrl || item.articleUrl),
      canonicalUrl,
      originalTitleArabic,
      originalTextArabic,
      sourceHost: hostnameOf(page.finalUrl || item.articleUrl),
      contentChars: originalTextArabic.length,
      arabicRatio: ratio,
      contentStatus: "FULL_TEXT",
      errorCode: null,
      relevanceNote: categoryResult.note,
      fetchedAt: new Date().toISOString(),
      translation: { status: "PENDING", titleKo: "", fullTextKo: "" },
      analysis: { status: "PENDING", category: item.category, recommendation: "USER_REVIEW_REQUIRED", relevanceScore: null, recommendationReason: "" },
      selection: { selected: false, reportSection: null, displayOrder: null, userNote: "" }
    };
  } catch (error) {
    const message = String(error.message || error);
    const errorCode = /abort|timeout/i.test(message) ? "FETCH_TIMEOUT" : /HTTP 404|HTTP 410/.test(message) ? "ARTICLE_REMOVED" : /HTTP 401|HTTP 403|HTTP 429/.test(message) ? "ACCESS_BLOCKED" : "CONTENT_EXTRACTION_FAILED";
    return { ...item, originalTextArabic: "", contentStatus: "FAILED", errorCode, contentError: message.slice(0, 300), fetchedAt: new Date().toISOString() };
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
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return output;
}

async function loadPrevious() {
  try {
    const previous = JSON.parse(await fs.readFile(OUTPUT_FILE, "utf8"));
    return Array.isArray(previous.articles) ? previous.articles : [];
  } catch { return []; }
}

function articleKey(item) {
  return item.canonicalUrl || item.articleUrl || item.discoveryUrl || item.articleId;
}

const input = JSON.parse(await fs.readFile(INPUT_FILE, "utf8"));
const hydrated = await mapLimit(input.articles || [], CONCURRENCY, hydrate);
const successful = hydrated.filter((item) => item.contentStatus === "FULL_TEXT" && item.originalTextArabic);
const previous = await loadPrevious();
const cutoff = new Date();
cutoff.setUTCDate(cutoff.getUTCDate() - RETENTION_DAYS);
const merged = new Map();
for (const item of [...previous, ...successful]) {
  const published = new Date(item.publishedAt || 0);
  if (!Number.isNaN(published.getTime()) && published < cutoff) continue;
  const key = articleKey(item);
  if (key) merged.set(key, item);
}
const articles = [...merged.values()].sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
const categoryCounts = articles.reduce((acc, item) => {
  acc[item.category] = (acc[item.category] || 0) + 1;
  return acc;
}, {});
const payload = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  lookbackDays: RETENTION_DAYS,
  count: articles.length,
  categoryCounts,
  collectionRun: {
    discoveredCount: input.count || (input.articles || []).length,
    resolvedCount: input.resolvedCount || 0,
    fullTextCount: successful.length,
    failedCount: hydrated.length - successful.length,
    failures: hydrated.filter((item) => item.contentStatus !== "FULL_TEXT").reduce((acc, item) => {
      const key = item.errorCode || "UNKNOWN";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {})
  },
  articles
};
await fs.writeFile(OUTPUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`[content] completed: ${successful.length} new full-text articles; retained=${articles.length}`, categoryCounts);
