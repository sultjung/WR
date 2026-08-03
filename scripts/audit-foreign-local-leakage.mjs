#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const ARTICLES_FILE = path.resolve(
  process.env.FOREIGN_LOCAL_AUDIT_ARTICLES_FILE || path.join(ROOT, "data", "articles.json")
);
const OUTPUT_FILE = path.resolve(
  process.env.FOREIGN_LOCAL_AUDIT_OUTPUT_FILE || path.join(ROOT, "data", "foreign-local-audit.json")
);

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

const TARGET_CATEGORIES = new Set(["economy", "bismayah"]);
const FOREIGN_PLACES = [
  "سوريا", "السوري", "السورية", "درعا", "حماة", "حمص", "حلب", "دمشق",
  "لبنان", "اللبناني", "اللبنانية", "بيروت",
  "فلسطين", "الفلسطيني", "الفلسطينية", "قطاع غزة", "غزة",
  "ايران", "الايراني", "الايرانية", "طهران",
  "اليمن", "اليمني", "اليمنية", "صنعاء",
  "السعودية", "السعودي", "السعودية", "جدة", "الرياض", "ينبع",
  "مصر", "المصري", "المصرية", "القاهرة",
  "الاردن", "الاردني", "الاردنية",
  "الكويت", "الكويتي", "الكويتية",
  "قطر", "القطري", "القطرية",
  "الامارات", "الاماراتي", "الاماراتية", "دبي",
  "البحرين", "البحريني", "البحرينية",
  "عمان", "العماني", "العمانية",
  "تركيا", "التركي", "التركية",
  "باكستان", "افغانستان", "الهند", "المغرب", "تونس", "الجزائر", "السودان"
];
const IRAQ_ANCHORS = [
  "العراق", "العراقي", "العراقية", "عراقي", "عراقية",
  "بغداد", "البصرة", "الموصل", "كركوك", "الانبار", "اربيل", "السليمانية",
  "كربلاء", "النجف", "ديالى", "صلاح الدين", "نينوى", "ذي قار", "ميسان", "واسط",
  "بابل", "الديوانية", "المثنى", "دهوك", "كردستان العراق",
  "الحكومة العراقية", "مجلس الوزراء العراقي", "مجلس النواب العراقي", "البرلمان العراقي",
  "وزارة الاعمار والاسكان", "وزارة الاعمار والاسكان والبلديات العامة",
  "وزارة الاعمار والاسكان والبلديات والاشغال العامة", "دائرة الطرق والجسور",
  "وزارة التخطيط العراقية", "وزارة النفط العراقية", "البنك المركزي العراقي",
  "الهيئة الوطنية للاستثمار", "هيئة الاستثمار الوطنية",
  "بسماية", "بسمايه", "مدينة بسماية الجديدة", "مشروع بسماية", "شركة هانوا",
  "iraq", "iraqi", "bismayah", "bismaya", "bncp", "hanwha"
];
const CONFIRMED_IRAQ_PROJECT_EXCEPTIONS = [
  "جسر غزة"
];

function evidenceTerms(text, terms) {
  return terms.filter((term) => hasAny(text, [term]));
}

const payload = JSON.parse(await fs.readFile(ARTICLES_FILE, "utf8"));
const articles = Array.isArray(payload.articles) ? payload.articles : [];
const reviewed = [];
const suspects = [];

for (const article of articles) {
  const category = getCategory(article);
  if (!TARGET_CATEGORIES.has(category)) continue;

  const title = getTitle(article);
  const lead = getBody(article).slice(0, 1600);
  const combined = `${title}\n${lead}`;
  const foreignInTitle = evidenceTerms(title, FOREIGN_PLACES);
  if (!foreignInTitle.length) continue;

  const iraqEvidence = evidenceTerms(combined, IRAQ_ANCHORS);
  const exceptionEvidence = evidenceTerms(title, CONFIRMED_IRAQ_PROJECT_EXCEPTIONS);
  const acceptedException = exceptionEvidence.length > 0 && iraqEvidence.length > 0;
  const suspicious = !acceptedException && iraqEvidence.length === 0;

  const record = {
    articleId: article.articleId || article.id || "",
    category,
    sourceArabic: article.sourceArabic || article.source?.arabicName || "",
    publishedAt: article.publishedAt || "",
    originalTitleArabic: title,
    articleUrl: getUrl(article),
    foreignTitleSignals: foreignInTitle,
    iraqEvidence: iraqEvidence.slice(0, 12),
    exceptionEvidence,
    status: suspicious ? "SUSPECT_FOREIGN_LOCAL_LEAKAGE" : "REVIEWED_WITH_IRAQ_EVIDENCE"
  };
  reviewed.push(record);
  if (suspicious) suspects.push(record);
}

const result = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  targetCategories: [...TARGET_CATEGORIES],
  totalArticles: articles.length,
  reviewedForeignTitleArticles: reviewed.length,
  suspectCount: suspects.length,
  suspects,
  reviewed
};

await fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
await fs.writeFile(OUTPUT_FILE, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(`[audit:foreign-local] reviewed=${reviewed.length}, suspects=${suspects.length}, output=${OUTPUT_FILE}`);

if (process.env.FOREIGN_LOCAL_AUDIT_FAIL_ON_SUSPECT === "1" && suspects.length > 0) {
  process.exitCode = 1;
}
