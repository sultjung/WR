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
const primaryModel = String(process.env.IMPORTANCE_MODEL || "gpt-5.6-luna").trim();
const fallbackModels = String(process.env.IMPORTANCE_MODEL_FALLBACKS || "gpt-4.1-mini,gpt-4o-mini")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const modelCandidates = [...new Set([primaryModel, ...fallbackModels])];
const batchSize = Math.max(1, Math.min(10, Number(process.env.IMPORTANCE_AI_BATCH_SIZE || 10)));
const maxArticles = Math.max(0, Number(process.env.IMPORTANCE_AI_MAX_ARTICLES || 40));
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
          reportPriority: { type: "string", enum: ["MUST_INCLUDE", "PRIORITY_REVIEW", "REVIEW", "REFERENCE"] }
        },
        required: ["id", "score", "reportPriority"]
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
  return {
    score: clamp(item.score),
    reportPriority: String(item.reportPriority || "REFERENCE").slice(0, 30)
  };
}

function cachedResult(article) {
  const importance = article.importance || {};
  if (Number(importance.scoringVersion || 0) !== IMPORTANCE_SCORING_VERSION) return null;
  if (importance.scoreFingerprint !== importanceFingerprint(article)) return null;
  if (typeof importance.aiScore !== "number" || !Number.isFinite(importance.aiScore)) return null;
  if (!importance.aiModel || !modelCandidates.includes(importance.aiModel)) return null;
  return normalizeResult({
    score: importance.aiScore,
    reportPriority: importance.aiReportPriority || importance.reportPriority
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
    summary: (article.card?.summaryKo || article.translation?.previewKo || article.descriptionArabic || record.descriptionArabic || "").slice(0, 800),
    bodyExcerpt: importanceArticleText(article).slice(0, 1800)
  };
}

function isDirectPriorityArticle(article) {
  const category = normalizeImportanceCategory(article.analysis?.category || article.category || "");
  if (category === "bismayah") return true;
  return /بسماي|bismayah|bncp|الهيئة الوطنية للاستثمار|national investment commission|\bnic\b|شركة هانوا|هانوا|hanwha/i.test(importanceArticleText(article));
}

function candidatePriority(article, ruleScore, businessFloorScore, categoryFloorScore) {
  const directPriority = isDirectPriorityArticle(article);
  return (directPriority ? 1000000 : 0)
    + Math.max(businessFloorScore, categoryFloorScore) * 10000
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

function selectCandidates(candidatePool, limit) {
  if (limit <= 0) return [];
  const mandatory = candidatePool
    .filter(({ article }) => isDirectPriorityArticle(article))
    .sort((a, b) => b.priority - a.priority);
  const selectedMandatory = mandatory.slice(0, limit);
  const selectedIds = new Set(selectedMandatory.map((item) => item.id));
  const remaining = Math.max(0, limit - selectedMandatory.length);
  if (!remaining) return selectedMandatory;
  const regular = candidatePool.filter((item) => !selectedIds.has(item.id));
  return [...selectedMandatory, ...selectBalancedCandidates(regular, remaining)];
}

function isModelAccessError(error) {
  return Boolean(error?.modelAccessError)
    || /model_not_found|must be verified|do not have access|does not exist/i.test(String(error?.message || ""));
}

async function request(items, selectedModel) {
  const instruction = `이라크 뉴스의 중요도를 입력된 category 안에서 상대평가한다.

점수 기준:
- 해당 카테고리 핵심 의제와의 직접성
- 사건의 국가적 규모·금액·정책 파급력
- 총리·국무회의·의회·부처·사법기관 등 권한 있는 주체의 공식 결정·조치
- 주간보고서에서의 실제 활용가치
- 출처와 수치의 구체성
- 제목과 본문이 짧다는 이유만으로 중요도를 낮추지 말고, 등장인물의 현재·과거 직위, 기관 간 관계, 회동 의제와 사업상 파급력을 함께 판정한다.
- 단순 키워드 개수가 아니라 '누가 누구와 무엇을 결정·지시·논의했는가'를 중심으로 평가한다.

카테고리 기준:
- bismayah: 비스마야·شركة هانوا·الهيئة الوطنية للاستثمار·계약·대금·금융·보증·공사재개 영향을 특히 높게 평가한다. NIC 의장과 현·전 총리, 주요 정파 지도자, 장관 등 핵심 이해관계자의 투자·주택·국가사업 회동은 비스마야를 직접 언급하지 않아도 80점 이상 검토 대상으로 평가한다. 단순 의전·축하·일상 방문은 제외한다.
- economy: 이라크 경제·건설·주택·인프라·투자·예산·에너지·국가사업의 중요도를 평가한다.
- politics: 정부 구성, 총리·의회·정당 권력구도, 법률·인사·부패수사·국정운영 영향을 평가한다.
- security: 이라크 내 테러·무력사건·치안조치의 위치, 피해, 국가안보 및 현장운영 영향을 평가한다.
- international: 이라크 외교·에너지·교역·안보·물류에 미치는 직접 영향을 평가한다.

기사에 없는 전망이나 영향을 만들지 않는다. 각 id마다 score와 reportPriority만 반환한다.`;

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
            description: "Compact category-relative importance scores for supplied Iraqi news articles",
            strict: true,
            schema: OUTPUT_SCHEMA
          }
        },
        max_output_tokens: Math.max(600, items.length * 100)
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
      return isDirectPriorityArticle(article) || ruleScores[index] >= 60;
    });

  const candidates = selectCandidates(candidatePool, maxArticles);

  let activeModelIndex = 0;
  let activeModel = modelCandidates[activeModelIndex];
  let evaluated = 0;
  let failedBatches = 0;
  let modelFallbacks = 0;

  console.log(`[importance-ai] model candidates=${modelCandidates.join(",")}`);
  console.log(`[importance-ai] candidate pool=${candidatePool.length}, selected=${candidates.length}, strategy=direct-priority-plus-category-balanced`);

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
      selectionStrategy: "DIRECT_PRIORITY_PLUS_CATEGORY_BALANCED"
    }
  };
}
