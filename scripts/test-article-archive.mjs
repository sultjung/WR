#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  archiveKey,
  archiveMonth,
  compactArchivedArticle,
  mergeArchiveArticles
} from "./article-archive-core.mjs";

const fullArticle = {
  articleId: "article-1",
  publishedAt: "2026-07-31T21:00:00.000Z",
  sourceArabic: "السومرية",
  sourceHost: "alsumaria.tv",
  category: "bismayah",
  originalTitleArabic: "خبر استثماري مهم",
  originalTextArabic: "نص عربي طويل يجب ألا ينتقل إلى الأرشيف الخفيف".repeat(100),
  articleUrl: "https://example.com/article-1",
  contentHash: "hash-1",
  translation: {
    titleKo: "중요 투자 기사",
    fullTextKo: "용량이 큰 한국어 전문번역".repeat(100)
  },
  importance: { score: 88, stars: 4.5, breakdown: { relevance: 50 } },
  selection: { selected: true }
};

const compact = compactArchivedArticle(fullArticle);
assert.equal(archiveKey(fullArticle), "article-1");
assert.equal(archiveMonth(fullArticle), "2026-07");
assert.equal(compact.titleKo, "중요 투자 기사");
assert.equal(compact.importanceScore, 88);
assert.equal(compact.importanceStars, 4.5);
assert.equal(compact.selected, true);
assert.ok(!Object.hasOwn(compact, "originalTextArabic"));
assert.ok(!Object.hasOwn(compact, "translation"));
assert.ok(!Object.hasOwn(compact, "importance"));

const updated = { ...compact, importanceScore: 90 };
const merged = mergeArchiveArticles([compact], [updated]);
assert.equal(merged.length, 1);
assert.equal(merged[0].importanceScore, 90);
assert.ok(JSON.stringify(compact).length < JSON.stringify(fullArticle).length * 0.15);

console.log(`[test-article-archive] compactBytes=${JSON.stringify(compact).length}, fullBytes=${JSON.stringify(fullArticle).length}, dedupe=passed`);
