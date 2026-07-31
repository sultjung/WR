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
function countAny(text = "", terms = []) {
  const normalized = normalizeArabic(text);
  return terms.reduce((sum, term) => sum + (normalized.includes(normalizeArabic(term)) ? 1 : 0), 0);
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

const IRAQ_GENERAL = [
  "العراق", "العراقي", "العراقية", "بغداد", "الأجواء العراقية", "الحدود العراقية"
];
const IRAQ_SUBJECTS = [
  "الحكومة العراقية", "رئيس الوزراء العراقي", "رئيس مجلس الوزراء العراقي", "مجلس الوزراء العراقي",
  "مجلس النواب العراقي", "البرلمان العراقي", "وزارة الخارجية العراقية", "وزارة المالية العراقية",
  "وزارة التخطيط العراقية", "وزارة النفط العراقية", "البنك المركزي العراقي", "المصارف العراقية",
  "الهيئة الوطنية للاستثمار", "القوات العراقية", "الحشد الشعبي", "المليشيات العراقية",
  "الميليشيات العراقية", "الفصائل العراقية", "المقاومة العراقية"
];
const IRAQI_ARMED_ACTORS = [
  "المليشيات العراقية", "الميليشيات العراقية", "الفصائل العراقية", "فصائل عراقية",
  "الحشد الشعبي", "المقاومة الإسلامية في العراق", "كتائب حزب الله", "النجباء",
  "عصائب أهل الحق", "جماعات عراقية مسلحة"
];
const SECURITY_SIGNALS = [
  "هجوم", "هجمات", "ضربة", "ضربات", "قصف", "غارة", "غارات", "انفجار", "اغتيال",
  "اشتباك", "استهداف", "طائرات مسيرة", "مسيّرات", "صواريخ", "مقذوفات", "إطلاق نار",
  "داعش", "إرهاب", "عملية أمنية", "اعتقال إرهابي", "تسلل", "تصعيد عسكري", "عملية عسكرية"
];
const ECONOMY_STRONG = [
  "اتفاقية اقتصادية", "اتفاق اقتصادي", "اتفاقية تجارية", "اتفاق تجاري", "شراكة اقتصادية",
  "تبادل تجاري", "حجم التجارة", "استثمار", "استثمارات", "عقد استثماري", "عقود استثمارية",
  "تمويل", "قرض", "ائتمان", "الموازنة", "العجز", "البنك المركزي", "مصرف", "مصارف",
  "تحويلات الدولار", "امتثال مصرفي", "مشروع سكني", "مشاريع سكنية", "إعمار", "بنى تحتية",
  "طريق التنمية", "ممر تجاري", "سكك حديد", "ربط كهربائي", "تصدير النفط", "صادرات النفط",
  "إمدادات الغاز", "اتفاقية طاقة", "مشروع طاقة", "منطقة صناعية", "منطقة حرة", "رسوم جمركية"
];
const ECONOMY_ACTIONS = [
  "وقع", "توقيع", "أبرم", "إبرام", "اتفق", "اتفاق", "اعتماد", "تمويل", "استثمار",
  "تنفيذ", "إنشاء", "تطوير", "زيادة", "رفع حجم", "تسهيل التجارة"
];
const POLITICS_SIGNALS = [
  "اجتمع", "التقى", "لقاء", "مباحثات", "بحث العلاقات", "تعزيز العلاقات", "زيارة رسمية",
  "يدين", "أدان", "إدانة", "يرفض", "استنكر", "موقف رسمي", "بيان الحكومة",
  "بيان الخارجية", "وزارة الخارجية", "استدعى السفير", "علاقات دبلوماسية", "اتفاق سياسي",
  "مجلس الوزراء", "رئيس الوزراء", "البرلمان", "سيادة العراق", "تنسيق سياسي"
];
const REGIONAL_INTERNATIONAL = [
  "الحرب بين إيران وإسرائيل", "الحرب الإيرانية الإسرائيلية", "إيران وإسرائيل",
  "الولايات المتحدة وإيران", "الحرب مع إيران", "حرب إيران", "هجوم على إيران", "ضربة على إيران",
  "انسحاب الولايات المتحدة من حرب إيران", "اتساع نطاق المهمة", "مضيق هرمز", "إغلاق مضيق هرمز",
  "الخليج", "دول الخليج", "البحر الأحمر", "باب المندب", "الحوثي", "الحوثيين",
  "هجمات حوثية", "أمن الملاحة", "حرية الملاحة", "ناقلات النفط", "طرق الشحن",
  "تصعيد إقليمي", "توتر إقليمي", "إغلاق الأجواء", "تعليق الرحلات", "قوات أميركية",
  "الحرب الإقليمية", "العقوبات الأميركية", "مفاوضات نووية", "وساطة عمان"
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
  const lead = body.slice(0, 2400);
  const text = `${title}\n${body.slice(0, 7000)}`;
  const titleLead = `${title}\n${lead}`;
  const current = getCategory(article);

  if (isMoroccoSource(article, title)) {
    return { action: "exclude", reason: "모로코 언론 또는 사이트 공통 제목 기사 제외" };
  }

  const titleHasIraq = hasAny(title, [...IRAQ_GENERAL, ...IRAQ_SUBJECTS]);
  const leadHasIraqSubject = hasAny(titleLead, IRAQ_SUBJECTS);
  const iraqMentions = countAny(titleLead, [...IRAQ_GENERAL, ...IRAQ_SUBJECTS]);
  const iraqIsCore = titleHasIraq || leadHasIraqSubject || iraqMentions >= 2;

  const armedActor = hasAny(titleLead, IRAQI_ARMED_ACTORS);
  const security = hasAny(titleLead, SECURITY_SIGNALS);
  const economyStrength = countAny(titleLead, ECONOMY_STRONG);
  const economyAction = hasAny(titleLead, ECONOMY_ACTIONS);
  const economyIsCore = economyStrength >= 2 || (economyStrength >= 1 && economyAction);
  const politics = hasAny(titleLead, POLITICS_SIGNALS);
  const regionalInternational = hasAny(text, REGIONAL_INTERNATIONAL);

  // 이라크 민병대·무장세력의 공격은 발생 장소와 관계없이 이라크 안보로 분류한다.
  if (armedActor && security) {
    return { action: "reclassify", category: "security", reason: "이라크 민병대·무장세력의 공격 또는 군사행동이 핵심" };
  }

  // 이라크가 기사의 실질적 주체라면 안보 → 경제 → 정치 순으로 중심 주제를 판정한다.
  if (iraqIsCore) {
    if (security) {
      return { action: "reclassify", category: "security", reason: "이라크가 핵심 주체이며 공격·군사·치안 사건이 중심" };
    }
    if (economyIsCore) {
      return { action: "reclassify", category: "economy", reason: "이라크가 핵심 주체이며 경제협약·투자·금융·건설·에너지가 중심" };
    }
    if (politics) {
      return { action: "reclassify", category: "politics", reason: "이라크 정부·정치권의 회담·외교·정책 행위가 중심" };
    }
    return { action: "reclassify", category: "politics", reason: "이라크 정부·국가기관이 핵심 주체인 일반 정무 기사" };
  }

  // 이라크가 실질적 주체가 아닌 주변국 전쟁·해운·제재 기사는 국제사회로 유지한다.
  if (regionalInternational || current === "international") {
    return { action: "reclassify", category: "international", reason: "이라크가 핵심 주체가 아닌 주변국·글로벌 국제정세" };
  }

  const pureForeignDomestic = hasAny(text, PURE_FOREIGN_DOMESTIC)
    && hasAny(text, PURE_DOMESTIC_ACTIONS)
    && !hasAny(text, IRAQ_GENERAL)
    && !regionalInternational;
  if (pureForeignDomestic) {
    return { action: "exclude", reason: "이라크 연계가 없는 순수 해외 국내 기사" };
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
    excluded.push({
      articleId: article.articleId || article.article?.articleId || null,
      titleArabic: getTitle(article),
      articleUrl: getUrl(article),
      reason: result.reason
    });
    continue;
  }
  if (result.action === "reclassify" && result.category !== getCategory(article)) {
    const updated = setCategory(article, result.category);
    retained.push({
      ...updated,
      categoryRouting: {
        from: getCategory(article),
        to: result.category,
        reason: result.reason,
        method: "IRAQ_SUBJECT_TOPIC_RULES_V4"
      }
    });
    reclassified.push({
      titleArabic: getTitle(article),
      from: getCategory(article),
      to: result.category,
      reason: result.reason
    });
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
    method: "IRAQ_SUBJECT_TOPIC_RULES_V4"
  },
  articles: retained
}, null, 2)}\n`, "utf8");

await fs.writeFile(SUMMARY_FILE, `${JSON.stringify({
  schemaVersion: "4.0",
  generatedAt: new Date().toISOString(),
  reclassified,
  excluded
}, null, 2)}\n`, "utf8");

console.log(`[category-router] reclassified=${reclassified.length}, international=${retained.filter((item) => getCategory(item) === "international").length}, excluded=${excluded.length}`);
