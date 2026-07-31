#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const ARTICLES_FILE = path.join(ROOT, "data", "articles.json");
const SUMMARY_FILE = path.join(ROOT, "data", "politics-filter-summary.json");

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

function firstMatched(text = "", terms = []) {
  const normalized = normalizeArabic(text);
  return terms.find((term) => normalized.includes(normalizeArabic(term))) || "";
}

function categoryOf(article = {}) {
  return String(article.analysis?.category || article.category || "").toLowerCase();
}

function titleOf(article = {}) {
  return String(article.article?.originalTitleArabic || article.originalTitleArabic || "");
}

function bodyOf(article = {}) {
  return String(article.article?.originalTextArabic || article.originalTextArabic || "");
}

function urlOf(article = {}) {
  return String(article.article?.articleUrl || article.articleUrl || "");
}

const EXPLICIT_IRAQ_ANCHORS = [
  "العراق", "العراقي", "العراقية", "بغداد",
  "الحكومة العراقية", "مجلس الوزراء العراقي", "رئاسة الوزراء العراقية",
  "رئيس مجلس الوزراء العراقي", "رئيس الوزراء العراقي",
  "مجلس النواب العراقي", "البرلمان العراقي",
  "المحكمة الاتحادية العليا", "رئاسة الجمهورية العراقية",
  "الإطار التنسيقي", "هيئة النزاهة الاتحادية",
  "اللجنة المالية النيابية العراقية", "لجنة الاستثمار والتنمية النيابية",
  "الهيئة الوطنية للاستثمار", "وزارة المالية العراقية", "وزارة التخطيط العراقية"
];

const FOREIGN_STATE_ANCHORS = [
  "مصر", "المصري", "المصرية", "القاهرة", "حكومة مصر", "مجلس الوزراء المصري",
  "الأردن", "الأردني", "الأردنية", "عمان", "الحكومة الأردنية",
  "السعودية", "السعودي", "الرياض", "الحكومة السعودية",
  "الإمارات", "الإماراتي", "الإماراتية", "أبوظبي", "دبي", "الحكومة الإماراتية",
  "الكويت", "الكويتي", "الكويتية", "الحكومة الكويتية",
  "قطر", "القطري", "القطرية", "الدوحة",
  "البحرين", "البحريني", "المنامة",
  "عمان السلطنة", "العماني", "مسقط",
  "سوريا", "السوري", "السورية", "دمشق", "الحكومة السورية",
  "لبنان", "اللبناني", "اللبنانية", "بيروت", "الحكومة اللبنانية",
  "تركيا", "التركي", "التركية", "أنقرة", "الحكومة التركية",
  "إيران", "الإيراني", "الإيرانية", "طهران", "الحكومة الإيرانية",
  "فلسطين", "غزة", "إسرائيل", "الإسرائيلي", "الإسرائيلية",
  "اليمن", "اليمني", "صنعاء", "الحكومة اليمنية",
  "ليبيا", "الليبي", "طرابلس ليبيا", "الحكومة الليبية",
  "السودان", "الخرطوم", "الحكومة السودانية",
  "تونس", "التونسي", "الجزائر", "الجزائري", "المغرب", "المغربي"
];

const GENERIC_POLITICAL_TERMS = [
  "مجلس الوزراء", "رئيس الوزراء", "رئيس مجلس الوزراء", "الحكومة",
  "البرلمان", "مجلس النواب", "الوزارة", "الوزير", "قرارات", "جلسة"
];

function validatePoliticsArticle(article = {}) {
  const title = titleOf(article);
  const body = bodyOf(article);
  const lead = body.slice(0, 2200);
  const primaryText = `${title}\n${lead}`;

  const iraqInTitle = firstMatched(title, EXPLICIT_IRAQ_ANCHORS);
  const iraqInLead = firstMatched(primaryText, EXPLICIT_IRAQ_ANCHORS);
  const foreignInTitle = firstMatched(title, FOREIGN_STATE_ANCHORS);
  const foreignInLead = firstMatched(primaryText, FOREIGN_STATE_ANCHORS);
  const genericSignal = firstMatched(primaryText, GENERIC_POLITICAL_TERMS);

  if (foreignInTitle && !iraqInTitle) {
    return {
      ok: false,
      reason: `해외 정치기사 제외: 제목에서 ${foreignInTitle} 확인, 이라크 명시 없음`,
      foreignSignal: foreignInTitle
    };
  }

  if (!iraqInLead) {
    return {
      ok: false,
      reason: genericSignal
        ? `일반 정치표현(${genericSignal})만 확인되고 이라크 국가·기관 표식이 없음`
        : "제목·기사 도입부에서 명시적 이라크 정치 주체가 확인되지 않음",
      foreignSignal: foreignInLead || null
    };
  }

  return {
    ok: true,
    iraqSignal: iraqInTitle || iraqInLead,
    foreignSignal: foreignInLead || null,
    classificationMethod: "EXPLICIT_IRAQ_POLITICAL_ANCHOR"
  };
}

const payload = JSON.parse(await fs.readFile(ARTICLES_FILE, "utf8"));
const articles = Array.isArray(payload) ? payload : (Array.isArray(payload.articles) ? payload.articles : []);
const retained = [];
const excluded = [];

for (const article of articles) {
  if (categoryOf(article) !== "politics") {
    retained.push(article);
    continue;
  }

  const result = validatePoliticsArticle(article);
  if (!result.ok) {
    excluded.push({
      articleId: article.articleId || article.id || null,
      titleArabic: titleOf(article),
      articleUrl: urlOf(article),
      reason: result.reason,
      foreignSignal: result.foreignSignal || null
    });
    continue;
  }

  retained.push({
    ...article,
    politicsValidation: {
      iraqSignal: result.iraqSignal,
      foreignSignal: result.foreignSignal,
      classificationMethod: result.classificationMethod
    }
  });
}

const categoryCounts = retained.reduce((acc, article) => {
  const category = categoryOf(article) || "unknown";
  acc[category] = (acc[category] || 0) + 1;
  return acc;
}, {});

const politicsInputCount = articles.filter((item) => categoryOf(item) === "politics").length;
const politicsRetainedCount = retained.filter((item) => categoryOf(item) === "politics").length;
const output = Array.isArray(payload)
  ? retained
  : {
      ...payload,
      generatedAt: new Date().toISOString(),
      count: retained.length,
      categoryCounts,
      politicsFilterRun: {
        inputCount: politicsInputCount,
        retainedCount: politicsRetainedCount,
        excludedCount: excluded.length
      },
      articles: retained
    };

await fs.writeFile(ARTICLES_FILE, `${JSON.stringify(output, null, 2)}\n`, "utf8");
await fs.writeFile(SUMMARY_FILE, `${JSON.stringify({
  schemaVersion: "1.1",
  generatedAt: new Date().toISOString(),
  inputCount: politicsInputCount,
  retainedCount: politicsRetainedCount,
  excludedCount: excluded.length,
  excluded
}, null, 2)}\n`, "utf8");

console.log(`[politics-filter] input=${politicsInputCount}, retained=${politicsRetainedCount}, excluded=${excluded.length}`);
