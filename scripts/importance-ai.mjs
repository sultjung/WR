import {
  businessFloorFor,
  importanceArticleId,
  importanceArticleText,
  importanceFingerprint
} from "./importance-business-rules.mjs";
import {
  IMPORTANCE_SCORING_VERSION,
  categoryFloorFor,
  normalizeImportanceCategory
} from "./importance-category-rules.mjs";

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
const maxArticles = Math.max(0, Number(process.env.IMPORTANCE_AI_MAX_ARTICLES || 120));
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
          categoryRelevance: { type: "string", enum: ["DIRECT", "HIGH", "MEDIUM", "LOW"] },
          reportPriority: { type: "string", enum: ["MUST_INCLUDE", "PRIORITY_REVIEW", "REVIEW", "REFERENCE"] },
          reasonKo: { type: "string" },
          breakdown: {
            type: "object",
            additionalProperties: false,
            properties: {
              categoryCoreRelevance: { type: "integer", minimum: 0, maximum: 30 },
              eventScale: { type: "integer", minimum: 0, maximum: 25 },
              authorityDecisionImpact: { type: "integer", minimum: 0, maximum: 20 },
              reportOperationalValue: { type: "integer", minimum: 0, maximum: 15 },
              sourceReliability: { type: "integer", minimum: 0, maximum: 10 }
            },
            required: [
              "categoryCoreRelevance",
              "eventScale",
              "authorityDecisionImpact",
              "reportOperationalValue",
              "sourceReliability"
            ]
          }
        },
        required: ["id", "score", "categoryRelevance", "reportPriority", "reasonKo", "breakdown"]
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
    categoryCoreRelevance: clamp(raw.categoryCoreRelevance, 30),
    eventScale: clamp(raw.eventScale, 25),
    authorityDecisionImpact: clamp(raw.authorityDecisionImpact, 20),
    reportOperationalValue: clamp(raw.reportOperationalValue, 15),
    sourceReliability: clamp(raw.sourceReliability, 10)
  };
  const total = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  const categoryRelevance = String(item.categoryRelevance || "LOW").slice(0, 20);
  return {
    score: clamp(Number.isFinite(Number(item.score)) ? item.score : total),
    categoryRelevance,
    businessRelevance: categoryRelevance,
    reportPriority: String(item.reportPriority || "REFERENCE").slice(0, 30),
    reasonKo: String(item.reasonKo || "").slice(0, 300),
    breakdown
  };
}

function cachedResult(article) {
  const importance = article.importance || {};
  if (Number(importance.scoringVersion || 0) !== IMPORTANCE_SCORING_VERSION) return null;
  if (importance.scoreFingerprint !== importanceFingerprint(article)) return null;
  if (!Number.isFinite(Number(importance.aiScore))) return null;
  if (importance.aiModel && !modelCandidates.includes(importance.aiModel)) return null;
  return normalizeResult({
    score: importance.aiScore,
    categoryRelevance: importance.categoryRelevance || importance.businessRelevance,
    reportPriority: importance.aiReportPriority || importance.reportPriority,
    reasonKo: importance.aiReasonKo || importance.reasonKo,
    breakdown: importance.aiBreakdown
  });
}

function inputOf(article, index) {
  const record = article.article && typeof article.article === "object" ? article.article : article;
  return {
    id: importanceArticleId(article, index),
    category: normalizeImportanceCategory(article.analysis?.category || article.category || record.category || ""),
    source: article.sourceArabic || record.sourceArabic || article.source?.arabicName || article.sourceHost || "",
    titleArabic: article.originalTitleArabic || record.originalTitleArabic || "",
    titleKo: article.card?.titleKo || article.translation?.titleKo || article.display_title || "",
    summary: (article.card?.summaryKo || article.translation?.previewKo || article.descriptionArabic || record.descriptionArabic || "").slice(0, 1500),
    bodyExcerpt: importanceArticleText(article).slice(0, 4000)
  };
}

function candidatePriority(article, ruleScore, businessFloorScore, categoryFloorScore) {
  const category = normalizeImportanceCategory(article.analysis?.category || article.category || "");
  const text = importanceArticleText(article);
  const directAnchor = /بسماي|bismayah|bncp|الهيئة الوطنية للاستثمار|national investment commission|شركة هانوا|هانوا|hanwha/i.test(text);
  return Math.max(businessFloorScore, categoryFloorScore) * 10000
    + (category === "bismayah" ? 100000 : 0)
    + (directAnchor ? 50000 : 0)
    + ruleScore * 100;
}

function selectBalancedCandidates(candidates, limit) {
  if (limit <= 0) return [];
  const order = ["bismayah", "economy", "politics", "security", "international", ""];
  const buckets = new Map(order.map((category) => [category, []]));

  for (const candidate of candidates) {
    const category = normalizeImportanceCategory(
      candidate.article.analysis?.category || candidate.article.category || ""
    );
    const key = buckets.has(category) ? category : "";
    buckets.get(key).push(candidate);
  }
  for (const bucket of buckets.values()) bucket.sort((a, b) => b.priority - a.priority);

  const selected = [];
  while (selected.length < limit) {
    let added = false;
    for (const category of order) {
      const next = buckets.get(category)?.shift();
      if (!next) continue;
      selected.push(next);
      added = true;
      if (selected.length >= limit) break;
    }
    if (!added) break;
  }
  return selected;
}

function isModelAccessError(error) {
  return Boolean(error?.modelAccessError)
    || /model_not_found|must be verified|do not have access|does not exist/i.test(String(error?.message || ""));
}

async function request(items, selectedModel) {
  const instruction = `기사 중요도는 반드시 입력된 category 안에서 상대평가한다. 모든 기사에 비스마야 관련성을 요구하지 않는다.

공통 배점:
- categoryCoreRelevance 30: 해당 카테고리의 핵심 의제에 얼마나 직접 해당하는가
- eventScale 25: 국가적 범위, 규모, 금액, 피해, 정책 파급력
- authorityDecisionImpact 20: 총리·국무회의·의회·부처·사법기관 등 권한 있는 주체의 공식 결정·조치
- reportOperationalValue 15: 주간보고서에 넣을 구체성, 후속 절차, 업무상 활용가치
- sourceReliability 10: 원문·수치·기관·출처의 구체성과 신뢰성

카테고리별 기준:
- bismayah: 비스마야·شركة هانوا·الهيئة الوطنية للاستثمار·계약·대금·금융·보증·공사재개 영향을 평가한다.
- economy: 이라크 경제·건설·주택·인프라·투자·예산·에너지·국가사업의 중요도를 평가한다. 비스마야 언급은 필요 없다. 특히 의회·국무회의·관계부처가 المشاريع المتلكئة/المتوقفة 등 지연·중단 사업을 공식 조사·점검·정상화하는 기사는 75점 이상을 적극 검토한다.
- politics: 정부 구성, 총리·의회·정당 권력구도, 법률·인사·부패수사·국정운영 영향을 평가한다.
- security: 이라크 내 테러·무력사건·치안조치의 위치, 피해, 국가안보 및 현장운영 영향을 평가한다.
- international: 국제 사건 자체의 화제성이 아니라 이라크 외교·에너지·교역·안보·물류에 미치는 직접 영향을 평가한다.

기사에 없는 전망이나 비스마야 영향을 만들지 않는다. 각 입력 id마다 정확히 한 개의 결과를 반환한다. reasonKo에는 해당 카테고리에서 점수가 높거나 낮은 이유를 구체적으로 적는다.`;

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
            name: "category_relative_importance_scores",
            description: "Category-relative importance scores for supplied Iraqi news articles",
            strict: true,
            schema: OUTPUT_SCHEMA
          }
        },
        max_output_tokens: Math.max(1800, items.length * 360)
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

export async function getImportanceAiScores(articles, ruleScores, businessFloors, categoryFloors) {
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

  const candidatePool = articles
    .map((article, index) => ({
      article,
      index,
      id: importanceArticleId(article, index),
      priority: candidatePriority(
        article,
        ruleScores[index],
        businessFloors[index]?.score || businessFloorFor(article).score,
        categoryFloors[index]?.score || categoryFloorFor(article).score
      )
    }))
    .filter(({ article, index, id }) => {
      if (scores.has(id)) return false;
      const category = normalizeImportanceCategory(article.analysis?.category || article.category || "");
      return ruleScores[index] >= 40
        || (businessFloors[index]?.score || 0) >= 65
        || (categoryFloors[index]?.score || 0) >= 65
        || category === "bismayah";
    });

  const candidates = selectBalancedCandidates(candidatePool, maxArticles);

  let activeModelIndex = 0;
  let activeModel = modelCandidates[activeModelIndex];
  let evaluated = 0;
  let failedBatches = 0;
  let modelFallbacks = 0;

  console.log(`[importance-ai] model candidates=${modelCandidates.join(",")}`);
  console.log(`[importance-ai] candidate pool=${candidatePool.length}, selected=${candidates.length}, strategy=category-balanced`);

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
      candidatePool: candidatePool.length,
      evaluated,
      cached: cachedCount,
      failedBatches,
      modelFallbacks,
      selectionStrategy: "CATEGORY_BALANCED"
    }
  };
}
