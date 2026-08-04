import {
  articleIdOf,
  cardIsCurrent,
  factsAreCurrent
} from "./article-card-core.mjs";

function articleList(payload = {}) {
  return Array.isArray(payload) ? payload : (Array.isArray(payload.articles) ? payload.articles : []);
}

function timestamp(value = "") {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function factsTime(article = {}) {
  return timestamp(article.cardFacts?.extractedAt);
}

function cardTime(article = {}) {
  return timestamp(article.card?.generatedAt);
}

export function mergeGeneratedCardData(latestPayload = {}, generatedPayload = {}) {
  const latestArticles = articleList(latestPayload);
  const generatedArticles = articleList(generatedPayload);
  const generatedById = new Map(
    generatedArticles.map((article, index) => [articleIdOf(article, index), article])
  );

  const stats = {
    latestArticleCount: latestArticles.length,
    generatedArticleCount: generatedArticles.length,
    matchedArticleCount: 0,
    factsMerged: 0,
    cardsMerged: 0,
    pendingCardsMerged: 0,
    preservedNewerFacts: 0,
    preservedNewerCards: 0,
    skippedMissingArticle: 0,
    skippedSourceMismatch: 0
  };

  const mergedArticles = latestArticles.map((latestArticle, index) => {
    const id = articleIdOf(latestArticle, index);
    const generatedArticle = generatedById.get(id);
    if (!generatedArticle) {
      stats.skippedMissingArticle += 1;
      return latestArticle;
    }

    stats.matchedArticleCount += 1;
    let next = { ...latestArticle };
    const generatedFacts = generatedArticle.cardFacts;
    const generatedFactsCandidate = generatedFacts
      ? { ...latestArticle, cardFacts: generatedFacts }
      : null;

    if (generatedFactsCandidate && factsAreCurrent(generatedFactsCandidate)) {
      const latestHasCurrentFacts = factsAreCurrent(latestArticle);
      if (!latestHasCurrentFacts || factsTime(generatedArticle) >= factsTime(latestArticle)) {
        next.cardFacts = generatedFacts;
        stats.factsMerged += 1;
      } else {
        stats.preservedNewerFacts += 1;
      }
    } else if (generatedFacts) {
      stats.skippedSourceMismatch += 1;
    }

    const generatedCard = generatedArticle.card;
    const generatedCardCandidate = generatedCard
      ? { ...next, card: generatedCard }
      : null;

    if (generatedCardCandidate && cardIsCurrent(generatedCardCandidate)) {
      const latestHasCurrentCard = cardIsCurrent(next);
      if (!latestHasCurrentCard || cardTime(generatedArticle) >= cardTime(next)) {
        next.card = generatedCard;
        stats.cardsMerged += 1;
      } else {
        stats.preservedNewerCards += 1;
      }
    } else if (
      generatedCard
      && String(generatedCard.status || "").toUpperCase() === "PENDING"
      && factsAreCurrent(next)
      && !cardIsCurrent(next)
    ) {
      next.card = generatedCard;
      stats.pendingCardsMerged += 1;
    }

    return next;
  });

  const changeCount = stats.factsMerged + stats.cardsMerged + stats.pendingCardsMerged;
  if (!changeCount) return { output: latestPayload, stats };

  const mergedAt = new Date().toISOString();
  const output = Array.isArray(latestPayload)
    ? mergedArticles
    : {
        ...latestPayload,
        generatedAt: mergedAt,
        articles: mergedArticles,
        cardGeneration: {
          ...(latestPayload.cardGeneration || {}),
          ...(generatedPayload.cardGeneration || {}),
          mergeMethod: "LATEST_MAIN_PLUS_GENERATED_CARD_FIELDS",
          mergedAt,
          ...stats
        }
      };

  return { output, stats };
}
