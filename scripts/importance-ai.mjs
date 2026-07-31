import { importanceArticleId, importanceArticleText, importanceFingerprint } from "./importance-business-rules.mjs";

const enabled = /^(1|true|yes)$/i.test(process.env.IMPORTANCE_AI_ENABLED || "true") && Boolean(process.env.OPENAI_API_KEY);
const model = process.env.IMPORTANCE_MODEL || "gpt-5.4-mini";
const batchSize = Math.max(1, Math.min(15, Number(process.env.IMPORTANCE_AI_BATCH_SIZE || 8)));
const maxArticles = Math.max(0, Number(process.env.IMPORTANCE_AI_MAX_ARTICLES || 40));
const clamp = (value, max = 100) => Math.max(0, Math.min(max, Math.round(Number(value) || 0)));

function responseText(payload = {}) {
  if (typeof payload.output_text === "string") return payload.output_text;
  return (payload.output || []).flatMap((item) => item.content || [])
    .filter((item) => item?.type === "output_text")
    .map((item) => item.text || "").join("\n");
}

function parseArray(text = "") {
  const cleaned = String(text).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error("importance AI returned no JSON array");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function normalizeResult(item = {}) {
  const raw = item.breakdown || {};
  const breakdown = {
    bismayahRelevance: clamp(raw.bismayahRelevance, 30),
    decisionMakerInfluence: clamp(raw.decisionMakerInfluence, 25),
    contractPaymentImpact: clamp(raw.contractPaymentImpact, 25),
    responseUrgency: clamp(raw.responseUrgency, 10),
    sourceReliability: clamp(raw.sourceReliability, 10)
  };
  const total = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  return {
    score: clamp(Number.isFinite(Number(item.score)) ? item.score : total),
    businessRelevance: String(item.businessRelevance || "").slice(0, 30),
    reportPriority: String(item.reportPriority || "").slice(0, 30),
    reasonKo: String(item.reasonKo || "").slice(0, 240),
    breakdown
  };
}

function cachedResult(article) {
  const importance = article.importance || {};
  if (importance.scoreFingerprint !== importanceFingerprint(article) || !Number.isFinite(Number(importance.aiScore))) return null;
  return normalizeResult({
    score: importance.aiScore,
    businessRelevance: importance.businessRelevance,
    reportPriority: importance.aiReportPriority || importance.reportPriority,
    reasonKo: importance.aiReasonKo || importance.reasonKo,
    breakdown: importance.aiBreakdown
  });
}

function inputOf(article, index) {
  const record = article.article && typeof article.article === "object" ? article.article : article;
  return {
    id: importanceArticleId(article, index),
    category: article.analysis?.category || article.category || record.category || "",
    source: article.sourceArabic || article.source?.arabicName || "",
    titleArabic: article.originalTitleArabic || record.originalTitleArabic || "",
    titleKo: article.translation?.titleKo || article.display_title || "",
    summary: (article.translation?.previewKo || article.descriptionArabic || record.descriptionArabic || "").slice(0, 1500),
    bodyExcerpt: importanceArticleText(article).slice(0, 3000)
  };
}

async function request(items) {
  const instruction = `일반 뉴스 화제성이 아니라 한화의 비스마야 신도시 사업 관점에서 중요도를 평가한다.
배점은 비스마야 직접 관련성 30, NIC·총리실·국무회의 등 의사결정 영향 25, 계약·대금·금융·보증·사업재개 영향 25, 즉시 대응 필요성 10, 정보 구체성·출처 신뢰성 10이다.
NIC 의장 임명·해임·교체는 90점 이상 MUST_INCLUDE, 비스마야 직접 보도는 90점 이상, 비스마야 관련 정부 결정·계약·대금·금융·보증·재개 기사는 95점 이상으로 평가한다. 기사에 없는 전망은 만들지 않는다.
설명 없이 JSON 배열만 반환한다: [{"id":"입력 id","score":0,"businessRelevance":"DIRECT|INDIRECT|MONITOR|REFERENCE","reportPriority":"MUST_INCLUDE|PRIORITY_REVIEW|REVIEW|REFERENCE","reasonKo":"한국어 한 문장","breakdown":{"bismayahRelevance":0,"decisionMakerInfluence":0,"contractPaymentImpact":0,"responseUrgency":0,"sourceReliability":0}}]`;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: [{ role: "system", content: instruction }, { role: "user", content: JSON.stringify(items) }],
      max_output_tokens: Math.max(1200, items.length * 260)
    })
  });
  if (!response.ok) throw new Error(`OpenAI ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return parseArray(responseText(await response.json()));
}

export async function getImportanceAiScores(articles, ruleScores, floors) {
  const scores = new Map();
  articles.forEach((article, index) => {
    const cached = cachedResult(article);
    if (cached) scores.set(importanceArticleId(article, index), cached);
  });
  if (!enabled || maxArticles === 0) return { scores, enabled: false, model: null };

  const candidates = articles.map((article, index) => ({ article, index, id: importanceArticleId(article, index) }))
    .filter(({ article, index, id }) => !scores.has(id) && (ruleScores[index] >= 55 || floors[index].score >= 65 || String(article.analysis?.category || article.category).toLowerCase() === "bismayah"))
    .slice(0, maxArticles);

  for (let offset = 0; offset < candidates.length; offset += batchSize) {
    const batch = candidates.slice(offset, offset + batchSize);
    try {
      const output = await request(batch.map(({ article, index }) => inputOf(article, index)));
      output.forEach((item) => item?.id && scores.set(String(item.id), normalizeResult(item)));
      console.log(`[importance-ai] ${Math.min(offset + batch.length, candidates.length)}/${candidates.length}, model=${model}`);
    } catch (error) {
      console.warn(`[importance-ai] rules fallback: ${error.message}`);
    }
  }
  return { scores, enabled: true, model };
}
