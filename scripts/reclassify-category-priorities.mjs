#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const ARTICLES_FILE = path.join(ROOT, "data", "articles.json");
const SUMMARY_FILE = path.join(ROOT, "data", "category-reclassification-summary.json");

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

function readCategory(article = {}) {
  return article?.analysis?.category || article?.category || article?.article?.category || "unknown";
}

function readTitle(article = {}) {
  return article?.article?.originalTitleArabic || article?.originalTitleArabic || article?.titleArabic || "";
}

function readBody(article = {}) {
  return article?.article?.originalTextArabic || article?.originalTextArabic || article?.fullTextArabic || "";
}

function setCategory(article = {}, category, rule, reason) {
  const now = new Date().toISOString();
  return {
    ...article,
    category,
    analysis: {
      ...(article.analysis || {}),
      category,
      categoryOverride: {
        rule,
        reason,
        appliedAt: now
      }
    },
    article: article.article && typeof article.article === "object"
      ? { ...article.article, category }
      : article.article
  };
}

const BANKING_ECONOMY_TERMS = [
  "المصارف الاهليه", "المصارف العراقية", "المصارف", "البنوك العراقية",
  "البنك المركزي العراقي", "الفيدرالي الاميركي", "الاحتياطي الفيدرالي",
  "العقوبات المصرفيه", "رفع العقوبات", "التحويلات الخارجيه",
  "الامتثال المصرفي", "متطلبات الامتثال", "الدولار", "الحوالات"
];

const IRAQ_TURKEY_RELATION_TERMS = [
  "العلاقات التركيه العراقيه", "العلاقات العراقيه التركيه",
  "تركيا والعراق", "العراق وتركيا", "شراكه استراتيجيه"
];

const ECONOMIC_COOPERATION_TERMS = [
  "التجاره", "التبادل التجاري", "الاستثمار", "الاستثمارات", "الطاقه",
  "النفط", "الغاز", "خط انابيب", "طريق التنميه", "النقل", "المياه",
  "البنى التحتيه", "الاعمار", "المشاريع", "التعاون الاقتصادي",
  "الشراكه الاقتصاديه", "الربط السككي", "الممر التجاري"
];

const IRAQ_OFFICIAL_POSITION_TERMS = [
  "العراق يدين", "العراق يستنكر", "الحكومه العراقيه تدين",
  "الحكومه العراقيه تستنكر", "وزاره الخارجيه العراقيه تدين",
  "وزاره الخارجيه العراقيه تستنكر", "رئاسه الجمهوريه تدين",
  "رئاسه الوزراء تدين", "رئيس الوزراء يدين", "بيان عراقي"
];

const STRIKE_OR_ATTACK_TERMS = [
  "الضربه", "القصف", "الهجوم", "العدوان", "غاره", "استهداف",
  "الحشد الشعبي", "القوات العراقيه"
];

function classify(article = {}) {
  const title = readTitle(article);
  const body = readBody(article);
  const lead = body.slice(0, 3500);
  const text = `${title}\n${lead}`;
  const current = readCategory(article);

  if (hasAny(text, BANKING_ECONOMY_TERMS) && hasAny(text, ["العراق", "العراقي", "العراقيه", "بغداد"])) {
    return {
      category: "economy",
      rule: "IRAQI_BANKING_AND_FINANCIAL_REGULATION",
      reason: "이라크 은행·미 연준 요건·금융제재·송금 규제는 경제 카테고리 우선"
    };
  }

  const exactTurkeyStrategicTitle = hasAny(title, ["هل تدخل العلاقات التركيه العراقيه في شراكه استراتيجيه جديده"]);
  if (
    hasAny(text, IRAQ_TURKEY_RELATION_TERMS) &&
    (hasAny(text, ECONOMIC_COOPERATION_TERMS) || exactTurkeyStrategicTitle)
  ) {
    return {
      category: "economy",
      rule: "IRAQ_TURKEY_ECONOMIC_STRATEGIC_PARTNERSHIP",
      reason: "터키–이라크 관계 중 교역·투자·에너지·개발 협력 중심 기사는 경제 카테고리 우선"
    };
  }

  if (hasAny(text, IRAQ_OFFICIAL_POSITION_TERMS) && hasAny(text, STRIKE_OR_ATTACK_TERMS)) {
    return {
      category: "politics",
      rule: "IRAQI_OFFICIAL_DIPLOMATIC_POSITION",
      reason: "공격 사건 자체가 아니라 이라크 정부의 규탄·외교적 입장 발표가 핵심이므로 정치 카테고리 우선"
    };
  }

  return { category: current, rule: null, reason: null };
}

const payload = JSON.parse(await fs.readFile(ARTICLES_FILE, "utf8"));
const articles = Array.isArray(payload.articles) ? payload.articles : [];
const changes = [];

const updated = articles.map((article) => {
  const before = readCategory(article);
  const result = classify(article);
  if (!result.rule || result.category === before) return article;

  changes.push({
    articleId: article.articleId || article.id || null,
    titleArabic: readTitle(article),
    from: before,
    to: result.category,
    rule: result.rule,
    reason: result.reason
  });

  return setCategory(article, result.category, result.rule, result.reason);
});

const categoryCounts = updated.reduce((acc, article) => {
  const category = readCategory(article);
  acc[category] = (acc[category] || 0) + 1;
  return acc;
}, {});

await fs.writeFile(ARTICLES_FILE, `${JSON.stringify({
  ...payload,
  generatedAt: new Date().toISOString(),
  count: updated.length,
  categoryCounts,
  categoryReclassificationRun: {
    changedCount: changes.length
  },
  articles: updated
}, null, 2)}\n`, "utf8");

await fs.writeFile(SUMMARY_FILE, `${JSON.stringify({
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  changedCount: changes.length,
  changes
}, null, 2)}\n`, "utf8");

console.log(`[category-reclassify] changed=${changes.length}`);
