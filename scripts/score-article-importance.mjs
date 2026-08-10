#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { starsForScore } from "./importance-category-rules.mjs";

const ROOT = process.cwd();
const ARTICLES_FILE = path.join(ROOT, "data", "articles.json");

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

function countMatches(text = "", terms = []) {
  const normalized = normalizeArabic(text);
  return terms.reduce((count, term) => count + (normalized.includes(normalizeArabic(term)) ? 1 : 0), 0);
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function recordOf(article = {}) {
  return article.article && typeof article.article === "object" ? article.article : article;
}

function categoryOf(article = {}) {
  return String(article.analysis?.category || article.category || recordOf(article).category || "").toLowerCase();
}

function articleText(article = {}) {
  const record = recordOf(article);
  return [
    record.originalTitleArabic,
    article.originalTitleArabic,
    record.descriptionArabic,
    article.descriptionArabic,
    record.originalTextArabic,
    article.originalTextArabic,
    article.translation?.titleKo,
    article.translation?.previewKo,
    article.translation?.fullTextKo
  ].filter(Boolean).join("\n");
}

function articleUrlOf(article = {}) {
  const record = recordOf(article);
  return record.articleUrl || article.articleUrl || record.canonicalUrl || article.canonicalUrl || "";
}

function articleBodyOf(article = {}) {
  const record = recordOf(article);
  return record.originalTextArabic || article.originalTextArabic || "";
}

const RELIABLE_SOURCES = [
  "وكالة الأنباء العراقية", "واع", "مجلس الوزراء", "مجلس النواب", "رئاسة الوزراء",
  "البنك المركزي العراقي", "وزارة", "شفق نيوز", "السومرية", "شبكة 964", "الجزيرة",
  "رويترز", "فرانس برس", "أسوشيتد برس", "CNN Arabic", "Kurdistan24"
];

const DECISION_SIGNALS = [
  "قرار", "قرارات", "توجيه", "توجيهات", "تصويت", "قانون", "مرسوم", "اتفاق", "مذكرة تفاهم",
  "إقرار", "اعتماد", "تنفيذ", "تخصيص", "تمويل", "إقالة", "إعفاء", "تعيين", "استقالة"
];

function sourceScore(article, text) {
  const source = `${article.sourceArabic || ""} ${article.source?.arabicName || ""}`;
  const url = articleUrlOf(article);
  const body = articleBodyOf(article);
  if (hasAny(`${source}\n${text}`, ["بيان رسمي", "أعلن مكتب رئيس الوزراء", "ذكرت الدائرة الإعلامية"])) return 10;
  if (hasAny(source, RELIABLE_SOURCES)) return 8;
  if (url && body.length >= 500) return 6;
  if (url) return 4;
  return 1;
}

function levelOf(score) {
  if (score >= 90) return { code: "URGENT", labelKo: "긴급", reportStatus: "IMMEDIATE_REVIEW" };
  if (score >= 80) return { code: "IMPORTANT", labelKo: "중요", reportStatus: "PRIORITY_REVIEW" };
  if (score >= 70) return { code: "NOTABLE", labelKo: "주목", reportStatus: "REVIEW" };
  if (score >= 60) return { code: "REFERENCE", labelKo: "참고", reportStatus: "OPTIONAL_REVIEW" };
  if (score >= 40) return { code: "GENERAL", labelKo: "일반", reportStatus: "REFERENCE_ONLY" };
  return { code: "LOW", labelKo: "낮음", reportStatus: "EXCLUDE" };
}

function scoreBismayah(article, text) {
  const directBismayah = hasAny(text, ["بسماية", "مدينة بسماية الجديدة", "مشروع بسماية"]);
  const hanwha = hasAny(text, ["شركة هانوا", "هانوا", "Hanwha"]);
  const nic = hasAny(text, ["الهيئة الوطنية للاستثمار", "رئيس الهيئة الوطنية للاستثمار"]);
  const business = countMatches(text, ["استئناف المشروع", "استكمال المشروع", "العقد", "مستحقات", "دفعات", "تمويل", "ضمان", "تنفيذ", "وحدات سكنية", "تسليم", "صيانة"]);
  const government = hasAny(text, ["رئيس الوزراء", "مجلس الوزراء", "مكتب رئيس الوزراء"]);
  let relevance = 0;
  if (directBismayah && hanwha) relevance = 50;
  else if (directBismayah && nic) relevance = 47;
  else if (directBismayah) relevance = 42;
  else if (hanwha && nic) relevance = 38;
  else if (nic) relevance = 25;
  const projectImpact = clamp(business * 5 + (government ? 5 : 0), 0, 25);
  const reportValue = clamp((hasAny(text, DECISION_SIGNALS) ? 8 : 2) + (business >= 2 ? 7 : 2), 0, 15);
  return { relevance, projectImpact, reportValue };
}

function scorePolitics(article, text) {
  const national = ["رئيس الوزراء", "مجلس الوزراء", "مجلس النواب", "المحكمة الاتحادية", "رئاسة الجمهورية", "الإطار التنسيقي"];
  const senior = ["وزير", "رئيس الهيئة الوطنية للاستثمار", "محافظ البنك المركزي", "رئيس مجلس النواب"];
  const policy = ["تشكيل الحكومة", "التشكيلة الوزارية", "الموازنة", "قانون الاستثمار", "عقد حكومي", "مكافحة الفساد", "حصر السلاح", "إقالة", "تعيين"];
  const business = ["الهيئة الوطنية للاستثمار", "مشاريع الإسكان", "العقود الاستثمارية", "الاستثمار الأجنبي", "شركة أجنبية", "بسماية"];
  let nationalImportance = 5;
  if (hasAny(text, national) && hasAny(text, policy)) nationalImportance = 40;
  else if (hasAny(text, national) && hasAny(text, DECISION_SIGNALS)) nationalImportance = 34;
  else if (hasAny(text, senior) && hasAny(text, DECISION_SIGNALS)) nationalImportance = 28;
  else if (hasAny(text, national)) nationalImportance = 20;
  else if (hasAny(text, senior)) nationalImportance = 12;
  const businessImpact = clamp(countMatches(text, business) * 5, 0, 20);
  const politicalImpact = clamp(countMatches(text, ["أزمة", "احتجاجات", "انقسام", "استقالة", "إقالة", "تصويت", "حكومة جديدة", "حل البرلمان", "فساد"]) * 4 + (hasAny(text, DECISION_SIGNALS) ? 5 : 0), 0, 20);
  const reportValue = clamp((hasAny(text, DECISION_SIGNALS) ? 7 : 3) + (nationalImportance >= 30 ? 3 : 0), 0, 10);
  return { nationalImportance, businessImpact, politicalImpact, reportValue };
}

function scoreEconomy(article, text) {
  const housing = ["مشروع سكني", "مشاريع سكنية", "وحدات سكنية", "مدن جديدة", "مدينة سكنية", "الإسكان", "بسماية"];
  const investment = ["استثمار", "عقد", "عقود", "مستثمر", "قانون الاستثمار", "إعفاءات جمركية", "تمويل", "تحويلات خارجية", "ضمانات"];
  const nationalEconomy = ["الموازنة", "العجز", "الدين العام", "البنك المركزي", "سعر الصرف", "النفط", "صادرات النفط", "الغاز", "أوبك", "الموانئ", "طريق التنمية"];
  const foreignBusiness = ["شركة أجنبية", "الاستثمار الأجنبي", "تحويلات خارجية", "الاعتماد المستندي", "الكمارك", "الضرائب", "شركة هانوا"];
  const scale = ["مليار", "تريليون", "مشروع استراتيجي", "مشروع وطني", "آلاف الوحدات", "اتفاقية دولية"];
  const constructionInvestment = clamp(countMatches(text, [...housing, ...investment]) * 4 + (hasAny(text, housing) ? 7 : 0), 0, 35);
  const nationalImportance = clamp(countMatches(text, nationalEconomy) * 4 + (hasAny(text, DECISION_SIGNALS) ? 5 : 0), 0, 25);
  const businessImpact = clamp(countMatches(text, foreignBusiness) * 5, 0, 20);
  const executionScale = clamp(countMatches(text, scale) * 3 + (hasAny(text, ["تنفيذ", "بدء", "افتتاح", "توقيع"]) ? 4 : 0), 0, 10);
  return { constructionInvestment, nationalImportance, businessImpact, executionScale };
}

function scoreSecurity(article, text) {
  const terror = ["إرهاب", "إرهابي", "داعش", "هجوم إرهابي", "تفجير", "انفجار", "عبوة ناسفة", "انتحاري", "اغتيال", "قصف", "صاروخ", "طائرة مسيرة", "اشتباكات مسلحة", "خلية إرهابية"];
  const directIncident = ["قتل", "مقتل", "إصابة", "جرح", "استهداف", "هاجم", "انفجرت", "اعتقال", "إحباط"];
  const baghdad = ["بسماية", "بغداد", "مطار بغداد", "المدائن", "النهروان", "طريق بغداد"];
  const iraq = ["العراق", "العراقي", "القوات الأمنية العراقية", "الحشد الشعبي", "جهاز مكافحة الإرهاب"];
  const scale = ["قتلى", "جرحى", "ضحايا", "هجوم واسع", "حالة الطوارئ", "إغلاق الطرق", "تعليق الرحلات"];
  const foreigner = ["أجانب", "شركة أجنبية", "سفارة", "بعثة دبلوماسية", "إجلاء", "تحذير أمني"];
  const protest = ["تظاهرة", "تظاهرات", "احتجاج", "احتجاجات", "متظاهرون", "اعتصام", "اعتصامات", "إضراب", "اضراب", "وقفات احتجاجية"];
  const protestScale = ["اعتصام مفتوح", "إضراب عام", "جامعات", "محافظات", "موظفين", "أساتذة", "توسع الاحتجاجات", "إغلاق الطرق"];
  const isProtest = hasAny(text, protest);
  const incidentDirectness = isProtest
    ? clamp(18 + countMatches(text, protest) * 3, 0, 35)
    : clamp(countMatches(text, terror) * 5 + (hasAny(text, directIncident) ? 8 : 0), 0, 35);
  let location = 0;
  if (hasAny(text, baghdad)) location = 25;
  else if (hasAny(text, iraq)) location = 15;
  const incidentScale = isProtest
    ? clamp(countMatches(text, protestScale) * 3, 0, 15)
    : clamp(countMatches(text, scale) * 4 + (hasAny(text, directIncident) ? 3 : 0), 0, 15);
  const siteSafety = clamp(countMatches(text, foreigner) * 5 + (location === 25 ? 5 : 0), 0, 15);
  return { incidentDirectness, location, incidentScale, siteSafety };
}

function scoreInternational(article, text) {
  const directIraq = ["العراق", "الحكومة العراقية", "رئيس الوزراء العراقي", "بغداد", "الحدود العراقية", "الأجواء العراقية"];
  const priorityCountries = ["الولايات المتحدة", "أمريكا", "إيران", "تركيا", "السعودية", "الكويت", "الأردن", "سوريا", "الإمارات", "كوريا", "الصين", "الأمم المتحدة", "أوبك", "صندوق النقد الدولي", "البنك الدولي"];
  const impact = ["عقوبات", "اتفاق", "حدود", "مياه", "غاز", "كهرباء", "نفط", "تجارة", "أمن", "قصف", "تأشيرات", "رحلات جوية", "طريق التنمية", "استثمار", "مضيق هرمز", "الملاحة"];
  const bismayahImpact = ["بسماية", "شركة هانوا", "الهيئة الوطنية للاستثمار", "الشركات الكورية", "المشاريع السكنية", "الاستثمار الأجنبي"];
  const iraqLink = clamp(countMatches(text, directIraq) * 8 + (hasAny(text, DECISION_SIGNALS) ? 3 : 0), 0, 35);
  const countryImportance = clamp(countMatches(text, priorityCountries) * 5, 0, 15);
  const iraqImpact = clamp(countMatches(text, impact) * 4 + (iraqLink >= 20 ? 5 : 0), 0, 25);
  const businessImpact = clamp(countMatches(text, bismayahImpact) * 5, 0, 15);
  return { iraqLink, countryImportance, iraqImpact, businessImpact };
}

function scoreArticle(article) {
  const text = articleText(article);
  const reliability = sourceScore(article, text);
  const category = categoryOf(article);
  let breakdown;
  switch (category) {
    case "bismayah": breakdown = { ...scoreBismayah(article, text), sourceReliability: reliability }; break;
    case "politics": breakdown = { ...scorePolitics(article, text), sourceReliability: reliability }; break;
    case "economy": breakdown = { ...scoreEconomy(article, text), sourceReliability: reliability }; break;
    case "security": breakdown = { ...scoreSecurity(article, text), sourceReliability: reliability }; break;
    case "international": breakdown = { ...scoreInternational(article, text), sourceReliability: reliability }; break;
    default: breakdown = { categoryRelevance: 0, impact: 0, reportValue: 0, sourceReliability: reliability };
  }
  let score = Object.values(breakdown).reduce((sum, value) => sum + Number(value || 0), 0);
  if (!articleUrlOf(article)) score -= 10;
  if (articleBodyOf(article).length < 300) score -= 8;
  if (article.eventGroup?.isRepresentative === false) score -= 15;
  score = clamp(score);
  const level = levelOf(score);
  return {
    score,
    stars: starsForScore(score),
    ratingScale: "0.5_TO_5_STARS",
    level: level.code,
    levelKo: level.labelKo,
    reportStatus: level.reportStatus,
    scoringMethod: "CATEGORY_RULES_V3_STAR",
    scoredAt: new Date().toISOString(),
    breakdown
  };
}

const payload = JSON.parse(await fs.readFile(ARTICLES_FILE, "utf8"));
const articles = Array.isArray(payload.articles) ? payload.articles : [];
const scored = articles.map((article) => ({ ...article, importance: scoreArticle(article) }));

await fs.writeFile(ARTICLES_FILE, `${JSON.stringify({
  ...payload,
  generatedAt: new Date().toISOString(),
  importanceScoring: {
    method: "CATEGORY_RULES_V3_STAR",
    scoredCount: scored.length,
    starScale: { minimum: 0.5, maximum: 5, step: 0.5 }
  },
  articles: scored
}, null, 2)}\n`, "utf8");

console.log(`[importance] scored=${scored.length}, method=CATEGORY_RULES_V3_STAR`);
