#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const ARTICLES_FILE = path.join(ROOT, "data", "articles.json");
const SUMMARY_FILE = path.join(ROOT, "data", "foreign-local-exclusions.json");

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

function hasAny(text = "", terms = []) {
  const value = normalizeArabic(text);
  return terms.some((term) => value.includes(normalizeArabic(term)));
}

function getTitle(article = {}) {
  return article.article?.originalTitleArabic || article.originalTitleArabic || article.titleArabic || "";
}

function getBody(article = {}) {
  return article.article?.originalTextArabic || article.originalTextArabic || article.fullTextArabic || "";
}

function getUrl(article = {}) {
  return article.article?.articleUrl || article.articleUrl || article.canonicalUrl || "";
}

const SITE_BOILERPLATE = [
  "شفق نيوز | آخر الأخبار العاجلة في العراق وكوردستان والعالم",
  "آخر الأخبار العاجلة في العراق وكوردستان والعالم",
  "اخبار العراق وكوردستان والعالم",
  "أخبار العراق وكوردستان والعالم"
];

const IRAQ_DIRECT = [
  "الحكومة العراقية", "رئيس الوزراء العراقي", "مجلس الوزراء العراقي", "مجلس النواب العراقي",
  "وزارة الخارجية العراقية", "وزارة الداخلية العراقية", "القوات العراقية", "الجيش العراقي",
  "الحشد الشعبي", "المليشيات العراقية", "الميليشيات العراقية", "الفصائل العراقية",
  "بغداد", "داخل العراق", "الحدود العراقية", "الحدود العراقية السورية",
  "الأجواء العراقية", "الهيئة الوطنية للاستثمار", "بسماية", "شركة هانوا"
];

const SYRIA_SIGNALS = [
  "سوريا", "السورية", "السوري", "دمشق", "ريف دمشق", "حلب", "ريف حلب",
  "حمص", "ريف حمص", "حماة", "ريف حماة", "إدلب", "ريف إدلب", "دير الزور",
  "الحسكة", "الرقة", "اللاذقية", "طرطوس", "درعا", "السويداء", "القنيطرة",
  "الجيش السوري", "الحكومة السورية", "الشرطة السورية", "قوات الأمن السورية"
];

const EXCLUDED_LOCAL_COUNTRIES = [
  "باكستان", "الباكستانية", "إسلام آباد", "كراتشي", "بيشاور", "بلوشستان",
  "أفغانستان", "الأفغانية", "كابول", "قندهار",
  "الهند", "الهندية", "نيودلهي", "كشمير",
  "بنغلادش", "دكا", "سريلانكا", "كولومبو",
  "إندونيسيا", "جاكرتا", "الفلبين", "مانيلا",
  "نيجيريا", "الصومال", "مقديشو", "مالي", "بوركينا فاسو", "النيجر"
];

const LOCAL_INCIDENT_SIGNALS = [
  "تفجير انتحاري", "انفجار", "انفجار لغم", "لغم", "هجوم مسلح", "إطلاق نار",
  "مقتل", "قتلى", "جريح", "جرحى", "الشرطة", "قوات الأمن", "اعتقال",
  "إرهابي", "إرهاب", "اشتباكات", "عبوة ناسفة", "حادث", "ضحايا"
];

const SYRIA_DOMESTIC_SIGNALS = [
  ...LOCAL_INCIDENT_SIGNALS,
  "انتخابات", "تعيين", "إقالة", "قرار حكومي", "مجلس الوزراء السوري",
  "احتجاجات", "مظاهرات", "أزمة معيشية", "أسعار", "مدارس", "مستشفى",
  "خدمات", "طقس", "زراعة", "حريق", "جريمة"
];

const REGIONAL_OR_GLOBAL_LINK = [
  "العراق", "إيران", "تركيا", "الأردن", "السعودية", "الكويت", "الخليج",
  "مضيق هرمز", "البحر الأحمر", "باب المندب", "الولايات المتحدة", "إسرائيل", "الأمم المتحدة",
  "العقوبات", "أسعار النفط", "أمن الطاقة", "طرق الشحن", "الملاحة الدولية"
];

function cleanTitle(title = "") {
  let cleaned = String(title);
  for (const phrase of SITE_BOILERPLATE) cleaned = cleaned.replaceAll(phrase, " ");
  return cleaned.replace(/\s*[|\-–—]\s*شفق نيوز.*$/u, "").replace(/\s+/g, " ").trim();
}

function evaluate(article) {
  const rawTitle = getTitle(article);
  const title = cleanTitle(rawTitle);
  const lead = getBody(article).slice(0, 2200);
  const primary = `${title}\n${lead}`;
  const titleAndOpening = `${title}\n${lead.slice(0, 900)}`;

  const iraqDirect = hasAny(primary, IRAQ_DIRECT);
  const syriaFocused = hasAny(titleAndOpening, SYRIA_SIGNALS);
  const syriaDomestic = hasAny(primary, SYRIA_DOMESTIC_SIGNALS);

  // 사용 방침: 시리아가 실제 사건 발생지·핵심 주체인 국내 기사는 모두 제외한다.
  // 단, 이라크 정부·군·국경 등 이라크가 직접 주체인 경우만 유지한다.
  if (syriaFocused && syriaDomestic && !iraqDirect) {
    return {
      exclude: true,
      reason: "이라크 직접 연계가 없는 시리아 국내 기사",
      cleanedTitle: title
    };
  }

  const foreignCountry = EXCLUDED_LOCAL_COUNTRIES.find((term) => hasAny(title, [term]))
    || EXCLUDED_LOCAL_COUNTRIES.find((term) => hasAny(lead.slice(0, 800), [term]));
  const localIncident = hasAny(primary, LOCAL_INCIDENT_SIGNALS);
  const regionalOrGlobal = hasAny(primary, REGIONAL_OR_GLOBAL_LINK);

  if (foreignCountry && localIncident && !iraqDirect && !regionalOrGlobal) {
    return {
      exclude: true,
      reason: `이라크·주변국 연계가 없는 비대상 국가의 현지 사건: ${foreignCountry}`,
      cleanedTitle: title
    };
  }

  return { exclude: false, cleanedTitle: title };
}

const payload = JSON.parse(await fs.readFile(ARTICLES_FILE, "utf8"));
const articles = Array.isArray(payload.articles) ? payload.articles : [];
const retained = [];
const excluded = [];

for (const article of articles) {
  const result = evaluate(article);
  if (result.exclude) {
    excluded.push({
      articleId: article.articleId || article.article?.articleId || null,
      titleArabic: getTitle(article),
      cleanedTitleArabic: result.cleanedTitle,
      articleUrl: getUrl(article),
      reason: result.reason
    });
    continue;
  }
  retained.push(article);
}

const categoryCounts = retained.reduce((acc, article) => {
  const category = article.analysis?.category || article.category || "unknown";
  acc[category] = (acc[category] || 0) + 1;
  return acc;
}, {});

await fs.writeFile(ARTICLES_FILE, `${JSON.stringify({
  ...payload,
  generatedAt: new Date().toISOString(),
  count: retained.length,
  categoryCounts,
  foreignLocalIncidentFilter: {
    method: "FOREIGN_LOCAL_INCIDENT_EXCLUSION_V2_SYRIA",
    inputCount: articles.length,
    excludedCount: excluded.length
  },
  articles: retained
}, null, 2)}\n`, "utf8");

await fs.writeFile(SUMMARY_FILE, `${JSON.stringify({
  schemaVersion: "2.0",
  generatedAt: new Date().toISOString(),
  excluded
}, null, 2)}\n`, "utf8");

console.log(`[foreign-local-filter] retained=${retained.length}, excluded=${excluded.length}, method=V2_SYRIA`);
