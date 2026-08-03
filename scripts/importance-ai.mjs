import { importanceArticleId, importanceArticleText, importanceFingerprint } from "./importance-business-rules.mjs";

const requested = /^(1|true|yes)$/i.test(process.env.IMPORTANCE_AI_ENABLED || "true");
const required = /^(1|true|yes)$/i.test(process.env.IMPORTANCE_AI_REQUIRED || "false");
const hasApiKey = Boolean(String(process.env.OPENAI_API_KEY || "").trim());
const enabled = requested && hasApiKey;
const primaryModel = String(process.env.IMPORTANCE_MODEL || "gpt-4.1-mini").trim();
const fallbackModels = String(process.env.IMPORTANCE_MODEL_FALLBACKS || "gpt-4o-mini")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const modelCandidates = [...new Set([primaryModel, ...fallbackModels])];
const batchSize = Math.max(1, Math.min(10, Number(process.env.IMPORTANCE_AI_BATCH_SIZE || 6)));
const maxArticles = Math.max(0, Number(process.env.IMPORTANCE_AI_MAX_ARTICLES || 80));
const timeoutMs = Math.max(15000, Number(process.env.IMPORTANCE_AI_TIMEOUT_MS || 60000));
const clamp = (value, max = 100) => Math.max(0, Math.min(max, Math.round(Number(value) || 0)));

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          score: { type: "integer", minimum: 0, maximum: 100 },
          businessRelevance: { type: "string", enum: ["DIRECT", "INDIRECT", "MONITOR", "REFERENCE"] },
          reportPriority: { type: "string", enum: ["MUST_INCLUDE", "PRIORITY_REVIEW", "REVIEW", "REFERENCE"] },
          reasonKo: { type: "string" },
          breakdown: {
            type: "object",
            additionalProperties: false,
            properties: {
              bismayahRelevance: { type: "integer", minimum: 0, maximum: 30 },
              decisionMakerInfluence: { type: "integer", minimum: 0, maximum: 25 },
              contractPaymentImpact: { type: "integer", minimum: 0, maximum: 25 },
              responseUrgency: { type: "integer", minimum: 0, maximum: 10 },
              sourceReliability: { type: "integer", minimum: 0, maximum: 10 }
            },
            required: [
              "bismayahRelevance",
              "decisionMakerInfluence",
              "contractPaymentImpact",
              "responseUrgency",
              "sourceReliability"
            ]
          }
        },
        required: ["id", "score", "businessRelevance", "reportPriority", "reasonKo", "breakdown"]
      }
    }
  },
  required: ["results"]
};

function responseText(payload = {}) {
  if (typeof payload.output_text === "string") return payload.output_text;
  return (payload.output || []).flatMap((item) => item.content || [])
    .filter((item) => item?.type === "output_text")
    .map((item) => item.text || "")
    .join("\n");
}

function parseResults(text = "") {
  const cleaned = String(text).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const parsed = JSON.parse(cleaned);
  if (!parsed || !Array.isArray(parsed.results)) throw new Error("importance AI returned no results array");
  return parsed.results;
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
    businessRelevance: String(item.businessRelevance || "REFERENCE").slice(0, 30),
    reportPriority: String(item.reportPriority || "REFERENCE").slice(0, 30),
    reasonKo: String(item.reasonKo || "").slice(0, 240),
    breakdown
  };
}

function cachedResult(article) {
  const importance = article.importance || {};
  if (importance.scoreFingerprint !== importanceFingerprint(article)) return null;
  if (!Number.isFinite(Number(importance.aiScore))) return null;
  if (importance.aiModel && !modelCandidates.includes(importance.aiModel)) return null;
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
    source: article.sourceArabic || article.source?.arabicName || article.sourceHost || "",
    titleArabic: article.originalTitleArabic || record.originalTitleArabic || "",
    titleKo: article.translation?.titleKo || article.display_title || "",
    summary: (article.translation?.previewKo || article.descriptionArabic || record.descriptionArabic || "").slice(0, 1500),
    bodyExcerpt: importanceArticleText(article).slice(0, 3000)
  };
}

function candidatePriority(article, ruleScore, floorScore) {
  const category = String(article.analysis?.category || article.category || "").toLowerCase();
  const text = importanceArticleText(article);
  const directAnchor = /بسماي|bismayah|bncp|الهيئة الوطنية للاستثمار|national investment commission|شركة هانوا|هانوا|hanwha|عادل داخل الياسري|حيدر مكية/i.test(text);
  return floorScore * 10000
    + (category === "bismayah" ? 500000 : 0)
    + (directAnchor ? 250000 : 0)
    + ruleScore * 100;
}

function isModelAccessError(error) {
  return Boolean(error?.modelAccessError)
    || /model_not_found|must be verified|do not have access|does not exist/i.test(String(error?.message || ""));
}

async function request(items, selectedModel) {
  const instruction = `일반적인 뉴스 화제성이 아니라 한화의 비스마야 신도시 사업 관점에서 기사 중요도를 평가한다.
배점은 비스마야 직접 관련성 30, NIC·총리실·국무회의 등 의사결정 영향 25, 계약·대금·금융·보증·사업재개 영향 25, 즉시 대응 필요성 10, 정보 구체성·출처 신뢰성 10이다.
NIC 의장 임명·해임·교체는 90점 이상 MUST_INCLUDE, 비스마야 직접 보도는 90점 이상, 비스마야 관련 정부 결정·계약·대금·금융·보증·재개 기사는 95점 이상으로 평가한다.
이라크 일반 정치·경제·치안 기사는 비스마야 사업과의 실제 연결 정도를 기준으로 평가하고, 기사에 없는 전망이나 효과는 만들지 않는다.
각 입력 id마다 정확히 한 개의 결과를 반환한다.`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("IMPORTANCE_AI_TIMEOUT")), timeoutMs);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: selectedModel,
        store: false,
        input: [
          { role: "system", content: [{ type: "input_text", text: instruction }] },
          { role: "user", content: [{ type: "input_text", text: JSON.stringify(items) }] }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "importance_scores",
            description: "Bismayah business importance scores for the supplied articles",
            strict: true,
            schema: OUTPUT_SCHEMA
          }
        },
        max_output_tokens: Math.max(1600, items.length * 320)
      })
    });
    if (!response.ok) {
      const body = (await response.text()).slice(0, 800);
      const error = new Error(`OpenAI ${response.status} (${selectedModel}): ${body}`);
      error.status = response.status;
      error.modelAccessError = response.status === 404
        && /model_not_found|must be verified|do not have access|does not exist/i.test(body);
      throw error;
    }
    return parseResults(responseText(await response.json()));
  } finally {
    clearTimeout(timer);
  }
}

export async function getImportanceAiScores(articles, ruleScores, floors) {
  const scores = new Map();
  let cachedCount = 0;
  articles.forEach((article, index) => {
    const cached = cachedResult(article);
    if (cached) {
      scores.set(importanceArticleId(article, index), cached);
      cachedCount += 1;
    }
  });

  if (requested && !hasApiKey) {
    const message = "OPENAI_API_KEY is unavailable to the importance-scoring process";
    if (required) throw new Error(message);
    console.warn(`[importance-ai] ${message}; rules fallback`);
  }
  if (!enabled || maxArticles === 0) {
    return {
      scores,
      enabled: false,
      model: null,
      stats: { requested: 0, evaluated: 0, cached: cachedCount, failedBatches: 0, modelFallbacks: 0 }
    };
  }

  const candidates = articles
    .map((article, index) => ({
      article,
      index,
      id: importanceArticleId(article, index),
      priority: candidatePriority(article, ruleScores[index], floors[index].score)
    }))
    .filter(({ article, index, id }) => {
      if (scores.has(id)) return false;
      const category = String(article.analysis?.category || article.category).toLowerCase();
      return ruleScores[index] >= 45 || floors[index].score >= 65 || category === "bismayah";
    })
    .sort((a, b) => b.priority - a.priority)
    .slice(0, maxArticles);

  let activeModelIndex = 0;
  let activeModel = modelCandidates[activeModelIndex];
  let evaluated = 0;
  let failedBatches = 0;
  let modelFallbacks = 0;

  console.log(`[importance-ai] model candidates=${modelCandidates.join(",")}`);

  for (let offset = 0; offset < candidates.length; offset += batchSize) {
    const batch = candidates.slice(offset, offset + batchSize);
    let output = null;

    while (output === null) {
      try {
        output = await request(batch.map(({ article, index }) => inputOf(article, index)), activeModel);
      } catch (error) {
        if (isModelAccessError(error) && activeModelIndex + 1 < modelCandidates.length) {
          const previousModel = activeModel;
          activeModelIndex += 1;
          activeModel = modelCandidates[activeModelIndex];
          modelFallbacks += 1;
          console.warn(`[importance-ai] model unavailable: ${previousModel}; switching to ${activeModel}`);
          continue;
        }
        failedBatches += 1;
        console.warn(`[importance-ai] batch failed: ${error.message}`);
        break;
      }
    }

    if (!output) continue;

    const expectedIds = new Set(batch.map((item) => item.id));
    let accepted = 0;
    for (const item of output) {
      const id = String(item?.id || "");
      if (!id || !expectedIds.has(id)) continue;
      scores.set(id, normalizeResult(item));
      accepted += 1;
    }
    evaluated += accepted;
    if (accepted !== batch.length) {
      console.warn(`[importance-ai] incomplete batch: expected=${batch.length}, accepted=${accepted}`);
    }
    console.log(`[importance-ai] ${Math.min(offset + batch.length, candidates.length)}/${candidates.length}, accepted=${accepted}, model=${activeModel}`);
  }

  if (required && candidates.length > 0 && evaluated === 0) {
    throw new Error(`importance AI required but no new article was scored; failedBatches=${failedBatches}`);
  }

  return {
    scores,
    enabled: true,
    model: activeModel,
    stats: {
      requested: candidates.length,
      evaluated,
      cached: cachedCount,
      failedBatches,
      modelFallbacks
    }
  };
}
