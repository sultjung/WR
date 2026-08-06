#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const INPUT_FILE = process.env.RECOVERED_URL_SANITIZER_INPUT_FILE
  || path.join(ROOT, "data", "recovered-articles.json");
const OUTPUT_FILE = process.env.RECOVERED_URL_SANITIZER_OUTPUT_FILE
  || INPUT_FILE;

function hostnameOf(url = "") {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function isExplicitPriorityAggregatorFallback(article = {}) {
  return hostnameOf(article.articleUrl) === "hathalyoum.net"
    && article.allowAggregatorFallback === true
    && article.recoveredSourceId === "hathalyoum";
}

function isForbiddenRecoveredUrl(article = {}) {
  const host = hostnameOf(article.articleUrl);
  if (!host) return true;

  if (host === "hathalyoum.net") {
    return !isExplicitPriorityAggregatorFallback(article);
  }

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
    || /nabd\.com$/i.test(host);
}

const payload = JSON.parse(await fs.readFile(INPUT_FILE, "utf8"));
if (!Array.isArray(payload.articles)) {
  throw new Error("recovered article payload must contain an articles array");
}

let rejectedCount = 0;
const articles = payload.articles.map((article) => {
  if (!article.articleUrl || !isForbiddenRecoveredUrl(article)) return article;

  rejectedCount += 1;
  return {
    ...article,
    rejectedArticleUrl: article.articleUrl,
    articleUrl: "",
    urlStatus: "PENDING",
    urlRecoveryMethod: null,
    recoveredSourceId: null,
    titleSimilarity: null,
    errorCode: "RECOVERED_URL_REJECTED"
  };
});

const recoveredCount = articles.filter((article) => article.articleUrl && article.urlStatus === "RECOVERED").length;
const output = {
  ...payload,
  articles,
  count: articles.length,
  recoveredCount,
  failedCount: articles.length - recoveredCount,
  rejectedRecoveredUrlCount: rejectedCount
};

await fs.writeFile(OUTPUT_FILE, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`[recover-url-sanitize] rejected=${rejectedCount}, recovered=${recoveredCount}, total=${articles.length}`);
