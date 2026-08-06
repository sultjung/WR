#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const SCRIPT = process.env.PRIORITY_ORIGIN_SCRIPT
  || path.resolve("scripts/preserve-priority-discovery-origins.mjs");
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "wr-priority-origin-"));
const inputFile = path.join(temp, "recovered.json");
const snapshotFile = path.join(temp, "snapshot.json");
const googleUrl = "https://news.google.com/rss/articles/example?oc=5";
const hathaUrl = "https://hathalyoum.net/articles/4207696";
const title = "الاستثمار تبحث مع هانوا الكورية استكمال مشروع بسماية وتعد بحل العقبات المالية";

function run(mode) {
  return spawnSync(process.execPath, [SCRIPT, mode], {
    env: {
      ...process.env,
      PRIORITY_ORIGIN_INPUT_FILE: inputFile,
      PRIORITY_ORIGIN_SNAPSHOT_FILE: snapshotFile
    },
    encoding: "utf8"
  });
}

try {
  await fs.writeFile(inputFile, JSON.stringify({
    schemaVersion: "1.0",
    articles: [{
      articleId: "google-candidate",
      originalTitleArabic: title,
      discoveryUrl: googleUrl,
      articleUrl: "",
      urlStatus: "PENDING",
      contentStatus: "PENDING"
    }]
  }, null, 2));
  const snapshot = run("snapshot");
  assert.equal(snapshot.status, 0, snapshot.stderr || snapshot.stdout);

  await fs.writeFile(inputFile, JSON.stringify({
    schemaVersion: "1.0",
    articles: [{
      articleId: "google-candidate",
      originalTitleArabic: title,
      discoveryUrl: hathaUrl,
      articleUrl: hathaUrl,
      priorityAggregatorUrl: hathaUrl,
      urlStatus: "RECOVERED",
      urlRecoveryMethod: "priority-source-index",
      recoveredSourceId: "hathalyoum",
      allowAggregatorFallback: true,
      contentStatus: "PENDING"
    }]
  }, null, 2));
  const restore = run("restore");
  assert.equal(restore.status, 0, restore.stderr || restore.stdout);

  const output = JSON.parse(await fs.readFile(inputFile, "utf8"));
  const article = output.articles[0];
  assert.equal(article.discoveryUrl, googleUrl);
  assert.equal(article.articleUrl, "");
  assert.equal(article.urlStatus, "PENDING");
  assert.equal(article.priorityAggregatorUrl, hathaUrl);
  assert.equal(article.recoveredSourceId, "hathalyoum");
  assert.equal(article.allowAggregatorFallback, true);
  assert.equal(article.priorityOriginPreserved, true);
  console.log("[test-priority-origin] Google News origin preserved while Hatha fallback remains available");
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
