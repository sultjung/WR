const ANADOLU_CONTAINER_PATTERNS = [
  /<div\b[^>]*class=(["'])[^"']*(?:\bembed-responsive\b[^"']*\bprose\b|\bprose\b[^"']*\bembed-responsive\b)[^"']*\1[^>]*>([\s\S]*?)<\/div>/gi,
  /<div\b[^>]*class=(["'])[^"']*\bdetay-icerik\b[^"']*\1[^>]*>([\s\S]*?)<\/div>/gi
];

export function extractAnadoluCandidates(html = "") {
  const candidates = [];
  for (const pattern of ANADOLU_CONTAINER_PATTERNS) {
    for (const match of String(html).matchAll(pattern)) {
      const body = String(match[2] || "").trim();
      if (body) candidates.push(body);
    }
  }
  return candidates;
}
