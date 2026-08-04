import fs from "node:fs";
import { createHash } from "node:crypto";

const GLOSSARY_URL = new URL("../config/translation-glossary.json", import.meta.url);
const rawGlossary = fs.readFileSync(GLOSSARY_URL, "utf8");
const payload = JSON.parse(rawGlossary);

export const GLOSSARY_VERSION = String(payload.version || "1");
export const GLOSSARY_HASH = createHash("sha256").update(rawGlossary).digest("hex").slice(0, 20);
export const PREFERRED_TRANSLATION_TERMS = (Array.isArray(payload.entries) ? payload.entries : [])
  .map((entry) => ({
    ko: String(entry.ko || "").trim(),
    ar: String(entry.ar || "").trim(),
    aliases: Array.isArray(entry.aliases) ? entry.aliases.map((value) => String(value || "").trim()).filter(Boolean) : []
  }))
  .filter((entry) => entry.ko && entry.ar);

export function normalizeArabicGlossary(value = "") {
  return String(value)
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/\u0640/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function matchLength(normalizedText, entry) {
  const candidates = [entry.ar, ...entry.aliases]
    .map(normalizeArabicGlossary)
    .filter(Boolean);
  return candidates.reduce((best, candidate) => normalizedText.includes(candidate) ? Math.max(best, candidate.length) : best, 0);
}

export function preferredTermsForText(value = "", maxItems = 16) {
  const normalizedText = normalizeArabicGlossary(value);
  if (!normalizedText) return [];

  return PREFERRED_TRANSLATION_TERMS
    .map((entry) => ({ entry, length: matchLength(normalizedText, entry) }))
    .filter((item) => item.length > 0)
    .sort((a, b) => b.length - a.length || a.entry.ko.localeCompare(b.entry.ko, "ko"))
    .slice(0, Math.max(1, maxItems))
    .map(({ entry }) => ({
      arabic: entry.ar,
      korean: entry.ko
    }));
}
