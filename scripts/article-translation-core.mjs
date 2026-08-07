import { createHash } from "node:crypto";
import {
  GLOSSARY_VERSION,
  GLOSSARY_HASH,
  preferredTermsForText,
  preferredTermsSignatureForText
} from "./preferred-translation-terms.mjs";

export const TRANSLATION_PIPELINE_VERSION = "FULL_TRANSLATION_V1";

function recordOf(article = {}) {
  return article.article && typeof article.article === "object" ? article.article : article;
}

function compact(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
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
    && Boolean(compact(translation.titleKo))
    && String(translation.fullTextKo || "").trim().length >= 50;
}

export function hasUsableArabicSource(article = {}) {
  return sourceTextOf(article).length >= 300;
}

export function needsTranslation(article = {}) {
  return isRepresentative(article) && hasUsableArabicSource(article) && !translationIsCurrent(article);
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
        ...pendingTranslation("SOURCE_OR_PIPELINE_CHANGED"),
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
