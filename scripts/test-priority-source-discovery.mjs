#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const DISCOVERY_SCRIPT = process.env.PRIORITY_DISCOVERY_SCRIPT || path.resolve("scripts/discover-priority-source-news.mjs");
const RESTORE_SCRIPT = process.env.PRIORITY_RESTORE_SCRIPT || path.resolve("scripts/restore-priority-aggregator-urls.mjs");

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
  for (let i = 0; i < 40; i += 1) {
    try {
      await new Promise((resolve, reject) => {
        const socket = net.createConnection({ host: "127.0.0.1", port }, () => { socket.end(); resolve(); });
        socket.once("error", reject);
      });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error("test HTTP server did not start");
}

const temp = await fs.mkdtemp(path.join(os.tmpdir(), "wr-priority-source-"));
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const root = path.join(temp, "web");
await fs.mkdir(path.join(root, "nic"), { recursive: true });
await fs.mkdir(path.join(root, "hatha", "articles"), { recursive: true });
const title = "رئيس الهيئة الوطنية للاستثمار يبحث سير العمل في مشروع بسماية مع شركة هانوا الكورية";
const genericNicTitle = "إطلاق خمس فرص استثمارية جديدة في قطاعات الإسكان والطاقة والصناعة";
const hathaPath = path.join(root, "hatha", "articles", "4207696");
const nicFeedPath = path.join(root, "nic", "feed");
await fs.writeFile(nicFeedPath, `<?xml version="1.0"?><rss><channel><item><title>${title}</title><link>${base}/nic/article-5001</link><pubDate>Wed, 05 Aug 2026 12:00:00 GMT</pubDate><description>متابعة مشروع بسماية مع شركة هانوا</description></item><item><title>${genericNicTitle}</title><link>${base}/nic/article-5002</link><pubDate>Thu, 06 Aug 2026 12:00:00 GMT</pubDate><description>فرص استثمارية رسمية جديدة</description></item></channel></rss>`);
await fs.writeFile(path.join(root, "nic", "article-5001"), `<html><head><meta property="og:title" content="${title}"></head><body><article>النص</article></body></html>`);
await fs.writeFile(path.join(root, "nic", "article-5002"), `<html><head><meta property="og:title" content="${genericNicTitle}"></head><body><article>النص</article></body></html>`);
await fs.writeFile(hathaPath, `<html><head><meta property="og:title" content="${title}"><meta property="og:description" content="رئيس الهيئة الوطنية للاستثمار يتابع مشروع بسماية مع شركة هانوا"></head><body><article>النص</article></body></html>`);

const server = spawn("python", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", root], { stdio: "ignore" });
try {
  await waitForServer(port);
  const seedsFile = path.join(temp, "seeds.json");
  const inputFile = path.join(temp, "recovered.json");
  const resolvedFile = path.join(temp, "resolved.json");
  await fs.writeFile(seedsFile, JSON.stringify({ schemaVersion: "1.0", urls: [{ url: `${base}/hatha/articles/4207696`, enabled: true }] }));
  await fs.writeFile(inputFile, JSON.stringify({ schemaVersion: "1.0", articles: [], recoveredCount: 0, failedCount: 0 }));

  const commonEnv = {
    ...process.env,
    PRIORITY_DISCOVERY_INPUT_FILE: inputFile,
    PRIORITY_DISCOVERY_OUTPUT_FILE: inputFile,
    PRIORITY_DISCOVERY_SEEDS_FILE: seedsFile,
    PRIORITY_DISCOVERY_TEST_BASE: base,
    PRIORITY_DISCOVERY_TIMEOUT_MS: "3000",
    PRIORITY_DISCOVERY_MAX_DETAIL_FETCHES: "10",
    NEWS_DISCOVERY_DAYS: "30"
  };

  const run = spawnSync(process.execPath, [DISCOVERY_SCRIPT], { env: commonEnv, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const output = JSON.parse(await fs.readFile(inputFile, "utf8"));
  assert.equal(output.articles.length, 2, run.stdout);
  const officialCopy = output.articles.find((article) => article.originalTitleArabic === title);
  const genericOfficialPost = output.articles.find((article) => article.originalTitleArabic === genericNicTitle);
  assert.equal(officialCopy?.recoveredSourceId, "nic", "official NIC copy must win over duplicate aggregator copy");
  assert.equal(officialCopy?.allowAggregatorFallback, false);
  assert.equal(genericOfficialPost?.officialSource, true, "generic NIC official posts must be collected without a Bismayah keyword");
  assert.equal(genericOfficialPost?.sourceReliability, "OFFICIAL");

  await fs.writeFile(nicFeedPath, `<?xml version="1.0"?><rss><channel></channel></rss>`);
  await fs.rm(path.join(root, "nic", "article-5001"));
  await fs.rm(path.join(root, "nic", "article-5002"));
  await fs.writeFile(inputFile, JSON.stringify({ schemaVersion: "1.0", articles: [], recoveredCount: 0, failedCount: 0 }));
  const fallbackRun = spawnSync(process.execPath, [DISCOVERY_SCRIPT], { env: commonEnv, encoding: "utf8" });
  assert.equal(fallbackRun.status, 0, fallbackRun.stderr || fallbackRun.stdout);
  const fallbackOutput = JSON.parse(await fs.readFile(inputFile, "utf8"));
  assert.equal(fallbackOutput.articles.length, 1, fallbackRun.stdout);
  assert.equal(fallbackOutput.articles[0].recoveredSourceId, "hathalyoum");
  assert.equal(fallbackOutput.articles[0].allowAggregatorFallback, true);

  await fs.writeFile(resolvedFile, JSON.stringify({ schemaVersion: "1.0", articles: fallbackOutput.articles.map((article) => ({ ...article, articleUrl: "", urlStatus: "FAILED", errorCode: "URL_RESOLUTION_FAILED" })) }));
  const restore = spawnSync(process.execPath, [RESTORE_SCRIPT], {
    env: { ...process.env, PRIORITY_RECOVERED_FILE: inputFile, PRIORITY_RESOLVED_FILE: resolvedFile }, encoding: "utf8"
  });
  assert.equal(restore.status, 0, restore.stderr || restore.stdout);
  const restored = JSON.parse(await fs.readFile(resolvedFile, "utf8"));
  assert.equal(restored.priorityAggregatorFallbackRestored, 1);
  assert.equal(restored.articles[0].urlResolutionMethod, "PRIORITY_AGGREGATOR_FALLBACK");
  assert.equal(restored.articles[0].urlStatus, "RESOLVED");
  console.log("[test-priority-source-discovery] official-first and aggregator fallback passed");
} finally {
  server.kill("SIGTERM");
  await fs.rm(temp, { recursive: true, force: true });
}
