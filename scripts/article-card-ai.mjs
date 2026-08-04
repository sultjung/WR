const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
const timeoutMs = Math.max(15000, Number(process.env.CARD_AI_TIMEOUT_MS || 90000));

const FACTS_SCHEMA = {
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
          mainSubjectAr: { type: "string" },
          actionAr: { type: "string" },
          locationAr: { type: "string" },
          eventDateAr: { type: "string" },
          resultAr: { type: "string" },
          keyFactsAr: { type: "array", items: { type: "string" } },
          numbersAr: { type: "array", items: { type: "string" } },
          peopleAr: { type: "array", items: { type: "string" } },
          organizationsAr: { type: "array", items: { type: "string" } },
          directQuotesAr: { type: "array", items: { type: "string" } },
          uncertaintiesAr: { type: "array", items: { type: "string" } },
          multipleAgendaItems: { type: "boolean" }
        },
        required: [
          "id", "mainSubjectAr", "actionAr", "locationAr", "eventDateAr", "resultAr",
          "keyFactsAr", "numbersAr", "peopleAr", "organizationsAr", "directQuotesAr",
          "uncertaintiesAr", "multipleAgendaItems"
        ]
      }
    }
  },
  required: ["results"]
};

const CARD_SCHEMA = {
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
          titleKo: { type: "string" },
          summaryKo: { type: "string" }
        },
        required: ["id", "titleKo", "summaryKo"]
      }
    }
  },
  required: ["results"]
};

const RELATED_TITLE_SCHEMA = {
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
          titleKo: { type: "string" }
        },
        required: ["id", "titleKo"]
      }
    }
  },
  required: ["results"]
};

function responseText(payload = {}) {
  if (typeof payload.output_text === "string") return payload.output_text;
  return (payload.output || [])
    .flatMap((item) => item.content || [])
    .filter((item) => item?.type === "output_text")
    .map((item) => item.text || "")
    .join("\n");
}

function parseResults(payload = {}) {
  const text = responseText(payload).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const parsed = JSON.parse(text);
  if (!parsed || !Array.isArray(parsed.results)) throw new Error("card AI returned no results array");
  return parsed.results;
}

function modelList(primaryEnv, fallbackEnv, defaultPrimary = "gpt-4.1-mini") {
  const primary = String(process.env[primaryEnv] || defaultPrimary).trim();
  const fallbacks = String(process.env[fallbackEnv] || process.env.CARD_MODEL_FALLBACKS || "gpt-4o-mini")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set([primary, ...fallbacks])];
}

function isModelAccessError(status, body) {
  return status === 404 && /model_not_found|must be verified|do not have access|does not exist/i.test(body);
}

async function requestStructured({ items, models, instruction, schema, schemaName, maxOutputTokens }) {
  if (!apiKey) throw new Error("OPENAI_API_KEY is unavailable to article-card generation");
  let lastError;
  for (const model of models) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("CARD_AI_TIMEOUT")), timeoutMs);
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          store: false,
          input: [
            { role: "system", content: [{ type: "input_text", text: instruction }] },
            { role: "user", content: [{ type: "input_text", text: JSON.stringify(items) }] }
          ],
          text: {
            format: {
              type: "json_schema",
              name: schemaName,
              strict: true,
              schema
            }
          },
          max_output_tokens: maxOutputTokens
        })
      });
      if (!response.ok) {
        const body = (await response.text()).slice(0, 1000);
        const error = new Error(`OpenAI ${response.status} (${model}): ${body}`);
        if (isModelAccessError(response.status, body)) {
          lastError = error;
          console.warn(`[article-card-ai] model unavailable: ${model}`);
          continue;
        }
        throw error;
      }
      return { results: parseResults(await response.json()), model };
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error("No article-card model is available");
}

export async function extractArabicFacts(items) {
  const instruction = `أنت محرر حقائق للأخبار العراقية. اقرأ النص العربي الأصلي كاملاً ثم استخرج الحقائق المؤكدة فقط باللغة العربية.
هذه ليست مهمة ترجمة، ولا تكتب أي جملة كورية أو إنجليزية.
تجاهل اسم الكاتب، السيرة الذاتية، أزرار المشاركة، الوسوم، القوائم، الأخبار السابقة واللاحقة، والإعلانات.
احفظ أسماء الأشخاص والمؤسسات والأماكن والأرقام والتواريخ كما وردت. لا تضف توقعات أو آثاراً لم يذكرها المصدر.
إذا كان الخبر عن اجتماع أو جلسة فيها عدة بنود، فعّل multipleAgendaItems ولا تختزل الخبر في بند واحد.
ضع الشك أو التعارض أو النقص في uncertaintiesAr بدلاً من تخمينه.
أعد نتيجة واحدة لكل id.`;
  return requestStructured({
    items,
    models: modelList("CARD_FACT_MODEL", "CARD_FACT_MODEL_FALLBACKS"),
    instruction,
    schema: FACTS_SCHEMA,
    schemaName: "arabic_article_facts",
    maxOutputTokens: Math.max(1800, items.length * 850)
  });
}

export async function createKoreanCards(items) {
  const instruction = `당신은 이라크 주간상황보고서 사이트의 기사 카드 편집자다.
입력에는 아랍어 원문 전체가 아니라 1단계에서 확정한 구조화된 아랍어 사실만 제공된다. 제공된 사실 밖의 내용은 절대 추가하지 않는다.
각 id마다 한국어 제목 1개와 2~3문장의 카드 요약을 작성한다.
제목은 원문 제목을 직역하지 말고 핵심 주체·행동·결과가 드러나도록 짧게 재작성한다.
요약에는 주체, 장소, 행동 또는 결정, 결과를 우선 포함하고 인명·기관명·날짜·금액·수량은 누락하거나 바꾸지 않는다.
preferredTerms는 입력 사실에 실제로 등장한 고유명사의 권장 한국어 표기다. 같은 대상을 지칭할 때 우선 사용하되, 일반 단어처럼 기계적으로 치환하거나 등장하지 않은 용어를 억지로 넣지 않는다.
multipleAgendaItems가 true이면 회의 전체를 단일 안건처럼 왜곡하지 않는다.
전망, 평가, 비스마야 영향, '주목된다', '가능성이 있다' 같은 문구를 임의로 만들지 않는다.
한국어는 짧고 단정하게 작성하며 전문 번역은 생성하지 않는다.`;
  return requestStructured({
    items,
    models: modelList("CARD_KO_MODEL", "CARD_KO_MODEL_FALLBACKS"),
    instruction,
    schema: CARD_SCHEMA,
    schemaName: "korean_article_cards",
    maxOutputTokens: Math.max(1000, items.length * 360)
  });
}

export async function translateRelatedTitles(items) {
  const instruction = `당신은 이라크 뉴스 사이트의 관련기사 제목 번역자다.
각 입력의 titleArabic만 근거로 한국어 제목 1개를 작성한다.
원문의 주체·행동·대상·숫자·인명·기관명을 보존하고, 원문에 없는 결과·평가·전망을 추가하지 않는다.
제목은 직역투를 피하되 원문의 의미를 바꾸지 말고 짧고 자연스러운 한국어 뉴스 제목으로 작성한다.
preferredTerms는 제목에 실제로 등장한 고유명사의 권장 한국어 표기다. 같은 대상을 지칭할 때 우선 사용하되, 일반 단어처럼 강제 치환하거나 등장하지 않은 용어를 넣지 않는다.
각 id마다 정확히 한 개의 결과를 반환한다.`;
  return requestStructured({
    items,
    models: modelList("RELATED_TITLE_MODEL", "RELATED_TITLE_MODEL_FALLBACKS"),
    instruction,
    schema: RELATED_TITLE_SCHEMA,
    schemaName: "korean_related_news_titles",
    maxOutputTokens: Math.max(800, items.length * 140)
  });
}
