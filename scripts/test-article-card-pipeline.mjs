#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  CARD_PIPELINE_VERSION,
  cardInputOf,
  cardIsCurrent,
  factsHashOf,
  factsInputOf,
  factsAreCurrent,
  normalizeCardResult,
  normalizeFactsResult,
  reportSourceOf,
  sourceHashOf
} from "./article-card-core.mjs";

const article = {
  articleId: "fixture-1",
  category: "politics",
  sourceArabic: "وكالة الأنباء العراقية",
  publishedAt: "2026-08-04T00:00:00.000Z",
  originalTitleArabic: "مجلس الوزراء يتخذ قرارات جديدة",
  originalTextArabic: `${"نص عربي مؤكد عن اجتماع مجلس الوزراء والقرار والنتيجة. ".repeat(10)} SECRET_SOURCE_TOKEN`,
  eventGroup: { isRepresentative: true }
};

const factsInput = factsInputOf(article, 0, 20000);
assert.ok(factsInput.bodyArabic.includes("SECRET_SOURCE_TOKEN"));
assert.equal(sourceHashOf(article).length, 64);

const facts = normalizeFactsResult({
  mainSubjectAr: "مجلس الوزراء العراقي",
  actionAr: "اتخذ مجموعة من القرارات",
  locationAr: "بغداد",
  eventDateAr: "4 آب 2026",
  resultAr: "تكليف الجهات المعنية بالتنفيذ",
  keyFactsAr: ["ناقش المجلس عدة بنود", "أصدر توجيهات تنفيذية"],
  numbersAr: ["4 آب 2026"],
  peopleAr: [],
  organizationsAr: ["مجلس الوزراء العراقي"],
  directQuotesAr: [],
  uncertaintiesAr: [],
  multipleAgendaItems: true
}, article, "mock-fact-model");
article.cardFacts = facts;

assert.equal(facts.pipelineVersion, CARD_PIPELINE_VERSION);
assert.ok(factsAreCurrent(article));

const cardInput = cardInputOf(article, 0);
const serializedCardInput = JSON.stringify(cardInput);
assert.ok(!serializedCardInput.includes("SECRET_SOURCE_TOKEN"));
assert.ok(!serializedCardInput.includes("originalTextArabic"));
assert.ok(!serializedCardInput.includes("bodyArabic"));
assert.equal(cardInput.factsArabic.multipleAgendaItems, true);

article.card = normalizeCardResult({
  titleKo: "이라크 각료회의, 복수 정부 안건 의결",
  summaryKo: "이라크 각료회의는 바그다드에서 여러 정부 안건을 논의하고 관계기관에 후속 이행을 지시함. 구체적인 결정사항은 확인된 사실 범위에서 정리됨."
}, article, "mock-card-model");

assert.ok(cardIsCurrent(article));
assert.equal(article.card.fullTranslationGenerated, false);
assert.equal(article.card.factBasis, "STRUCTURED_ARABIC_FACTS_ONLY");
assert.equal(article.card.factsHash, factsHashOf(article.cardFacts));

const reportSource = reportSourceOf(article, 0);
assert.ok(reportSource.originalTextArabic.includes("SECRET_SOURCE_TOKEN"));
assert.ok(!Object.hasOwn(reportSource, "summaryKo"));
assert.ok(!Object.hasOwn(reportSource, "titleKo"));

console.log("[test:article-card] facts-first pipeline passed");
