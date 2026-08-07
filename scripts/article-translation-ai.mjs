const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
const timeoutMs = Math.max(30000, Number(process.env.TRANSLATION_AI_TIMEOUT_MS || 120000));
const primaryModel = String(process.env.TRANSLATION_MODEL || "gpt-4.1-mini").trim();
const fallbackModels = String(process.env.TRANSLATION_MODEL_FALLBACKS || "gpt-4o-mini")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const modelCandidates = [...new Set([primaryModel, ...fallbackModels])];

const ARTICLE_TRANSLATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    titleKo: { type: "string" },
    fullTextKo: { type: "string" }
  },
  required: ["titleKo", "fullTextKo"]
};

function responseText(payload = {}) {
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  return (payload.output || [])
    .flatMap((item) => item.content || [])
    .filter((item) => item?.type === "output_text")
    .map((item) => item.text || "")
    .join("\n")
    .trim();
}

function parseStructuredText(text = "") {
  const cleaned = String(text)
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const parsed = JSON.parse(cleaned);
  if (!parsed || typeof parsed !== "object") throw new Error("translation returned invalid JSON");
  if (!String(parsed.titleKo || "").trim()) throw new Error("translation returned empty titleKo");
  if (!String(parsed.fullTextKo || "").trim()) throw new Error("translation returned empty fullTextKo");
  return {
    titleKo: String(parsed.titleKo).trim(),
    fullTextKo: String(parsed.fullTextKo).trim()
  };
}

function isModelAccessError(status, body) {
  return status === 404 && /model_not_found|must be verified|do not have access|does not exist/i.test(body);
}

function termsInstruction(preferredTerms = []) {
  if (!Array.isArray(preferredTerms) || !preferredTerms.length) return "";
  const rows = preferredTerms
    .slice(0, 30)
    .map((term) => `${term.arabic || term.source || ""} → ${term.korean || ""}`)
    .filter((row) => !row.endsWith("→ "));
  return rows.length ? `\n고유명사 권장 표기:\n${rows.join("\n")}` : "";
}

export async function translateArabicArticle(titleArabic, bodyArabic, preferredTerms = []) {
  if (!apiKey) throw new Error("OPENAI_API_KEY is unavailable to full article translation");

  const title = String(titleArabic || "").trim();
  const body = String(bodyArabic || "").trim();
  if (!title) throw new Error("Arabic title is empty");
  if (!body) throw new Error("Arabic body is empty");

  const instruction = `당신은 이라크 아랍어 뉴스 전문을 한국어로 옮기는 정밀 번역자다.
입력 JSON의 titleArabic과 bodyArabic을 한 번에 번역한다.
제목과 본문 모두 요약, 축약, 재구성, 해설, 분석, 영향평가를 하지 않는다.
원문의 주체·행동·대상·인명·기관명·지명·날짜·금액·수량·인용·부정 표현·조건 표현·뉘앙스를 보존한다.
본문의 문장 순서와 문단 순서를 유지하고 반복 내용도 임의로 삭제하지 않는다.
원문에 없는 정보나 연결 문장을 만들지 않는다.
titleKo에는 자연스러운 한국어 제목만, fullTextKo에는 본문 전체 번역만 넣는다.${termsInstruction(preferredTerms)}`;

  const inputText = JSON.stringify({ titleArabic: title, bodyArabic: body });
  const maxOutputTokens = Math.max(1800, Math.min(12000, Math.ceil(body.length * 0.9) + 400));
  let lastError;

  for (const model of modelCandidates) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("TRANSLATION_AI_TIMEOUT")), timeoutMs);
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
            { role: "user", content: [{ type: "input_text", text: inputText }] }
          ],
          text: {
            format: {
              type: "json_schema",
              name: "article_translation",
              description: "Faithful Korean translation of one Arabic article title and full body",
              strict: true,
              schema: ARTICLE_TRANSLATION_SCHEMA
            }
          },
          max_output_tokens: maxOutputTokens
        })
      });

      if (!response.ok) {
        const responseBody = (await response.text()).slice(0, 1200);
        const error = new Error(`OpenAI ${response.status} (${model}): ${responseBody}`);
        if (isModelAccessError(response.status, responseBody)) {
          lastError = error;
          console.warn(`[article-translation-ai] model unavailable: ${model}`);
          continue;
        }
        throw error;
      }

      const translated = parseStructuredText(responseText(await response.json()));
      return { ...translated, model };
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || new Error("No translation model is available");
}
