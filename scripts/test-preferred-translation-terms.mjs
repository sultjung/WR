#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  GLOSSARY_HASH,
  GLOSSARY_VERSION,
  preferredTermsForText
} from "./preferred-translation-terms.mjs";
import {
  cardInputOf,
  normalizeRelatedTitleResult,
  relatedTitleInputOf,
  relatedTitleIsCurrent
} from "./article-card-core.mjs";

assert.ok(GLOSSARY_VERSION);
assert.equal(GLOSSARY_HASH.length, 20);

const matched = preferredTermsForText("اجتمع مجلس الوزراء في بغداد وبحث الأوضاع في مدينة بسماية الجديدة");
assert.ok(matched.some((item) => item.korean === "국무회의"));
assert.ok(matched.some((item) => item.korean === "바그다드"));
assert.ok(matched.some((item) => item.korean === "비스마야 신도시"));
assert.equal(preferredTermsForText("اعتراض النواب على القرار").length, 0);

const representative = {
  articleId: "representative-1",
  category: "economy",
  eventGroup: { isRepresentative: true },
  originalTitleArabic: "مجلس الوزراء يناقش مشاريع بغداد",
  originalTextArabic: "x".repeat(400),
  cardFacts: {
    status: "COMPLETED",
    pipelineVersion: "FACTS_FIRST_V1",
    sourceContentHash: "unused-in-this-test",
    mainSubjectAr: "مجلس الوزراء",
    actionAr: "ناقش مشاريع بغداد",
    locationAr: "بغداد",
    eventDateAr: "",
    resultAr: "",
    keyFactsAr: [],
    numbersAr: [],
    peopleAr: [],
    organizationsAr: ["مجلس الوزراء"],
    directQuotesAr: [],
    uncertaintiesAr: [],
    multipleAgendaItems: false
  }
};
const cardInput = cardInputOf(representative, 0);
assert.ok(cardInput.preferredTerms.some((item) => item.korean === "국무회의"));
assert.ok(cardInput.preferredTerms.some((item) => item.korean === "바그다드"));

const duplicate = {
  articleId: "duplicate-1",
  category: "security",
  eventGroup: { isRepresentative: false },
  originalTitleArabic: "قيادة العمليات المشتركة تعلن إجراءً جديداً في بغداد"
};
const relatedInput = relatedTitleInputOf(duplicate, 0, "rt-0");
assert.equal(relatedInput.id, "rt-0");
assert.ok(relatedInput.preferredTerms.some((item) => item.korean === "합동작전사령부"));
assert.ok(relatedInput.preferredTerms.some((item) => item.korean === "바그다드"));

const normalized = normalizeRelatedTitleResult({ titleKo: "합동작전사령부, 바그다드에서 새 조치 발표" }, duplicate, "test-model");
const completedDuplicate = { ...duplicate, relatedTitle: normalized };
assert.equal(relatedTitleIsCurrent(completedDuplicate), true);

console.log("[test-translation-terms] preferred proper-name references and related titles passed");
