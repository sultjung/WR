#!/usr/bin/env node
import assert from "node:assert/strict";
import { isExplicitPriorityAggregatorFallback, isForbiddenArticleUrl } from "./article-url-policy.mjs";

const approvedRecovered = {
  articleUrl: "https://hathalyoum.net/articles/4207696",
  category: "politics",
  allowAggregatorFallback: true,
  recoveredSourceId: "hathalyoum",
  urlRecoveryMethod: "priority-source-index"
};
const approvedResolved = {
  articleUrl: "https://hathalyoum.net/articles/4207696",
  category: "bismayah",
  allowAggregatorFallback: true,
  priorityDiscovery: { sourceId: "hathalyoum" },
  urlResolutionMethod: "PRIORITY_AGGREGATOR_FALLBACK"
};

assert.equal(isExplicitPriorityAggregatorFallback(approvedRecovered), true);
assert.equal(isForbiddenArticleUrl(approvedRecovered), false);
assert.equal(isExplicitPriorityAggregatorFallback(approvedResolved), true);
assert.equal(isForbiddenArticleUrl(approvedResolved), false);
assert.equal(isForbiddenArticleUrl({ ...approvedRecovered, allowAggregatorFallback: false }), true);
assert.equal(isForbiddenArticleUrl({ ...approvedRecovered, recoveredSourceId: "ina" }), true);
assert.equal(isForbiddenArticleUrl({ ...approvedRecovered, urlRecoveryMethod: "source-listing" }), true);
assert.equal(isForbiddenArticleUrl({ ...approvedRecovered, articleUrl: "https://hathalyoum.net/category/iraq" }), true);
assert.equal(isForbiddenArticleUrl({ articleUrl: "https://ina.iq/articles/1001" }), false);
assert.equal(isForbiddenArticleUrl({ articleUrl: "https://news.google.com/rss/articles/example" }), true);
assert.equal(isForbiddenArticleUrl({ articleUrl: "https://nabd.com/t/1001" }), true);
assert.equal(isForbiddenArticleUrl({ articleUrl: "https://nabdapp.com/t/176337038" }), true);
console.log("[test-article-url-policy] explicit priority fallback accepted and untrusted aggregator URLs rejected");
