#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const ARTICLES_FILE = path.resolve(
  process.env.IRAQ_SCOPE_ARTICLES_FILE || path.join(ROOT, "data", "articles.json")
);
const SUMMARY_FILE = path.resolve(
  process.env.IRAQ_SCOPE_SUMMARY_FILE || path.join(ROOT, "data", "iraq-scope-gate-summary.json")
);
const LEAD_CHARS = Number(process.env.IRAQ_SCOPE_LEAD_CHARS || 2200);
const PRIMARY_FOREIGN_LEAD_CHARS = Number(process.env.IRAQ_SCOPE_FOREIGN_LEAD_CHARS || 900);

function normalizeArabic(value = "") {
  return String(value)
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/\u0640/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, " ")
    .toLowerCase();
}

function tokenize(value = "") {
  return normalizeArabic(value).match(/[\p{L}\p{N}]+/gu) || [];
}

function tokenForms(token = "") {
  const forms = new Set([token]);
  const queue = [token];
  const prefixes = new Set(["و", "ف", "ب", "ك", "ل"]);
  while (queue.length) {
    const current = queue.shift();
    if (current.length > 3 && prefixes.has(current[0])) {
      const stripped = current.slice(1);
      if (!forms.has(stripped)) {
        forms.add(stripped);
        queue.push(stripped);
      }
    }
  }
  return forms;
}

function tokenMatches(actual = "", expected = "") {
  return tokenForms(actual).has(expected);
}

function containsPhrase(text = "", phrase = "") {
  const haystack = tokenize(text);
  const needle = tokenize(phrase);
  if (!needle.length || haystack.length < needle.length) return false;
  for (let i = 0; i <= haystack.length - needle.length; i += 1) {
    let matched = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (!tokenMatches(haystack[i + j], needle[j])) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

function containsAnyPhrase(text = "", phrases = []) {
  return phrases.some((phrase) => containsPhrase(text, phrase));
}

function getRecord(article = {}) {
  return article.article && typeof article.article === "object" ? article.article : article;
}

function getTitle(article = {}) {
  const record = getRecord(article);
  return record.originalTitleArabic || article.originalTitleArabic || article.titleArabic || "";
}

function getBody(article = {}) {
  const record = getRecord(article);
  return record.originalTextArabic || article.originalTextArabic || article.fullTextArabic || "";
}

function getCategory(article = {}) {
  return String(article.analysis?.category || article.category || getRecord(article).category || "").toLowerCase();
}

function getArticleId(article = {}, index = 0) {
  const record = getRecord(article);
  return article.articleId || record.articleId || article.id || `article-${index}`;
}

const IRAQ_ANCHORS = [
  "العراق", "العراقي", "العراقية", "عراقي", "عراقية",
  "بغداد", "البصرة", "الموصل", "كركوك", "الانبار", "أربيل", "اربيل", "السليمانية",
  "كربلاء", "النجف", "ديالى", "صلاح الدين", "نينوى", "ذي قار", "ميسان", "واسط",
  "بابل", "الديوانية", "المثنى", "دهوك", "كردستان العراق",
  "الحكومة العراقية", "مجلس الوزراء العراقي", "مجلس النواب العراقي", "البرلمان العراقي",
  "القوات العراقية", "الجيش العراقي", "الشرطة العراقية", "الحشد الشعبي",
  "جهاز مكافحة الارهاب", "جهاز الامن الوطني", "قيادة العمليات المشتركة",
  "وزارة الداخلية العراقية", "وزارة الدفاع العراقية"
];

const FOREIGN_SECURITY_LOCATIONS = [
  "نيجيريا", "النيجيري", "النيجيرية", "سوكوتو",
  "سوريا", "السوري", "السورية", "لبنان", "اللبناني", "اللبنانية",
  "فلسطين", "الفلسطيني", "الفلسطينية", "غزة", "ايران", "الايراني", "الايرانية",
  "اليمن", "اليمني", "اليمنية", "السعودية", "السعودي", "مصر", "المصري", "الاردن",
  "الكويت", "قطر", "الامارات", "البحرين", "تركيا", "التركي", "افغانستان", "باكستان",
  "الهند", "كينيا", "الصومال", "السودان", "المغرب", "تونس", "الجزائر", "كولومبيا",
  "تايلاند", "التايلاندية", "التايلاندي", "بانكوك", "نونثابوري"
];

// Iraqi and Kurdish outlets often prefix syndicated foreign stories with a desk location
// such as "زاكروس - أربيل". That is publisher metadata, not evidence that the incident
// occurred in Iraq. Remove only short, obvious outlet/dateline prefixes before scope checks.
function stripPublisherDateline(value = "") {
  let text = String(value || "");
  text = text
    .replace(/^\s*(?:zagros\s*tv\s*)?(?:\d{1,2}:\d{2}\s*(?:ص|م|صباحا|مساء)?)?\s*زاكروس\s*[-–—|:]\s*(?:أ?ربيل)\s*/iu, "")
    .replace(/^\s*زاكروس\s*[-–—|:]\s*(?:أ?ربيل)\s*/iu, "")
    .replace(/^\s*(?:شفق\s+نيوز|السومرية\s+نيوز|رووداو)\s*[-–—|:]\s*(?:أ?ربيل|بغداد)\s*/iu, "");
  return text.trimStart();
}

function evaluateSecurityScope(article = {}) {
  const title = getTitle(article);
  const rawLead = getBody(article).slice(0, LEAD_CHARS);
  const lead = stripPublisherDateline(rawLead);
  const primaryLead = lead.slice(0, PRIMARY_FOREIGN_LEAD_CHARS);
  const iraqInTitle = containsAnyPhrase(title, IRAQ_ANCHORS);
  const iraqInLead = containsAnyPhrase(lead, IRAQ_ANCHORS);
  const foreignPrimaryTitle = containsAnyPhrase(title, FOREIGN_SECURITY_LOCATIONS);
  const foreignPrimaryLead = containsAnyPhrase(primaryLead, FOREIGN_SECURITY_LOCATIONS);

  if (foreignPrimaryTitle && !iraqInTitle) {
    return {
      keep: false,
      reason: "FOREIGN_SECURITY_PRIMARY_TITLE",
      note: "해외 국가·도시가 제목의 주체이며 제목에 이라크 직접 연관이 없음"
    };
  }

  if (foreignPrimaryLead && !iraqInTitle && !iraqInLead) {
    return {
      keep: false,
      reason: "FOREIGN_SECURITY_PRIMARY_LEAD",
      note: "본문 도입부가 해외 사건을 직접 다루며 언론사 발행지 표기를 제외하면 이라크 직접 연관이 없음"
    };
  }

  if (!iraqInTitle && !iraqInLead) {
    return {
      keep: false,
      reason: "NO_EXACT_IRAQ_SCOPE_EVIDENCE",
      note: "제목·본문 도입부에서 정확한 이라크 지명·기관·치안 주체를 확인하지 못함"
    };
  }

  return {
    keep: true,
    reason: "EXACT_IRAQ_SCOPE_CONFIRMED",
    note: iraqInTitle ? "제목에서 이라크 직접 연관 확인" : "본문 도입부에서 이라크 직접 연관 확인"
  };
}

function evaluateArticle(article = {}) {
  const category = getCategory(article);
  if (category !== "security") {
    return { keep: true, reason: "CATEGORY_NOT_TARGETED", note: "치안 카테고리 외 기사" };
  }
  return evaluateSecurityScope(article);
}

const payload = JSON.parse(await fs.readFile(ARTICLES_FILE, "utf8"));
const articles = Array.isArray(payload) ? payload : (Array.isArray(payload.articles) ? payload.articles : []);
const retained = [];
const excluded = [];

articles.forEach((article, index) => {
  const result = evaluateArticle(article);
  if (result.keep) {
    retained.push(article);
    return;
  }
  excluded.push({
    articleId: getArticleId(article, index),
    category: getCategory(article),
    originalTitleArabic: getTitle(article),
    reason: result.reason,
    note: result.note
  });
});

const output = Array.isArray(payload)
  ? retained
  : {
      ...payload,
      generatedAt: new Date().toISOString(),
      articles: retained,
      iraqScopeGate: {
        method: "EXACT_ARABIC_TOKEN_SCOPE_V2",
        before: articles.length,
        retained: retained.length,
        excluded: excluded.length,
        leadChars: LEAD_CHARS,
        primaryForeignLeadChars: PRIMARY_FOREIGN_LEAD_CHARS
      }
    };

const reasonCounts = excluded.reduce((counts, item) => {
  counts[item.reason] = (counts[item.reason] || 0) + 1;
  return counts;
}, {});

const summary = {
  schemaVersion: "1.1",
  generatedAt: new Date().toISOString(),
  method: "EXACT_ARABIC_TOKEN_SCOPE_V2",
  before: articles.length,
  retained: retained.length,
  excludedCount: excluded.length,
  reasonCounts,
  excluded
};

await fs.mkdir(path.dirname(ARTICLES_FILE), { recursive: true });
await fs.mkdir(path.dirname(SUMMARY_FILE), { recursive: true });
await fs.writeFile(ARTICLES_FILE, `${JSON.stringify(output, null, 2)}\n`, "utf8");
await fs.writeFile(SUMMARY_FILE, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

console.log(`[iraq-scope] before=${articles.length}, retained=${retained.length}, excluded=${excluded.length}`);
