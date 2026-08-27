import { createHash } from "node:crypto";
import {
  GLOSSARY_VERSION,
  GLOSSARY_HASH,
  preferredTermsForText,
  preferredTermsSignatureForText
} from "./preferred-translation-terms.mjs";

export const TRANSLATION_PIPELINE_VERSION = "FULL_TRANSLATION_V1";
export const MIN_TRANSLATABLE_BODY_CHARS = 30;

const BISMAYAH_ARABIC_TERMS = [
  "بسماية",
  "بسمايه",
  "مدينة بسماية الجديدة",
  "مشروع بسماية"
];
const BISMAYAH_LATIN_PATTERN = /(?:^|[^a-z0-9])(bismayah|bismaya|bncp)(?:[^a-z0-9]|$)/i;

function recordOf(article = {}) {
  return article.article && typeof article.article === "object" ? article.article : article;
}

function compact(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

function normalizeArabic(value = "") {
  return String(value)
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/\u0640/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function categoryOf(article = {}) {
  const record = recordOf(article);
  return String(article.analysis?.category || article.category || record.category || "").trim().toLowerCase();
}

export function articleIdOf(article = {}, index = 0) {
  const record = recordOf(article);
  return String(article.articleId || record.articleId || article.id || `article-${index}`).trim();
}

export function isRepresentative(article = {}) {
  return article.eventGroup?.isRepresentative !== false;
}

export function sourceTitleOf(article = {}) {
  const record = recordOf(article);
  return compact(article.originalTitleArabic || record.originalTitleArabic || "");
}

export function sourceTextOf(article = {}) {
  const record = recordOf(article);
  return String(article.originalTextArabic || record.originalTextArabic || "").trim();
}

export function isBismayahArticle(article = {}) {
  if (categoryOf(article) === "bismayah") return true;

  const source = `${sourceTitleOf(article)}\n${sourceTextOf(article)}`.trim();
  if (!source) return false;

  const normalized = normalizeArabic(source);
  if (BISMAYAH_ARABIC_TERMS.some((term) => normalized.includes(normalizeArabic(term)))) return true;
  return BISMAYAH_LATIN_PATTERN.test(source);
}

export function looksLikeKoreanTranslation(value = "", options = {}) {
  const text = String(value || "").trim();
  if (!text) return false;

  const minHangul = Math.max(1, Number(options.minHangul || 10));
  const maxArabicToHangulRatio = Math.max(0, Number(options.maxArabicToHangulRatio ?? 0.15));
  const hangulCount = (text.match(/\p{Script=Hangul}/gu) || []).length;
  const arabicCount = (text.match(/\p{Script=Arabic}/gu) || []).length;
  // A Korean translation may naturally contain Latin names and numbers, but it
  // must never contain a third-language script. This catches occasional model
  // leakage such as Hindi/Devanagari words embedded in otherwise Korean text.
  const unexpectedScript = /[\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Thai}\p{Script=Myanmar}\p{Script=Sinhala}\p{Script=Armenian}\p{Script=Georgian}\p{Script=Ethiopic}\p{Script=Hebrew}\p{Script=Cyrillic}]/u;

  if (hangulCount < minHangul) return false;
  if (unexpectedScript.test(text)) return false;
  return arabicCount <= Math.max(4, Math.floor(hangulCount * maxArabicToHangulRatio));
}

export function sourceHashOf(article = {}) {
  const title = sourceTitleOf(article);
  const body = sourceTextOf(article);
  const source = `${title}\n${body}`.trim();
  return source ? createHash("sha256").update(source).digest("hex") : "";
}

function glossaryIsCurrent(translation = {}, source = "") {
  const signature = preferredTermsSignatureForText(source);
  if (!signature) return true;
  if (!translation.preferredTermsSignature) return true;
  return translation.preferredTermsSignature === signature;
}

export function translationIsCurrent(article = {}) {
  const translation = article.translation || {};
  const source = `${sourceTitleOf(article)}\n${sourceTextOf(article)}`.trim();
  const hash = sourceHashOf(article);
  return Boolean(hash)
    && String(translation.status || translation.translationStatus || "").toUpperCase() === "COMPLETED"
    && translation.pipelineVersion === TRANSLATION_PIPELINE_VERSION
    && translation.sourceContentHash === hash
    && glossaryIsCurrent(translation, source)
    && looksLikeKoreanTranslation(translation.titleKo, { minHangul: 2, maxArabicToHangulRatio: 0.2 })
    && looksLikeKoreanTranslation(translation.fullTextKo, { minHangul: 10, maxArabicToHangulRatio: 0.15 });
}

export function hasUsableArabicSource(article = {}) {
  return sourceTextOf(article).length >= MIN_TRANSLATABLE_BODY_CHARS;
}

export function needsTranslation(article = {}) {
  const fullTranslationRequired = isRepresentative(article) || isBismayahArticle(article);
  return fullTranslationRequired && hasUsableArabicSource(article) && !translationIsCurrent(article);
}

export function pendingTranslation(reason = "PENDING") {
  return {
    status: "PENDING",
    translationStatus: "PENDING",
    pipelineVersion: TRANSLATION_PIPELINE_VERSION,
    titleKo: "",
    fullTextKo: "",
    resetReason: reason
  };
}

export function reconcileTranslationState(article = {}) {
  const translation = article.translation || {};
  const status = String(translation.status || translation.translationStatus || "").toUpperCase();
  if (status !== "COMPLETED" || translationIsCurrent(article)) {
    return { article, reset: false };
  }
  return {
    article: {
      ...article,
      translation: {
        ...pendingTranslation("SOURCE_PIPELINE_OR_LANGUAGE_QUALITY_CHANGED"),
        previousModel: translation.model || null
      }
    },
    reset: true
  };
}

export function translationContextOf(article = {}) {
  const source = `${sourceTitleOf(article)}\n${sourceTextOf(article)}`;
  return {
    preferredTerms: preferredTermsForText(source),
    preferredTermsSignature: preferredTermsSignatureForText(source)
  };
}

export function normalizeTranslationResult({ titleKo, fullTextKo, model, chunkCount }, article = {}) {
  const source = `${sourceTitleOf(article)}\n${sourceTextOf(article)}`;
  const preferredTerms = preferredTermsForText(source);
  return {
    status: "COMPLETED",
    translationStatus: "COMPLETED",
    pipelineVersion: TRANSLATION_PIPELINE_VERSION,
    method: "ARABIC_TITLE_AND_FULL_TEXT_TO_KOREAN",
    sourceContentHash: sourceHashOf(article),
    sourceChars: sourceTextOf(article).length,
    translatedChars: String(fullTextKo || "").length,
    fullTranslationGenerated: true,
    glossaryVersion: GLOSSARY_VERSION,
    glossaryHash: GLOSSARY_HASH,
    preferredTermsSignature: preferredTermsSignatureForText(source),
    preferredTermsApplied: preferredTerms.map((term) => term.korean),
    model,
    chunkCount,
    generatedAt: new Date().toISOString(),
    titleKo: compact(titleKo).slice(0, 300),
    fullTextKo: String(fullTextKo || "").trim()
  };
}
