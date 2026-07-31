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

function getCategory(article = {}) {
  return article.analysis?.category || article.category || "";
}

function getTitle(article = {}) {
  return article.article?.originalTitleArabic || article.originalTitleArabic || article.titleArabic || "";
}

function getBody(article = {}) {
  return article.article?.originalTextArabic || article.originalTextArabic || article.fullTextArabic || "";
}

function setCategory(article = {}, category = "") {
  const next = { ...article, category };
  if (article.analysis && typeof article.analysis === "object") {
    next.analysis = { ...article.analysis, category };
  }
  return next;
}

const IRAQ_CORE = [
  "العراق", "العراقي", "العراقية", "بغداد", "الحكومة العراقية",
  "مجلس الوزراء العراقي", "رئيس الوزراء العراقي", "رئاسة الوزراء العراقية",
  "مجلس النواب العراقي", "البرلمان العراقي", "وزارة المالية العراقية",
  "وزارة التخطيط العراقية", "البنك المركزي العراقي", "المصارف العراقية",
  "الحشد الشعبي", "القوات العراقية", "الأجواء العراقية", "الحدود العراقية"
];

const ECONOMY_SIGNALS = [
  "مصرف", "مصارف", "البنك المركزي", "الفيدرالي الأميركي", "الخزانة الأميركية",
  "عقوبات", "رفع العقوبات", "تحويلات الدولار", "امتثال مصرفي", "تمويل",
  "استثمار", "تجارة", "تبادل تجاري", "مشروع", "مشاريع", "طريق التنمية",
  "شراكة استراتيجية", "شراكة اقتصادية", "طاقة", "نفط", "غاز", "جيهان",
  "مياه", "إعمار", "بنى تحتية", "نقل", "ممر تجاري", "تنمية"
];

const POLITICS_SIGNALS = [
  "يدين", "أدان", "إدانة", "يرفض", "استنكر", "احتجاج", "موقف رسمي",
  "بيان الحكومة", "بيان الخارجية", "وزارة الخارجية", "استدعى السفير",
  "علاقات دبلوماسية", "مباحثات سياسية", "زيارة رسمية", "اتفاق سياسي",
  "مجلس الوزراء", "رئيس الوزراء", "البرلمان", "قرار حكومي", "سيادة العراق"
];

const SECURITY_SIGNALS = [
  "هجوم", "ضربة", "قصف", "غارة", "انفجار", "اغتيال", "اشتباك", "اعتقال",
  "إرهاب", "داعش", "ضحايا", "قتلى", "جرحى", "عملية أمنية", "طائرات مسيرة",
  "صواريخ", "اختراق أمني", "الحدود", "تسلل"
];

const REGIONAL_HIGH_IMPACT = [
  "الحرب بين إيران وإسرائيل", "الحرب الإيرانية الإسرائيلية", "إيران وإسرائيل",
  "الولايات المتحدة وإيران", "الحرب مع إيران", "هجوم على إيران", "ضربة على إيران",
  "مضيق هرمز", "إغلاق مضيق هرمز", "حرية الملاحة", "أمن الملاحة",
  "ناقلات النفط", "أسعار النفط", "سوق النفط", "توتر إقليمي", "تصعيد إقليمي",
  "إغلاق الأجواء", "تعليق الرحلات", "أمن الطاقة", "الخليج", "سلطنة عمان",
  "وساطة عمان", "سياسة عمان", "سوريا", "مخيم الهول", "الحدود السورية",
  "البحر الأحمر", "باب المندب", "طرق الشحن", "سلاسل الإمداد", "العقوبات الأميركية"
];

const CROSS_BORDER_IMPACT = [
  "ملاحة", "شحن", "ناقلات", "نفط", "غاز", "طاقة", "طيران", "أجواء",
  "رحلات", "حدود", "مياه", "تجارة إقليمية", "عقوبات", "قوات أميركية",
  "تحالف دولي", "تصعيد", "حرب", "وساطة", "مفاوضات نووية"
];

const IRAQ_IMPACT = [
  "تأثير على العراق", "ينعكس على العراق", "يهدد العراق", "يمس العراق",
  "الأجواء العراقية", "الاقتصاد العراقي", "صادرات النفط العراقية",
  "الملاحة العراقية", "الحدود العراقية", "أمن العراق", "السوق العراقية",
  "الرحلات إلى العراق", "العلاقات مع العراق"
];

const PURE_FOREIGN_DOMESTIC = [
  "حكومة مصر", "مجلس الوزراء المصري", "الرئيس المصري", "القاهرة",
  "الحكومة الأردنية", "مجلس الوزراء الأردني", "الحكومة السعودية",
  "مجلس الوزراء السعودي", "الحكومة الإماراتية", "مجلس الوزراء الإماراتي",
  "الحكومة الكويتية", "الحكومة القطرية", "الحكومة البحرينية"
];

const PURE_DOMESTIC_ACTIONS = [
  "تعيين", "إقالة", "إنشاء مشروع محلي", "افتتاح مشروع محلي", "موازنة محلية",
  "انتخابات محلية", "تعديل وزاري", "قرارات حكومية داخلية"
];

function routeInternationalArticle(article) {
  const title = getTitle(article);
  const body = getBody(article);
  const text = `${title}\n${body.slice(0, 5000)}`;
  const titleHasIraq = hasAny(title, IRAQ_CORE);
  const textHasIraq = hasAny(text, IRAQ_CORE);
  const economy = hasAny(text, ECONOMY_SIGNALS);
  const politics = hasAny(text, POLITICS_SIGNALS);
  const security = hasAny(text, SECURITY_SIGNALS);
  const regionalHighImpact = hasAny(text, REGIONAL_HIGH_IMPACT);
  const crossBorderImpact = hasAny(text, CROSS_BORDER_IMPACT);
  const explicitIraqImpact = hasAny(text, IRAQ_IMPACT);

  if (textHasIraq) {
    if (economy) {
      return { action: "reclassify", category: "economy", reason: "이라크가 핵심 주체이며 금융·교역·투자·에너지·개발 내용이 중심" };
    }
    if (politics || (titleHasIraq && hasAny(title, ["يدين", "أدان", "إدانة", "يرفض", "استنكر"]))) {
      return { action: "reclassify", category: "politics", reason: "이라크 정부·기관의 공식 입장 또는 외교·정책 행위가 중심" };
    }
    if (security) {
      return { action: "reclassify", category: "security", reason: "이라크 내 공격·치안·군사 사건이 중심" };
    }
  }

  const pureForeignDomestic = hasAny(text, PURE_FOREIGN_DOMESTIC)
    && hasAny(text, PURE_DOMESTIC_ACTIONS)
    && !textHasIraq
    && !explicitIraqImpact
    && !regionalHighImpact
    && !crossBorderImpact;

  if (pureForeignDomestic) {
    return { action: "exclude", reason: "이라크 연계가 없는 순수 해외 국내 정치·경제 기사" };
  }

  if (regionalHighImpact) {
    return {
      action: "retain",
      confidence: explicitIraqImpact || textHasIraq ? "HIGH" : "MEDIUM",
      reason: explicitIraqImpact || textHasIraq
        ? "주변국·국제정세가 이라크 안보·물류·에너지에 미치는 영향이 명확"
        : "전쟁·호르무즈·영공·원유·해운 등 이라크 파급 가능성이 큰 고영향 국제정세"
    };
  }

  if (crossBorderImpact) {
    return {
      action: "retain",
      confidence: explicitIraqImpact || textHasIraq ? "HIGH" : "REVIEW",
      reason: explicitIraqImpact || textHasIraq
        ? "국경·에너지·해운·항공·제재 등 이라크 연계 국제이슈"
        : "국경·에너지·해운·항공·제재 관련 국제정세로 검토 가치가 있어 유지"
    };
  }

  return {
    action: "retain",
    confidence: "REVIEW",
    reason: "국제사회 후보 기사로 유지하며 AI 평가 단계에서 최종 관련성을 검토"
  };
}

const payload = JSON.parse(await fs.readFile(ARTICLES_FILE, "utf8"));
const articles = Array.isArray(payload.articles) ? payload.articles : [];
const retained = [];
const excluded = [];
const reclassified = [];

for (const article of articles) {
  if (getCategory(article) !== "international") {
    retained.push(article);
    continue;
  }

  const result = routeInternationalArticle(article);
  if (result.action === "exclude") {
    excluded.push({
      articleId: article.articleId || article.article?.articleId || null,
      titleArabic: getTitle(article),
      articleUrl: article.articleUrl || article.article?.articleUrl || "",
      reason: result.reason
    });
    continue;
  }

  if (result.action === "reclassify") {
    const updated = setCategory(article, result.category);
    retained.push({
      ...updated,
      categoryRouting: {
        from: "international",
        to: result.category,
        reason: result.reason,
        method: "IRAQ_FIRST_RULES"
      }
    });
    reclassified.push({ titleArabic: getTitle(article), to: result.category, reason: result.reason });
    continue;
  }

  retained.push({
    ...article,
    internationalContext: {
      type: "REGIONAL_INDIRECT_IMPACT",
      confidence: result.confidence || "REVIEW",
      classificationMethod: "REGIONAL_IMPACT_RULES"
    },
    relevanceNote: result.reason
  });
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
    inputCount: articles.filter((item) => getCategory(item) === "international").length,
    retainedInternationalCount: retained.filter((item) => getCategory(item) === "international").length,
    reclassifiedCount: reclassified.length,
    excludedCount: excluded.length
  },
  articles: retained
}, null, 2)}\n`, "utf8");

await fs.writeFile(SUMMARY_FILE, `${JSON.stringify({
  schemaVersion: "2.1",
  generatedAt: new Date().toISOString(),
  reclassified,
  excluded
}, null, 2)}\n`, "utf8");

console.log(`[international-router] reclassified=${reclassified.length}, retained=${retained.filter((item) => getCategory(item) === "international").length}, excluded=${excluded.length}`);
