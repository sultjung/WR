#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import {
  businessFloorFor,
  importanceArticleId,
  importanceFingerprint
} from "./importance-business-rules.mjs";
import {
  IMPORTANCE_SCORING_VERSION,
  categoryFloorFor,
  starsForScore
} from "./importance-category-rules.mjs";
import { getImportanceAiScores } from "./importance-ai.mjs";

const file = process.env.IMPORTANCE_ARTICLES_FILE || path.join(process.cwd(), "data", "articles.json");
const payload = JSON.parse(await fs.readFile(file, "utf8"));
const articles = Array.isArray(payload.articles) ? payload.articles : [];
const clamp = (value) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
const ruleScores = articles.map((article) => clamp(article.importance?.score ?? article.importance?.ruleScore ?? 0));
const businessFloors = articles.map(businessFloorFor);
const categoryFloors = articles.map(categoryFloorFor);
const ai = await getImportanceAiScores(articles, ruleScores, businessFloors, categoryFloors);
const scoredAt = new Date().toISOString();

function levelOf(stars) {
  if (stars >= 4.5) return ["URGENT", "최우선", "IMMEDIATE_REVIEW", "MUST_INCLUDE"];
  if (stars >= 4) return ["IMPORTANT", "중요", "PRIORITY_REVIEW", "PRIORITY_REVIEW"];
  if (stars >= 3.5) return ["NOTABLE", "주목", "REVIEW", "REVIEW"];
  if (stars >= 3) return ["REFERENCE", "참고", "OPTIONAL_REVIEW", "REFERENCE"];
  if (stars >= 2) return ["GENERAL", "일반", "REFERENCE_ONLY", "REFERENCE"];
  return ["LOW", "낮음", "EXCLUDE", "REFERENCE"];
}

function relevanceOf(score, floorScore) {
  if (floorScore >= 90 || score >= 90) return "DIRECT";
  if (floorScore >= 70 || score >= 75) return "HIGH";
  if (floorScore >= 40 || score >= 60) return "MEDIUM";
  return "LOW";
}

function strongerFloor(businessFloor, categoryFloor) {
  return businessFloor.score >= categoryFloor.score ? businessFloor : categoryFloor;
}

function blendedScore(ruleScore, aiScore, floorScore) {
  if (aiScore === null) return Math.max(ruleScore, floorScore);
  const blended = Math.round(ruleScore * 0.6 + aiScore * 0.4);
  return Math.max(floorScore, blended);
}

const scored = articles.map((article, index) => {
  const previous = article.importance || {};
  const businessFloor = businessFloors[index];
  const categoryFloor = categoryFloors[index];
  const floor = strongerFloor(businessFloor, categoryFloor);
  const aiResult = ai.scores.get(importanceArticleId(article, index)) || null;
  const aiScore = aiResult ? clamp(aiResult.score) : null;
  const score = blendedScore(ruleScores[index], aiScore, floor.score);
  const stars = starsForScore(score);
  const [level, levelKo, reportStatus, defaultPriority] = levelOf(stars);
  const floorApplied = floor.score > 0 && floor.score >= score;
  const reportPriority = floorApplied
    ? (floor.score >= 90 ? "MUST_INCLUDE" : floor.score >= 80 ? "PRIORITY_REVIEW" : floor.score >= 70 ? "REVIEW" : "REFERENCE")
    : (aiResult?.reportPriority || defaultPriority);
  const reasonKo = floorApplied
    ? floor.reasonKo
    : (previous.reasonKo || floor.reasonKo || "해당 카테고리의 핵심성·규모·기관 권한·보고서 활용가치를 종합 평가함");
  const categoryRelevance = relevanceOf(score, floor.score);

  return {
    ...article,
    importance: {
      ...previous,
      score,
      stars,
      ratingScale: "0.5_TO_5_STARS",
      level,
      levelKo,
      reportStatus,
      reportPriority,
      categoryRelevance,
      businessRelevance: categoryRelevance,
      reasonKo,
      scoringMethod: "CATEGORY_RULES_STAR_V7",
      scoringVersion: IMPORTANCE_SCORING_VERSION,
      scoredAt,
      scoreFingerprint: importanceFingerprint(article),
      ruleScore: ruleScores[index],
      category: categoryFloor.category || previous.category || "",
      categoryFloor: categoryFloor.score,
      categoryFloorRule: categoryFloor.rule,
      categoryFloorReasonKo: categoryFloor.reasonKo,
      businessFloor: businessFloor.score,
      businessFloorRule: businessFloor.rule,
      businessFloorReasonKo: businessFloor.reasonKo,
      floorScore: floor.score,
      floorRule: floor.rule,
      floorReasonKo: floor.reasonKo,
      aiScore,
      aiWeight: aiResult ? 0.4 : 0,
      ruleWeight: aiResult ? 0.6 : 1,
      aiModel: aiResult ? ai.model : null,
      aiReportPriority: aiResult?.reportPriority || null,
      aiReasonKo: "",
      aiBreakdown: null
    }
  };
});

const floorCounts = scored.reduce((counts, article) => {
  const rule = article.importance.floorRule || "NONE";
  counts[rule] = (counts[rule] || 0) + 1;
  return counts;
}, {});

await fs.writeFile(file, `${JSON.stringify({
  ...payload,
  generatedAt: scoredAt,
  importanceScoring: {
    ...(payload.importanceScoring || {}),
    method: "CATEGORY_RULES_STAR_V7",
    version: IMPORTANCE_SCORING_VERSION,
    evaluationPrinciple: "CATEGORY_RULES_AND_DIRECT_BUSINESS_IMPACT",
    ratingScale: "0.5_TO_5_STARS",
    aiEnabled: ai.enabled,
    aiModel: ai.model,
    aiStats: ai.stats,
    scoredCount: scored.length,
    categoryFloors: {
      economyNationalStalledProjectOversight: 78,
      economyStalledProjectOversight: 72
    },
    businessFloors: {
      bismayahGovernmentDecision: 95,
      bismayahContractPaymentExecution: 95,
      nicChairPersonnelChange: 90,
      directBismayah: 90,
      nicPolicyOrganization: 80,
      iraqHousingGeneral: 65
    }
  },
  articles: scored
}, null, 2)}\n`, "utf8");

console.log(`[importance-category] scored=${scored.length}, ai=${ai.enabled ? ai.model : "off"}, stats=${JSON.stringify(ai.stats || {})}`);
console.log(`[importance-category] floors=${JSON.stringify(floorCounts)}`);
