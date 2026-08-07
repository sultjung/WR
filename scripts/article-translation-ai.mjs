const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
const timeoutMs = Math.max(30000, Number(process.env.TRANSLATION_AI_TIMEOUT_MS || 120000));
const primaryModel = String(process.env.TRANSLATION_MODEL || "gpt-4.1-mini").trim();
const fallbackModels = String(process.env.TRANSLATION_MODEL_FALLBACKS || "gpt-4o-mini")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const modelCandidates = [...new Set([primaryModel, ...fallbackModels])];

function responseText(payload = {}) {
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  return (payload.output || [])
    .flatMap((item) => item.content || [])
    .filter((item) => item?.type === "output_text")
    .map((item) => item.text || "")
    .join("\n")
    .trim();
}

function isModelAccessError(status, body) {
  return status === 404 && /model_not_found|must be verified|do not have access|does not exist/i.test(body);
}

async function requestTranslation({ instruction, inputText, maxOutputTokens }) {
  if (!apiKey) throw new Error("OPENAI_API_KEY is unavailable to full article translation");
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
          max_output_tokens: maxOutputTokens
        })
      });

      if (!response.ok) {
        const body = (await response.text()).slice(0, 1200);
        const error = new Error(`OpenAI ${response.status} (${model}): ${body}`);
        if (isModelAccessError(response.status, body)) {
          lastError = error;
          console.warn(`[article-translation-ai] model unavailable: ${model}`);
          continue;
        }
        throw error;
      }

      const text = responseText(await response.json());
      if (!text) throw new Error(`translation returned empty text (${model})`);
      return { text, model };
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || new Error("No translation model is available");
}

function termsInstruction(preferredTerms = []) {
  if (!Array.isArray(preferredTerms) || !preferredTerms.length) return "";
  const rows = preferredTerms
    .slice(0, 30)
    .map((term) => `${term.arabic || term.source || ""} → ${term.korean || ""}`)
    .filter((row) => !row.endsWith("→ "));
  return rows.length ? `\n고유명사 권장 표기:\n${rows.join("\n")}` : "";
}

export async function translateArabicTitle(titleArabic, preferredTerms = []) {
  const instruction = `당신은 이라크 아랍어 뉴스의 한국어 번역자다.
입력은 기사 제목이다. 제목을 요약하거나 보고서식으로 재작성하지 말고, 원문의 주체·행동·대상·수치·고유명사·뉘앙스를 그대로 보존해 자연스러운 한국어 제목으로 충실히 번역한다.
원문에 없는 결과, 평가, 배경, 전망을 절대 추가하지 않는다.
출력에는 번역된 한국어 제목만 적고 설명이나 따옴표를 붙이지 않는다.${termsInstruction(preferredTerms)}`;
  return requestTranslation({
    instruction,
    inputText: String(titleArabic || "").trim(),
    maxOutputTokens: 300
  });
}

export async function translateArabicBodyChunk(bodyArabic, preferredTerms = []) {
  const instruction = `당신은 이라크 아랍어 뉴스 전문을 한국어로 옮기는 정밀 번역자다.
입력된 아랍어 본문을 처음부터 끝까지 빠짐없이 번역한다.
절대로 요약, 축약, 재구성, 해설, 분석, 영향평가를 하지 않는다.
문장에 있는 인명·기관명·지명·날짜·금액·수량·인용·부정 표현·조건 표현을 보존한다.
원문의 문장 순서와 문단 순서를 유지한다. 같은 내용이 반복되어도 임의로 삭제하지 않는다.
원문에 없는 정보나 연결 문장을 만들지 않는다.
번역문만 출력하고 '번역:' 같은 머리말이나 설명을 붙이지 않는다.${termsInstruction(preferredTerms)}`;
  const inputLength = String(bodyArabic || "").length;
  return requestTranslation({
    instruction,
    inputText: String(bodyArabic || "").trim(),
    maxOutputTokens: Math.max(1800, Math.min(8000, Math.ceil(inputLength * 0.85)))
  });
}
