#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const ARTICLES_FILE = path.join(ROOT, "data", "articles.json");
const SUMMARY_FILE = path.join(ROOT, "data", "international-summary.json");

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
  const normalized = normalizeArabic(text);
  return terms.some((term) => normalized.includes(normalizeArabic(term)));
}

const IRAQ_ANCHORS = [
  "العراق", "العراقي", "بغداد", "الحكومة العراقية", "الأجواء العراقية",
  "الحدود العراقية السورية", "صادرات النفط العراقية", "المصارف العراقية"
];

const IMPACT_SIGNALS = [
  "انسحاب القوات", "القوات الأميركية", "التحالف الدولي", "عقوبات",
  "مصارف عراقية", "تحويلات الدولار", "الخزانة الأميركية", "طريق التنمية",
  "المياه", "النفط عبر جيهان", "الحدود العراقية السورية", "مخيم الهول",
  "مضيق هرمز", "صادرات النفط", "الملاحة", "ناقلات النفط", "إغلاق الأجواء",
  "تعليق الرحلات", "صواريخ", "طائرات مسيرة", "توتر إقليمي", "أمن الطاقة",
  "النفوذ الإيراني", "الفصائل المسلحة", "التبادل التجاري", "اتفاقية أمنية"
];

const GENERIC_GLOBAL_SIGNALS = [
  "بطولة", "مباراة", "مسلسل", "فيلم", "مهرجان", "سياحة", "طقس",
  "مشاهير", "كرة القدم", "الانتخابات الأميركية دون صلة بالعراق"
];

const TYPE_RULES = [
  { type: "US_SECURITY", terms: ["الولايات المتحدة", "واشنطن", "القوات الأميركية", "التحالف الدولي"] },
  { type: "IRAN_RELATIONS", terms: ["إيران", "طهران", "النفوذ الإيراني", "الفصائل المسلحة"] },
  { type: "TURKEY_RELATIONS", terms: ["تركيا", "أنقرة", "طريق التنمية", "النفط عبر جيهان", "المياه"] },
  { type: "SYRIA_BORDER", terms: ["الحدود العراقية السورية", "مخيم الهول", "سوريا", "تسلل"] },
  { type: "ENERGY_ROUTE", terms: ["مضيق هرمز", "صادرات النفط", "ناقلات النفط", "الملاحة"] },
  { type: "AIRSPACE", terms: ["الأجواء العراقية", "تعليق الرحلات", "إغلاق الأجواء", "صواريخ", "طائرات مسيرة"] },
  { type: "SANCTIONS_FINANCE", terms: ["عقوبات أميركية", "مصارف عراقية", "تحويلات الدولار", "الخزانة الأميركية"] },
  { type: "GULF_SECURITY", terms: ["الخليج", "توتر إقليمي", "أمن الملاحة", "أمن الطاقة"] }
];

function classifyType(text = "", fallback = "") {
  for (const rule of TYPE_RULES) {
    if (hasAny(text, rule.terms)) return rule.type;
  }
  return fallback || "OTHER_IRAQ_LINKED";
}

function validateInternational(article) {
  const text = `${article.originalTitleArabic || ""}\n${article.originalTextArabic || ""}`;
  if (!hasAny(text, IRAQ_ANCHORS)) {
    return { ok: false, reason: "이라크가 기사의 핵심 주체·영향 대상이 아님" };
  }
  if (hasAny(text, GENERIC_GLOBAL_SIGNALS)) {
    return { ok: false, reason: "일반 국제·문화·스포츠 기사" };
  }
  if (!hasAny(text, IMPACT_SIGNALS)) {
    return { ok: false, reason: "이라크 안보·물류·에너지·금융에 대한 직접 영향 근거 부족" };
  }
  const type = classifyType(text, article.internationalType || "");
  return {
    ok: true,
    international: {
      type,
      classificationMethod: "RULE_BASED_ARABIC_FULL_TEXT"
    }
  };
}

const payload = JSON.parse(await fs.readFile(ARTICLES_FILE, "utf8"));
const articles = Array.isArray(payload.articles) ? payload.articles : [];
const retained = [];
const excluded = [];

for (const article of articles) {
  if (article.category !== "international") {
    retained.push(article);
    continue;
  }
  const result = validateInternational(article);
  if (!result.ok) {
    excluded.push({
      articleId: article.articleId,
      titleArabic: article.originalTitleArabic,
      articleUrl: article.articleUrl,
      reason: result.reason
    });
    continue;
  }
  retained.push({
    ...article,
    internationalContext: result.international,
    relevanceNote: `이라크 직접 연계 국제정세: ${result.international.type}`
  });
}

const internationalArticles = retained.filter((item) => item.category === "international");
const typeCounts = internationalArticles.reduce((acc, item) => {
  const key = item.internationalContext?.type || "UNCLASSIFIED";
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});

const categoryCounts = retained.reduce((acc, item) => {
  acc[item.category] = (acc[item.category] || 0) + 1;
  return acc;
}, {});

await fs.writeFile(ARTICLES_FILE, `${JSON.stringify({
  ...payload,
  generatedAt: new Date().toISOString(),
  count: retained.length,
  categoryCounts,
  internationalRun: {
    inputCount: articles.filter((item) => item.category === "international").length,
    retainedCount: internationalArticles.length,
    excludedCount: excluded.length,
    typeCounts
  },
  articles: retained
}, null, 2)}\n`, "utf8");

await fs.writeFile(SUMMARY_FILE, `${JSON.stringify({
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  total: internationalArticles.length,
  typeCounts,
  excluded
}, null, 2)}\n`, "utf8");

console.log(`[international] retained=${internationalArticles.length}, excluded=${excluded.length}`, typeCounts);
