#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const ARTICLES_FILE = path.join(ROOT, "data", "articles.json");
const SUMMARY_FILE = path.join(ROOT, "data", "strict-category-gate-summary.json");

function normalizeArabic(value = "") {
  return String(value)
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/\u0640/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[“”"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasAny(text = "", terms = []) {
  const normalized = normalizeArabic(text);
  return terms.some((term) => normalized.includes(normalizeArabic(term)));
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
function getCategory(article = {}) {
  return article.category || article.analysis?.category || "";
}
function getKeywordId(article = {}) {
  return article.keywordId || article.discovery?.keywordId || "";
}

function cleanLead(article = {}) {
  return getBody(article)
    .replace(/اقرأ ايضا[\s\S]*$/i, " ")
    .replace(/مواضيع ذات صله[\s\S]*$/i, " ")
    .replace(/قد يهمك[\s\S]*$/i, " ")
    .replace(/تابع ايضا[\s\S]*$/i, " ")
    .replace(/إعلان[\s\S]*$/i, " ")
    .replace(/share-nodes[\s\S]*$/i, " ")
    .slice(0, 2200);
}

const IRAQ_CORE = [
  "العراق", "العراقي", "العراقية", "بغداد", "البصرة", "الموصل", "كركوك", "الانبار",
  "اربيل", "السليمانية", "كربلاء", "النجف", "ديالى", "صلاح الدين", "نينوى", "ذي قار",
  "ميسان", "واسط", "بابل", "الديوانية", "المثنى", "دهوك", "كردستان العراق"
];
const IRAQ_INSTITUTIONS = [
  "رئيس الوزراء العراقي", "رئيس مجلس الوزراء العراقي", "الحكومة العراقية", "مجلس الوزراء العراقي",
  "مجلس النواب العراقي", "البرلمان العراقي", "رئاسة الجمهورية العراقية", "وزارة الخارجية العراقية",
  "وزارة المالية العراقية", "وزارة التخطيط العراقية", "وزارة النفط العراقية",
  "وزارة الاعمار والاسكان", "البنك المركزي العراقي", "القضاء العراقي", "المحكمة الاتحادية",
  "الاطار التنسيقي", "هيئة النزاهة", "الهيئة الوطنية للاستثمار", "القوات العراقية",
  "الجيش العراقي", "الشرطة العراقية", "جهاز الامن الوطني", "الحشد الشعبي"
];
const BISMAYAH = [
  "بسماية", "بسمايه", "مدينة بسماية الجديدة", "مشروع بسماية", "شركة هانوا", "هانوا",
  "bismayah", "hanwha"
];
const NIC = [
  "الهيئة الوطنية للاستثمار", "هيئة الاستثمار الوطنية", "رئيس الهيئة الوطنية للاستثمار",
  "عادل الياسري", "عادل داخل الياسري", "حيدر مكية"
];
const POLITICS = [
  "رئيس الوزراء", "مجلس الوزراء", "مجلس النواب", "البرلمان", "الاطار التنسيقي", "انتخابات",
  "تشكيل الحكومة", "تعيين", "تكليف", "اقالة", "استقالة", "تصويت", "جلسة", "قرار",
  "بيان", "اجتماع", "مباحثات", "زيارة رسمية", "وزارة الخارجية", "هيئة النزاهة",
  "المحكمة الاتحادية", "السيادة", "حصر السلاح بيد الدولة"
];
const ECONOMY = [
  "اقتصاد", "استثمار", "استثمارات", "مشروع", "مشاريع", "اعمار", "اسكان", "سكني",
  "مدينة سكنية", "بنى تحتية", "عقد", "عقود", "تمويل", "قرض", "موازنة", "ميزانية",
  "مصرف", "مصارف", "البنك المركزي", "دولار", "تجارة", "تصدير", "استيراد", "نفط",
  "غاز", "طاقة", "كهرباء", "مطار", "مطارات", "طريق التنمية", "سكك حديد", "ميناء",
  "جمارك", "اعفاءات جمركية", "مقاولين", "مستحقات المقاولين", "المشاريع المتلكئة"
];
const SECURITY = [
  "انفجار", "تفجير", "عبوة ناسفة", "لغم", "هجوم", "هجوم مسلح", "اطلاق نار", "اغتيال",
  "اشتباك", "قصف", "غارة", "صاروخ", "صواريخ", "طائرة مسيرة", "مسيّرات", "داعش",
  "ارهاب", "ارهابي", "عملية امنية", "اعتقال", "احباط هجوم", "قتل", "مقتل", "اصابة",
  "تظاهرة", "تظاهرات", "احتجاج", "احتجاجات", "متظاهرون", "اعتصام", "قطع الطريق",
  "اغلاق الطريق", "ساحة التحرير", "المنطقة الخضراء"
];
const INTERNATIONAL = [
  "حرب ايران", "الحرب مع ايران", "ايران والولايات المتحدة", "ايران واسرائيل", "الولايات المتحدة وايران",
  "مضيق هرمز", "الخليج", "دول الخليج", "البحر الاحمر", "باب المندب", "الحوثي", "الحوثيين",
  "امن الملاحة", "ناقلات النفط", "طرق الشحن", "تصعيد اقليمي", "حرب اقليمية", "العقوبات الاميركية",
  "مفاوضات نووية", "اسعار النفط العالمية", "برنت", "خام برنت", "دبي الخام"
];
const FOREIGN_PLACES = [
  "سوريا", "درعا", "حماة", "حمص", "حلب", "دمشق", "لبنان", "بيروت", "فلسطين", "غزة",
  "ايران", "طهران", "اليمن", "صنعاء", "السعودية", "مصر", "القاهرة", "الاردن", "الكويت",
  "قطر", "الامارات", "دبي", "البحرين", "تركيا", "باكستان", "كشمير", "افغانستان", "كينيا",
  "الصومال", "كولومبيا", "المغرب", "تونس", "الجزائر", "السودان", "الهند"
];
const NOISE = [
  "كرة القدم", "مباراة", "الدوري", "لاعب", "ريال مدريد", "برشلونة", "مسلسل", "فنان",
  "ممثلة", "اغنية", "ابراج", "حظك اليوم", "وصفة", "طبخ", "موضة", "اهم عناوين",
  "ملخص الاخبار", "نشرة الاخبار", "اخبار المغرب العاجلة"
];

function hasDirectIraqLink(title, lead) {
  const titleLead = `${title}\n${lead}`;
  return hasAny(title, IRAQ_CORE)
    || hasAny(titleLead, IRAQ_INSTITUTIONS)
    || hasAny(titleLead, BISMAYAH)
    || hasAny(titleLead, NIC);
}

function setLockedCategory(article, category, reason) {
  return {
    ...article,
    category,
    analysis: {
      ...(article.analysis && typeof article.analysis === "object" ? article.analysis : {}),
      category
    },
    categoryRouting: {
      from: getCategory(article),
      to: category,
      reason,
      locked: true,
      method: "STRICT_CATEGORY_GATE_V1"
    }
  };
}

function evaluate(article) {
  const title = getTitle(article);
  const lead = cleanLead(article);
  const text = `${title}\n${lead}`;
  const current = getCategory(article);
  const keywordId = getKeywordId(article);

  if (!title || normalizeArabic(title).length < 10) {
    return { action: "exclude", reason: "제목 정보 부족" };
  }
  if (hasAny(title, NOISE)) {
    return { action: "exclude", reason: "스포츠·연예·생활·목록형 기사" };
  }

  const directIraq = hasDirectIraqLink(title, lead);
  const bismayahMatch = hasAny(text, BISMAYAH) || /^bismayah-/i.test(keywordId);
  const nicMatch = hasAny(text, NIC) || /(?:^|-)nic(?:-|$)/i.test(keywordId);

  if (bismayahMatch || nicMatch) {
    return { action: "keep", category: "bismayah", reason: "비스마야·한화·NIC 직접 관련" };
  }

  if (["politics", "economy", "security"].includes(current) && !directIraq) {
    return { action: "exclude", reason: `${current} 카테고리이나 이라크 직접 연관 없음` };
  }

  if (current === "politics") {
    if (!hasAny(text, POLITICS)) return { action: "exclude", reason: "이라크 정치 핵심 사건 신호 부족" };
    return { action: "keep", category: "politics", reason: "이라크 정치·정부·의회 직접 관련" };
  }

  if (current === "economy") {
    if (!hasAny(text, ECONOMY)) return { action: "exclude", reason: "이라크 경제·건설 핵심 신호 부족" };
    return { action: "keep", category: "economy", reason: "이라크 경제·건설·투자 직접 관련" };
  }

  if (current === "security") {
    if (hasAny(title, FOREIGN_PLACES) && !hasAny(title, IRAQ_CORE)) {
      return { action: "exclude", reason: "해외에서 발생한 테러·치안 사건" };
    }
    if (!hasAny(text, SECURITY)) return { action: "exclude", reason: "이라크 치안 사건 신호 부족" };
    return { action: "keep", category: "security", reason: "이라크 내 테러·치안·바그다드 시위 직접 관련" };
  }

  if (current === "international") {
    if (!hasAny(text, INTERNATIONAL)) return { action: "exclude", reason: "지정 국제사회 키워드 불일치" };
    return { action: "keep", category: "international", reason: "지정 주변국·국제정세 키워드 일치" };
  }

  return { action: "exclude", reason: "허용된 카테고리 또는 키워드 규칙 불일치" };
}

const payload = JSON.parse(await fs.readFile(ARTICLES_FILE, "utf8"));
const articles = Array.isArray(payload.articles) ? payload.articles : [];
const retained = [];
const excluded = [];

for (const article of articles) {
  const result = evaluate(article);
  if (result.action === "exclude") {
    excluded.push({
      articleId: article.articleId || article.article?.articleId || null,
      titleArabic: getTitle(article),
      articleUrl: getUrl(article),
      category: getCategory(article),
      keywordId: getKeywordId(article),
      reason: result.reason
    });
    continue;
  }
  retained.push(setLockedCategory(article, result.category, result.reason));
}

const categoryCounts = retained.reduce((acc, article) => {
  acc[article.category] = (acc[article.category] || 0) + 1;
  return acc;
}, {});
const generatedAt = new Date().toISOString();

await fs.writeFile(ARTICLES_FILE, `${JSON.stringify({
  ...payload,
  generatedAt,
  count: retained.length,
  categoryCounts,
  articles: retained
}, null, 2)}\n`, "utf8");

await fs.writeFile(SUMMARY_FILE, `${JSON.stringify({
  schemaVersion: "1.0",
  generatedAt,
  before: articles.length,
  retained: retained.length,
  excludedCount: excluded.length,
  categoryCounts,
  excluded
}, null, 2)}\n`, "utf8");

console.log(`[strict-category-gate] before=${articles.length} retained=${retained.length} excluded=${excluded.length}`);
console.log(`[strict-category-gate] counts=${JSON.stringify(categoryCounts)}`);
