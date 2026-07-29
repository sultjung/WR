#!/usr/bin/env node

/**
 * Decode Google News RSS article URLs to publisher URLs.
 *
 * Current Google News links require a two-step flow:
 * 1. Fetch the Google News article page and extract data-n-a-sg/data-n-a-ts.
 * 2. Send the article id, timestamp and signature to batchexecute.
 */

const DEFAULT_TIMEOUT_MS = Number(process.env.GOOGLE_NEWS_DECODE_TIMEOUT_MS || 15000);

function extractGoogleNewsId(value = "") {
  try {
    const url = new URL(value);
    if (url.hostname !== "news.google.com") return "";
    const match = url.pathname.match(/\/(?:rss\/)?(?:articles|read)\/([^/?#]+)/i);
    return match?.[1] || "";
  } catch {
    return "";
  }
}

function decodeHtml(value = "") {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
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

function extractAttribute(html = "", name = "") {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`${escaped}=["']([^"']+)["']`, "i"),
    new RegExp(`${escaped}=([^\\s>]+)`, "i")
  ];
  for (const pattern of patterns) {
    const match = String(html).match(pattern);
    if (match?.[1]) return decodeHtml(match[1]).trim();
  }
  return "";
}

async function getDecodingParams(id, timeoutMs) {
  const candidates = [
    `https://news.google.com/articles/${id}?hl=ar&gl=IQ&ceid=IQ:ar`,
    `https://news.google.com/rss/articles/${id}?hl=ar&gl=IQ&ceid=IQ:ar`
  ];

  let lastError = "";
  for (const url of candidates) {
    try {
      const response = await fetchWithTimeout(url, {
        redirect: "follow",
        headers: {
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
          "accept-language": "ar-IQ,ar;q=0.9,en;q=0.5",
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

function buildRequestPayload(id, timestamp, signature) {
  const inner = [
    "garturlreq",
    [["X", "X", ["X", "X"], null, null, 1, 1, "IQ:ar", null, 1, null, null, null, null, null, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0],
    id,
    Number(timestamp),
    signature
  ];
  return JSON.stringify([[["Fbv4je", JSON.stringify(inner), null, "generic"]]]);
}

function parseDecodedUrl(responseText = "") {
  const text = String(responseText);
  const marker = '[\\"garturlres\\",\\"';
  const startIndex = text.indexOf(marker);
  if (startIndex >= 0) {
    const remainder = text.slice(startIndex + marker.length);
    const endIndex = remainder.indexOf('\\",');
    if (endIndex >= 0) {
      return remainder.slice(0, endIndex)
        .replace(/\\u003d/g, "=")
        .replace(/\\u0026/g, "&")
        .replace(/\\u002f/g, "/")
        .replace(/\\\//g, "/")
        .replace(/\\"/g, '"');
    }
  }

  const urlMatch = text.match(/https?:\\?\/?\\?\/[^"\\\s]+/i);
  return urlMatch?.[0]
    ? urlMatch[0].replace(/\\u003d/g, "=").replace(/\\u0026/g, "&").replace(/\\\//g, "/")
    : "";
}

export async function decodeGoogleNewsUrl(googleNewsUrl, options = {}) {
  const id = extractGoogleNewsId(googleNewsUrl);
  if (!id) return "";

  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const { signature, timestamp } = await getDecodingParams(id, timeoutMs);
  const response = await fetchWithTimeout(
    "https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je",
    {
      method: "POST",
      redirect: "follow",
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
        "accept-language": "ar-IQ,ar;q=0.9,en;q=0.5",
        referer: "https://news.google.com/"
      },
      body: `f.req=${encodeURIComponent(buildRequestPayload(id, timestamp, signature))}`
    },
    timeoutMs
  );

  if (!response.ok) throw new Error(`GOOGLE_DECODE_HTTP_${response.status}`);
  const decoded = parseDecodedUrl(await response.text());
  if (!decoded) throw new Error("GOOGLE_DECODE_RESPONSE_INVALID");

  const parsed = new URL(decoded);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("GOOGLE_DECODE_URL_INVALID");
  return parsed.toString();
}

export { extractGoogleNewsId, getDecodingParams };
