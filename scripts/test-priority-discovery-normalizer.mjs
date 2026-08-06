#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const SCRIPT = process.env.PRIORITY_NORMALIZER_SCRIPT
  || path.resolve("scripts/normalize-priority-discovery-articles.mjs");
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "wr-priority-normalizer-"));
const inputFile = path.join(temp, "recovered.json");

try {
  await fs.writeFile(inputFile, JSON.stringify({
    schemaVersion: "1.0",
    articles: [
      {
        articleId: "priority-match",
        keywordId: "politics-cabinet-001",
        category: "politics",
        priority: 72,
        priorityDiscovery: { sourceId: "hathalyoum" },
        optionalTerms: ["مجلس الوزراء"]
      },
      {
        articleId: "ordinary-politics",
        keywordId: "politics-cabinet-001",
        category: "politics",
        priority: 80
      }
    ]
  }, null, 2));

  const run = spawnSync(process.execPath, [SCRIPT], {
    env: {
      ...process.env,
      PRIORITY_NORMALIZER_INPUT_FILE: inputFile,
      PRIORITY_NORMALIZER_OUTPUT_FILE: inputFile
    },
    encoding: "utf8"
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);

  const output = JSON.parse(await fs.readFile(inputFile, "utf8"));
  const priority = output.articles.find((article) => article.articleId === "priority-match");
  const ordinary = output.articles.find((article) => article.articleId === "ordinary-politics");

  assert.equal(priority.category, "bismayah");
  assert.equal(priority.keywordId, "bismayah-priority-source-001");
  assert.equal(priority.priority, 100);
  assert.ok(priority.optionalTerms.includes("بسماية"));
  assert.equal(ordinary.category, "politics");
  assert.equal(output.priorityClassificationNormalized, 1);
  console.log("[test-priority-normalizer] priority source matches promoted to Bismayah without changing ordinary articles");
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
