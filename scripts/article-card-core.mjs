import { createHash } from "node:crypto";

export const CARD_PIPELINE_VERSION = "FACTS_FIRST_V1";

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
    && Boolean(compact(card.titleKo))
    && Boolean(compact(card.summaryKo));
}

export function needsFacts(article = {}) {
  return isRepresentative(article) && hasUsableArabicSource(article) && !factsAreCurrent(article);
}

export function needsCard(article = {}) {
  return isRepresentative(article) && factsAreCurrent(article) && !cardIsCurrent(article);
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
  return {
    status: "COMPLETED",
    pipelineVersion: CARD_PIPELINE_VERSION,
    method: "STRUCTURED_ARABIC_FACTS_TO_KOREAN_CARD",
    factBasis: "STRUCTURED_ARABIC_FACTS_ONLY",
    sourceContentHash: sourceHashOf(article),
    factsHash: factsHashOf(facts),
    model,
    generatedAt: new Date().toISOString(),
    titleKo: compact(item.titleKo).slice(0, 140),
    summaryKo: compact(item.summaryKo).slice(0, 700),
    fullTranslationGenerated: false
  };
}

export function reportSourceOf(article = {}, index = 0) {
  const record = recordOf(article);
  return {
    id: articleIdOf(article, index),
    category: categoryOf(article),
    sourceArabic: compact(article.sourceArabic || article.source?.arabicName || record.sourceArabic || ""),
    publishedAt: String(article.publishedAt || record.publishedAt || ""),
    articleUrl: String(article.articleUrl || record.articleUrl || article.canonicalUrl || record.canonicalUrl || ""),
    originalTitleArabic: sourceTitleOf(article),
    originalTextArabic: sourceTextOf(article)
  };
}
