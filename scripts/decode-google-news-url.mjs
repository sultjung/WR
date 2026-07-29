#!/usr/bin/env node

/**
 * Decode Google News RSS article URLs through Google's batchexecute endpoint.
 *
 * The RSS link contains an opaque article id rather than a normal HTTP redirect.
 * This module asks Google News to resolve that id and returns the publisher URL.
 *
 * Protocol reference:
 * https://gist.github.com/huksley/bc3cb046157a99cd9d1517b32f91a99e
 * Original approach licensed under the MIT License.
 */

const DEFAULT_TIMEOUT_MS = Number(process.env.GOOGLE_NEWS_DECODE_TIMEOUT_MS || 15000);

function extractGoogleNewsId(value = "") {
  try {
    const url = new URL(value);
    if (url.hostname !== "news.google.com") return "";
    const match = url.pathname.match(/\/(?:rss\/)?articles\/([^/?#]+)/i);
    return match?.[1] || "";
  } catch {
    return "";
  }
}

function buildRequestPayload(id) {
  const request = [
    "garturlreq",
    [
      ["ar", "IQ", ["FINANCE_TOP_INDICES", "WEB_TEST_1_0_0"], null, null, 1, 1, "IQ:ar", null, 180, null, null, null, null, null, 0, null, null, [1608992183, 723341000]],
      "ar",
      "IQ",
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
  const marker = '[\\"garturlres\\",\\"';
  const startIndex = responseText.indexOf(marker);
  if (startIndex < 0) return "";
  const remainder = responseText.slice(startIndex + marker.length);
  const endIndex = remainder.indexOf('\\",');
  if (endIndex < 0) return "";
  return remainder.slice(0, endIndex)
    .replace(/\\u003d/g, "=")
    .replace(/\\u0026/g, "&")
    .replace(/\\u002f/g, "/")
    .replace(/\\\//g, "/")
    .replace(/\\"/g, '"');
}

export async function decodeGoogleNewsUrl(googleNewsUrl, options = {}) {
  const id = extractGoogleNewsId(googleNewsUrl);
  if (!id) return "";

  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch("https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je", {
      method: "POST",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
        "accept-language": "ar-IQ,ar;q=0.9,en;q=0.5",
        referer: "https://news.google.com/"
      },
      body: `f.req=${encodeURIComponent(buildRequestPayload(id))}`
    });

    if (!response.ok) throw new Error(`GOOGLE_DECODE_HTTP_${response.status}`);
    const decoded = parseDecodedUrl(await response.text());
    if (!decoded) throw new Error("GOOGLE_DECODE_RESPONSE_INVALID");

    try {
      const parsed = new URL(decoded);
      return /^https?:$/.test(parsed.protocol) ? parsed.toString() : "";
    } catch {
      throw new Error("GOOGLE_DECODE_URL_INVALID");
    }
  } finally {
    clearTimeout(timer);
  }
}

export { extractGoogleNewsId };
