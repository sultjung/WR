#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { isForbiddenArticleUrl } from "./article-url-policy.mjs";

const ROOT = path.resolve(process.env.COLLECTED_DATA_ROOT || process.cwd());
const FILES = [
  { file: path.join(ROOT, "data", "discovered-articles.json"), required: false },
  { file: path.join(ROOT, "data", "recovered-articles.json"), required: false },
  { file: path.join(ROOT, "data", "resolved-articles.json"), required: false },
  { file: path.join(ROOT, "data", "articles.json"), required: true }
];

function normalizeArabic(value = "") {
  return String(value)
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/\u0640/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function hasExactBismayah(value = "") {
  return /(?<![\u0600-\u06FF])بسمايه(?![\u0600-\u06FF])/.test(normalizeArabic(value));
}

function hasAny(value = "", terms = []) {
  const text = normalizeArabic(value);
  return terms.some((term) => text.includes(normalizeArabic(term)));
}

function hasNicAcronym(value = "") {
  return /(?:^|[^a-z0-9])nic(?:[^a-z0-9]|$)/i.test(String(value));
}

const BISMAYAH_TERMS = ["bismayah", "bismaya", "bncp"];
const NIC_TERMS = [
  "الهيئة الوطنية للاستثمار", "هيئة الاستثمار الوطنية", "رئيس الهيئة الوطنية للاستثمار",
  "national investment commission", "iraq national investment commission",
  "عادل الياسري", "عادل داخل الياسري", "حيدر مكية"
];
const HANWHA_TERMS = ["شركة هانوا", "هانوا", "hanwha", "한화"];
const IRAQ_TERMS = ["العراق", "العراقي", "العراقية", "بغداد", "iraq", "iraqi"];

function validBismayahFullText(value = "") {
  const directBismayah = hasExactBismayah(value) || hasAny(value, BISMAYAH_TERMS);
  const directNic = hasAny(value, NIC_TERMS) || hasNicAcronym(value);
  const hanwhaIraq = hasAny(value, HANWHA_TERMS) && hasAny(value, IRAQ_TERMS);
  return directBismayah || directNic || hanwhaIraq;
}

function validPoliticalFullText(value = "") {
  const iraqAnchors = ["العراق", "العراقي", "بغداد", "الحكومة العراقية", "مجلس الوزراء", "مجلس النواب", "رئيس مجلس الوزراء", "رئيس الوزراء", "الإطار التنسيقي", "اللجنة المالية النيابية", "هيئة النزاهة"];
  const substantiveSignals = ["قرار", "قرارات", "توجيه", "توجيهات", "سياسة", "برنامج حكومي", "جلسة", "اجتماع", "تصويت", "قانون", "مشروع قانون", "استجواب", "إقالة", "إعفاء", "تعيين", "تشكيل الحكومة", "التشكيلة الوزارية", "الموازنة", "تخصيصات", "تمويل", "مكافحة الفساد", "حصر السلاح", "منح الثقة", "إحالة إلى القضاء", "اتفاق", "مذكرة تفاهم", "تنفيذ", "خطة", "إصلاح"];
  return hasAny(value, iraqAnchors) && hasAny(value, substantiveSignals);
}

function validEconomyFullText(value = "") {
  const iraqAnchors = ["العراق", "العراقي", "بغداد", "وزارة الإعمار", "وزارة المالية", "وزارة التخطيط", "الهيئة الوطنية للاستثمار", "البنك المركزي العراقي", "مجلس الوزراء"];
  const businessSignals = ["مشروع", "مشاريع", "سكني", "وحدات سكنية", "مدن جديدة", "بنى تحتية", "مقاول", "مقاولين", "مستحقات", "تمويل", "تخصيصات", "الموازنة", "الإنفاق الاستثماري", "عقد", "عقود", "استثمار", "مستثمر", "قانون الاستثمار", "إعفاءات جمركية", "مواد البناء", "استئناف", "المشاريع المتلكئة", "نسب الإنجاز", "تحويلات خارجية", "امتثال مصرفي", "مصارف"];
  return hasAny(value, iraqAnchors) && hasAny(value, businessSignals);
}

let errorCount = 0;
let warningCount = 0;
for (const { file, required } of FILES) {
  const label = path.relative(ROOT, file);
  let payload;
  try {
    payload = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (!required && error?.code === "ENOENT") {
      console.log(`[validate-data] ${label}: skipped (runtime intermediate file not present)`);
      continue;
    }
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

    if (article.articleUrl && isForbiddenArticleUrl(article)) {
      console.error(`[validate-data] ${label}[${index}]: forbidden articleUrl ${article.articleUrl}`);
      errorCount += 1;
    }

    if (["RECOVERED", "RESOLVED"].includes(article.urlStatus) && !article.articleUrl) {
      console.error(`[validate-data] ${label}[${index}]: ${article.urlStatus} without articleUrl`);
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
      if (article.category === "bismayah" && !validBismayahFullText(combined)) {
        console.error(`[validate-data] ${label}[${index}]: Bismayah article lacks a direct Bismayah, NIC, NIC-chair, or Hanwha+Iraq anchor`);
        errorCount += 1;
      }
      if (article.category === "politics" && !validPoliticalFullText(combined)) {
        console.warn(`[validate-data] warning ${label}[${index}]: politics article may lack substantive Iraq political context`);
        warningCount += 1;
      }
      if (article.category === "economy" && !validEconomyFullText(combined)) {
        console.warn(`[validate-data] warning ${label}[${index}]: economy article may lack construction, investment or government-finance context`);
        warningCount += 1;
      }
    }
  }
  console.log(`[validate-data] ${label}: ${payload.articles.length} articles checked`);
}

if (errorCount) {
  console.error(`[validate-data] failed with ${errorCount} error(s), ${warningCount} warning(s)`);
  process.exit(1);
}
console.log(`[validate-data] all collected data checks passed with ${warningCount} warning(s)`);
