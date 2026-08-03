#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const ARTICLES_FILE = path.resolve(
  process.env.STRICT_GATE_ARTICLES_FILE || path.join(ROOT, "data", "articles.json")
);
const SUMMARY_FILE = path.resolve(
  process.env.STRICT_GATE_SUMMARY_FILE || path.join(ROOT, "data", "strict-category-gate-summary.json")
);
const PRIMARY_LEAD_CHARS = Number(process.env.STRICT_GATE_PRIMARY_LEAD_CHARS || 700);

function normalizeArabic(value = "") {
  return String(value)
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/\u0640/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[“”"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function hasAny(text = "", terms = []) {
  const normalized = normalizeArabic(text);
  return terms.some((term) => normalized.includes(normalizeArabic(term)));
}

function hasNicAcronym(text = "") {
  return /(?:^|[^a-z0-9])nic(?:[^a-z0-9]|$)/i.test(String(text));
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
  "العراق", "العراقي", "العراقية", "عراقي", "عراقية", "بغداد", "البصرة", "الموصل", "كركوك", "الانبار",
  "اربيل", "السليمانية", "كربلاء", "النجف", "ديالى", "صلاح الدين", "نينوى", "ذي قار",
  "ميسان", "واسط", "بابل", "الديوانية", "المثنى", "دهوك", "كردستان العراق", "iraq", "iraqi"
];
const IRAQ_INSTITUTIONS = [
  "رئيس الوزراء العراقي", "رئيس مجلس الوزراء العراقي", "الحكومة العراقية", "مجلس الوزراء العراقي",
  "مجلس النواب العراقي", "البرلمان العراقي", "رئاسة الجمهورية العراقية", "وزارة الخارجية العراقية",
  "وزارة المالية العراقية", "وزارة التخطيط العراقية", "وزارة النفط العراقية",
  "وزارة الاعمار والاسكان", "وزارة الاعمار والاسكان والبلديات العامة",
  "وزارة الاعمار والاسكان والبلديات والاشغال العامة", "دائرة الطرق والجسور",
  "البنك المركزي العراقي", "القضاء العراقي", "المحكمة الاتحادية",
  "الاطار التنسيقي", "هيئة النزاهة", "الهيئة الوطنية للاستثمار", "القوات العراقية",
  "الجيش العراقي", "الشرطة العراقية", "جهاز الامن الوطني", "الحشد الشعبي"
];
const BISMAYAH = [
  "بسماية", "بسمايه", "مدينة بسماية الجديدة", "مشروع بسماية",
  "bismayah", "bismaya", "bncp"
];
const HANWHA = [
  "شركة هانوا", "هانوا", "hanwha", "한화"
];
const NIC = [
  "الهيئة الوطنية للاستثمار", "هيئة الاستثمار الوطنية", "رئيس الهيئة الوطنية للاستثمار",
  "national investment commission", "iraq national investment commission",
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
const INTERNATIONAL_DIRECT_MARKET = [
  "مضيق هرمز", "هرمز", "اسعار النفط العالمية", "اسعار النفط", "سعر النفط العالمي", "سعر النفط",
  "برنت", "خام برنت", "دبي الخام", "ازمة النفط"
];
const INTERNATIONAL_OIL_ROUTE = [
  "تصدير النفط", "صادرات النفط", "طرق تصدير النفط", "ناقلات النفط", "امدادات النفط"
];
const INTERNATIONAL_ROUTE_CONTEXT = [
  "الخليج", "مضيق", "البحر الاحمر", "باب المندب", "قناة السويس", "الملاحة"
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

function hasStrongIraqInstitution(text = "") {
  return hasAny(text, IRAQ_INSTITUTIONS)
    || hasAny(text, BISMAYAH)
    || hasAny(text, NIC)
    || hasNicAcronym(text);
}

function iraqRelevance(title, lead) {
  const opening = String(lead || "").slice(0, PRIMARY_LEAD_CHARS);
  const titleHasIraq = hasAny(title, IRAQ_CORE) || hasStrongIraqInstitution(title);
  const openingHasInstitution = hasStrongIraqInstitution(opening);
  const openingHasIraq = hasAny(opening, IRAQ_CORE);
  const foreignPrimaryTitle = hasAny(title, FOREIGN_PLACES) && !titleHasIraq;
  const primary = titleHasIraq
    || openingHasInstitution
    || (!foreignPrimaryTitle && openingHasIraq);

  return {
    primary,
    titleHasIraq,
    openingHasInstitution,
    openingHasIraq,
    foreignPrimaryTitle
  };
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
      method: "STRICT_CATEGORY_GATE_V2"
    }
  };
}

function evaluate(article) {
  const title = getTitle(article);
  const lead = cleanLead(article);
  const opening = lead.slice(0, PRIMARY_LEAD_CHARS);
  const text = `${title}\n${lead}`;
  const current = getCategory(article);
  const keywordId = getKeywordId(article);

  if (!title || normalizeArabic(title).length < 10) {
    return { action: "exclude", reason: "제목 정보 부족" };
  }
  if (hasAny(title, NOISE)) {
    return { action: "exclude", reason: "스포츠·연예·생활·목록형 기사" };
  }

  const relevance = iraqRelevance(title, lead);
  const isFullText = article.contentStatus === "FULL_TEXT";
  const bismayahMatch = hasAny(text, BISMAYAH)
    || (!isFullText && /^bismayah-/i.test(keywordId));
  const nicMatch = hasAny(text, NIC)
    || hasNicAcronym(text)
    || (!isFullText && /(?:^|-)nic(?:-|$)/i.test(keywordId));
  const hanwhaIraqMatch = hasAny(text, HANWHA) && hasAny(text, IRAQ_CORE);

  if (bismayahMatch || nicMatch || hanwhaIraqMatch) {
    return { action: "keep", category: "bismayah", reason: "비스마야·NIC·NIC 의장 또는 한화+이라크 직접 관련" };
  }

  if (["politics", "economy", "security"].includes(current) && !relevance.primary) {
    const reason = relevance.foreignPrimaryTitle
      ? `${current} 카테고리이나 해외 사건이 제목의 주제이고 이라크 핵심 연관은 본문 부수 언급에 그침`
      : `${current} 카테고리이나 제목·본문 도입부에 이라크 직접 연관 없음`;
    return { action: "exclude", reason };
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
    if (relevance.foreignPrimaryTitle && !relevance.titleHasIraq && !relevance.openingHasInstitution) {
      return { action: "exclude", reason: "해외에서 발생한 테러·치안 사건" };
    }
    if (!hasAny(text, SECURITY)) return { action: "exclude", reason: "이라크 치안 사건 신호 부족" };
    return { action: "keep", category: "security", reason: "이라크 내 테러·치안·바그다드 시위 직접 관련" };
  }

  if (current === "international") {
    if (!hasAny(text, INTERNATIONAL) && !relevance.primary) {
      return { action: "exclude", reason: "지정 국제사회 키워드 및 이라크 직접 연결 불일치" };
    }
    const internationalOpening = `${title}\n${opening}`;
    const strategicMarketLink = hasAny(internationalOpening, INTERNATIONAL_DIRECT_MARKET)
      || (hasAny(internationalOpening, INTERNATIONAL_OIL_ROUTE)
        && hasAny(internationalOpening, INTERNATIONAL_ROUTE_CONTEXT));
    if (!relevance.primary && !strategicMarketLink) {
      return { action: "exclude", reason: "이라크 직접 영향 또는 호르무즈·국제유가 연결이 없는 해외 지역기사" };
    }
    return {
      action: "keep",
      category: "international",
      reason: relevance.primary
        ? "이라크와 직접 연결된 국제정세"
        : "호르무즈·국제유가를 통한 이라크 사업 직접 영향"
    };
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
const excludedReasonCounts = excluded.reduce((acc, article) => {
  acc[article.reason] = (acc[article.reason] || 0) + 1;
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
  schemaVersion: "1.1",
  generatedAt,
  before: articles.length,
  retained: retained.length,
  excludedCount: excluded.length,
  primaryLeadChars: PRIMARY_LEAD_CHARS,
  method: "STRICT_CATEGORY_GATE_V2",
  categoryCounts,
  excludedReasonCounts,
  excluded
}, null, 2)}\n`, "utf8");

console.log(`[strict-category-gate] before=${articles.length} retained=${retained.length} excluded=${excluded.length}`);
console.log(`[strict-category-gate] counts=${JSON.stringify(categoryCounts)}`);
console.log(`[strict-category-gate] excludedReasons=${JSON.stringify(excludedReasonCounts)}`);
