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
  const normalized = normalizeArabic(text);
  return terms.some((term) => normalized.includes(normalizeArabic(term)));
}

function countAny(text = "", terms = []) {
  const normalized = normalizeArabic(text);
  return terms.reduce((sum, term) => sum + (normalized.includes(normalizeArabic(term)) ? 1 : 0), 0);
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
  return article.analysis?.category || article.category || "";
}
function setCategory(article = {}, category, reason) {
  const next = { ...article, category };
  next.analysis = {
    ...(article.analysis && typeof article.analysis === "object" ? article.analysis : {}),
    category
  };
  next.categoryRouting = {
    ...(article.categoryRouting && typeof article.categoryRouting === "object" ? article.categoryRouting : {}),
    from: getCategory(article),
    to: category,
    reason,
    method: "FINAL_CATEGORY_ROUTING_V1"
  };
  return next;
}

// 기사 하단의 관련기사·메뉴 문구가 분류에 끼어들지 않도록 제목과 도입부만 사용한다.
function getLead(article = {}) {
  const body = getBody(article)
    .replace(/اقرأ ايضا[\s\S]*$/i, " ")
    .replace(/مواضيع ذات صله[\s\S]*$/i, " ")
    .replace(/قد يهمك[\s\S]*$/i, " ")
    .replace(/تابع ايضا[\s\S]*$/i, " ")
    .replace(/إعلان[\s\S]*$/i, " ")
    .replace(/share-nodes[\s\S]*$/i, " ");
  return body.slice(0, 1800);
}

const IRAQ = [
  "العراق", "العراقي", "العراقية", "بغداد", "البصرة", "الموصل", "كركوك", "الانبار",
  "اربيل", "السليمانية", "كربلاء", "النجف", "ديالى", "صلاح الدين", "نينوى", "ذي قار",
  "ميسان", "واسط", "بابل", "الديوانية", "المثنى", "دهوك"
];
const IRAQ_OFFICIAL = [
  "رئيس الوزراء", "رئيس مجلس الوزراء", "مجلس الوزراء", "مجلس النواب", "البرلمان",
  "رئاسة الجمهورية", "وزارة الخارجية", "وزارة المالية", "وزارة التخطيط", "وزارة النفط",
  "البنك المركزي العراقي", "الحكومة العراقية", "القضاء العراقي", "المحكمة الاتحادية",
  "الاطار التنسيقي", "هيئة النزاهة", "الهيئة الوطنية للاستثمار"
];
const BISMAYAH_STRONG = [
  "بسماية", "بسمايه", "مدينة بسماية", "مدينة بسمايه", "مشروع بسماية", "مشروع بسمايه",
  "مدينة بسماية الجديدة", "هانوا", "شركة هانوا", "hanwha", "bismayah"
];
const NIC_SIGNALS = [
  "الهيئة الوطنية للاستثمار", "هيئة الاستثمار الوطنية", "رئيس الهيئة الوطنية للاستثمار",
  "رئيسا للهيئة الوطنية للاستثمار", "عادل الياسري", "حيدر مكية"
];
const ECONOMY = [
  "استثمار", "استثمارات", "مشروع", "مشاريع", "اعمار", "بنى تحتية", "اسكان", "سكني",
  "مدينة سكنية", "عقد", "عقود", "تمويل", "قرض", "موازنة", "ميزانية", "عجز", "مصرف",
  "مصارف", "البنك المركزي", "دولار", "تجارة", "تصدير", "استيراد", "نفط", "غاز",
  "طاقة", "كهرباء", "مطار", "مطارات", "طريق التنمية", "سكك حديد", "ميناء", "جمارك",
  "تعرفة", "شركة", "شركات", "قطاع خاص", "فرص العمل", "اقتصاد"
];
const ECONOMY_ACTIONS = [
  "وقع", "توقيع", "ابرم", "اتفاق", "اطلق", "افتتح", "تنفيذ", "تطوير", "تمويل",
  "استثمار", "انشاء", "استكمال", "تخصيص", "رفع العقوبات", "متطلبات الفيدرالي"
];
const POLITICS = [
  "اجتماع", "اجتمع", "التقى", "مباحثات", "زيارة رسمية", "بيان", "ادان", "يدين",
  "استنكر", "يرفض", "موقف", "قرار", "قرارات", "صوت", "تصويت", "جلسة البرلمان",
  "مجلس الوزراء", "مجلس النواب", "رئيس الوزراء", "رئيس الجمهورية", "وزير", "تعيين",
  "تكليف", "اقالة", "استقالة", "انتخابات", "كتلة", "تحالف", "الاطار التنسيقي",
  "السيادة", "مجلس الامن", "المحكمة الدولية", "علاقات دبلوماسية"
];
const SECURITY_INCIDENT = [
  "انفجار", "عبوة ناسفة", "عبوة متفجرة", "لغم", "هجوم مسلح", "اطلاق نار", "اغتيال",
  "قتل", "مقتل", "اصابة", "اشتباك", "قصف", "غارة", "ضربة جوية", "صاروخ", "صواريخ",
  "طائرة مسيرة", "طائرات مسيرة", "مسيّرة", "مسيّرات", "تفجير انتحاري", "حزام ناسف",
  "داعش", "ارهابي", "ارهابيين", "خلية ارهابية", "عملية امنية", "اعتقال", "احباط هجوم"
];
const OFFICIAL_RESPONSE = [
  "يدين", "ادان", "استنكر", "يرفض", "بيان", "اجتماع طارئ", "موقف", "بحث",
  "مجلس الامن", "المحكمة الدولية", "انتهاك السيادة", "دعا", "طالب", "حذر"
];
const INTERNATIONAL = [
  "ايران", "اسرائيل", "الولايات المتحدة", "واشنطن", "السعودية", "الخليج", "لبنان",
  "سوريا", "اليمن", "الحوثي", "البحر الاحمر", "باب المندب", "مضيق هرمز", "الامم المتحدة",
  "العقوبات الاميركية", "الحرب الاقليمية", "التصعيد الاقليمي", "الملاحة الدولية"
];
const FOREIGN_LOCATIONS = [
  "سوريا", "درعا", "حمص", "حلب", "دمشق", "لبنان", "بيروت", "غزة", "فلسطين", "اسرائيل",
  "ايران", "طهران", "ايرانشهر", "اليمن", "صنعاء", "السعودية", "مصر", "القاهرة", "الاردن",
  "عمان", "الكويت", "قطر", "الامارات", "دبي", "البحرين", "تركيا", "باكستان", "كشمير",
  "كينيا", "الصومال", "كولومبيا", "المغرب", "تونس", "الجزائر", "السودان"
];
const NOISE = [
  "كرة القدم", "مباراة", "الدوري", "لاعب", "ريال مدريد", "برشلونة", "نتائج المباريات",
  "مسلسل", "فنان", "ممثلة", "اغنية", "ابراج", "حظك اليوم", "وصفة", "طبخ", "موضة",
  "اهم عناوين", "اخر الاخبار", "اخبار عاجلة", "ملخص الاخبار", "نشرة الاخبار"
];
const LOCAL_INCIDENT = [
  "انفجار", "قتل", "مقتل", "اصابة", "اطلاق نار", "هجوم", "اغتيال", "حادث", "اشتباك",
  "عبوة", "لغم", "اعتقال", "سرقة", "سطو"
];

function classify(article) {
  const title = getTitle(article);
  const lead = getLead(article);
  const titleLead = `${title}\n${lead}`;
  const titleNorm = normalizeArabic(title);

  if (!titleNorm || titleNorm.length < 10) {
    return { action: "exclude", reason: "제목 정보 부족" };
  }

  if (hasAny(title, NOISE)) {
    return { action: "exclude", reason: "스포츠·연예·생활정보 또는 뉴스목록형 제목" };
  }

  const iraqInTitle = hasAny(title, IRAQ);
  const iraqCore = iraqInTitle || hasAny(titleLead, IRAQ_OFFICIAL) || countAny(titleLead, IRAQ) >= 2;
  const bismayahStrong = hasAny(titleLead, BISMAYAH_STRONG);
  const nicRelevant = hasAny(titleLead, NIC_SIGNALS);
  const securityIncident = hasAny(titleLead, SECURITY_INCIDENT);
  const officialResponse = hasAny(titleLead, OFFICIAL_RESPONSE) && hasAny(titleLead, IRAQ_OFFICIAL);
  const economyScore = countAny(titleLead, ECONOMY);
  const economyCore = economyScore >= 2 || (economyScore >= 1 && hasAny(titleLead, ECONOMY_ACTIONS));
  const politicsCore = hasAny(titleLead, POLITICS) && (iraqCore || hasAny(titleLead, IRAQ_OFFICIAL));
  const internationalCore = hasAny(titleLead, INTERNATIONAL);
  const foreignLocalIncident = hasAny(titleLead, FOREIGN_LOCATIONS)
    && hasAny(titleLead, LOCAL_INCIDENT)
    && !iraqInTitle
    && !hasAny(titleLead, IRAQ_OFFICIAL)
    && countAny(titleLead, IRAQ) === 0;

  if (foreignLocalIncident) {
    return { action: "exclude", reason: "이라크와 무관한 해외 현지 사건" };
  }

  // 비스마야·한화 직접 언급 및 NIC 핵심 인사는 다른 모든 카테고리보다 우선한다.
  if (bismayahStrong || nicRelevant) {
    return { action: "category", category: "bismayah", reason: "비스마야·한화·국가투자위원회 직접 관련" };
  }

  // 공격 자체가 아니라 정부·정당의 성명·회의·외교대응이 핵심이면 정치권이다.
  if (officialResponse || politicsCore) {
    return { action: "category", category: "politics", reason: "이라크 정부·의회·정당의 결정·회의·공식 대응" };
  }

  // 경제·건설 신호는 위기·제재·공격 단어가 섞여도 경제 중심성이 강하면 우선한다.
  if (iraqCore && economyCore) {
    return { action: "category", category: "economy", reason: "이라크 투자·건설·금융·예산·에너지 중심" };
  }

  // 테러·치안은 이라크가 사건 발생지 또는 직접 당사자이며 실제 사건 동사가 있을 때만 허용한다.
  if (iraqCore && securityIncident) {
    return { action: "category", category: "security", reason: "이라크 내 실제 공격·폭발·암살·치안 사건" };
  }

  if (iraqCore) {
    return { action: "category", category: "politics", reason: "이라크 국가기관·정치권이 핵심 주체" };
  }

  if (internationalCore) {
    return { action: "category", category: "international", reason: "이라크가 핵심 주체가 아닌 주변국·국제 정세" };
  }

  return { action: "exclude", reason: "이라크·비스마야·회사·주요 국제정세 연계 부족" };
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
  const next = setCategory(article, result.category, result.reason);
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

const output = {
  ...payload,
  generatedAt: new Date().toISOString(),
  count: retained.length,
  categoryCounts,
  articles: retained
};

await fs.writeFile(ARTICLES_FILE, `${JSON.stringify(output, null, 2)}\n`, "utf8");
await fs.writeFile(SUMMARY_FILE, `${JSON.stringify({
  schemaVersion: "1.0",
  generatedAt: output.generatedAt,
  before: articles.length,
  retained: retained.length,
  excludedCount: excluded.length,
  changedCount: changed.length,
  categoryCounts,
  changed,
  excluded
}, null, 2)}\n`, "utf8");

console.log(`[category-finalize] before=${articles.length} retained=${retained.length} excluded=${excluded.length} changed=${changed.length}`);
console.log(`[category-finalize] counts=${JSON.stringify(categoryCounts)}`);
