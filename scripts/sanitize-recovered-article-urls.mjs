#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { isForbiddenArticleUrl } from "./article-url-policy.mjs";

const ROOT = process.cwd();
const INPUT_FILE = process.env.RECOVERED_URL_SANITIZER_INPUT_FILE
  || path.join(ROOT, "data", "recovered-articles.json");
const OUTPUT_FILE = process.env.RECOVERED_URL_SANITIZER_OUTPUT_FILE
  || INPUT_FILE;

const payload = JSON.parse(await fs.readFile(INPUT_FILE, "utf8"));
if (!Array.isArray(payload.articles)) {
  throw new Error("recovered article payload must contain an articles array");
}

let rejectedCount = 0;
const articles = payload.articles.map((article) => {
  if (!article.articleUrl || !isForbiddenArticleUrl(article)) return article;

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
