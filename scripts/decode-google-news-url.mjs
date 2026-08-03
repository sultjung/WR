#!/usr/bin/env node

/**
 * Decode Google News RSS links to publisher URLs.
 * Uses the proven legacy batch request first, then the signed variant.
 */

const DEFAULT_TIMEOUT_MS = Number(process.env.GOOGLE_NEWS_DECODE_TIMEOUT_MS || 15000);

function extractGoogleNewsId(value = "") {
  try {
    const url = new URL(value);
    if (url.hostname !== "news.google.com") return "";
    return url.pathname.match(/\/(?:__i\/rss\/rd\/)?(?:rss\/)?(?:articles|read)\/([^/?#]+)/i)?.[1] || "";
  } catch { return ""; }
}

function decodeEscapes(value = "") {
  return String(value)
    .replace(/\\u003d/g, "=")
    .replace(/\\u0026/g, "&")
    .replace(/\\u002f/g, "/")
    .replace(/\\\//g, "/")
    .replace(/\\"/g, '"')
    .trim();
}

function validUrl(value = "") {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) ? url.toString() : "";
  } catch { return ""; }
}

async function fetchTextTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    return { response, text };
  } catch (error) {
    if (timedOut) throw new Error("GOOGLE_FETCH_TIMEOUT");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function legacyBase64(id) {
  try {
    const padded = id.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - id.length % 4) % 4);
    const text = Buffer.from(padded, "base64").toString("utf8");
    return validUrl(text.match(/https?:\/\/[^\u0000-\u0020"'<>]+/i)?.[0] || "");
  } catch { return ""; }
}

function parseBatch(text = "") {
  const marker = '[\\"garturlres\\",\\"';
  const start = String(text).indexOf(marker);
  if (start >= 0) {
    const rest = String(text).slice(start + marker.length);
    const end = rest.indexOf('\\",');
    if (end >= 0) return validUrl(decodeEscapes(rest.slice(0, end)));
  }
  const match = String(text).match(/https?:\\?\/?\\?\/[^"\\\s]+/i);
  return validUrl(decodeEscapes(match?.[0] || ""));
}

function directPayload(id) {
  const request = [
    "garturlreq",
    [["en-US", "US", ["FINANCE_TOP_INDICES", "WEB_TEST_1_0_0"], null, null, 1, 1, "US:en", null, 180, null, null, null, null, null, 0, null, null, [1608992183, 723341000]], "en-US", "US", 1, [2, 3, 4, 8], 1, 0, "655000234", 0, 0, null, 0],
    id
  ];
  return JSON.stringify([[['Fbv4je', JSON.stringify(request), null, 'generic']]]);
}

async function postBatch(payload, timeoutMs) {
  const { response, text } = await fetchTextTimeout(
    "https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je",
    {
      method: "POST",
      redirect: "follow",
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=utf-8",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
        "accept-language": "en-US,en;q=0.9",
        referer: "https://news.google.com/"
      },
      body: `f.req=${encodeURIComponent(payload)}`
    },
    timeoutMs
  );
  if (!response.ok) throw new Error(`GOOGLE_BATCH_HTTP_${response.status}`);
  const decoded = parseBatch(text);
  if (!decoded) throw new Error("GOOGLE_BATCH_RESPONSE_INVALID");
  return decoded;
}

function attribute(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return String(html).match(new RegExp(`${escaped}=["']([^"']+)["']`, "i"))?.[1] || "";
}

async function signedParams(id, timeoutMs) {
  for (const url of [
    `https://news.google.com/articles/${id}?hl=en-US&gl=US&ceid=US:en`,
    `https://news.google.com/rss/articles/${id}?hl=en-US&gl=US&ceid=US:en`
  ]) {
    const { response, text: html } = await fetchTextTimeout(url, {
      redirect: "follow",
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
        "accept-language": "en-US,en;q=0.9"
      }
    }, timeoutMs);
    if (!response.ok) continue;
    const signature = attribute(html, "data-n-a-sg");
    const timestamp = attribute(html, "data-n-a-ts");
    if (signature && timestamp) return { signature, timestamp };
  }
  throw new Error("GOOGLE_SIGNED_PARAMS_MISSING");
}

function signedPayload(id, timestamp, signature) {
  const request = [
    "garturlreq",
    [["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0],
    id,
    Number(timestamp),
    signature
  ];
  return JSON.stringify([[['Fbv4je', JSON.stringify(request), null, 'generic']]]);
}

export async function decodeGoogleNewsUrl(googleNewsUrl, options = {}) {
  const id = extractGoogleNewsId(googleNewsUrl);
  if (!id) return "";
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);

  const embedded = legacyBase64(id);
  if (embedded) return embedded;

  let directError = "";
  try { return await postBatch(directPayload(id), timeoutMs); }
  catch (error) { directError = String(error.message || error); }

  try {
    const { signature, timestamp } = await signedParams(id, timeoutMs);
    return await postBatch(signedPayload(id, timestamp, signature), timeoutMs);
  } catch (error) {
    throw new Error(`${directError}; ${String(error.message || error)}`);
  }
}

export { extractGoogleNewsId, legacyBase64, parseBatch };
