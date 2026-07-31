#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const ARTICLES_FILE = path.join(ROOT, "data", "articles.json");
const SUMMARY_FILE = path.join(ROOT, "data", "security-summary.json");

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
function firstMatched(text = "", terms = []) {
  return terms.find((term) => hasAny(text, [term])) || "";
}
function getCategory(article = {}) { return article.analysis?.category || article.category || ""; }
function getTitle(article = {}) { return article.article?.originalTitleArabic || article.originalTitleArabic || ""; }
function getBody(article = {}) { return article.article?.originalTextArabic || article.originalTextArabic || ""; }
function getUrl(article = {}) { return article.article?.articleUrl || article.articleUrl || ""; }

const SITE_BOILERPLATE = [
  "آخر الأخبار العاجلة في العراق وكوردستان والعالم",
  "اخبار العراق وكوردستان والعالم",
  "أخبار العراق وكوردستان والعالم",
  "شفق نيوز"
];

const IRAQ_LOCATIONS = [
  "العراق", "داخل العراق", "بغداد", "بسماية", "المدائن", "النهروان", "مطار بغداد",
  "نينوى", "الموصل", "الأنبار", "الرمادي", "الفلوجة", "كركوك", "ديالى", "بعقوبة",
  "صلاح الدين", "تكريت", "سامراء", "بابل", "الحلة", "كربلاء", "النجف", "البصرة",
  "ميسان", "العمارة", "ذي قار", "الناصرية", "واسط", "الكوت", "المثنى", "السماوة",
  "القادسية", "الديوانية", "أربيل", "السليمانية", "دهوك", "حلبجة"
];

const IRAQ_SECURITY_AUTHORITIES = [
  "القوات الأمنية العراقية", "وزارة الداخلية العراقية", "جهاز مكافحة الإرهاب العراقي",
  "قيادة العمليات المشتركة", "الشرطة الاتحادية العراقية", "الجيش العراقي",
  "الشرطة العراقية", "الحشد الشعبي", "الأمن الوطني العراقي", "الاستخبارات العراقية"
];

const FOREIGN_LOCATIONS = [
  "سوريا", "السوري", "درعا", "حماة", "ريف حماة", "ريف درعا", "دمشق", "حلب", "حمص",
  "إدلب", "دير الزور", "الحسكة", "الرقة", "اللاذقية", "طرطوس", "السويداء",
  "لبنان", "الأردن", "تركيا", "إيران", "فلسطين", "غزة", "إسرائيل", "السعودية",
  "الإمارات", "الكويت", "البحرين", "قطر", "اليمن", "مصر", "ليبيا", "السودان",
  "باكستان", "أفغانستان", "الهند", "الصومال", "نيجيريا"
];

const ATTACK_SIGNALS = [
  "هجوم", "هجمات", "هجوم مسلح", "هجوم إرهابي", "ضربة", "ضربات", "قصف", "غارة",
  "انفجار", "تفجير", "مخلفات حربية", "لغم", "ألغام", "اغتيال", "اشتباك", "إطلاق نار",
  "استهداف", "صاروخ", "صواريخ", "طائرة مسيرة", "طائرات مسيرة", "مسيّرات",
  "عبوة ناسفة", "داعش", "خلية إرهابية", "عملية أمنية", "اعتقال إرهابي"
];

const NON_INCIDENT_SIGNALS = [
  "فيلم", "مسلسل", "لعبة", "وثائقي", "ذكرى تاريخية", "تحليل تاريخي",
  "إطلاق نار احتفالي", "تدريب عسكري", "وقفة تضامنية سلمية"
];

function cleanText(value = "") {
  let cleaned = String(value);
  for (const phrase of SITE_BOILERPLATE) cleaned = cleaned.replaceAll(phrase, " ");
  return cleaned.replace(/\s+/g, " ").trim();
}

function incidentType(text = "") {
  const rules = [
    ["SUICIDE_BOMBING", "자살폭탄테러", ["تفجير انتحاري", "هجوم انتحاري", "حزام ناسف"]],
    ["IED_MINE", "IED·지뢰", ["عبوة ناسفة", "انفجار عبوة", "لغم", "ألغام", "مخلفات حربية"]],
    ["ASSASSINATION", "암살", ["اغتيال", "محاولة اغتيال"]],
    ["MISSILE_DRONE_ATTACK", "미사일·드론 공격", ["طائرة مسيرة", "طائرات مسيرة", "مسيّرات", "صاروخ", "صواريخ"]],
    ["ARMED_ATTACK", "무장세력공격", ["هجوم", "هجمات", "هجوم مسلح", "ضربة", "قصف", "غارة", "استهداف"]],
    ["SHOOTING", "총격", ["إطلاق نار", "اشتباك مسلح"]],
    ["OTHER_SECURITY", "기타 치안", ["داعش", "خلية إرهابية", "عملية أمنية", "اعتقال إرهابي", "تهريب أسلحة"]]
  ];
  for (const [type, labelKo, terms] of rules) {
    const matchedTerm = firstMatched(text, terms);
    if (matchedTerm) return { type, labelKo, matchedTerm };
  }
  return null;
}

function validateSecurityArticle(article) {
  const title = cleanText(getTitle(article));
  const lead = cleanText(getBody(article).slice(0, 3500));
  const primaryText = `${title}\n${lead}`;

  const iraqLocation = firstMatched(primaryText, IRAQ_LOCATIONS);
  const iraqAuthority = firstMatched(primaryText, IRAQ_SECURITY_AUTHORITIES);
  const foreignLocation = firstMatched(primaryText, FOREIGN_LOCATIONS);

  if (hasAny(primaryText, NON_INCIDENT_SIGNALS)) {
    return { ok: false, reason: "실제 치안사건이 아닌 문화·역사·훈련성 콘텐츠" };
  }
  if (!hasAny(primaryText, ATTACK_SIGNALS)) {
    return { ok: false, reason: "공격·폭발·테러·치안 사건 신호가 확인되지 않음" };
  }

  // 해외 발생지가 확인되면, 제목·도입부에 이라크 발생지가 명확하지 않은 한 제외한다.
  if (foreignLocation && !iraqLocation) {
    return { ok: false, reason: `이라크 밖에서 발생한 치안사건 제외: ${foreignLocation}` };
  }

  // 테러·치안에는 이라크 발생지 또는 이라크 치안기관이 실제 사건 주체로 확인된 기사만 허용한다.
  if (!iraqLocation && !iraqAuthority) {
    return { ok: false, reason: "사건 발생지가 이라크로 확인되지 않음" };
  }

  const incident = incidentType(primaryText);
  if (!incident) {
    return { ok: false, reason: "구체적인 치안사건 유형을 확인할 수 없음" };
  }

  return {
    ok: true,
    incident: {
      ...incident,
      locationSignal: iraqLocation || null,
      authoritySignal: iraqAuthority || null,
      classificationMethod: "IRAQ_OCCURRENCE_ONLY_V3"
    }
  };
}

const payload = JSON.parse(await fs.readFile(ARTICLES_FILE, "utf8"));
const articles = Array.isArray(payload.articles) ? payload.articles : [];
const retained = [];
const excluded = [];

for (const article of articles) {
  if (getCategory(article) !== "security") {
    retained.push(article);
    continue;
  }

  const result = validateSecurityArticle(article);
  if (!result.ok) {
    excluded.push({
      articleId: article.articleId || article.article?.articleId || null,
      titleArabic: getTitle(article),
      articleUrl: getUrl(article),
      reason: result.reason
    });
    continue;
  }

  retained.push({
    ...article,
    securityIncident: result.incident,
    relevanceNote: `이라크 발생 안보사건 확인: ${result.incident.labelKo}`
  });
}

const securityArticles = retained.filter((item) => getCategory(item) === "security");
const typeCounts = securityArticles.reduce((acc, item) => {
  const key = item.securityIncident?.type || "UNCLASSIFIED";
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});
const categoryCounts = retained.reduce((acc, item) => {
  const key = getCategory(item);
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});

await fs.writeFile(ARTICLES_FILE, `${JSON.stringify({
  ...payload,
  generatedAt: new Date().toISOString(),
  count: retained.length,
  categoryCounts,
  securityRun: {
    inputCount: articles.filter((item) => getCategory(item) === "security").length,
    retainedCount: securityArticles.length,
    excludedCount: excluded.length,
    typeCounts,
    method: "IRAQ_OCCURRENCE_ONLY_V3"
  },
  articles: retained
}, null, 2)}\n`, "utf8");

await fs.writeFile(SUMMARY_FILE, `${JSON.stringify({
  schemaVersion: "3.0",
  generatedAt: new Date().toISOString(),
  total: securityArticles.length,
  typeCounts,
  excluded
}, null, 2)}\n`, "utf8");

console.log(`[security] retained=${securityArticles.length}, excluded=${excluded.length}, method=IRAQ_OCCURRENCE_ONLY_V3`, typeCounts);
