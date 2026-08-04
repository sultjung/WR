#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { mergeGeneratedCardData } from "./article-card-merge.mjs";

const ROOT = process.cwd();
const latestFile = path.resolve(process.env.CARD_ARTICLES_FILE || path.join(ROOT, "data", "articles.json"));
const generatedFileValue = String(process.env.CARD_GENERATED_FILE || "").trim();

if (!generatedFileValue) {
  throw new Error("CARD_GENERATED_FILE is required for safe article-card merging");
}

const generatedFile = path.resolve(generatedFileValue);
const [latestPayload, generatedPayload] = await Promise.all([
  fs.readFile(latestFile, "utf8").then(JSON.parse),
  fs.readFile(generatedFile, "utf8").then(JSON.parse)
]);

const { output, stats } = mergeGeneratedCardData(latestPayload, generatedPayload);
await fs.writeFile(latestFile, `${JSON.stringify(output, null, 2)}\n`, "utf8");

console.log(
  `[article-card-merge] matched=${stats.matchedArticleCount}, facts=${stats.factsMerged}, cards=${stats.cardsMerged}, pending=${stats.pendingCardsMerged}, sourceMismatch=${stats.skippedSourceMismatch}`
);
