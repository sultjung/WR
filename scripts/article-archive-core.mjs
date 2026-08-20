import crypto from "node:crypto";

export const ARTICLE_ARCHIVE_SCHEMA_VERSION = "1.0";

function recordOf(article = {}) {
  return article.article && typeof article.article === "object" ? article.article : article;
}

export function archiveKey(article = {}) {
  const record = recordOf(article);
  const direct = article.articleId || record.articleId || article.id || record.id
    || article.articleUrl || record.articleUrl || article.canonicalUrl || record.canonicalUrl;
  if (direct) return String(direct);
  return `archive-${crypto.createHash("sha256").update([
    article.publishedAt || record.publishedAt || "",
    article.sourceArabic || record.sourceArabic || "",
    article.originalTitleArabic || record.originalTitleArabic || ""
  ].join("\n")).digest("base64url").slice(0, 24)}`;
}

export function archiveMonth(article = {}) {
  const record = recordOf(article);
  const value = article.publishedAt || record.publishedAt || article.pagePublishedAt || record.pagePublishedAt || "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "undated" : date.toISOString().slice(0, 7);
}

export function compactArchivedArticle(article = {}) {
  const record = recordOf(article);
  const importance = article.importance || article.analysis?.importance || record.importance || {};
  const translation = article.translation || record.translation || {};
  const category = article.analysis?.category || article.category || record.category || "";
  const url = article.articleUrl || record.articleUrl || article.canonicalUrl || record.canonicalUrl || "";
  return {
    articleId: archiveKey(article),
    publishedAt: article.publishedAt || record.publishedAt || article.pagePublishedAt || record.pagePublishedAt || "",
    sourceArabic: article.sourceArabic || record.sourceArabic || article.source?.arabicName || "",
    sourceHost: article.sourceHost || record.sourceHost || "",
    category,
    titleKo: translation.titleKo || article.card?.titleKo || article.display_title || "",
    titleArabic: article.originalTitleArabic || record.originalTitleArabic || "",
    articleUrl: url,
    importanceScore: Number.isFinite(Number(importance.score)) ? Number(importance.score) : null,
    importanceStars: Number.isFinite(Number(importance.stars)) ? Number(importance.stars) : null,
    selected: Boolean(article.selection?.selected),
    contentHash: article.contentHash || record.contentHash || ""
  };
}

export function mergeArchiveArticles(existing = [], incoming = []) {
  const merged = new Map();
  for (const article of [...existing, ...incoming]) merged.set(archiveKey(article), article);
  return [...merged.values()].sort((a, b) =>
    new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0)
    || String(a.articleId || "").localeCompare(String(b.articleId || ""))
  );
}
