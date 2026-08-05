#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import {
  applyDirectIraqInternationalRouting,
  categorySectionOf,
  classifyDirectIraqInternational
} from "./direct-iraq-category-routing.mjs";

const ROOT = process.cwd();
const INPUT_FILE = path.resolve(
  process.env.REPORT_INPUT_FILE || path.join(ROOT, "work", "report-input.json")
);
const SECTION_ORDER = {
  politicsItems: 0,
  securityItems: 1,
  economyItems: 2,
  internationalItems: 3
};

const payload = JSON.parse(await fs.readFile(INPUT_FILE, "utf8"));
const selected = Array.isArray(payload.selectedArticles) ? payload.selectedArticles : [];
const existingClusters = Array.isArray(payload.reportClusters) ? payload.reportClusters : [];
const priorClusterByArticle = new Map();
for (const cluster of existingClusters) {
  for (const id of Array.isArray(cluster.articleIds) ? cluster.articleIds : []) {
    priorClusterByArticle.set(id, cluster);
  }
}

let changedCount = 0;
const normalizedArticles = selected.map((article) => {
  const result = classifyDirectIraqInternational(article);
  const routed = result.changed ? applyDirectIraqInternationalRouting(article) : article;
  if (result.changed) changedCount += 1;
  const category = String(routed.category || article.category || "").toLowerCase();
  return {
    ...routed,
    category,
    targetSection: categorySectionOf(category),
    reportCategoryRouting: result.changed
      ? { from: "international", to: category, reason: result.reason, scores: result.scores }
      : (article.reportCategoryRouting || null)
  };
});

const articlesById = new Map(normalizedArticles.map((article) => [article.articleId, article]));
const clusterBuckets = new Map();
for (const article of normalizedArticles) {
  const prior = priorClusterByArticle.get(article.articleId);
  const priorId = prior?.clusterId || article.topicClusterId || `single-${article.articleId}`;
  const key = `${priorId}:${article.targetSection}`;
  if (!clusterBuckets.has(key)) clusterBuckets.set(key, []);
  clusterBuckets.get(key).push(article);
}

const rebuiltClusters = [...clusterBuckets.values()].map((members) => {
  const dates = members.map((member) => member.publishedDate).filter(Boolean).sort();
  const ranked = [...members].sort((a, b) =>
    (Number(b.importanceScore) || -1) - (Number(a.importanceScore) || -1)
    || String(a.publishedDate || "").localeCompare(String(b.publishedDate || ""))
  );
  const prior = priorClusterByArticle.get(members[0].articleId);
  return {
    articleIds: members.map((member) => member.articleId),
    targetSection: members[0].targetSection,
    dateStart: dates[0] || "",
    dateEnd: dates.at(-1) || "",
    suggestedTitleKo: ranked[0]?.card?.titleKo || prior?.suggestedTitleKo || "",
    mergeBasis: [
      ...(Array.isArray(prior?.mergeBasis) ? prior.mergeBasis : ["single-selected-article"]),
      ...(members.some((member) => member.reportCategoryRouting) ? ["direct-iraq-category-rerouting"] : [])
    ].filter((value, index, array) => array.indexOf(value) === index)
  };
}).sort((a, b) =>
  (SECTION_ORDER[a.targetSection] ?? 99) - (SECTION_ORDER[b.targetSection] ?? 99)
  || String(a.dateStart).localeCompare(String(b.dateStart))
);

rebuiltClusters.forEach((cluster, index) => {
  cluster.clusterId = `topic-${String(index + 1).padStart(2, "0")}`;
});
const clusterByArticle = new Map();
for (const cluster of rebuiltClusters) {
  for (const id of cluster.articleIds) clusterByArticle.set(id, cluster);
}
for (const article of normalizedArticles) {
  const cluster = clusterByArticle.get(article.articleId);
  article.topicClusterId = cluster?.clusterId || article.topicClusterId;
}

const output = {
  ...payload,
  selectedArticles: normalizedArticles.sort((a, b) =>
    (SECTION_ORDER[a.targetSection] ?? 99) - (SECTION_ORDER[b.targetSection] ?? 99)
    || String(a.publishedDate || "").localeCompare(String(b.publishedDate || ""))
    || (Number(b.importanceScore) || -1) - (Number(a.importanceScore) || -1)
  ),
  reportClusters: rebuiltClusters,
  editorialConstraints: {
    ...(payload.editorialConstraints || {}),
    directIraqInternationalReroutingRequired: true,
    categoryOrder: ["politicsItems", "securityItems", "economyItems", "internationalItems"]
  }
};

await fs.writeFile(INPUT_FILE, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`[report-category-routing] articles=${selected.length} rerouted=${changedCount} clusters=${rebuiltClusters.length}`);
for (const article of normalizedArticles.filter((item) => item.reportCategoryRouting).slice(0, 20)) {
  console.log(`[report-category-routing] ${article.articleId}: international -> ${article.category}`);
}
