#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "wr-google-cse-"));
const input = path.join(temp, "recovered.json");
const server = http.createServer((request, response) => {
  const query = new URL(request.url, "http://localhost").searchParams.get("q");
  response.setHeader("content-type", "application/json");
  const items = query === "بسماية" ? [{
    title: "رئيس الهيئة الوطنية للاستثمار يناقش حلول استئناف مشروع بسماية",
    link: "https://investpromo.gov.iq/ar/nic-bismayah-test/",
    snippet: "بحثت الهيئة استئناف العمل مع شركة هانوا",
    pagemap: { metatags: [{ "article:published_time": "2026-08-23T14:00:00+03:00" }] }
  }] : query === "site:facebook.com/profile.php?id=100090604137582" ? [{
    title: "الهيئة الوطنية للاستثمار تبحث خطة استثمارية جديدة",
    link: "https://www.facebook.com/permalink.php?story_fbid=123456789&id=100090604137582",
    snippet: "ناقشت الهيئة الوطنية للاستثمار الخطط والمشاريع الاستثمارية الجديدة في العراق",
    pagemap: { metatags: [{ "article:published_time": "2026-08-24T14:00:00+03:00" }] }
  }] : [];
  response.end(JSON.stringify({ items }));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  await fs.writeFile(input, JSON.stringify({ schemaVersion: "1.0", articles: [] }));
  const port = server.address().port;
  const run = await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, "scripts/discover-nic-google-cse.mjs")], {
    cwd: ROOT,
    env: { ...process.env, GOOGLE_CSE_API_KEY: "test", GOOGLE_CSE_ID: "test", GOOGLE_CSE_ENDPOINT: `http://127.0.0.1:${port}/search`, GOOGLE_CSE_INPUT_FILE: input, GOOGLE_CSE_OUTPUT_FILE: input, GOOGLE_CSE_REQUIRED: "true" }
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const output = JSON.parse(await fs.readFile(input, "utf8"));
  assert.equal(output.articles.length, 2);
  assert.equal(output.articles[0].category, "bismayah");
  assert.equal(output.articles.some((article) => article.officialSource && article.recoveredSourceId === "nic"), true);
  const facebook = output.articles.find((article) => article.recoveredSourceId === "nic-facebook");
  assert.equal(facebook?.facebookSearchSnippetOnly, true);
  assert.equal(facebook?.sourceHomepage, "https://www.facebook.com/profile.php?id=100090604137582");
  assert.equal(output.googleCseDiscovery.added, 2);
  console.log("[test:google-cse] official NIC result is added as a Bismayah priority candidate");
} finally {
  server.close();
  await fs.rm(temp, { recursive: true, force: true });
}
