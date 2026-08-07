export const IMPORTANCE_SCORING_VERSION = 6;

const CATEGORY_ALIASES = {
  bismayah: ["bismayah", "비스마야", "بسماية"],
  politics: ["politics", "political", "정치", "정국", "정국/정치", "السياسة", "سياسة"],
  economy: ["economy", "economic", "construction", "economy/construction", "economy & construction", "경제/건설", "경제·건설", "경제 건설", "경제", "건설", "الاقتصاد", "اقتصاد", "الاعمار", "اعمار"],
  security: ["security", "안보", "치안", "치안/안보", "الامن", "أمن", "امن"],
  international: ["international", "국제사회", "국제", "الدولية", "دولي"]
};

export function normalizeCategoryText(value = "") {
  return String(value)
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/\u0640/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function normalizeImportanceCategory(value = "") {
  const normalized = normalizeCategoryText(value);
  if (!normalized) return "";
  for (const [canonical, aliases] of Object.entries(CATEGORY_ALIASES)) {
    if (aliases.some((alias) => {
      const candidate = normalizeCategoryText(alias);
      return normalized === candidate
        || normalized.startsWith(`${candidate} >`)
        || normalized.startsWith(`${candidate}/`)
        || normalized.includes(` ${candidate} `);
    })) return canonical;
  }
  return normalized;
}

function recordOf(article = {}) {
  return article.article && typeof article.article === "object" ? article.article : article;
}

function textOf(article = {}) {
  const record = recordOf(article);
  return [
    article.originalTitleArabic,
    record.originalTitleArabic,
    article.originalTextArabic,
    record.originalTextArabic,
    article.descriptionArabic,
    record.descriptionArabic,
    article.card?.titleKo,
    article.card?.summaryKo,
    article.translation?.titleKo,
    article.translation?.previewKo,
    article.display_title
  ].filter(Boolean).join("\n");
}

const ECONOMY_STALLED_PROJECT_RE = /(?:المشاريع?\s+(?:المتلكئه|المتوقفه)|مشاريع?\s+(?:متلكئه|متوقفه)|stalled\s+projects?|delayed\s+projects?|중단\s*사업|지연\s*사업)/i;
const OVERSIGHT_RE = /(?:لجنه|مجلس\s+النواب|البرلمان|مجلس\s+الوزراء|وزاره|متابعه|تحقيق|استئناف|اعاده\s+العمل|committee|parliament|cabinet|ministry|oversight|investigat|resume|restart|위원회|의회|국무회의|부처|점검|조사|재개)/i;

export function categoryFloorFor(article = {}) {
  const category = normalizeImportanceCategory(article.analysis?.category || article.category || recordOf(article).category || "");
  const text = textOf(article);

  if (category === "economy" && ECONOMY_STALLED_PROJECT_RE.test(text) && OVERSIGHT_RE.test(text)) {
    const nationalSignal = /(?:العراق|وطني|اتحادي|مجلس\s+النواب|مجلس\s+الوزراء|الحكومه|iraq|national|federal|parliament|cabinet|이라크|국가|연방|의회|국무회의)/i.test(text);
    return {
      category,
      score: nationalSignal ? 78 : 72,
      rule: nationalSignal ? "ECONOMY_NATIONAL_STALLED_PROJECT_OVERSIGHT" : "ECONOMY_STALLED_PROJECT_OVERSIGHT",
      reasonKo: nationalSignal
        ? "이라크 국가 차원의 지연·중단 사업 점검·정상화 조치"
        : "지연·중단 사업에 대한 공식 점검·정상화 조치"
    };
  }

  return { category, score: 0, rule: "NONE", reasonKo: "" };
}
