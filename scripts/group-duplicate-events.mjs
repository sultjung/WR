#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const ROOT = process.cwd();
const ARTICLES_FILE = path.join(ROOT, "data", "articles.json");
const GROUPS_FILE = path.join(ROOT, "data", "event-groups.json");
const MAX_HOURS = Number(process.env.EVENT_GROUP_MAX_HOURS || 48);
const MIN_SCORE = Number(process.env.EVENT_GROUP_MIN_SCORE || 0.58);

const STOP_WORDS = new Set([
  "في","من","على","الى","إلى","عن","مع","بعد","قبل","خلال","هذا","هذه","ذلك","التي","الذي","وهو","وهي",
  "قال","أكد","اعلن","أعلن","العراق","العراقي","العراقية","اليوم","امس","أمس","جديد","اخبار","أخبار","عاجل"
]);

function normalizeArabic(value = "") {
  return String(value)
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/\u0640/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\u0600-\u06FF0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleTokens(title = "") {
  return [...new Set(normalizeArabic(title).split(" ").filter((token) => token.length >= 3 && !STOP_WORDS.has(token)))];
}

function jaccard(a = [], b = []) {
  const A = new Set(a); const B = new Set(b);
  if (!A.size || !B.size) return 0;
  let common = 0;
  for (const value of A) if (B.has(value)) common += 1;
  return common / (A.size + B.size - common);
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
    "مضيق هرمز","طريق التنميه","بسمايه","هانوا"
  ];
  return terms.filter((term) => normalized.includes(term));
}

function dateHours(a, b) {
  const A = new Date(a || 0).getTime(); const B = new Date(b || 0).getTime();
  if (!Number.isFinite(A) || !Number.isFinite(B)) return Infinity;
  return Math.abs(A - B) / 3600000;
}

function eventScore(a, b) {
  if ((a.category || "") !== (b.category || "")) return 0;
  if (dateHours(a.publishedAt, b.publishedAt) > MAX_HOURS) return 0;
  const titleScore = jaccard(titleTokens(a.originalTitleArabic), titleTokens(b.originalTitleArabic));
  const entityScore = jaccard(entitySignals(`${a.originalTitleArabic}\n${a.originalTextArabic || ""}`), entitySignals(`${b.originalTitleArabic}\n${b.originalTextArabic || ""}`));
  const numberScore = jaccard(numbers(`${a.originalTitleArabic}\n${a.originalTextArabic || ""}`), numbers(`${b.originalTitleArabic}\n${b.originalTextArabic || ""}`));
  const incidentBonus = a.securityIncident?.type && a.securityIncident?.type === b.securityIncident?.type ? 0.1 : 0;
  return Math.min(1, titleScore * 0.68 + entityScore * 0.22 + numberScore * 0.1 + incidentBonus);
}

function sourceRank(article) {
  const host = String(article.sourceHost || "").toLowerCase();
  if (/pmo\.iq|cabinet\.iq|parliament\.iq|ina\.iq/.test(host)) return 3;
  if (/shafaq\.com|alsumaria\.tv|ninanews\.com|rudawarabia\.net|aljazeera\.net/.test(host)) return 2;
  return 1;
}

function representativeScore(article) {
  return sourceRank(article) * 100000 + Number(article.contentChars || 0) + titleTokens(article.originalTitleArabic).length * 100;
}

function stableGroupId(memberIds = []) {
  return `event-${createHash("sha256").update([...memberIds].sort().join("|")).digest("base64url").slice(0, 18)}`;
}

const payload = JSON.parse(await fs.readFile(ARTICLES_FILE, "utf8"));
const articles = Array.isArray(payload.articles) ? payload.articles : [];
const parent = articles.map((_, index) => index);
const find = (x) => parent[x] === x ? x : (parent[x] = find(parent[x]));
const union = (a, b) => { const A = find(a), B = find(b); if (A !== B) parent[B] = A; };
const matches = [];

for (let i = 0; i < articles.length; i += 1) {
  for (let j = i + 1; j < articles.length; j += 1) {
    const score = eventScore(articles[i], articles[j]);
    if (score >= MIN_SCORE) {
      union(i, j);
      matches.push({ left: articles[i].articleId, right: articles[j].articleId, score: Number(score.toFixed(4)) });
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
    sources: sorted.map((item) => ({ articleId: item.articleId, sourceArabic: item.sourceArabic || "", articleUrl: item.articleUrl || "", publishedAt: item.publishedAt || "" }))
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

await fs.writeFile(ARTICLES_FILE, `${JSON.stringify({
  ...payload,
  generatedAt: new Date().toISOString(),
  eventGrouping: {
    groupCount: groups.length,
    duplicateGroupCount: groups.filter((group) => group.memberCount > 1).length,
    duplicateArticleCount: groups.reduce((sum, group) => sum + group.duplicateCount, 0),
    maxHours: MAX_HOURS,
    minScore: MIN_SCORE,
    method: "DETERMINISTIC_ARABIC_TITLE_ENTITY_NUMERIC"
  },
  articles: annotated
}, null, 2)}\n`, "utf8");

await fs.writeFile(GROUPS_FILE, `${JSON.stringify({
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  groupCount: groups.length,
  duplicateGroupCount: groups.filter((group) => group.memberCount > 1).length,
  duplicateArticleCount: groups.reduce((sum, group) => sum + group.duplicateCount, 0),
  matches,
  groups
}, null, 2)}\n`, "utf8");

console.log(`[events] groups=${groups.length}, duplicateGroups=${groups.filter((g) => g.memberCount > 1).length}, duplicateArticles=${groups.reduce((s, g) => s + g.duplicateCount, 0)}`);
