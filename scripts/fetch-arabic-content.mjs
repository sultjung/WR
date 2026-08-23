#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { cleanArticleText } from "./article-text-cleaner.mjs";
import { extractAnadoluCandidates } from "./article-source-extractors.mjs";
import { isForbiddenArticleUrl } from "./article-url-policy.mjs";

const ROOT = process.cwd();
const INPUT_FILE = path.join(ROOT, "data", "resolved-articles.json");
const OUTPUT_FILE = path.join(ROOT, "data", "articles.json");
const FETCH_TIMEOUT_MS = Number(process.env.CONTENT_FETCH_TIMEOUT_MS || 18000);
const CONCURRENCY = Number(process.env.CONTENT_FETCH_CONCURRENCY || 3);
const MIN_CONTENT_CHARS = Number(process.env.MIN_ARABIC_CONTENT_CHARS || 300);
const MIN_ARABIC_RATIO = Number(process.env.MIN_ARABIC_RATIO || 0.35);
const RETENTION_DAYS = Number(process.env.ARTICLE_RETENTION_DAYS || 7);

function decodeHtml(value = "") {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
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
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
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

function hasNicAcronym(value = "") {
  return /(?:^|[^a-z0-9])nic(?:[^a-z0-9]|$)/i.test(String(value));
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

function extractJsonLdNodes(html = "") {
  const nodes = [];
  for (const match of String(html).matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(decodeHtml(match[1]).trim());
      walkJson(parsed, nodes);
    } catch {}
  }
  return nodes;
}

function meaningfulTitleTokens(value = "") {
  const stop = new Set(["في", "من", "على", "إلى", "الى", "عن", "مع", "بعد", "قبل", "رغم", "ضد", "هذا", "هذه", "التي", "الذي", "أن", "ان"]);
  return normalizeArabic(stripTags(value))
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !stop.has(token));
}

function headlineOverlap(left = "", right = "") {
  const expected = meaningfulTitleTokens(left);
  if (!expected.length) return 0;
  const actual = new Set(meaningfulTitleTokens(right));
  return expected.filter((token) => actual.has(token)).length / expected.length;
}

function matchingJsonLdArticles(html = "", title = "") {
  return extractJsonLdNodes(html)
    .filter((node) => {
      const type = Array.isArray(node?.["@type"]) ? node["@type"].join(" ") : String(node?.["@type"] || "");
      return !type || /(?:NewsArticle|Article|ReportageNewsArticle)/i.test(type);
    })
    .map((node) => ({
      node,
      headline: stripTags(node?.headline || node?.name || ""),
      overlap: headlineOverlap(title, node?.headline || node?.name || "")
    }))
    .filter((item) => item.overlap >= 0.55)
    .sort((a, b) => b.overlap - a.overlap);
}

function extractJsonLdCandidates(html = "") {
  const candidates = [];
  for (const node of extractJsonLdNodes(html)) {
    const type = Array.isArray(node?.["@type"]) ? node["@type"].join(" ") : String(node?.["@type"] || "");
    if (type && !/(?:NewsArticle|Article|ReportageNewsArticle)/i.test(type)) continue;
    if (typeof node?.articleBody === "string") candidates.push(node.articleBody);
  }
  return candidates;
}

function extractJsonLdHeadline(html = "") {
  for (const node of extractJsonLdNodes(html)) {
    const type = Array.isArray(node?.["@type"]) ? node["@type"].join(" ") : String(node?.["@type"] || "");
    if (type && !/(?:NewsArticle|Article|ReportageNewsArticle)/i.test(type)) continue;
    for (const key of ["headline", "name"]) {
      if (typeof node?.[key] === "string" && stripTags(node[key])) return stripTags(node[key]);
    }
  }
  return "";
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

function extractionPenalty(text = "") {
  const matches = String(text).match(/(?:فيسبوك|تويتر|واتساب|الأكثر\s+(?:قراءة|مشاهدة)|أخبار\s+ذات\s+صلة|مواضيع\s+ذات\s+صلة|facebook|twitter|whatsapp|most\s+(?:read|viewed)|related\s+(?:news|articles))/gi) || [];
  return matches.length * 900;
}

function bestCandidate(candidates = [], title = "") {
  return candidates
    .map((value) => cleanArticleText(value, { title }))
    .filter((value) => value.length >= MIN_CONTENT_CHARS)
    .sort((a, b) => (b.length - extractionPenalty(b)) - (a.length - extractionPenalty(a)))[0] || "";
}

function extractBestText(html = "", title = "", articleUrl = "") {
  const host = hostnameOf(articleUrl);
  if (host === "aa.com.tr" || host.endsWith(".aa.com.tr")) {
    const anadolu = bestCandidate(extractAnadoluCandidates(html), title);
    if (anadolu) return anadolu;
  }

  // Pages such as aawsat.com embed several complete articles in one HTML
  // response. Use only JSON-LD whose headline matches the requested article;
  // otherwise a longer, unrelated sidebar article can win the length ranking.
  const matchedStructuredText = bestCandidate(
    matchingJsonLdArticles(html, title)
      .map(({ node }) => typeof node.articleBody === "string" ? node.articleBody : ""),
    title
  );
  if (matchedStructuredText) return matchedStructuredText;

  // Some publishers (notably Shafaq) expose a short keyword string in
  // JSON-LD articleBody while the real article is present in the page body.
  // Rank every structured/body candidate together instead of accepting the
  // first non-empty JSON-LD value.
  const articleText = bestCandidate([
    ...extractJsonLdCandidates(html),
    ...extractSelectorCandidates(html)
  ], title);
  if (articleText) return articleText;

  return bestCandidate([
    extractMeta(html, "og:description"),
    extractMeta(html, "description")
  ], title);
}

function extractPublishedAt(html = "", title = "") {
  for (const { node } of matchingJsonLdArticles(html, title)) {
    for (const key of ["datePublished", "dateCreated"]) {
      const date = new Date(node?.[key] || "");
      if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
  }
  for (const key of ["article:published_time", "datePublished", "date"]) {
    const date = new Date(extractMeta(html, key));
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return "";
}

function isOutsideRetention(value = "") {
  const time = new Date(value).getTime();
  return !Number.isNaN(time) && time < Date.now() - RETENTION_DAYS * 86400000;
}

function extractCanonicalUrl(html = "", fallback = "") {
  const link = String(html).match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1];
  const og = extractMeta(html, "og:url");
  return normalizeUrl(link || og || fallback);
}

function cleanArticleTitle(title = "", articleUrl = "") {
  const host = hostnameOf(articleUrl);
  let value = stripTags(title)
    .replace(/&(?:lrm|rlm);/gi, " ")
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (host === "shafaq.com" || host.endsWith(".shafaq.com")) {
    value = value
      .replace(/\s*(?:[-–—|]\s*)?شفق نيوز(?:\s*\|[\s\S]*)?$/i, "")
      .replace(/\s*\|\s*آخر الأخبار العاجلة في العراق وكوردستان والعالم[\s\S]*$/i, "")
      .trim();
  }

  value = value
    .replace(/\s*(?:[-–—|]\s*)?(?:آخر الأخبار العاجلة|آخر الأخبار|الأخبار العاجلة)\s+في\s+العراق(?:\s+وكوردستان)?(?:\s+والعالم)?\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  return value;
}

function stripTitleScopeNoise(value = "") {
  return String(value || "")
    .replace(/^\s*وان\s+نيوز\s*\/\s*/iu, "")
    .replace(/\s*\(\s*وان[_\s-]+نيوز\s*\)\s*/giu, " ")
    .replace(/\s*\(\s*المنصة[_\s-]+الإخبارية[_\s-]+الأولى[_\s-]+في[_\s-]+العراق\s*\)\s*/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractH1Title(html = "") {
  return stripTags(String(html).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "");
}

function extractTitle(html = "", fallback = "", articleUrl = "") {
  const candidates = [
    extractJsonLdHeadline(html),
    extractH1Title(html),
    extractMeta(html, "og:title"),
    extractMeta(html, "twitter:title"),
    fallback
  ];
  return candidates.map((title) => cleanArticleTitle(title, articleUrl)).find(Boolean) || "";
}

const BISMAYAH_TERMS = ["bismayah", "bismaya", "bncp"];
const NIC_TERMS = [
  "الهيئة الوطنية للاستثمار", "هيئة الاستثمار الوطنية", "رئيس الهيئة الوطنية للاستثمار",
  "national investment commission", "iraq national investment commission",
  "عادل الياسري", "عادل داخل الياسري", "حيدر مكية"
];
const HANWHA_TERMS = ["شركة هانوا", "هانوا", "hanwha", "한화"];
const IRAQ_TERMS = [
  "العراق", "العراقي", "العراقية", "بغداد", "البصرة", "الموصل", "كركوك", "الانبار", "الأنبار",
  "اربيل", "أربيل", "السليمانية", "كربلاء", "النجف", "ديالى", "صلاح الدين", "نينوى", "ذي قار",
  "ميسان", "واسط", "بابل", "الديوانية", "المثنى", "دهوك", "كردستان العراق", "iraq", "iraqi"
];

function hasHanwhaMention(text = "") {
  const normalized = normalizeArabic(text);
  return /(?:^|[^\p{L}\p{N}])هانوا(?:$|[^\p{L}\p{N}])/u.test(normalized)
    || hasAny(text, HANWHA_TERMS.filter((term) => term !== "هانوا"));
}

function bismayahValidation(text = "") {
  const directBismayah = containsExactBismayah(text) || hasAny(text, BISMAYAH_TERMS);
  const directNic = hasAny(text, NIC_TERMS) || hasNicAcronym(text);
  const hanwhaIraq = hasHanwhaMention(text) && hasAny(text, IRAQ_TERMS);
  return directBismayah || directNic || hanwhaIraq
    ? { ok: true, errorCode: null, note: "비스마야·NIC·NIC 의장 또는 한화+이라크 직접 관련" }
    : { ok: false, errorCode: "NON_IRAQ_RELATED", note: "비스마야·NIC·NIC 의장 또는 한화+이라크 직접 근거 미확인" };
}

function politicalValidation(item = {}, title = "", body = "") {
  const text = `${title}\n${body}`;
  const requiredTerms = Array.isArray(item.requiredTerms) ? item.requiredTerms : [];
  const excludedTerms = Array.isArray(item.excludedTerms) ? item.excludedTerms : [];
  const ceremonialTerms = ["تهنئة", "تعزية", "برقية تهنئة", "برقية تعزية", "استقبال المهنئين", "ذكرى تأسيس", "حفل تكريم", "زيارة مجاملة"];
  const iraqAnchors = ["العراق", "العراقي", "بغداد", "الحكومة العراقية", "مجلس الوزراء", "مجلس النواب", "رئيس مجلس الوزراء", "رئيس الوزراء", "الإطار التنسيقي", "اللجنة المالية النيابية", "هيئة النزاهة"];
  const substantiveSignals = ["قرار", "قرارات", "توجيه", "توجيهات", "سياسة", "برنامج حكومي", "جلسة", "اجتماع", "تصويت", "قانون", "مشروع قانون", "استجواب", "إقالة", "إعفاء", "تعيين", "تشكيل الحكومة", "التشكيلة الوزارية", "الموازنة", "تخصيصات", "تمويل", "مكافحة الفساد", "حصر السلاح", "منح الثقة", "إحالة إلى القضاء", "اتفاق", "مذكرة تفاهم", "تنفيذ", "خطة", "إصلاح"];
  if (hasAny(text, [...ceremonialTerms, ...excludedTerms])) return { ok: false, errorCode: "CEREMONIAL_POLITICS", note: "축하·조문·기념식 등 의례성 정치기사" };
  if (!hasAny(body, iraqAnchors)) return { ok: false, errorCode: "TITLE_BODY_MISMATCH", note: "제목은 이라크 정치 기사이나 추출 본문에서 이라크 주체가 확인되지 않음" };
  if (requiredTerms.length && !hasAll(body, requiredTerms)) return { ok: false, errorCode: "TITLE_BODY_MISMATCH", note: "검색 필수 정치 주체가 추출 본문에서 확인되지 않음" };
  if (!hasAny(body, substantiveSignals)) return { ok: false, errorCode: "LOW_INFORMATION_POLITICS", note: "정책·결정·회의·법률·인사 등 실질 내용 부족" };
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

function securityValidation(item = {}, title = "", body = "", articleUrl = "") {
  const requiredTerms = Array.isArray(item.requiredTerms) ? item.requiredTerms : [];
  const excludedTerms = Array.isArray(item.excludedTerms) ? item.excludedTerms : [];
  const lead = String(body).slice(0, 2200);
  const scopeTitle = stripTitleScopeNoise(title);
  const evidence = `${scopeTitle}\n${lead}`;
  const foreignPlaces = [
    "الهند", "باكستان", "سوريا", "لبنان", "فلسطين", "غزة", "ايران", "إيران", "اليمن", "السعودية",
    "مصر", "الاردن", "الأردن", "الكويت", "قطر", "الامارات", "الإمارات", "البحرين", "تركيا",
    "افغانستان", "أفغانستان", "كينيا", "الصومال", "المغرب", "تونس", "الجزائر", "السودان", "كولومبيا"
  ];
  const iraqAnchors = [
    ...IRAQ_TERMS,
    "الحكومة العراقية", "القوات العراقية", "الجيش العراقي", "الشرطة العراقية", "جهاز الامن الوطني",
    "جهاز الأمن الوطني", "الحشد الشعبي", "وزارة الداخلية العراقية", "قيادة العمليات المشتركة"
  ];
  const securitySignals = [
    "انفجار", "تفجير", "عبوة ناسفة", "لغم", "هجوم", "هجوم مسلح", "اطلاق نار", "إطلاق نار", "اغتيال",
    "اشتباك", "قصف", "غارة", "صاروخ", "صواريخ", "طائرة مسيرة", "مسيّرات", "داعش", "ارهاب", "إرهاب",
    "عملية امنية", "عملية أمنية", "اعتقال", "احباط هجوم", "إحباط هجوم", "مقتل", "اصابة", "إصابة",
    "تظاهرة", "تظاهرات", "احتجاج", "احتجاجات", "اعتصام", "قطع الطريق", "اغلاق الطريق", "إغلاق الطريق"
  ];
  const foreignLocationInTitle = hasAny(scopeTitle, foreignPlaces);
  const iraqInTitle = hasAny(scopeTitle, iraqAnchors);
  const iraqInLead = hasAny(lead, iraqAnchors);
  const isShafaqWorldSection = (() => {
    if (hostnameOf(articleUrl) !== "shafaq.com") return false;
    try { return decodeURIComponent(new URL(articleUrl).pathname).includes("المنطقة-والعالم"); } catch { return false; }
  })();

  if (hasAny(evidence, excludedTerms)) return { ok: false, errorCode: "KEYWORD_CONTEXT_MISMATCH", note: "제외 키워드가 확인된 치안기사" };
  if (foreignLocationInTitle && !iraqInTitle) {
    return { ok: false, errorCode: "FOREIGN_SECURITY_EVENT", note: "이라크와 무관한 해외 치안·시위 사건" };
  }
  if (isShafaqWorldSection && !iraqInTitle && !iraqInLead) {
    return { ok: false, errorCode: "FOREIGN_SECURITY_EVENT", note: "Shafaq 지역·세계 섹션의 비이라크 치안기사" };
  }
  if (!iraqInTitle && !iraqInLead) return { ok: false, errorCode: "NON_IRAQ_RELATED", note: "이라크 지역·기관·치안 주체 확인 불가" };
  if (requiredTerms.length && !hasAll(evidence, requiredTerms)) return { ok: false, errorCode: "KEYWORD_CONTEXT_MISMATCH", note: "검색 키워드의 필수 치안 주체가 본문에서 확인되지 않음" };
  if (!hasAny(evidence, securitySignals)) return { ok: false, errorCode: "LOW_INFORMATION_SECURITY", note: "테러·치안·시위 관련 실질 사건 신호 부족" };
  return { ok: true, errorCode: null, note: "이라크 내 테러·치안·시위 사건" };
}

function validateCategory(item = {}, title = "", body = "", articleUrl = "") {
  const text = `${title}\n${body}`;
  if (item.category === "bismayah") return bismayahValidation(text);
  if (item.category === "politics") return politicalValidation(item, title, body);
  if (item.category === "economy") return economyValidation(item, text);
  if (item.category === "security") return securityValidation(item, title, body, articleUrl);
  return { ok: true, errorCode: null, note: "카테고리 전용 검증 미적용" };
}

function sanitizeStoredArticle(item = {}) {
  const articleUrl = item.canonicalUrl || item.articleUrl || "";
  if (articleUrl && isForbiddenArticleUrl({ ...item, articleUrl })) return null;
  const title = cleanArticleTitle(item.originalTitleArabic || "", articleUrl);
  const body = cleanArticleText(item.originalTextArabic || "", { title });
  if (body.length < MIN_CONTENT_CHARS || arabicRatio(body) < MIN_ARABIC_RATIO) return null;
  const validation = validateCategory(item, title, body, articleUrl);
  if (!validation.ok) return null;
  return {
    ...item,
    originalTitleArabic: title,
    originalTextArabic: body,
    relevanceNote: validation.note || item.relevanceNote
  };
}

async function hydrate(item) {
  if (item.urlStatus !== "RESOLVED" || !item.articleUrl) return { ...item, contentStatus: "NOT_ATTEMPTED" };
  try {
    const page = await fetchPage(item.articleUrl);
    const articleUrl = normalizeUrl(page.finalUrl || item.articleUrl);
    const originalTitleArabic = extractTitle(page.html, item.originalTitleArabic || "", articleUrl);
    const originalTextArabic = extractBestText(page.html, originalTitleArabic, articleUrl);
    const pagePublishedAt = extractPublishedAt(page.html, originalTitleArabic);
    const combinedText = `${originalTitleArabic}\n${originalTextArabic}`;
    const ratio = arabicRatio(combinedText);
    const canonicalUrl = extractCanonicalUrl(page.html, articleUrl);

    if (pagePublishedAt && isOutsideRetention(pagePublishedAt)) {
      return {
        ...item,
        articleUrl,
        canonicalUrl,
        originalTitleArabic,
        publishedAt: pagePublishedAt,
        pagePublishedAt,
        originalTextArabic: "",
        contentStatus: "FAILED",
        errorCode: "STALE_PUBLISHER_DATE",
        relevanceNote: `원문 게시일(${pagePublishedAt.slice(0, 10)})이 수집 기간을 벗어남`,
        fetchedAt: new Date().toISOString()
      };
    }

    if (originalTextArabic.length < MIN_CONTENT_CHARS) {
      return { ...item, articleUrl, canonicalUrl, originalTitleArabic, originalTextArabic: "", contentChars: originalTextArabic.length, arabicRatio: ratio, contentStatus: "FAILED", errorCode: "CONTENT_EXTRACTION_FAILED", fetchedAt: new Date().toISOString() };
    }
    if (ratio < MIN_ARABIC_RATIO) {
      return { ...item, articleUrl, canonicalUrl, originalTitleArabic, originalTextArabic: "", contentChars: originalTextArabic.length, arabicRatio: ratio, contentStatus: "FAILED", errorCode: "NON_ARABIC_ARTICLE", fetchedAt: new Date().toISOString() };
    }

    const categoryResult = validateCategory(item, originalTitleArabic, originalTextArabic, canonicalUrl || articleUrl);
    if (!categoryResult.ok) {
      return { ...item, articleUrl, canonicalUrl, originalTitleArabic, originalTextArabic: "", contentChars: originalTextArabic.length, arabicRatio: ratio, contentStatus: "FAILED", errorCode: categoryResult.errorCode, relevanceNote: categoryResult.note, fetchedAt: new Date().toISOString() };
    }

    return {
      ...item,
      articleUrl,
      canonicalUrl,
      publishedAt: pagePublishedAt || item.publishedAt,
      pagePublishedAt: pagePublishedAt || "",
      originalTitleArabic,
      originalTextArabic,
      sourceHost: hostnameOf(articleUrl),
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
let removedStoredCount = 0;
for (const rawItem of [...previous, ...successful]) {
  const item = sanitizeStoredArticle(rawItem);
  if (!item) {
    removedStoredCount += 1;
    continue;
  }
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
    removedStoredCount,
    failures: hydrated.filter((item) => item.contentStatus !== "FULL_TEXT").reduce((acc, item) => {
      const key = item.errorCode || "UNKNOWN";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {})
  },
  articles
};
await fs.writeFile(OUTPUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`[content] completed: ${successful.length} new full-text articles; retained=${articles.length}; removedStored=${removedStoredCount}`, categoryCounts);
