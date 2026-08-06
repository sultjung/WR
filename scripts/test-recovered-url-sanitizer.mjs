#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const SCRIPT = process.env.RECOVERED_URL_SANITIZER_SCRIPT
  || path.resolve("scripts/sanitize-recovered-article-urls.mjs");
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "wr-recovered-url-sanitizer-"));
const inputFile = path.join(temp, "recovered.json");

try {
  await fs.writeFile(inputFile, JSON.stringify({
    schemaVersion: "1.0",
    count: 5,
    recoveredCount: 5,
    failedCount: 0,
    articles: [
      {
        articleId: "valid-publisher",
        articleUrl: "https://ina.iq/articles/1001",
        urlStatus: "RECOVERED",
        recoveredSourceId: "ina"
      },
      {
        articleId: "google-preferences",
        articleUrl: "https://google.com/preferences/source?q=hathalyoum.net",
        urlStatus: "RECOVERED",
        recoveredSourceId: "ina"
      },
      {
        articleId: "google-news",
        articleUrl: "https://news.google.com/rss/articles/example",
        urlStatus: "RECOVERED",
        recoveredSourceId: "ina"
      },
      {
        articleId: "unapproved-aggregator",
        articleUrl: "https://hathalyoum.net/articles/4207696",
        urlStatus: "RECOVERED",
        recoveredSourceId: "ina"
      },
      {
        articleId: "approved-priority-fallback",
        articleUrl: "https://hathalyoum.net/articles/4207696",
        urlStatus: "RECOVERED",
        recoveredSourceId: "hathalyoum",
        allowAggregatorFallback: true
      }
    ]
  }, null, 2));

  const run = spawnSync(process.execPath, [SCRIPT], {
    env: {
      ...process.env,
      RECOVERED_URL_SANITIZER_INPUT_FILE: inputFile,
      RECOVERED_URL_SANITIZER_OUTPUT_FILE: inputFile
    },
    encoding: "utf8"
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);

  const output = JSON.parse(await fs.readFile(inputFile, "utf8"));
  const byId = new Map(output.articles.map((article) => [article.articleId, article]));

  assert.equal(byId.get("valid-publisher").articleUrl, "https://ina.iq/articles/1001");
  assert.equal(byId.get("approved-priority-fallback").articleUrl, "https://hathalyoum.net/articles/4207696");

  for (const id of ["google-preferences", "google-news", "unapproved-aggregator"]) {
    const article = byId.get(id);
    assert.equal(article.articleUrl, "");
    assert.equal(article.urlStatus, "PENDING");
    assert.equal(article.errorCode, "RECOVERED_URL_REJECTED");
    assert.ok(article.rejectedArticleUrl);
  }

  assert.equal(output.rejectedRecoveredUrlCount, 3);
  assert.equal(output.recoveredCount, 2);
  assert.equal(output.failedCount, 3);
  console.log("[test-recovered-url-sanitizer] invalid recovered URLs rejected; explicit priority fallback preserved");
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
