#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "iraq-scope-test-"));
const articlesFile = path.join(tempDir, "articles.json");
const summaryFile = path.join(tempDir, "summary.json");
const scriptFile = new URL("./enforce-iraq-scope.mjs", import.meta.url);

const fixtures = [
  {
    articleId: "nigeria-byline-false-positive",
    category: "security",
    originalTitleArabic: "هجوم مسلح في شمال غربي نيجيريا يسفر عن مقتولين ومخطوفين",
    originalTextArabic: "بواسطة محمد يسري. هاجم مسلحون قرية في ولاية سوكوتو وخطفوا عددا من السكان."
  },
  {
    articleId: "wasit-real-incident",
    category: "security",
    originalTitleArabic: "القوات الأمنية تعتقل منفذي هجوم مسلح في واسط",
    originalTextArabic: "أعلنت قيادة شرطة واسط القبض على المتهمين بعد عملية أمنية."
  },
  {
    articleId: "prefixed-iraq-token",
    category: "security",
    originalTitleArabic: "إحباط هجوم إرهابي بالعراق",
    originalTextArabic: "أعلنت القوات الأمنية تفاصيل العملية."
  },
  {
    articleId: "foreign-primary-syria",
    category: "security",
    originalTitleArabic: "هجوم مسلح في سوريا يخلف قتلى",
    originalTextArabic: "وأشار التقرير لاحقا إلى متابعة أخبار العراق والمنطقة."
  },
  {
    articleId: "iraq-syria-border",
    category: "security",
    originalTitleArabic: "تعزيز الأمن على الحدود العراقية السورية لمنع تسلل داعش",
    originalTextArabic: "دفعت قيادة قوات الحدود العراقية بتعزيزات إضافية."
  },
  {
    articleId: "non-security-untouched",
    category: "economy",
    originalTitleArabic: "مشروع اقتصادي تجريبي",
    originalTextArabic: "نص تجريبي"
  }
];

await fs.writeFile(articlesFile, `${JSON.stringify({ articles: fixtures }, null, 2)}\n`, "utf8");

const run = spawnSync(process.execPath, [scriptFile.pathname], {
  encoding: "utf8",
  env: {
    ...process.env,
    IRAQ_SCOPE_ARTICLES_FILE: articlesFile,
    IRAQ_SCOPE_SUMMARY_FILE: summaryFile
  }
});

assert.equal(run.status, 0, run.stderr || run.stdout);
const output = JSON.parse(await fs.readFile(articlesFile, "utf8"));
const summary = JSON.parse(await fs.readFile(summaryFile, "utf8"));
const ids = output.articles.map((article) => article.articleId);

assert.deepEqual(ids, [
  "wasit-real-incident",
  "prefixed-iraq-token",
  "iraq-syria-border",
  "non-security-untouched"
]);
assert.equal(summary.excludedCount, 2);
assert.equal(summary.reasonCounts.FOREIGN_SECURITY_PRIMARY_TITLE, 2);
assert.ok(!ids.includes("nigeria-byline-false-positive"), "بواسطة must not match واسط");
assert.ok(ids.includes("wasit-real-incident"), "standalone واسط must remain valid");
assert.ok(ids.includes("prefixed-iraq-token"), "بالعراق must match العراق after proclitic stripping");

console.log("[test:iraq-scope] passed");
