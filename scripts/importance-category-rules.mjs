export const IMPORTANCE_SCORING_VERSION = 8;

export function starsForScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return null;
  return Math.max(0.5, Math.min(5, Math.round(score / 10) / 2));
}

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

export function categoryOf(article = {}) {
  const record = recordOf(article);
  return normalizeImportanceCategory(article.analysis?.category || article.category || record.category || "");
}

export function categoryArticleText(article = {}) {
  const record = recordOf(article);
  return [
    record.originalTitleArabic, article.originalTitleArabic,
    record.descriptionArabic, article.descriptionArabic,
    record.originalTextArabic, article.originalTextArabic,
    article.card?.titleKo, article.card?.summaryKo,
    article.translation?.titleKo, article.translation?.previewKo,
    article.display_title, article.display_summary
  ].filter(Boolean).join("\n");
}

function hasAny(text, terms) {
  const normalized = normalizeCategoryText(text);
  return terms.some((term) => normalized.includes(normalizeCategoryText(term)));
}

export function categoryFloorFor(article = {}) {
  const category = categoryOf(article);
  const text = categoryArticleText(article);
  const rules = [];

  if (category === "economy") {
    const stalledProject = hasAny(text, [
      "المشاريع المتلكئة", "مشاريع متلكئة", "المشاريع المتوقفة", "مشاريع متوقفة",
      "تعثر المشاريع", "المشاريع المتعثرة", "توقف المشاريع", "العقود المتوقفة",
      "지연 사업", "중단 사업", "사업 지연", "사업 정상화"
    ]);
    const nationalAuthority = hasAny(text, [
      "البرلمان", "مجلس النواب", "مجلس الوزراء", "رئيس الوزراء", "وزارة التخطيط",
      "لجنة الخدمات والاعمار", "لجنة الاقتصاد والاستثمار", "لجنة الاستثمار والتنمية",
      "의회", "국회", "국무회의", "총리", "기획부"
    ]);
    const formalAction = hasAny(text, [
      "فتح ملف", "يفتح ملف", "بحث ملف", "مناقشة ملف", "تحقيق", "استضافة",
      "استجواب", "لجنة تحقيق", "اعداد تقرير", "تقديم تقرير", "توصيات",
      "معالجة", "حسم", "공식 검토", "조사 착수", "현황 점검", "보고서 제출"
    ]);
    const nationalScope = hasAny(text, [
      "في العراق", "عموم العراق", "جميع المحافظات", "المشاريع الحكومية",
      "المشاريع الوطنية", "이라크 전역", "국가 사업", "정부 사업"
    ]);

    if (stalledProject && nationalAuthority && formalAction && nationalScope) {
      rules.push([78, "ECONOMY_NATIONAL_STALLED_PROJECT_OVERSIGHT", "경제/건설 카테고리에서 국가기관이 이라크 지연·중단 사업을 공식 점검하는 핵심 정책 기사임"]);
    } else if (stalledProject && nationalAuthority && formalAction) {
      rules.push([72, "ECONOMY_STALLED_PROJECT_OVERSIGHT", "경제/건설 카테고리에서 권한 있는 국가기관이 지연·중단 사업의 해결 절차에 착수함"]);
    }
  }

  if (category === "politics") {
    const nationalLeadership = hasAny(text, [
      "رئيس الوزراء", "مجلس الوزراء", "رئاسة الوزراء", "رئيس الجمهورية",
      "مجلس النواب", "الإطار التنسيقي", "총리", "국무회의", "대통령", "의회"
    ]);
    const governmentFormation = hasAny(text, [
      "تشكيل الحكومة", "استكمال تشكيل الحكومة", "استكمال تشكيل الكابينة الوزارية",
      "التشكيلة الوزارية", "الحقائب الوزارية", "منح الثقة",
      "정부 구성", "내각 구성", "조각", "신임 투표"
    ]);
    const stateArmsControl = hasAny(text, [
      "حصر السلاح بيد الدولة", "حصر السلاح", "نزع سلاح الفصائل", "سيادة القانون",
      "국가의 무기 독점", "무기 회수", "무장 정파 무장해제", "법치 확립"
    ]);
    const antiCorruptionAction = hasAny(text, [
      "مكافحة الفساد", "هيئة النزاهة", "إحالة إلى القضاء", "اعتقال بتهمة الفساد",
      "부패 척결", "청렴위원회", "사법부 회부", "부패 혐의 체포"
    ]);

    if (nationalLeadership && governmentFormation && stateArmsControl) {
      rules.push([78, "POLITICS_GOVERNMENT_FORMATION_AND_STATE_ARMS", "정부 구성과 국가의 무기 독점 문제를 최고위급에서 함께 논의한 핵심 정국 기사임"]);
    } else if (nationalLeadership && governmentFormation) {
      rules.push([74, "POLITICS_GOVERNMENT_FORMATION", "총리·의회·주요 정치세력이 정부 및 내각 구성을 다룬 핵심 정국 기사임"]);
    } else if (nationalLeadership && stateArmsControl) {
      rules.push([72, "POLITICS_STATE_ARMS_CONTROL", "국가 지도부가 무기 독점·무장세력 통제·법치 확립을 다룬 국가안보 연계 정치 기사임"]);
    } else if (nationalLeadership && antiCorruptionAction) {
      rules.push([68, "POLITICS_HIGH_LEVEL_ANTI_CORRUPTION", "국가 지도부 또는 의회가 부패 척결과 공식 사법·행정 조치를 다룬 주요 정치 기사임"]);
    }
  }

  const selected = rules.sort((a, b) => b[0] - a[0])[0] || [0, "NONE", ""];
  return { score: selected[0], rule: selected[1], reasonKo: selected[2], category };
}
