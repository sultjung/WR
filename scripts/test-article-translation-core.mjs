#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  isBismayahArticle,
  looksLikeKoreanTranslation,
  needsTranslation,
  normalizeTranslationResult,
  sourceHashOf,
  translationIsCurrent
} from "./article-translation-core.mjs";

const arabicBody = "بحث رئيس الهيئة الوطنية للاستثمار مع ممثل شركة هانوا سير العمل في مشروع مدينة بسماية الجديدة ومعالجة تحديات التمويل واستكمال الأعمال المتبقية.";

const relatedBismayah = {
  articleId: "test-bismayah-related",
  category: "bismayah",
  eventGroup: { isRepresentative: false },
  originalTitleArabic: "مناقشة مشروع بسماية مع شركة هانوا",
  originalTextArabic: arabicBody
};

assert.equal(isBismayahArticle(relatedBismayah), true, "Bismayah category must be recognized");
assert.equal(needsTranslation(relatedBismayah), true, "non-representative Bismayah article must receive full translation");

const alternateSpelling = {
  articleId: "test-bismayah-alt",
  category: "politics",
  eventGroup: { isRepresentative: false },
  originalTitleArabic: "متابعة مشروع بسمايه",
  originalTextArabic: arabicBody.replaceAll("بسماية", "بسمايه")
};
assert.equal(isBismayahArticle(alternateSpelling), true, "alternate Arabic spelling بسمايه must be recognized");
assert.equal(needsTranslation(alternateSpelling), true, "exact Bismayah source mention must override duplicate representative status");

const falsePositive = {
  articleId: "test-bisma-false-positive",
  category: "politics",
  eventGroup: { isRepresentative: false },
  originalTitleArabic: "شكوى ضد شركة سما",
  originalTextArabic: "رفعت شكوى بسما بسبب خلاف تجاري ولا توجد أي صلة بالمشروع السكني أو بمدينة عراقية محددة."
};
assert.equal(isBismayahArticle(falsePositive), false, "partial بسما text must not be treated as Bismayah");
assert.equal(needsTranslation(falsePositive), false, "unrelated duplicate article must not gain full-translation cost");

assert.equal(looksLikeKoreanTranslation(arabicBody), false, "Arabic source text must not pass Korean translation quality check");
assert.equal(
  looksLikeKoreanTranslation("국가투자위원회는 비스마야 신도시 사업의 자금조달 문제와 잔여 공사 완료 방안을 논의했다."),
  true,
  "normal Korean translation must pass language quality check"
);

const badCompleted = {
  ...relatedBismayah,
  translation: {
    status: "COMPLETED",
    translationStatus: "COMPLETED",
    pipelineVersion: "FULL_TRANSLATION_V1",
    sourceContentHash: sourceHashOf(relatedBismayah),
    titleKo: "투자위원회, 비스마야 사업 논의",
    fullTextKo: arabicBody
  }
};
assert.equal(translationIsCurrent(badCompleted), false, "Arabic body stored in fullTextKo must be treated as stale");
assert.equal(needsTranslation(badCompleted), true, "Arabic body stored as completed must be queued for retranslation");

const goodTranslation = normalizeTranslationResult({
  titleKo: "투자위원회, 한화와 비스마야 사업 진행 상황 논의",
  fullTextKo: "국가투자위원회 위원장은 한화 측 대표단과 비스마야 신도시 사업의 진행 상황을 논의했다. 위원장은 자금조달 문제와 잔여 공사 완료를 위한 정부 지원 방안을 관련 기관에 제안하겠다고 밝혔다.",
  model: "test-model",
  chunkCount: 1
}, relatedBismayah);
const completed = { ...relatedBismayah, translation: goodTranslation };
assert.equal(translationIsCurrent(completed), true, "valid Korean full translation must remain current");
assert.equal(needsTranslation(completed), false, "valid completed translation must not be regenerated");

console.log("[test-article-translation-core] passed");
