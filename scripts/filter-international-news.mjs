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
function getCategory(article = {}) { return article.analysis?.category || article.category || ""; }
function getTitle(article = {}) { return article.article?.originalTitleArabic || article.originalTitleArabic || article.titleArabic || ""; }
function getBody(article = {}) { return article.article?.originalTextArabic || article.originalTextArabic || article.fullTextArabic || ""; }
function getUrl(article = {}) { return article.article?.articleUrl || article.articleUrl || article.canonicalUrl || ""; }
function getHost(article = {}) {
  try { return new URL(getUrl(article)).hostname.replace(/^www\./, "").toLowerCase(); }
  catch { return ""; }
}
function setCategory(article = {}, category = "") {
  const next = { ...article, category };
  if (article.analysis && typeof article.analysis === "object") next.analysis = { ...article.analysis, category };
  return next;
}

const IRAQ_CORE = [
  "العراق", "العراقي", "العراقية", "بغداد", "الحكومة العراقية", "مجلس الوزراء العراقي",
  "رئيس الوزراء العراقي", "مجلس النواب العراقي", "البرلمان العراقي", "وزارة المالية العراقية",
  "وزارة التخطيط العراقية", "البنك المركزي العراقي", "المصارف العراقية", "الحشد الشعبي",
  "المليشيات العراقية", "الميليشيات العراقية", "الفصائل العراقية", "المقاومة العراقية",
  "القوات العراقية", "الأجواء العراقية", "الحدود العراقية"
];
const IRAQI_ARMED_ACTORS = [
  "المليشيات العراقية", "الميليشيات العراقية", "الفصائل العراقية", "فصائل عراقية",
  "الحشد الشعبي", "المقاومة الإسلامية في العراق", "كتائب حزب الله", "النجباء",
  "عصائب أهل الحق", "هجمات عراقية", "جماعات عراقية مسلحة"
];
const SECURITY_ATTACK_SIGNALS = [
  "هجوم", "هجمات", "ضربة", "ضربات", "قصف", "غارة", "غارات", "انفجار", "اغتيال",
  "اشتباك", "استهداف", "طائرات مسيرة", "مسيّرات", "صواريخ", "مقذوفات", "تهديد",
  "عملية عسكرية", "تصعيد عسكري", "إطلاق نار"
];
const REGIONAL_WAR_SIGNALS = [
  "الحرب بين إيران وإسرائيل", "الحرب الإيرانية الإسرائيلية", "إيران وإسرائيل",
  "الولايات المتحدة وإيران", "الحرب مع إيران", "حرب إيران", "هجوم على إيران",
  "ضربة على إيران", "انسحاب الولايات المتحدة من حرب إيران", "اتساع نطاق المهمة",
  "مضيق هرمز", "سيادة هرمز", "إغلاق مضيق هرمز", "الخليج", "دول الخليج",
  "البحر الأحمر", "باب المندب", "الحوثي", "الحوثيين", "هجمات حوثية",
  "أمن الملاحة", "حرية الملاحة", "ناقلات النفط", "طرق الشحن", "تصعيد إقليمي",
  "توتر إقليمي", "إغلاق الأجواء", "تعليق الرحلات", "قوات أميركية", "الحرب الإقليمية"
];
const ECONOMY_CORE_SIGNALS = [
  "البنك المركزي", "مصرف", "مصارف", "تمويل", "استثمار", "مشروع سكني", "مشاريع سكنية",
  "عقد استثماري", "عقود استثمارية", "الموازنة", "إعمار", "بنى تحتية", "طريق التنمية",
  "تحويلات الدولار", "امتثال مصرفي", "تبادل تجاري", "ممر تجاري"
];
const POLITICS_SIGNALS = [
  "يدين", "أدان", "إدانة", "يرفض", "استنكر", "موقف رسمي", "بيان الحكومة",
  "بيان الخارجية", "وزارة الخارجية", "استدعى السفير", "علاقات دبلوماسية",
  "زيارة رسمية", "اتفاق سياسي", "مجلس الوزراء", "رئيس الوزراء", "البرلمان", "سيادة العراق"
];
const PURE_FOREIGN_DOMESTIC = [
  "حكومة مصر", "مجلس الوزراء المصري", "الرئيس المصري", "القاهرة", "الحكومة الأردنية",
  "مجلس الوزراء الأردني", "الحكومة السعودية", "مجلس الوزراء السعودي", "الحكومة الإماراتية",
  "مجلس الوزراء الإماراتي", "الحكومة الكويتية", "الحكومة القطرية", "الحكومة البحرينية"
];
const PURE_DOMESTIC_ACTIONS = [
  "تعيين", "إقالة", "إنشاء مشروع محلي", "افتتاح مشروع محلي", "موازنة محلية",
  "انتخابات محلية", "تعديل وزاري", "قرارات حكومية داخلية"
];
const MOROCCO_TITLE_SIGNALS = ["أخبار المغرب العاجلة", "اخبار المغرب العاجلة", "آخر أخبار المغرب"];
const MOROCCO_HOST_SIGNALS = [".ma", "morocco", "maghreb", "maroc"];

function isMoroccoSource(article, title) {
  const host = getHost(article);
  return hasAny(title, MOROCCO_TITLE_SIGNALS) || MOROCCO_HOST_SIGNALS.some((term) => host.includes(term));
}

function routeArticle(article) {
  const title = getTitle(article);
  const body = getBody(article);
  const lead = body.slice(0, 6000);
  const text = `${title}\n${lead}`;
  const current = getCategory(article);
  const titleHasIraq = hasAny(title, IRAQ_CORE);
  const textHasIraq = hasAny(text, IRAQ_CORE);
  const iraqiArmedActor = hasAny(text, IRAQI_ARMED_ACTORS);
  const attack = hasAny(text, SECURITY_ATTACK_SIGNALS);
  const regionalWar = hasAny(text, REGIONAL_WAR_SIGNALS);
  const economyCore = hasAny(text, ECONOMY_CORE_SIGNALS);
  const politics = hasAny(text, POLITICS_SIGNALS);

  if (isMoroccoSource(article, title)) {
    return { action: "exclude", reason: "모로코 언론·사이트 공통 제목 수집 제외" };
  }

  // 1) Iraqi armed groups conducting attacks are security, even when the target is outside Iraq.
  if (iraqiArmedActor && attack) {
    return { action: "reclassify", category: "security", reason: "이라크 민병대·무장세력의 공격 및 군사행동이 기사 핵심" };
  }

  // 2) US-Iran war, Houthis, Red Sea, Hormuz and regional escalation stay international.
  if (regionalWar && !iraqiArmedActor) {
    return { action: "reclassify", category: "international", reason: "미국-이란 전쟁·후티·홍해·호르무즈 등 주변국 국제정세가 기사 핵심" };
  }

  // 3) Domestic Iraqi attacks and incidents are security before any economy keyword check.
  if (textHasIraq && attack) {
    return { action: "reclassify", category: "security", reason: "이라크 관련 공격·군사·치안 사건이 경제 요소보다 우선" };
  }

  // 4) Iraqi official diplomatic reaction is politics.
  if (textHasIraq && politics) {
    return { action: "reclassify", category: "politics", reason: "이라크 정부·기관의 공식 외교·정책 입장이 기사 핵심" };
  }

  // 5) Economy only when finance, construction, investment or budget is the core subject.
  if (textHasIraq && economyCore) {
    return { action: "reclassify", category: "economy", reason: "이라크 금융·투자·건설·예산이 기사 핵심" };
  }

  const pureForeignDomestic = hasAny(text, PURE_FOREIGN_DOMESTIC)
    && hasAny(text, PURE_DOMESTIC_ACTIONS)
    && !textHasIraq
    && !regionalWar;
  if (pureForeignDomestic) return { action: "exclude", reason: "이라크 연계가 없는 순수 해외 국내 기사" };

  if (current === "international" || regionalWar) {
    return { action: "retain", reason: "이라크 주변국·국제정세 기사로 국제사회 유지" };
  }

  return { action: "keep", reason: "기존 카테고리 유지" };
}

const payload = JSON.parse(await fs.readFile(ARTICLES_FILE, "utf8"));
const articles = Array.isArray(payload.articles) ? payload.articles : [];
const retained = [];
const excluded = [];
const reclassified = [];

for (const article of articles) {
  const result = routeArticle(article);
  if (result.action === "exclude") {
    excluded.push({ articleId: article.articleId || article.article?.articleId || null, titleArabic: getTitle(article), articleUrl: getUrl(article), reason: result.reason });
    continue;
  }
  if (result.action === "reclassify" && result.category !== getCategory(article)) {
    const updated = setCategory(article, result.category);
    retained.push({ ...updated, categoryRouting: { from: getCategory(article), to: result.category, reason: result.reason, method: "EVENT_PRIORITY_RULES_V3" } });
    reclassified.push({ titleArabic: getTitle(article), from: getCategory(article), to: result.category, reason: result.reason });
    continue;
  }
  retained.push({ ...article, relevanceNote: result.reason });
}

const categoryCounts = retained.reduce((acc, item) => {
  const category = getCategory(item);
  acc[category] = (acc[category] || 0) + 1;
  return acc;
}, {});

await fs.writeFile(ARTICLES_FILE, `${JSON.stringify({
  ...payload,
  generatedAt: new Date().toISOString(),
  count: retained.length,
  categoryCounts,
  internationalRun: {
    inputCount: articles.length,
    retainedInternationalCount: retained.filter((item) => getCategory(item) === "international").length,
    reclassifiedCount: reclassified.length,
    excludedCount: excluded.length,
    method: "EVENT_PRIORITY_RULES_V3"
  },
  articles: retained
}, null, 2)}\n`, "utf8");

await fs.writeFile(SUMMARY_FILE, `${JSON.stringify({ schemaVersion: "3.0", generatedAt: new Date().toISOString(), reclassified, excluded }, null, 2)}\n`, "utf8");
console.log(`[category-router] reclassified=${reclassified.length}, international=${retained.filter((item) => getCategory(item) === "international").length}, excluded=${excluded.length}`);
