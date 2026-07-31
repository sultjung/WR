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
function firstMatched(text = "", terms = []) { return terms.find((term) => hasAny(text, [term])) || ""; }
function getCategory(article = {}) { return article.analysis?.category || article.category || ""; }
function getTitle(article = {}) { return article.article?.originalTitleArabic || article.originalTitleArabic || ""; }
function getBody(article = {}) { return article.article?.originalTextArabic || article.originalTextArabic || ""; }
function getUrl(article = {}) { return article.article?.articleUrl || article.articleUrl || ""; }

const IRAQ_ANCHORS = [
  "العراق", "العراقي", "العراقية", "بغداد", "نينوى", "الموصل", "الأنبار", "كركوك",
  "ديالى", "صلاح الدين", "البصرة", "أربيل", "السليمانية", "الحشد الشعبي",
  "القوات الأمنية العراقية", "وزارة الداخلية العراقية", "جهاز مكافحة الإرهاب العراقي",
  "قيادة العمليات المشتركة", "الشرطة الاتحادية العراقية"
];
const IRAQI_ARMED_ACTORS = [
  "المليشيات العراقية", "الميليشيات العراقية", "الفصائل العراقية", "فصائل عراقية",
  "الحشد الشعبي", "المقاومة الإسلامية في العراق", "كتائب حزب الله", "النجباء",
  "عصائب أهل الحق", "جماعات عراقية مسلحة"
];
const FOREIGN_LOCATION_ANCHORS = [
  "سوريا", "لبنان", "الأردن", "تركيا", "إيران", "فلسطين", "غزة", "إسرائيل",
  "السعودية", "الخليج", "الإمارات", "الكويت", "البحرين", "قطر", "اليمن",
  "البحر الأحمر", "باب المندب", "مصر", "ليبيا", "السودان", "تونس", "الجزائر", "المغرب"
];
const ATTACK_SIGNALS = [
  "هجوم", "هجمات", "هجوم مسلح", "هجوم إرهابي", "ضربة", "ضربات", "قصف", "غارة",
  "انفجار", "تفجير", "اغتيال", "اشتباك", "إطلاق نار", "استهداف", "صاروخ", "صواريخ",
  "طائرة مسيرة", "طائرات مسيرة", "مسيّرات", "عبوة ناسفة", "داعش", "خلية إرهابية"
];
const NON_INCIDENT_SIGNALS = [
  "فيلم", "مسلسل", "لعبة", "وثائقي", "ذكرى تاريخية", "تحليل تاريخي",
  "إطلاق نار احتفالي", "تدريب عسكري", "وقفة تضامنية سلمية"
];

function incidentType(text = "") {
  const rules = [
    ["SUICIDE_BOMBING", "자살폭탄테러", ["تفجير انتحاري", "هجوم انتحاري", "حزام ناسف"]],
    ["IED", "IED", ["عبوة ناسفة", "انفجار عبوة", "تفكيك عبوة"]],
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
  const title = getTitle(article);
  const body = getBody(article);
  const primaryText = `${title}\n${body.slice(0, 3500)}`;
  const iraqSignal = firstMatched(primaryText, IRAQ_ANCHORS);
  const iraqiActor = firstMatched(primaryText, IRAQI_ARMED_ACTORS);
  const foreignSignal = firstMatched(primaryText, FOREIGN_LOCATION_ANCHORS);

  if (hasAny(primaryText, NON_INCIDENT_SIGNALS)) return { ok: false, reason: "실제 치안사건이 아닌 문화·역사·훈련성 콘텐츠" };
  if (!hasAny(primaryText, ATTACK_SIGNALS)) return { ok: false, reason: "공격·폭발·미사일·드론·무장행동 신호가 확인되지 않음" };

  // Iraqi armed groups attacking abroad are retained as Iraqi security developments.
  if (!iraqSignal && !iraqiActor) {
    return { ok: false, reason: foreignSignal ? `이라크 주체가 없는 해외 치안사건: ${foreignSignal}` : "이라크 장소·기관·무장주체 확인 불가" };
  }

  const incident = incidentType(primaryText);
  if (!incident) return { ok: false, reason: "구체적인 치안사건 유형을 확인할 수 없음" };

  return {
    ok: true,
    incident: {
      ...incident,
      locationSignal: iraqSignal || null,
      iraqiArmedActor: iraqiActor || null,
      foreignTargetSignal: foreignSignal || null,
      classificationMethod: iraqiActor && foreignSignal
        ? "IRAQI_ACTOR_CROSS_BORDER_SECURITY"
        : "IRAQ_SECURITY_TITLE_AND_LEAD"
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
    excluded.push({ articleId: article.articleId || article.article?.articleId || null, titleArabic: getTitle(article), articleUrl: getUrl(article), reason: result.reason });
    continue;
  }
  retained.push({ ...article, securityIncident: result.incident, relevanceNote: `이라크 안보사건 확인: ${result.incident.labelKo}` });
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
    method: "IRAQI_ACTOR_SECURITY_V2"
  },
  articles: retained
}, null, 2)}\n`, "utf8");

await fs.writeFile(SUMMARY_FILE, `${JSON.stringify({
  schemaVersion: "2.0",
  generatedAt: new Date().toISOString(),
  total: securityArticles.length,
  typeCounts,
  excluded
}, null, 2)}\n`, "utf8");
console.log(`[security] retained=${securityArticles.length}, excluded=${excluded.length}`, typeCounts);
