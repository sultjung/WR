#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const DISCOVERY_SCRIPT = process.env.PRIORITY_DISCOVERY_SCRIPT || path.resolve("scripts/discover-priority-source-news.mjs");

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(port) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await new Promise((resolve, reject) => {
        const socket = net.createConnection({ host: "127.0.0.1", port }, () => {
          socket.end();
          resolve();
        });
        socket.once("error", reject);
      });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error("test HTTP server did not start");
}

const temp = await fs.mkdtemp(path.join(os.tmpdir(), "wr-priority-link-filter-"));
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const root = path.join(temp, "web");
const articlePath = "/hatha/articles/4207696";
const articleUrl = `${base}${articlePath}`;
const title = "رئيس الهيئة الوطنية للاستثمار يبحث سير العمل في مشروع بسماية مع شركة هانوا الكورية";

await fs.mkdir(path.join(root, "nic"), { recursive: true });
await fs.mkdir(path.join(root, "hatha", "articles"), { recursive: true });
await fs.writeFile(path.join(root, "nic", "feed"), "<?xml version=\"1.0\"?><rss><channel></channel></rss>");
await fs.writeFile(
  path.join(root, "hatha", "articles", "4207696"),
  `<html><head><meta property="og:title" content="${title}"><meta property="og:description" content="متابعة مشروع بسماية مع شركة هانوا"></head><body><a href="https://google.com/preferences/source?q=hathalyoum.net">المصدر</a><article>النص</article></body></html>`
);

const server = spawn("python", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", root], { stdio: "ignore" });
try {
  await waitForServer(port);
  const seedsFile = path.join(temp, "seeds.json");
  const inputFile = path.join(temp, "recovered.json");
  await fs.writeFile(seedsFile, JSON.stringify({ schemaVersion: "1.0", urls: [{ url: articleUrl, enabled: true }] }));
  await fs.writeFile(inputFile, JSON.stringify({
    schemaVersion: "1.0",
    articles: [{
      articleId: "existing-google-news-item",
      keywordId: "bismayah-direct-001",
      category: "bismayah",
      originalTitleArabic: title,
      discoveryUrl: "https://news.google.com/rss/articles/example",
      articleUrl: "",
      urlStatus: "PENDING",
      contentStatus: "PENDING"
    }],
    recoveredCount: 0,
    failedCount: 1
  }));

  const run = spawnSync(process.execPath, [DISCOVERY_SCRIPT], {
    env: {
      ...process.env,
      PRIORITY_DISCOVERY_INPUT_FILE: inputFile,
      PRIORITY_DISCOVERY_OUTPUT_FILE: inputFile,
      PRIORITY_DISCOVERY_SEEDS_FILE: seedsFile,
      PRIORITY_DISCOVERY_TEST_BASE: base,
      PRIORITY_DISCOVERY_TIMEOUT_MS: "3000",
      PRIORITY_DISCOVERY_MAX_DETAIL_FETCHES: "10",
      NEWS_DISCOVERY_DAYS: "30"
    },
    encoding: "utf8"
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);

  const output = JSON.parse(await fs.readFile(inputFile, "utf8"));
  assert.equal(output.articles.length, 1, run.stdout);
  const article = output.articles[0];
  assert.equal(article.articleUrl, articleUrl, "Google source-preference links must not replace the Hatha Alyoum article URL");
  assert.equal(article.discoveryUrl, articleUrl, "the valid aggregator article URL must be preserved during title-based upgrade");
  assert.equal(article.priorityAggregatorUrl, articleUrl);
  assert.equal(article.recoveredSourceId, "hathalyoum");
  assert.equal(article.allowAggregatorFallback, true);
  assert.equal(article.urlStatus, "RECOVERED");
  assert.ok(!article.articleUrl.includes("google.com/preferences/source"));
  console.log("[test-priority-source-publisher-link-filter] Google preference link rejected; Hatha Alyoum fallback preserved");
} finally {
  server.kill("SIGTERM");
  await fs.rm(temp, { recursive: true, force: true });
}
