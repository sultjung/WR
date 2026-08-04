#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  normalizeCardResult,
  normalizeFactsResult
} from "./article-card-core.mjs";
import { mergeGeneratedCardData } from "./article-card-merge.mjs";

function sourceText(label) {
  return `${label} ${"نص عربي مؤكد عن القرار والنتيجة والمكان والتاريخ. ".repeat(10)}`;
}

const latestSame = {
  articleId: "same-source",
  category: "politics",
  originalTitleArabic: "قرار حكومي جديد",
  originalTextArabic: sourceText("A"),
  eventGroup: { isRepresentative: true }
};

const generatedSame = { ...latestSame };
generatedSame.cardFacts = normalizeFactsResult({
  mainSubjectAr: "مجلس الوزراء العراقي",
  actionAr: "اتخذ قراراً جديداً",
  locationAr: "بغداد",
  eventDateAr: "4 آب 2026",
  resultAr: "تكليف الجهات المعنية بالتنفيذ",
  keyFactsAr: ["صدر القرار خلال جلسة رسمية"],
  numbersAr: ["4 آب 2026"],
  peopleAr: [],
  organizationsAr: ["مجلس الوزراء العراقي"],
  directQuotesAr: [],
  uncertaintiesAr: [],
  multipleAgendaItems: false
}, generatedSame, "mock-fact-model");
generatedSame.card = normalizeCardResult({
  titleKo: "이라크 각료회의, 신규 정부 결정 채택",
  summaryKo: "이라크 각료회의는 바그다드에서 신규 결정을 채택하고 관계기관에 후속 이행을 지시함."
}, generatedSame, "mock-card-model");

const latestChanged = {
  articleId: "changed-source",
  category: "economy",
  originalTitleArabic: "عنوان محدث",
  originalTextArabic: sourceText("NEW"),
  eventGroup: { isRepresentative: true }
};
const generatedChanged = {
  ...latestChanged,
  originalTextArabic: sourceText("OLD")
};
generatedChanged.cardFacts = normalizeFactsResult({
  mainSubjectAr: "وزارة التخطيط",
  actionAr: "أعلنت خطة",
  locationAr: "بغداد",
  eventDateAr: "",
  resultAr: "بدء التنفيذ",
  keyFactsAr: ["خطة قديمة"],
  numbersAr: [],
  peopleAr: [],
  organizationsAr: ["وزارة التخطيط"],
  directQuotesAr: [],
  uncertaintiesAr: [],
  multipleAgendaItems: false
}, generatedChanged, "mock-fact-model");

const latestOnly = {
  articleId: "latest-only",
  category: "security",
  originalTitleArabic: "خبر أمني عراقي",
  originalTextArabic: sourceText("C"),
  eventGroup: { isRepresentative: true }
};

const latestPayload = { schemaVersion: "1.0", articles: [latestSame, latestChanged, latestOnly] };
const generatedPayload = { schemaVersion: "1.0", articles: [generatedSame, generatedChanged] };
const { output, stats } = mergeGeneratedCardData(latestPayload, generatedPayload);

const byId = new Map(output.articles.map((article) => [article.articleId, article]));
assert.equal(byId.get("same-source").card.status, "COMPLETED");
assert.equal(byId.get("same-source").cardFacts.status, "COMPLETED");
assert.equal(byId.get("changed-source").cardFacts, undefined);
assert.equal(byId.get("latest-only").originalTitleArabic, "خبر أمني عراقي");
assert.equal(stats.cardsMerged, 1);
assert.equal(stats.factsMerged, 1);
assert.equal(stats.skippedSourceMismatch, 1);

console.log("[test:article-card-merge] latest data preserved and matching cards merged");
