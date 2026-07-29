#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const FILES = [
  path.join(ROOT, "data", "discovered-articles.json"),
  path.join(ROOT, "data", "resolved-articles.json"),
  path.join(ROOT, "data", "articles.json")
];

function hostnameOf(url = "") {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
}

function isForbiddenArticleUrl(url = "") {
  const host = hostnameOf(url);
  return !host
    || host === "news.google.com"
    || /(^|\.)google\.[a-z.]+$/i.test(host)
    || /gstatic\.com$/i.test(host)
    || /googleusercontent\.com$/i.test(host)
    || /facebook\.com$/i.test(host)
    || /instagram\.com$/i.test(host)
    || /youtube\.com$/i.test(host)
    || /twitter\.com$/i.test(host)
    || /(?:^|\.)x\.com$/i.test(host)
    || /w3\.org$/i.test(host)
    || /schema\.org$/i.test(host)
    || /xmlsoft\.org$/i.test(host);
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

function hasExactBismayah(value = "") {
  return /(?<![\u0600-\u06FF])بسمايه(?![\u0600-\u06FF])/.test(normalizeArabic(value));
}

function hasAny(value = "", terms = []) {
  const text = normalizeArabic(value);
  return terms.some((term) => text.includes(normalizeArabic(term)));
}

function validPoliticalFullText(value = "") {
  const iraqAnchors = ["العراق", "العراقي", "بغداد", "مجلس الوزراء", "مجلس النواب", "رئيس الوزراء", "الإطار التنسيقي", "هيئة النزاهة"];
  const substantiveSignals = ["قرار", "قرارات", "توجيه", "سياسة", "جلسة", "اجتماع", "تصويت", "قانون", "استجواب", "إقالة", "إعفاء", "تعيين", "الموازنة", "تمويل", "مكافحة الفساد", "حصر السلاح", "تشكيل الحكومة", "خطة", "اتفاق"];
  const ceremonial = ["تهنئة", "تعزية", "برقية تهنئة", "برقية تعزية", "استقبال المهنئين", "ذكرى تأسيس"];
  return hasAny(value, iraqAnchors) && hasAny(value, substantiveSignals) && !hasAny(value, ceremonial);
}

function validEconomyFullText(value = "") {
  const iraqAnchors = ["العراق", "العراقي", "بغداد", "وزارة الإعمار", "وزارة المالية", "وزارة التخطيط", "الهيئة الوطنية للاستثمار", "البنك المركزي العراقي", "مجلس الوزراء"];
  const businessSignals = ["مشروع", "مشاريع", "سكني", "وحدات سكنية", "مدن جديدة", "بنى تحتية", "مقاول", "مقاولين", "مستحقات", "تمويل", "تخصيصات", "الموازنة", "الإنفاق الاستثماري", "عقد", "عقود", "استثمار", "مستثمر", "قانون الاستثمار", "إعفاءات جمركية", "مواد البناء", "استئناف", "المشاريع المتلكئة", "نسب الإنجاز", "تحويلات خارجية", "امتثال مصرفي", "مصارف"];
  const lowValue = ["أسعار الخضروات", "أسعار الفواكه", "مهرجان تسوق", "رواتب المتقاعدين", "البطاقة التموينية"];
  return hasAny(value, iraqAnchors) && hasAny(value, businessSignals) && !hasAny(value, lowValue);
}

let errorCount = 0;
for (const file of FILES) {
  const label = path.relative(ROOT, file);
  let payload;
  try {
    payload = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    console.error(`[validate-data] ${label}: invalid or missing JSON - ${error.message}`);
    errorCount += 1;
    continue;
  }

  if (payload.schemaVersion !== "1.0") {
    console.error(`[validate-data] ${label}: schemaVersion must be 1.0`);
    errorCount += 1;
  }
  if (!Array.isArray(payload.articles)) {
    console.error(`[validate-data] ${label}: articles must be an array`);
    errorCount += 1;
    continue;
  }

  const ids = new Set();
  for (const [index, article] of payload.articles.entries()) {
    if (!article.articleId) {
      console.error(`[validate-data] ${label}[${index}]: articleId missing`);
      errorCount += 1;
    } else if (ids.has(article.articleId)) {
      console.error(`[validate-data] ${label}[${index}]: duplicate articleId ${article.articleId}`);
      errorCount += 1;
    } else ids.add(article.articleId);

    if (!article.category || !["bismayah", "politics", "economy", "security", "international"].includes(article.category)) {
      console.error(`[validate-data] ${label}[${index}]: invalid category ${article.category}`);
      errorCount += 1;
    }

    if (article.articleUrl && isForbiddenArticleUrl(article.articleUrl)) {
      console.error(`[validate-data] ${label}[${index}]: forbidden articleUrl ${article.articleUrl}`);
      errorCount += 1;
    }

    if (article.urlStatus === "RESOLVED" && !article.articleUrl) {
      console.error(`[validate-data] ${label}[${index}]: RESOLVED without articleUrl`);
      errorCount += 1;
    }

    if (article.contentStatus === "FULL_TEXT") {
      if (!article.originalTextArabic || article.originalTextArabic.length < 300) {
        console.error(`[validate-data] ${label}[${index}]: FULL_TEXT without sufficient Arabic body`);
        errorCount += 1;
      }
      if (Number(article.arabicRatio || 0) < 0.35) {
        console.error(`[validate-data] ${label}[${index}]: Arabic ratio below threshold`);
        errorCount += 1;
      }

      const combined = `${article.originalTitleArabic || ""}\n${article.originalTextArabic || ""}`;
      if (article.category === "bismayah" && !hasExactBismayah(combined)) {
        console.error(`[validate-data] ${label}[${index}]: Bismayah article lacks exact Bismayah term`);
        errorCount += 1;
      }
      if (article.category === "politics" && !validPoliticalFullText(combined)) {
        console.error(`[validate-data] ${label}[${index}]: politics article lacks substantive Iraq political context`);
        errorCount += 1;
      }
      if (article.category === "economy" && !validEconomyFullText(combined)) {
        console.error(`[validate-data] ${label}[${index}]: economy article lacks construction, investment or government-finance context`);
        errorCount += 1;
      }
    }
  }
  console.log(`[validate-data] ${label}: ${payload.articles.length} articles checked`);
}

if (errorCount) {
  console.error(`[validate-data] failed with ${errorCount} error(s)`);
  process.exit(1);
}
console.log("[validate-data] all collected data checks passed");
