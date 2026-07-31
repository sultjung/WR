#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { businessFloorFor, importanceArticleId, importanceFingerprint } from "./importance-business-rules.mjs";
import { getImportanceAiScores } from "./importance-ai.mjs";

const file = process.env.IMPORTANCE_ARTICLES_FILE || path.join(process.cwd(), "data", "articles.json");
const payload = JSON.parse(await fs.readFile(file, "utf8"));
const articles = Array.isArray(payload.articles) ? payload.articles : [];
const clamp = (value) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
const ruleScores = articles.map((article) => clamp(article.importance?.score ?? article.importance?.ruleScore ?? 0));
const floors = articles.map(businessFloorFor);
const ai = await getImportanceAiScores(articles, ruleScores, floors);
const scoredAt = new Date().toISOString();

function levelOf(score) {
  if (score >= 90) return ["URGENT", "긴급", "IMMEDIATE_REVIEW", "MUST_INCLUDE"];
  if (score >= 80) return ["IMPORTANT", "중요", "PRIORITY_REVIEW", "PRIORITY_REVIEW"];
  if (score >= 70) return ["NOTABLE", "주목", "REVIEW", "REVIEW"];
  if (score >= 60) return ["REFERENCE", "참고", "OPTIONAL_REVIEW", "REFERENCE"];
  if (score >= 40) return ["GENERAL", "일반", "REFERENCE_ONLY", "REFERENCE"];
  return ["LOW", "낮음", "EXCLUDE", "REFERENCE"];
}

const scored = articles.map((article, index) => {
  const previous = article.importance || {};
  const floor = floors[index];
  const aiResult = ai.scores.get(importanceArticleId(article, index)) || null;
  const aiScore = aiResult ? clamp(aiResult.score) : null;
  const score = Math.max(ruleScores[index], floor.score, aiScore ?? 0);
  const [level, levelKo, reportStatus, defaultPriority] = levelOf(score);
  const floorApplied = floor.score > ruleScores[index] && floor.score >= (aiScore ?? 0);
  const reportPriority = floorApplied ? (floor.score >= 90 ? "MUST_INCLUDE" : floor.score >= 80 ? "PRIORITY_REVIEW" : "REFERENCE")
    : (aiResult?.reportPriority || defaultPriority);
  const reasonKo = floorApplied ? floor.reasonKo : (aiResult?.reasonKo || previous.reasonKo || floor.reasonKo || "카테고리 규칙과 비스마야 사업 관련성을 종합 평가함");

  return {
    ...article,
    importance: {
      ...previous,
      score,
      level,
      levelKo,
      reportStatus,
      reportPriority,
      businessRelevance: aiResult?.businessRelevance || (floor.score >= 90 ? "DIRECT" : floor.score >= 65 ? "INDIRECT" : "REFERENCE"),
      reasonKo,
      scoringMethod: ai.enabled ? "BUSINESS_FLOOR_AI_V3" : "BUSINESS_FLOOR_RULES_V3",
      scoringVersion: 3,
      scoredAt,
      scoreFingerprint: importanceFingerprint(article),
      ruleScore: ruleScores[index],
      businessFloor: floor.score,
      floorRule: floor.rule,
      floorReasonKo: floor.reasonKo,
      aiScore,
      aiModel: aiResult ? ai.model : null,
      aiReportPriority: aiResult?.reportPriority || null,
      aiReasonKo: aiResult?.reasonKo || "",
      aiBreakdown: aiResult?.breakdown || null
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
    method: ai.enabled ? "BUSINESS_FLOOR_AI_V3" : "BUSINESS_FLOOR_RULES_V3",
    version: 3,
    aiEnabled: ai.enabled,
    aiModel: ai.model,
    scoredCount: scored.length,
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

console.log(`[importance-business] scored=${scored.length}, ai=${ai.enabled ? ai.model : "off"}`);
console.log(`[importance-business] floors=${JSON.stringify(floorCounts)}`);
