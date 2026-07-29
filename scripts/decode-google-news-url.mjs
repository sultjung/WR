#!/usr/bin/env node

/**
 * Decode Google News RSS article URLs to publisher URLs.
 *
 * Resolution order:
 * 1. Legacy URL embedded in the Base64 article id.
 * 2. Proven Fbv4je batchexecute request used by the legacy Bismayah-style flow.
 * 3. Signed request fallback for Google variants that expose data-n-a-sg/data-n-a-ts.
 */

const DEFAULT_TIMEOUT_MS = Number(process.env.GOOGLE_NEWS_DECODE_TIMEOUT_MS || 15000);

function extractGoogleNewsId(value = "") {
  try {
    const url = new URL(value);
    if (url.hostname !== "news.google.com") return "";
    const match = url.pathname.match(/\/(?:__i\/rss\/rd\/)?(?:rss\/)?(?:articles|read)\/([^/?#]+)/i);
    return match?.[1] || "";
  } catch {
    return "";
  }
}

function decodeEscapedUrl(value = "") {
  return String(value)
    .replace(/\\u003d/g, "=")
    .replace(/\\u0026/g, "&")
    .replace(/\\u002f/g, "/")
    .replace(/\\\//g, "/")
    .replace(/\\"/g, '"')
    .trim();
}

function validHttpUrl(value = "") {
  try {
    const parsed = new URL(value);
    return /^https?:$/.test(parsed.protocol) ? parsed.toString() : "";
  } catch {
    return "";
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function decodeLegacyBase64Id(id = "") {
  try {
    const padded = id.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - id.length % 4) % 4);
    const bytes = Buffer.from(padded, "base64");
    const text = bytes.toString("utf8");
    const match = text.match(/https?:\/\/[^\u0000-\u0020"'<>]+/i);
    return validHttpUrl(match?.[0] || "");
  } catch {
    return "";
  }
}

function buildDirectBatchPayload(id) {
  const request = [
    "garturlreq",
    [
      ["en-US", "US", ["FINANCE_TOP_INDICES", "WEB_TEST_1_0_0"], null, null, 1, 1, "US:en", null, 180, null, null, null, null, null, 0, null, null, [1608992183, 723341000]],
      "en-US",
      "US",
      1,
      [2, 3, 4, 8],
      1,
      0,
      "655000234",
      0,
      0,
      null,
      0
    ],
    id
  ];
  return JSON.stringify([[['Fbv4je', JSON.stringify(request), null, 'generic']]]);
}

function parseDecodedUrl(responseText = "") {
  const text = String(responseText);
  const marker = '[\\"garturlres\\",\\"';
  const startIndex = text.indexOf(marker);
  if (startIndex >= 0) {
    const remainder = text.slice(startIndex + marker.length);
    const endIndex = remainder.indexOf('\\",');
    if (endIndex >= 0) return validHttpUrl(decodeEscapedUrl(remainder.slice(0, endIndex)));
  }

  const escapedMatch = text.match(/https?:\\?\/?\\?\/[^"\\\s]+/i);
  return validHttpUrl(decodeEscapedUrl(escapedMatch?.[0] || ""));
}

async function decodeDirectBatch(id, timeoutMs) {
  const response = await fetchWithTimeout(
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
      body: `f.req=${encodeURIComponent(buildDirectBatchPayload(id))}`
    },
    timeoutMs
  );
  if (!response.ok) throw new Error(`GOOGLE_DIRECT_HTTP_${response.status}`);
  const decoded = parseDecodedUrl(await response.text());
  if (!decoded) throw new Error("GOOGLE_DIRECT_RESPONSE_INVALID");
  return decoded;
}

function extractAttribute(html = "", name = "") {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`${escaped}=["']([^"']+)["']`, "i"),
    new RegExp(`${escaped}=([^\\s>]+)`, "i")
  ];
  for (const pattern of patterns) {
    const match = String(html).match(pattern);
    if (match?.[1]) return match[1].replace(/&amp;/g, "&").trim();
  }
  return "";
}

async function getSignedParams(id, timeoutMs) {
  const urls = [
    `https://news.google.com/articles/${id}?hl=en-US&gl=US&ceid=US:en`,
    `https://news.google.com/rss/articles/${id}?hl=en-US&gl=US&ceid=US:en`
  ];
  let lastError = "";
  for (const url of urls) {
    try {
      const response = await fetchWithTimeout(url, {
        redirect: "follow",
        headers: {
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
          "accept-language": "en-US,en;q=0.9",
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.7"
        }
      }, timeoutMs);
      if (!response.ok) {
        lastError = `GOOGLE_PARAM_HTTP_${response.status}`;
        continue;
      }
      const html = await response.text();
      const signature = extractAttribute(html, "data-n-a-sg");
      const timestamp = extractAttribute(html, "data-n-a-ts");
      if (signature && timestamp) return { signature, timestamp };
      lastError = "GOOGLE_PARAM_ATTRIBUTES_MISSING";
    } catch (error) {
      lastError = String(error.message || error);
    }
  }
  throw new Error(lastError || "GOOGLE_PARAM_FETCH_FAILED");
}

function buildSignedPayload(id, timestamp, signature) {
  const request = [
    "garturlreq",
    [["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0],
    id,
    Number(timestamp),
    signature
  ];
  return JSON.stringify([[['Fbv4je', JSON.stringify(request), null, 'generic']]]);
}

async function decodeSignedBatch(id, timeoutMs) {
  const { signature, timestamp } = await getSignedParams(id, timeoutMs);
  const response = await fetchWithTimeout(
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
      body: `f.req=${encodeURIComponent(buildSignedPayload(id, timestamp, signature))}`
    },
    timeoutMs
  );
  if (!response.ok) throw new Error(`GOOGLE_SIGNED_HTTP_${response.status}`);
  const decoded = parseDecodedUrl(await response.text());
  if (!decoded) throw new Error("GOOGLE_SIGNED_RESPONSE_INVALID");
  return decoded;
}

export async function decodeGoogleNewsUrl(googleNewsUrl, options = {}) {
  const id = extractGoogleNewsId(googleNewsUrl);
  if (!id) return { url: "", method: "NOT_GOOGLE_NEWS", errors: [] };

  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const legacy = decodeLegacyBase64Id(id);
  if (legacy) return { url: legacy, method: "GOOGLE_NEWS_LEGACY_BASE64", errors: [] };

  const errors = [];
  try {
    const url = await decodeDirectBatch(id, timeoutMs);
    return { url, method: "GOOGLE_NEWS_DIRECT_BATCH", errors };
  } catch (error) {
    errors.push(String(error.message || error));
  }

  try {
    const url = await decodeSignedBatch(id, timeoutMs);
    return { url, method: "GOOGLE_NEWS_SIGNED_BATCH", errors };
  } catch (error) {
    errors.push(String(error.message || error));
  }

  return { url: "", method: "GOOGLE_NEWS_DECODE_FAILED", errors };
}

export { extractGoogleNewsId, decodeLegacyBase64Id, parseDecodedUrl };
