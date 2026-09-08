import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mergeContentArticles } from "./article-content-merge.mjs";
import { isForbiddenArticleUrl } from "./article-url-policy.mjs";

const detail = "https://ninanews.com/website/News/Details?Key=1313421";
for (const articleUrl of ["https://ninanews.com/", "https://ninanews.com/website/", "https://www.ninanews.com/website/?lang=ar", "https://ninanews.com/website/News/Details", "https://ninanews.com/website/News/Details?Key="]) {
  assert.equal(isForbiddenArticleUrl({ articleUrl }), true, articleUrl);
}
assert.equal(isForbiddenArticleUrl({ articleUrl: detail }), false);
const old = { articleId: "stable", articleUrl: detail, originalTextArabic: "old", translation: { status: "COMPLETED" } };
const fresh = { articleId: "stable", articleUrl: "https://ninanews.com/website/News/Details?Key=1313422", originalTextArabic: "new", translation: { status: "PENDING" } };
assert.deepEqual(mergeContentArticles([old, fresh]), [fresh]);
const sameUrl = { ...fresh, articleId: "rediscovered", articleUrl: detail + "&utm_source=test#top" };
assert.equal(mergeContentArticles([old, sameUrl])[0].articleId, "stable");
assert.equal(mergeContentArticles([old, sameUrl])[0].translation.status, "PENDING");
assert.equal(mergeContentArticles([old, { ...fresh, articleId: "separate" }]).length, 2);
assert.equal(mergeContentArticles([old, { ...fresh, articleId: "separate" }, { ...fresh, canonicalUrl: detail }]).length, 1);
// Regression: two records with the same stable ID must never survive URL recovery.
assert.equal(mergeContentArticles([fresh, { ...fresh, articleUrl: "https://publisher.example/article/123" }]).length, 1);

// Reproduce the failed run: a stored detail page and a bad index share an ID.
// Also reject a fresh detail URL redirecting to an index, and an index canonical.
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "wr-content-merge-"));
try {
  await fs.mkdir(path.join(temp, "data"));
  const title = "رئيس الهيئة الوطنية للاستثمار يبحث برنامج الاستثمار في العراق";
  const body = "بحث رئيس الهيئة الوطنية للاستثمار برنامج الاستثمار في العراق وتمويل المشاريع السكنية في بغداد وتذليل العقبات امام المستثمرين ومناقشة قانون الاستثمار مع مجلس النواب العراقي.";
  const valid = { ...old, originalTitleArabic: title, originalTextArabic: body, category: "bismayah", contentStatus: "FULL_TEXT", canonicalUrl: detail, publishedAt: new Date().toISOString() };
  const invalid = { ...valid, articleUrl: "https://ninanews.com/website/", canonicalUrl: "https://ninanews.com/website/" };
  await fs.writeFile(path.join(temp, "data/articles.json"), JSON.stringify({ articles: [invalid, valid] }));
  const inputs = [invalid, { ...valid, articleId: "redirect", articleUrl: detail + "&redirect=1" }, { ...valid, articleId: "canonical", articleUrl: detail + "&canonical=1" }].map((item) => ({ ...item, urlStatus: "RESOLVED" }));
  await fs.writeFile(path.join(temp, "data/resolved-articles.json"), JSON.stringify({ articles: inputs }));
  const script = fileURLToPath(new URL("./fetch-arabic-content.mjs", import.meta.url));
  const mock = `globalThis.fetch = async (url) => ({ok: true, url: url.includes('redirect=1') ? 'https://ninanews.com/website/' : url, text: async () => ${JSON.stringify(`<html><head><link rel="canonical" href="https://ninanews.com/website/"/><title>${title}</title></head><body><article>${body}</article></body></html>`)}}); await import(${JSON.stringify(script)});`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", mock], { cwd: temp, encoding: "utf8", env: { ...process.env, MIN_ARABIC_CONTENT_CHARS: "30" } });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(await fs.readFile(path.join(temp, "data/articles.json"), "utf8"));
  assert.equal(output.articles.length, 1);
  assert.equal(output.articles[0].articleUrl, detail);
  assert.deepEqual(output.articles[0].translation, valid.translation);
  assert.equal(output.collectionRun.failures.INVALID_ARTICLE_PAGE, 3);
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
console.log("[test-content-merge] ID/URL deduplication and NINA index regression passed");
