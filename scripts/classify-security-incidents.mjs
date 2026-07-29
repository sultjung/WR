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

const IRAQ_ANCHORS = [
  "العراق", "العراقي", "بغداد", "نينوى", "الموصل", "الأنبار", "الرمادي", "الفلوجة",
  "كركوك", "ديالى", "بعقوبة", "صلاح الدين", "تكريت", "سامراء", "بابل", "الحلة",
  "كربلاء", "النجف", "البصرة", "ميسان", "العمارة", "ذي قار", "الناصرية",
  "واسط", "الكوت", "المثنى", "السماوة", "الديوانية", "أربيل", "السليمانية", "دهوك",
  "القوات الأمنية العراقية", "وزارة الداخلية العراقية", "جهاز مكافحة الإرهاب العراقي",
  "الحشد الشعبي", "قيادة العمليات المشتركة", "الشرطة الاتحادية العراقية"
];

const FOREIGN_LOCATION_ANCHORS = [
  "سوريا", "السوري", "الأمن السوري", "دير الزور", "دمشق", "حلب", "حمص", "الحسكة", "الرقة", "إدلب",
  "لبنان", "اللبناني", "بيروت", "طرابلس لبنان", "صيدا", "البقاع",
  "الأردن", "الأردني", "عمان", "الزرقاء", "إربد",
  "تركيا", "التركي", "أنقرة", "إسطنبول",
  "إيران", "الإيراني", "طهران",
  "فلسطين", "غزة", "الضفة الغربية", "إسرائيل", "الإسرائيلي",
  "السعودية", "اليمن", "مصر", "ليبيا", "السودان", "تونس", "الجزائر", "المغرب"
];

const INCIDENT_RULES = [
  {
    type: "SUICIDE_BOMBING",
    labelKo: "자살폭탄테러",
    terms: ["تفجير انتحاري", "هجوم انتحاري", "انتحاري", "حزام ناسف"]
  },
  {
    type: "IED",
    labelKo: "IED",
    terms: ["عبوة ناسفة", "انفجار عبوة", "تفكيك عبوة", "عبوة محلية الصنع"]
  },
  {
    type: "ASSASSINATION",
    labelKo: "암살",
    terms: ["اغتيال", "محاولة اغتيال", "مسلحون مجهولون اغتالوا"]
  },
  {
    type: "PROTEST",
    labelKo: "시위",
    terms: ["تظاهرات", "احتجاجات", "اعتصام", "متظاهرون", "قوات مكافحة الشغب"]
  },
  {
    type: "ARMED_ATTACK",
    labelKo: "무장세력공격",
    terms: ["هجوم مسلح", "هجوم إرهابي", "اعتداء مسلح", "داعش هاجم", "تعرضت لهجوم"]
  },
  {
    type: "SHOOTING",
    labelKo: "총격",
    terms: ["إطلاق نار", "هجوم بالرصاص", "اشتباك مسلح", "مسلحون فتحوا النار"]
  },
  {
    type: "OTHER_SECURITY",
    labelKo: "기타 치안",
    terms: ["داعش", "خلية إرهابية", "عملية أمنية", "اعتقال إرهابي", "إحباط تسلل", "قوات الحدود", "تهريب أسلحة"]
  }
];

const NON_INCIDENT_SIGNALS = [
  "فيلم", "مسلسل", "لعبة", "وثائقي", "ذكرى تاريخية", "تحليل تاريخي",
  "إطلاق نار احتفالي", "تدريب عسكري", "وقفة تضامنية سلمية"
];

function classifyIncident(text = "", fallbackType = "") {
  for (const rule of INCIDENT_RULES) {
    const matchedTerm = firstMatched(text, rule.terms);
    if (matchedTerm) return { type: rule.type, labelKo: rule.labelKo, matchedTerm };
  }
  if (fallbackType) {
    const rule = INCIDENT_RULES.find((item) => item.type === fallbackType);
    if (rule) return { type: rule.type, labelKo: rule.labelKo, matchedTerm: "keyword-config" };
  }
  return null;
}

function extractNumbers(text = "") {
  const normalized = String(text).replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
  const casualties = [];
  const patterns = [
    /(?:مقتل|قتل|استشهاد)\s+(\d+)/g,
    /(?:إصابة|اصابة|جرح)\s+(\d+)/g,
    /(?:اعتقال|القبض على)\s+(\d+)/g
  ];
  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) casualties.push(match[0]);
  }
  return [...new Set(casualties)].slice(0, 8);
}

function validateSecurityArticle(article) {
  const title = String(article.originalTitleArabic || "");
  const body = String(article.originalTextArabic || "");
  const lead = body.slice(0, 2200);
  const primaryText = `${title}\n${lead}`;
  const fullText = `${title}\n${body}`;

  const iraqSignal = firstMatched(primaryText, IRAQ_ANCHORS);
  const foreignSignal = firstMatched(primaryText, FOREIGN_LOCATION_ANCHORS);
  const foreignInTitle = firstMatched(title, FOREIGN_LOCATION_ANCHORS);
  const iraqInTitle = firstMatched(title, IRAQ_ANCHORS);

  if (foreignInTitle && !iraqInTitle) {
    return { ok: false, reason: `해외 치안사건 제외: ${foreignInTitle}` };
  }
  if (foreignSignal && !iraqSignal) {
    return { ok: false, reason: `기사 도입부의 사건 발생지가 이라크가 아님: ${foreignSignal}` };
  }
  if (!iraqSignal) {
    return { ok: false, reason: "제목·기사 도입부에서 이라크 장소·기관·치안 주체가 확인되지 않음" };
  }
  if (hasAny(primaryText, NON_INCIDENT_SIGNALS)) {
    return { ok: false, reason: "실제 치안사건이 아닌 문화·역사·훈련성 콘텐츠" };
  }

  const incident = classifyIncident(primaryText, article.incidentType || "");
  if (!incident) {
    return { ok: false, reason: "기사 제목·도입부에서 공격·폭발·암살·시위·총격·대테러 작전 신호가 확인되지 않음" };
  }

  return {
    ok: true,
    incident: {
      ...incident,
      locationSignal: iraqSignal,
      factSignals: extractNumbers(primaryText),
      classificationMethod: "RULE_BASED_ARABIC_TITLE_AND_LEAD",
      foreignLocationSignal: foreignSignal || null,
      fullTextIraqMention: hasAny(fullText, IRAQ_ANCHORS)
    }
  };
}

const payload = JSON.parse(await fs.readFile(ARTICLES_FILE, "utf8"));
const articles = Array.isArray(payload.articles) ? payload.articles : [];
const retained = [];
const excluded = [];

for (const article of articles) {
  if (article.category !== "security") {
    retained.push(article);
    continue;
  }
  const result = validateSecurityArticle(article);
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
    securityIncident: result.incident,
    relevanceNote: `이라크 치안사건 확인: ${result.incident.labelKo}`
  });
}

const securityArticles = retained.filter((item) => item.category === "security");
const typeCounts = securityArticles.reduce((acc, item) => {
  const key = item.securityIncident?.type || "UNCLASSIFIED";
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
  securityRun: {
    inputCount: articles.filter((item) => item.category === "security").length,
    retainedCount: securityArticles.length,
    excludedCount: excluded.length,
    typeCounts
  },
  articles: retained
}, null, 2)}\n`, "utf8");

await fs.writeFile(SUMMARY_FILE, `${JSON.stringify({
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  total: securityArticles.length,
  typeCounts,
  reportTable: {
    total: securityArticles.length,
    armedAttack: typeCounts.ARMED_ATTACK || 0,
    ied: typeCounts.IED || 0,
    assassination: typeCounts.ASSASSINATION || 0,
    protest: typeCounts.PROTEST || 0,
    shooting: typeCounts.SHOOTING || 0,
    suicideBombing: typeCounts.SUICIDE_BOMBING || 0,
    otherSecurity: typeCounts.OTHER_SECURITY || 0
  },
  excluded
}, null, 2)}\n`, "utf8");

console.log(`[security] retained=${securityArticles.length}, excluded=${excluded.length}`, typeCounts);
