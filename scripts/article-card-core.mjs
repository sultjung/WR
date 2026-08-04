import { createHash } from "node:crypto";
import {
  GLOSSARY_HASH,
  GLOSSARY_VERSION,
  preferredTermsForText,
  preferredTermsSignatureForText
} from "./preferred-translation-terms.mjs";

export const CARD_PIPELINE_VERSION = "FACTS_FIRST_V1";
export const RELATED_TITLE_PIPELINE_VERSION = "RELATED_TITLE_V1";

function recordOf(article = {}) {
  return article.article && typeof article.article === "object" ? article.article : article;
}

function compact(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

function listOf(value, maxItems = 8, maxChars = 300) {
  const values = Array.isArray(value) ? value : [];
  return values
    .map((item) => compact(item).slice(0, maxChars))
    .filter(Boolean)
    .slice(0, maxItems);
}

function factsTextOf(facts = {}) {
  return [
    facts.mainSubjectAr,
    facts.actionAr,
    facts.locationAr,
    facts.eventDateAr,
    facts.resultAr,
    ...(Array.isArray(facts.keyFactsAr) ? facts.keyFactsAr : []),
    ...(Array.isArray(facts.numbersAr) ? facts.numbersAr : []),
    ...(Array.isArray(facts.peopleAr) ? facts.peopleAr : []),
    ...(Array.isArray(facts.organizationsAr) ? facts.organizationsAr : []),
    ...(Array.isArray(facts.directQuotesAr) ? facts.directQuotesAr : [])
  ].filter(Boolean).join("\n");
}

function glossaryIsCurrent(stored = {}, sourceText = "") {
  const signature = preferredTermsSignatureForText(sourceText);
  if (!signature) return true;

  // Legacy cards predate term-level signatures. They remain usable instead of
  // forcing a mass regeneration whenever the glossary file itself changes.
  if (!stored.preferredTermsSignature) return true;
  return stored.preferredTermsSignature === signature;
}

export function articleIdOf(article = {}, index = 0) {
  const record = recordOf(article);
  return String(article.articleId || record.articleId || article.id || `article-${index}`);
}

export function categoryOf(article = {}) {
  const record = recordOf(article);
  return String(article.analysis?.category || article.category || record.category || "").toLowerCase();
}

export function sourceTextOf(article = {}) {
  const record = recordOf(article);
  return String(article.originalTextArabic || record.originalTextArabic || "").trim();
}

export function sourceTitleOf(article = {}) {
  const record = recordOf(article);
  return compact(article.originalTitleArabic || record.originalTitleArabic || "");
}

export function sourceHashOf(article = {}) {
  const source = `${sourceTitleOf(article)}\n${compact(sourceTextOf(article))}`.trim();
  return source ? createHash("sha256").update(source).digest("hex") : "";
}

export function sourceTitleHashOf(article = {}) {
  const title = sourceTitleOf(article);
  return title ? createHash("sha256").update(title).digest("hex") : "";
}

export function factsHashOf(facts = {}) {
  const stable = {
    mainSubjectAr: compact(facts.mainSubjectAr),
    actionAr: compact(facts.actionAr),
    locationAr: compact(facts.locationAr),
    eventDateAr: compact(facts.eventDateAr),
    resultAr: compact(facts.resultAr),
    keyFactsAr: listOf(facts.keyFactsAr),
    numbersAr: listOf(facts.numbersAr),
    peopleAr: listOf(facts.peopleAr),
    organizationsAr: listOf(facts.organizationsAr),
    directQuotesAr: listOf(facts.directQuotesAr, 4, 500),
    uncertaintiesAr: listOf(facts.uncertaintiesAr, 4, 300),
    multipleAgendaItems: Boolean(facts.multipleAgendaItems)
  };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

export function isRepresentative(article = {}) {
  return article.eventGroup?.isRepresentative !== false;
}

export function hasUsableArabicSource(article = {}) {
  return sourceTextOf(article).length >= 300;
}

export function factsAreCurrent(article = {}) {
  const facts = article.cardFacts || {};
  const hash = sourceHashOf(article);
  return Boolean(hash)
    && String(facts.status || "").toUpperCase() === "COMPLETED"
    && facts.pipelineVersion === CARD_PIPELINE_VERSION
    && facts.sourceContentHash === hash
    && Boolean(compact(facts.mainSubjectAr) || listOf(facts.keyFactsAr).length);
}

export function cardIsCurrent(article = {}) {
  const card = article.card || {};
  const facts = article.cardFacts || {};
  return factsAreCurrent(article)
    && String(card.status || "").toUpperCase() === "COMPLETED"
    && card.pipelineVersion === CARD_PIPELINE_VERSION
    && card.sourceContentHash === sourceHashOf(article)
    && card.factsHash === factsHashOf(facts)
    && glossaryIsCurrent(card, factsTextOf(facts))
    && Boolean(compact(card.titleKo))
    && Boolean(compact(card.summaryKo));
}

export function relatedTitleIsCurrent(article = {}) {
  const relatedTitle = article.relatedTitle || {};
  const title = sourceTitleOf(article);
  return Boolean(title)
    && String(relatedTitle.status || "").toUpperCase() === "COMPLETED"
    && relatedTitle.pipelineVersion === RELATED_TITLE_PIPELINE_VERSION
    && relatedTitle.sourceTitleHash === sourceTitleHashOf(article)
    && glossaryIsCurrent(relatedTitle, title)
    && Boolean(compact(relatedTitle.titleKo));
}

export function reconcileArticleCardState(article = {}) {
  let next = article;
  let factsReset = false;
  let cardReset = false;
  const factsStatus = String(article.cardFacts?.status || "").toUpperCase();
  const cardStatus = String(article.card?.status || "").toUpperCase();

  if (factsStatus === "COMPLETED" && !factsAreCurrent(article)) {
    next = {
      ...next,
      cardFacts: {
        ...(article.cardFacts || {}),
        status: "PENDING",
        pipelineVersion: CARD_PIPELINE_VERSION,
        resetReason: "SOURCE_OR_PIPELINE_CHANGED"
      }
    };
    factsReset = true;
  }

  if (cardStatus === "COMPLETED" && (factsReset || !cardIsCurrent(next))) {
    next = {
      ...next,
      card: {
        ...(article.card || {}),
        status: "PENDING",
        pipelineVersion: CARD_PIPELINE_VERSION,
        resetReason: factsReset ? "FACTS_STALE" : "CARD_STALE"
      }
    };
    cardReset = true;
  }

  return {
    article: next,
    factsReset,
    cardReset,
    changed: factsReset || cardReset
  };
}

export function needsFacts(article = {}) {
  return isRepresentative(article) && hasUsableArabicSource(article) && !factsAreCurrent(article);
}

export function needsCard(article = {}) {
  return isRepresentative(article) && factsAreCurrent(article) && !cardIsCurrent(article);
}

export function needsRelatedTitle(article = {}) {
  return !isRepresentative(article) && Boolean(sourceTitleOf(article)) && !relatedTitleIsCurrent(article);
}

export function factsInputOf(article = {}, index = 0, maxSourceChars = 16000) {
  const record = recordOf(article);
  return {
    id: articleIdOf(article, index),
    category: categoryOf(article),
    sourceArabic: compact(article.sourceArabic || article.source?.arabicName || record.sourceArabic || ""),
    publishedAt: String(article.publishedAt || record.publishedAt || ""),
    titleArabic: sourceTitleOf(article),
    bodyArabic: sourceTextOf(article).slice(0, Math.max(1000, maxSourceChars))
  };
}

export function cardInputOf(article = {}, index = 0) {
  const facts = article.cardFacts || {};
  return {
    id: articleIdOf(article, index),
    category: categoryOf(article),
    sourceArabic: compact(article.sourceArabic || article.source?.arabicName || ""),
    publishedAt: String(article.publishedAt || article.article?.publishedAt || ""),
    preferredTerms: preferredTermsForText(factsTextOf(facts)),
    factsArabic: {
      mainSubjectAr: compact(facts.mainSubjectAr),
      actionAr: compact(facts.actionAr),
      locationAr: compact(facts.locationAr),
      eventDateAr: compact(facts.eventDateAr),
      resultAr: compact(facts.resultAr),
      keyFactsAr: listOf(facts.keyFactsAr),
      numbersAr: listOf(facts.numbersAr),
      peopleAr: listOf(facts.peopleAr),
      organizationsAr: listOf(facts.organizationsAr),
      directQuotesAr: listOf(facts.directQuotesAr, 4, 500),
      uncertaintiesAr: listOf(facts.uncertaintiesAr, 4, 300),
      multipleAgendaItems: Boolean(facts.multipleAgendaItems)
    }
  };
}

export function relatedTitleInputOf(article = {}, index = 0, requestId = "") {
  return {
    id: requestId || articleIdOf(article, index),
    category: categoryOf(article),
    sourceArabic: compact(article.sourceArabic || article.source?.arabicName || ""),
    publishedAt: String(article.publishedAt || article.article?.publishedAt || ""),
    titleArabic: sourceTitleOf(article),
    preferredTerms: preferredTermsForText(sourceTitleOf(article))
  };
}

export function normalizeFactsResult(item = {}, article = {}, model = "") {
  return {
    status: "COMPLETED",
    pipelineVersion: CARD_PIPELINE_VERSION,
    method: "ARABIC_SOURCE_FACT_EXTRACTION",
    sourceContentHash: sourceHashOf(article),
    model,
    extractedAt: new Date().toISOString(),
    mainSubjectAr: compact(item.mainSubjectAr).slice(0, 400),
    actionAr: compact(item.actionAr).slice(0, 600),
    locationAr: compact(item.locationAr).slice(0, 250),
    eventDateAr: compact(item.eventDateAr).slice(0, 200),
    resultAr: compact(item.resultAr).slice(0, 600),
    keyFactsAr: listOf(item.keyFactsAr, 7, 500),
    numbersAr: listOf(item.numbersAr, 10, 250),
    peopleAr: listOf(item.peopleAr, 10, 250),
    organizationsAr: listOf(item.organizationsAr, 10, 300),
    directQuotesAr: listOf(item.directQuotesAr, 4, 600),
    uncertaintiesAr: listOf(item.uncertaintiesAr, 4, 400),
    multipleAgendaItems: Boolean(item.multipleAgendaItems)
  };
}

export function normalizeCardResult(item = {}, article = {}, model = "") {
  const facts = article.cardFacts || {};
  const factsText = factsTextOf(facts);
  const preferredTerms = preferredTermsForText(factsText);
  return {
    status: "COMPLETED",
    pipelineVersion: CARD_PIPELINE_VERSION,
    method: "STRUCTURED_ARABIC_FACTS_TO_KOREAN_CARD",
    factBasis: "STRUCTURED_ARABIC_FACTS_ONLY",
    sourceContentHash: sourceHashOf(article),
    factsHash: factsHashOf(facts),
    glossaryVersion: GLOSSARY_VERSION,
    glossaryHash: GLOSSARY_HASH,
    preferredTermsSignature: preferredTermsSignatureForText(factsText),
    preferredTermsApplied: preferredTerms.map((term) => term.korean),
    model,
    generatedAt: new Date().toISOString(),
    titleKo: compact(item.titleKo).slice(0, 140),
    summaryKo: compact(item.summaryKo).slice(0, 700),
    fullTranslationGenerated: false
  };
}

export function normalizeRelatedTitleResult(item = {}, article = {}, model = "") {
  const title = sourceTitleOf(article);
  const preferredTerms = preferredTermsForText(title);
  return {
    status: "COMPLETED",
    pipelineVersion: RELATED_TITLE_PIPELINE_VERSION,
    method: "ARABIC_HEADLINE_TO_KOREAN_RELATED_TITLE",
    sourceTitleHash: sourceTitleHashOf(article),
    glossaryVersion: GLOSSARY_VERSION,
    glossaryHash: GLOSSARY_HASH,
    preferredTermsSignature: preferredTermsSignatureForText(title),
    preferredTermsApplied: preferredTerms.map((term) => term.korean),
    model,
    generatedAt: new Date().toISOString(),
    titleKo: compact(item.titleKo).slice(0, 160)
  };
}

export function reportSourceOf(article = {}, index = 0) {
  const record = recordOf(article);
  const originalTextArabic = sourceTextOf(article);
  return {
    id: articleIdOf(article, index),
    category: categoryOf(article),
    sourceArabic: compact(article.sourceArabic || article.source?.arabicName || record.sourceArabic || ""),
    publishedAt: String(article.publishedAt || record.publishedAt || ""),
    articleUrl: String(article.articleUrl || record.articleUrl || article.canonicalUrl || record.canonicalUrl || ""),
    originalTitleArabic: sourceTitleOf(article),
    originalTextArabic,
    preferredTerms: preferredTermsForText(`${sourceTitleOf(article)}\n${originalTextArabic}`)
  };
}
