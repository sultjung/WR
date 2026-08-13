const PRIORITY_AGGREGATOR_HOST = "hathalyoum.net";
const PRIORITY_AGGREGATOR_SOURCE_ID = "hathalyoum";
const PRIORITY_AGGREGATOR_METHODS = new Set([
  "priority-source-index",
  "priority-aggregator-source-link",
  "PRIORITY_AGGREGATOR_FALLBACK"
]);

export function hostnameOf(url = "") {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function pathnameOf(url = "") {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

function prioritySourceId(article = {}) {
  return article.recoveredSourceId || article.priorityDiscovery?.sourceId || "";
}

function priorityMethods(article = {}) {
  return [
    article.urlResolutionMethod,
    article.urlRecoveryMethod,
    article.discoveryMethod
  ].filter(Boolean);
}

export function isExplicitPriorityAggregatorFallback(article = {}) {
  return hostnameOf(article.articleUrl) === PRIORITY_AGGREGATOR_HOST
    && /^\/articles\/\d+\/?$/.test(pathnameOf(article.articleUrl))
    && article.allowAggregatorFallback === true
    && prioritySourceId(article) === PRIORITY_AGGREGATOR_SOURCE_ID
    && priorityMethods(article).some((method) => PRIORITY_AGGREGATOR_METHODS.has(method));
}

export function isForbiddenArticleUrl(article = {}) {
  const host = hostnameOf(article.articleUrl);
  if (!host) return true;
  if (host === PRIORITY_AGGREGATOR_HOST) return !isExplicitPriorityAggregatorFallback(article);

  return host === "news.google.com"
    || /(^|\.)google\.[a-z.]+$/i.test(host)
    || /gstatic\.com$/i.test(host)
    || /googleusercontent\.com$/i.test(host)
    || /facebook\.com$/i.test(host)
    || /instagram\.com$/i.test(host)
    || /youtube\.com$/i.test(host)
    || /twitter\.com$/i.test(host)
    || /(?:^|\.)x\.com$/i.test(host)
    || /w3\.org$/i.test(host)
    || /schema\.org$/i.test(host)
    || /xmlsoft\.org$/i.test(host)
    || /(^|\.)nabd(?:app)?\.com$/i.test(host);
}
