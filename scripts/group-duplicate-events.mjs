#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const ROOT = process.cwd();
const ARTICLES_FILE = path.join(ROOT, "data", "articles.json");
const GROUPS_FILE = path.join(ROOT, "data", "event-groups.json");
const MAX_HOURS = Number(process.env.EVENT_GROUP_MAX_HOURS || 72);
const MIN_SCORE = Number(process.env.EVENT_GROUP_MIN_SCORE || 0.5);

const STOP_WORDS = new Set([
  "في","من","على","الى","إلى","عن","مع","بعد","قبل","خلال","هذا","هذه","ذلك","التي","الذي","وهو","وهي",
  "قال","أكد","اعلن","أعلن","كشف","اوضح","أوضح","العراق","العراقي","العراقية","اليوم","امس","أمس",
  "جديد","اخبار","أخبار","عاجل","بشأن","حول","ضمن","جراء","لدى","بين","العام","الماضي","الحالي"
]);

function normalizeArabic(value = "") {
  return String(value)
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/\u0640/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, " ")
    .replace(/[^\u0600-\u06FF0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function tokens(value = "", maxChars = 0) {
  const input = maxChars > 0 ? String(value).slice(0, maxChars) : String(value);
  return [...new Set(
    normalizeArabic(input)
      .split(" ")
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token))
  )];
}

function intersectionCount(a = [], b = []) {
  const A = new Set(a);
  let common = 0;
  for (const value of new Set(b)) if (A.has(value)) common += 1;
  return common;
}

function jaccard(a = [], b = []) {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size || !B.size) return 0;
  const common = intersectionCount(a, b);
  return common / (A.size + B.size - common);
}

function overlapCoefficient(a = [], b = []) {
  const minSize = Math.min(new Set(a).size, new Set(b).size);
  return minSize ? intersectionCount(a, b) / minSize : 0;
}

function numbers(text = "") {
  return [...new Set(String(text).match(/\b\d+(?:[.,]\d+)?\b/g) || [])];
}

function entitySignals(text = "") {
  const normalized = normalizeArabic(text);
  const terms = [
    "رئيس الوزراء","مجلس الوزراء","مجلس النواب","الاطار التنسيقي","هيئه النزاهه","الهيئه الوطنيه للاستثمار",
    "وزاره الاعمار","وزاره الماليه","وزاره التخطيط","البنك المركزي العراقي","داعش","الولايات المتحده",
    "ايران","تركيا","سوريا","بغداد","البصره","نينوي","الانبار","كركوك","ديالي","صلاح الدين",
    "مضيق هرمز","طريق التنميه","بسمايه","هانوا","محمد شياع السوداني","علي الزيدي","نوري المالكي"
  ];
  return terms.filter((term) => normalized.includes(term));
}

function dateHours(a, b) {
  const A = new Date(a || 0).getTime();
  const B = new Date(b || 0).getTime();
  if (!Number.isFinite(A) || !Number.isFinite(B)) return Infinity;
  return Math.abs(A - B) / 3600000;
}

function sameOrContainedTitle(a = "", b = "") {
  const A = normalizeArabic(a);
  const B = normalizeArabic(b);
  if (!A || !B || Math.min(A.length, B.length) < 18) return false;
  return A === B || A.includes(B) || B.includes(A);
}

function eventScore(a, b) {
  if ((a.category || "") !== (b.category || "")) return 0;
  if (dateHours(a.publishedAt, b.publishedAt) > MAX_HOURS) return 0;

  const aTitle = tokens(a.originalTitleArabic);
  const bTitle = tokens(b.originalTitleArabic);
  const commonTitle = intersectionCount(aTitle, bTitle);
  const titleJaccard = jaccard(aTitle, bTitle);
  const titleOverlap = overlapCoefficient(aTitle, bTitle);

  const aLead = tokens(`${a.originalTitleArabic || ""}\n${a.originalTextArabic || ""}`, 1400);
  const bLead = tokens(`${b.originalTitleArabic || ""}\n${b.originalTextArabic || ""}`, 1400);
  const leadJaccard = jaccard(aLead, bLead);

  const aEntities = entitySignals(`${a.originalTitleArabic || ""}\n${a.originalTextArabic || ""}`);
  const bEntities = entitySignals(`${b.originalTitleArabic || ""}\n${b.originalTextArabic || ""}`);
  const entityScore = jaccard(aEntities, bEntities);
  const commonEntities = intersectionCount(aEntities, bEntities);

  const aNumbers = numbers(`${a.originalTitleArabic || ""}\n${String(a.originalTextArabic || "").slice(0, 1400)}`);
  const bNumbers = numbers(`${b.originalTitleArabic || ""}\n${String(b.originalTextArabic || "").slice(0, 1400)}`);
  const numberScore = jaccard(aNumbers, bNumbers);
  const commonNumbers = intersectionCount(aNumbers, bNumbers);

  const exactish = sameOrContainedTitle(a.originalTitleArabic, b.originalTitleArabic);
  const strongTitle = commonTitle >= 3 && titleOverlap >= 0.67;
  const supportedTitle = commonTitle >= 2
    && titleOverlap >= 0.45
    && (commonEntities > 0 || commonNumbers > 0 || leadJaccard >= 0.16);

  if (!exactish && !strongTitle && !supportedTitle) return 0;

  const incidentBonus = a.securityIncident?.type
    && a.securityIncident?.type === b.securityIncident?.type
    ? 0.08
    : 0;
  const exactBonus = exactish ? 0.14 : 0;

  return Math.min(
    1,
    titleJaccard * 0.29
      + titleOverlap * 0.29
      + leadJaccard * 0.18
      + entityScore * 0.12
      + numberScore * 0.12
      + incidentBonus
      + exactBonus
  );
}

function sourceRank(article) {
  const host = String(article.sourceHost || "").toLowerCase();
  if (/pmo\.iq|cabinet\.iq|parliament\.iq|ina\.iq/.test(host)) return 3;
  if (/shafaq\.com|alsumaria\.tv|ninanews\.com|rudawarabia\.net|aljazeera\.net/.test(host)) return 2;
  return 1;
}

function representativeScore(article) {
  const translated = article.translation?.titleKo ? 5000 : 0;
  return sourceRank(article) * 100000
    + Number(article.contentChars || 0)
    + tokens(article.originalTitleArabic).length * 100
    + translated;
}

function stableGroupId(memberIds = []) {
  return `event-${createHash("sha256")
    .update([...memberIds].sort().join("|"))
    .digest("base64url")
    .slice(0, 18)}`;
}

const payload = JSON.parse(await fs.readFile(ARTICLES_FILE, "utf8"));
const articles = Array.isArray(payload.articles) ? payload.articles : [];
const parent = articles.map((_, index) => index);
const find = (x) => parent[x] === x ? x : (parent[x] = find(parent[x]));
const union = (a, b) => {
  const A = find(a);
  const B = find(b);
  if (A !== B) parent[B] = A;
};
const matches = [];

for (let i = 0; i < articles.length; i += 1) {
  for (let j = i + 1; j < articles.length; j += 1) {
    const score = eventScore(articles[i], articles[j]);
    if (score >= MIN_SCORE) {
      union(i, j);
      matches.push({
        left: articles[i].articleId,
        right: articles[j].articleId,
        score: Number(score.toFixed(4))
      });
    }
  }
}

const buckets = new Map();
articles.forEach((article, index) => {
  const root = find(index);
  if (!buckets.has(root)) buckets.set(root, []);
  buckets.get(root).push(article);
});

const groups = [];
const annotated = [];
for (const members of buckets.values()) {
  const sorted = [...members].sort((a, b) => representativeScore(b) - representativeScore(a));
  const representative = sorted[0];
  const groupId = stableGroupId(sorted.map((item) => item.articleId));
  const group = {
    groupId,
    category: representative.category,
    representativeArticleId: representative.articleId,
    memberCount: sorted.length,
    duplicateCount: Math.max(0, sorted.length - 1),
    publishedFrom: sorted.map((item) => item.publishedAt).filter(Boolean).sort()[0] || "",
    publishedTo: sorted.map((item) => item.publishedAt).filter(Boolean).sort().at(-1) || "",
    memberArticleIds: sorted.map((item) => item.articleId),
    sources: sorted.map((item) => ({
      articleId: item.articleId,
      sourceArabic: item.sourceArabic || item.source?.arabicName || "",
      articleUrl: item.articleUrl || "",
      publishedAt: item.publishedAt || "",
      originalTitleArabic: item.originalTitleArabic || "",
      titleKo: item.translation?.titleKo || item.titleKo || "",
      isRepresentative: item.articleId === representative.articleId
    }))
  };
  groups.push(group);

  for (const article of sorted) {
    annotated.push({
      ...article,
      eventGroup: {
        groupId,
        representativeArticleId: representative.articleId,
        isRepresentative: article.articleId === representative.articleId,
        memberCount: sorted.length,
        duplicateCount: group.duplicateCount
      }
    });
  }
}

annotated.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
groups.sort((a, b) => new Date(b.publishedTo || 0) - new Date(a.publishedTo || 0));

const duplicateGroups = groups.filter((group) => group.memberCount > 1);
const duplicateArticleCount = groups.reduce((sum, group) => sum + group.duplicateCount, 0);

await fs.writeFile(ARTICLES_FILE, `${JSON.stringify({
  ...payload,
  generatedAt: new Date().toISOString(),
  eventGrouping: {
    groupCount: groups.length,
    duplicateGroupCount: duplicateGroups.length,
    duplicateArticleCount,
    maxHours: MAX_HOURS,
    minScore: MIN_SCORE,
    method: "ARABIC_TITLE_LEAD_ENTITY_NUMERIC_V2"
  },
  articles: annotated
}, null, 2)}\n`, "utf8");

await fs.writeFile(GROUPS_FILE, `${JSON.stringify({
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  groupCount: groups.length,
  duplicateGroupCount: duplicateGroups.length,
  duplicateArticleCount,
  matches,
  groups
}, null, 2)}\n`, "utf8");

console.log(`[events] groups=${groups.length}, duplicateGroups=${duplicateGroups.length}, duplicateArticles=${duplicateArticleCount}`);
