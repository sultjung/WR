#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const ARTICLES_FILE = path.join(ROOT, "data", "articles.json");
const SUMMARY_FILE = path.join(ROOT, "data", "category-routing-summary.json");

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
  const value = normalizeArabic(text);
  return terms.some((term) => value.includes(normalizeArabic(term)));
}
function countAny(text = "", terms = []) {
  const value = normalizeArabic(text);
  return terms.reduce((sum, term) => sum + (value.includes(normalizeArabic(term)) ? 1 : 0), 0);
}
function getTitle(article = {}) {
  return article.article?.originalTitleArabic || article.originalTitleArabic || article.titleArabic || article.translation?.titleArabic || "";
}
function getBody(article = {}) {
  return article.article?.originalTextArabic || article.originalTextArabic || article.fullTextArabic || article.descriptionArabic || "";
}
function getUrl(article = {}) {
  return article.article?.articleUrl || article.articleUrl || article.canonicalUrl || "";
}
function getCategory(article = {}) {
  return article.analysis?.category || article.category || "";
}
function setCategory(article = {}, category, reason, locked = false) {
  const previous = getCategory(article);
  return {
    ...article,
    category,
    analysis: {
      ...(article.analysis && typeof article.analysis === "object" ? article.analysis : {}),
      category
    },
    categoryRouting: {
      ...(article.categoryRouting && typeof article.categoryRouting === "object" ? article.categoryRouting : {}),
      from: previous,
      to: category,
      reason,
      locked,
      method: "FINAL_CATEGORY_ROUTING_V3"
    }
  };
}
function getLead(article = {}) {
  return getBody(article)
    .replace(/اقرأ ايضا[\s\S]*$/i, " ")
    .replace(/مواضيع ذات صله[\s\S]*$/i, " ")
    .replace(/قد يهمك[\s\S]*$/i, " ")
    .replace(/تابع ايضا[\s\S]*$/i, " ")
    .replace(/إعلان[\s\S]*$/i, " ")
    .replace(/share-nodes[\s\S]*$/i, " ")
    .slice(0, 1400);
}

const IRAQ_LOCATIONS = [
  "العراق", "بغداد", "البصرة", "الموصل", "كركوك", "الانبار", "اربيل", "السليمانية",
  "كربلاء", "النجف", "ديالى", "صلاح الدين", "نينوى", "ذي قار", "ميسان", "واسط",
  "بابل", "الديوانية", "المثنى", "دهوك", "سامراء", "الفلوجة", "الرمادي"
];
const IRAQ_OFFICIAL = [
  "الحكومة العراقية", "رئيس الوزراء العراقي", "رئيس مجلس الوزراء", "مجلس الوزراء العراقي",
  "مجلس النواب العراقي", "البرلمان العراقي", "وزارة الخارجية العراقية", "وزارة الداخلية العراقية",
  "وزارة الدفاع العراقية", "القوات العراقية", "الشرطة العراقية", "القضاء العراقي",
  "المحكمة الاتحادية", "الاطار التنسيقي", "هيئة النزاهة"
];
const BISMAYAH = [
  "بسماية", "بسمايه", "مدينة بسماية", "مدينة بسمايه", "مشروع بسماية", "مشروع بسمايه",
  "مدينة بسماية الجديدة", "هانوا", "شركة هانوا", "hanwha", "bismayah"
];
const NIC = [
  "الهيئة الوطنية للاستثمار", "هيئة الاستثمار الوطنية", "رئيس الهيئة الوطنية للاستثمار",
  "رئيسا للهيئة الوطنية للاستثمار", "رئيس هيئة الاستثمار", "عادل الياسري", "عادل داخل الياسري",
  "حيدر مكية", "هيئة الاستثمار العراقية"
];
const FOREIGN_TITLE_LOCATIONS = [
  "سوريا", "درعا", "حماة", "حمص", "حلب", "دمشق", "ادلب", "دير الزور", "اللاذقية",
  "لبنان", "بيروت", "غزة", "فلسطين", "اسرائيل", "ايران", "طهران", "ايرانشهر",
  "اليمن", "صنعاء", "السعودية", "مصر", "القاهرة", "الاردن", "الكويت", "قطر",
  "الامارات", "دبي", "البحرين", "تركيا", "باكستان", "كشمير", "افغانستان", "الهند",
  "كينيا", "الصومال", "كولومبيا", "المغرب", "تونس", "الجزائر", "السودان"
];
const SECURITY = [
  "انفجار", "عبوة ناسفة", "عبوة متفجرة", "لغم", "هجوم مسلح", "اطلاق نار", "اغتيال",
  "قتل", "مقتل", "اصابة", "اشتباك", "قصف", "غارة", "ضربة جوية", "صاروخ", "صواريخ",
  "طائرة مسيرة", "طائرات مسيرة", "مسيّرة", "مسيّرات", "تفجير انتحاري", "حزام ناسف",
  "داعش", "ارهابي", "خلية ارهابية", "عملية امنية", "احباط هجوم"
];
const PROTEST = [
  "تظاهرة", "تظاهرات", "احتجاج", "احتجاجات", "متظاهرون", "محتجون", "اعتصام",
  "قطع الطريق", "اغلاق الطريق", "ساحة التحرير", "المنطقة الخضراء"
];
const BAGHDAD = [
  "بغداد", "ساحة التحرير", "المنطقة الخضراء", "جسر الجمهورية", "الكرادة", "الجادرية",
  "الكاظمية", "الاعظمية", "المنصور", "مدينة الصدر", "الباب الشرقي"
];
const ECONOMY = [
  "استثمار", "استثمارات", "مشروع", "مشاريع", "اعمار", "بنى تحتية", "اسكان", "سكني",
  "عقد", "عقود", "تمويل", "قرض", "موازنة", "ميزانية", "عجز", "مصرف", "مصارف",
  "البنك المركزي", "دولار", "تجارة", "تصدير", "استيراد", "نفط", "غاز", "طاقة",
  "كهرباء", "مطار", "مطارات", "طريق التنمية", "سكك حديد", "ميناء", "جمارك",
  "شركة", "شركات", "قطاع خاص", "اقتصاد"
];
const ECON_ACTION = [
  "وقع", "توقيع", "ابرم", "اتفاق", "اطلق", "افتتح", "تنفيذ", "تطوير", "تمويل",
  "استثمار", "انشاء", "استكمال", "تخصيص", "رفع العقوبات"
];
const POLITICS = [
  "اجتماع", "اجتمع", "التقى", "مباحثات", "زيارة رسمية", "بيان", "ادان", "يدين",
  "استنكر", "يرفض", "موقف", "قرار", "تصويت", "جلسة البرلمان", "مجلس الوزراء",
  "مجلس النواب", "رئيس الوزراء", "رئيس الجمهورية", "وزير", "تعيين", "تكليف", "اقالة",
  "استقالة", "انتخابات", "كتلة", "تحالف", "الاطار التنسيقي", "السيادة", "مجلس الامن"
];
const INTERNATIONAL = [
  "ايران", "اسرائيل", "الولايات المتحدة", "واشنطن", "السعودية", "الخليج", "الحوثي",
  "البحر الاحمر", "باب المندب", "مضيق هرمز", "الامم المتحدة", "الحرب الاقليمية",
  "التصعيد الاقليمي", "الملاحة الدولية"
];
const NOISE = [
  "كرة القدم", "مباراة", "الدوري", "لاعب", "ريال مدريد", "برشلونة", "مسلسل", "فنان",
  "ممثلة", "اغنية", "ابراج", "حظك اليوم", "وصفة", "طبخ", "موضة", "اهم عناوين",
  "ملخص الاخبار", "نشرة الاخبار"
];

function classify(article) {
  const title = getTitle(article);
  const lead = getLead(article);
  const text = `${title}\n${lead}`;
  const current = getCategory(article);

  if (!normalizeArabic(title) || normalizeArabic(title).length < 10) {
    return { action: "exclude", reason: "제목 정보 부족" };
  }
  if (hasAny(title, NOISE)) {
    return { action: "exclude", reason: "스포츠·연예·생활정보 또는 뉴스목록형 기사" };
  }

  // 제목에 해외 발생지가 명시된 현지 사건은 사이트 소개문구에 العراق가 있어도 무조건 제외한다.
  const foreignIncidentInTitle = hasAny(title, FOREIGN_TITLE_LOCATIONS) && hasAny(title, SECURITY);
  const explicitIraqConnectionInTitle = hasAny(title, IRAQ_LOCATIONS) || hasAny(title, IRAQ_OFFICIAL);
  if (foreignIncidentInTitle && !explicitIraqConnectionInTitle) {
    return { action: "exclude", reason: "제목상 이라크 밖에서 발생한 테러·치안 사건" };
  }

  // 기존 수집 키워드·카테고리까지 포함해 NIC/Bismayah 기사를 가장 먼저 잠근다.
  const nicOrBismayah = hasAny(text, [...BISMAYAH, ...NIC])
    || current === "bismayah"
    || String(article.keywordId || "").includes("bismayah")
    || String(article.keywordId || "").includes("nic");
  if (nicOrBismayah) {
    return { action: "category", category: "bismayah", reason: "비스마야·한화·NIC 직접 관련", locked: true };
  }

  const iraqInTitle = hasAny(title, IRAQ_LOCATIONS) || hasAny(title, IRAQ_OFFICIAL);
  const iraqInLead = hasAny(lead, IRAQ_OFFICIAL) || countAny(lead, IRAQ_LOCATIONS) >= 2;
  const iraqCore = iraqInTitle || iraqInLead;
  const baghdadProtest = hasAny(text, PROTEST) && hasAny(text, BAGHDAD);
  const economyScore = countAny(text, ECONOMY);
  const economyCore = economyScore >= 2 || (economyScore >= 1 && hasAny(text, ECON_ACTION));
  const politicalAction = hasAny(text, POLITICS) && (iraqCore || hasAny(text, IRAQ_OFFICIAL));
  const actualSecurity = hasAny(title, SECURITY) || (hasAny(lead.slice(0, 700), SECURITY) && iraqCore);

  if (baghdadProtest) {
    return { action: "category", category: "security", reason: "바그다드에서 실제 발생한 시위·집회·도로통제" };
  }
  if (politicalAction && !hasAny(title, SECURITY)) {
    return { action: "category", category: "politics", reason: "이라크 정부·의회·정당의 결정·회의·공식 대응" };
  }
  if (iraqCore && economyCore) {
    return { action: "category", category: "economy", reason: "이라크 투자·건설·금융·예산·에너지 중심" };
  }
  if (iraqCore && actualSecurity) {
    return { action: "category", category: "security", reason: "이라크 내 실제 테러·폭발·암살·치안 사건" };
  }
  if (iraqCore) {
    return { action: "category", category: "politics", reason: "이라크 국가기관·정치권이 핵심 주체" };
  }
  if (hasAny(text, INTERNATIONAL)) {
    return { action: "category", category: "international", reason: "이라크가 핵심 주체가 아닌 주요 국제정세" };
  }
  return { action: "exclude", reason: "이라크·비스마야·NIC·주요 국제정세 연계 부족" };
}

const payload = JSON.parse(await fs.readFile(ARTICLES_FILE, "utf8"));
const articles = Array.isArray(payload.articles) ? payload.articles : [];
const retained = [];
const excluded = [];
const changed = [];

for (const article of articles) {
  const result = classify(article);
  if (result.action === "exclude") {
    excluded.push({
      articleId: article.articleId || article.article?.articleId || null,
      titleArabic: getTitle(article),
      articleUrl: getUrl(article),
      previousCategory: getCategory(article),
      reason: result.reason
    });
    continue;
  }
  const previous = getCategory(article);
  const next = setCategory(article, result.category, result.reason, Boolean(result.locked));
  retained.push(next);
  if (previous !== result.category) {
    changed.push({
      articleId: article.articleId || article.article?.articleId || null,
      titleArabic: getTitle(article),
      from: previous,
      to: result.category,
      reason: result.reason
    });
  }
}

const categoryCounts = retained.reduce((counts, article) => {
  const category = getCategory(article) || "unknown";
  counts[category] = (counts[category] || 0) + 1;
  return counts;
}, {});
const generatedAt = new Date().toISOString();
const output = { ...payload, generatedAt, count: retained.length, categoryCounts, articles: retained };
await fs.writeFile(ARTICLES_FILE, `${JSON.stringify(output, null, 2)}\n`, "utf8");
await fs.writeFile(SUMMARY_FILE, `${JSON.stringify({
  schemaVersion: "3.0", generatedAt, before: articles.length, retained: retained.length,
  excludedCount: excluded.length, changedCount: changed.length, categoryCounts, changed, excluded
}, null, 2)}\n`, "utf8");
console.log(`[category-finalize-v3] before=${articles.length} retained=${retained.length} excluded=${excluded.length} changed=${changed.length}`);
console.log(`[category-finalize-v3] counts=${JSON.stringify(categoryCounts)}`);
