function identityKeys(item) {
  const keys = [];
  if (item.articleId || item.id) keys.push(`id:${item.articleId || item.id}`);
  for (const value of [item.canonicalUrl, item.articleUrl]) {
    if (!value) continue;
    try {
      const url = new URL(value);
      url.hash = "";
      for (const key of [...url.searchParams.keys()]) {
        if (/^(utm_|fbclid|gclid|mc_)/i.test(key)) url.searchParams.delete(key);
      }
      url.searchParams.sort();
      keys.push(`url:${url}`);
    } catch { /* Invalid URLs are rejected by the collection URL policy. */ }
  }
  return keys;
}

// Input order is stored articles followed by fresh, validated full text.
// Match both IDs and URL aliases, retaining the old ID for saved selections.
// Replace the source as a whole: never attach an old translation to new text.
export function mergeContentArticles(items) {
  const groups = new Set();
  const byKey = new Map();
  for (const item of items) {
    const keys = identityKeys(item);
    const matches = new Set(keys.map((key) => byKey.get(key)).filter(Boolean));
    const group = matches.values().next().value || { keys: new Set(), article: item };
    const stableId = group.article.articleId || group.article.id;
    for (const match of matches) {
      for (const key of match.keys) group.keys.add(key);
      groups.delete(match);
    }
    for (const key of keys) group.keys.add(key);
    group.article = { ...item, ...(stableId ? { articleId: stableId } : {}) };
    for (const key of group.keys) byKey.set(key, group);
    groups.add(group);
  }
  const merged = [...groups].map((group) => group.article);

  // Defensive final pass: URL recovery may replace a Google News URL while
  // retaining the same articleId. Keep one record per identity even if an
  // upstream input unexpectedly contains duplicate identities.
  const unique = new Map();
  for (const article of merged) {
    const id = article.articleId || article.id;
    if (id && unique.has(id)) {
      unique.set(id, { ...unique.get(id), ...article, articleId: id });
    } else if (id) {
      unique.set(id, article);
    } else {
      unique.set(`anonymous-${unique.size}`, article);
    }
  }
  return [...unique.values()];
}
