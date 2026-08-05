const IRAQ_TITLE_TERMS = [
  "العراق", "العراقي", "العراقية", "عراقي", "عراقية", "بغداد", "حكومة العراق", "الحكومة العراقية",
  "رئيس الوزراء العراقي", "رئيس مجلس الوزراء العراقي", "مجلس الوزراء العراقي", "مجلس النواب العراقي",
  "البرلمان العراقي", "وزارة الخارجية العراقية", "وزارة النفط العراقية", "وزارة التجارة العراقية",
  "وزارة التخطيط العراقية", "وزارة النقل العراقية", "البنك المركزي العراقي", "إقليم كردستان العراق",
  "اقليم كردستان العراق", "iraq", "iraqi", "이라크", "이라크 정부", "이라크 총리"
];

const IRAQ_STRONG_OPENING_TERMS = [
  "الحكومة العراقية", "حكومة العراق", "رئيس الوزراء العراقي", "رئيس مجلس الوزراء العراقي",
  "مجلس الوزراء العراقي", "مجلس النواب العراقي", "البرلمان العراقي", "رئاسة الجمهورية العراقية",
  "وزارة الخارجية العراقية", "وزارة النفط العراقية", "وزارة التجارة العراقية", "وزارة التخطيط العراقية",
  "وزارة النقل العراقية", "وزارة الموارد المائية العراقية", "البنك المركزي العراقي", "الوفد العراقي",
  "مسؤولون عراقيون", "الجانب العراقي", "القوات العراقية", "الجيش العراقي", "إقليم كردستان العراق",
  "اقليم كردستان العراق", "이라크 정부", "이라크 총리", "이라크 대표단", "이라크 측", "이라크군"
];

const POLITICS_TERMS = [
  "رئيس الوزراء", "رئيس الجمهورية", "الحكومة", "مجلس الوزراء", "مجلس النواب", "البرلمان",
  "وزارة الخارجية", "وزير الخارجية", "العلاقات الثنائية", "علاقات ثنائية", "الشراكة الاستراتيجية",
  "شراكة استراتيجية", "اتفاقية", "اتفاقيات", "مذكرة تفاهم", "مذكرات تفاهم", "زيارة رسمية",
  "مباحثات", "مفاوضات", "وفد حكومي", "اللجنة المشتركة", "لجنة مشتركة", "المجلس الأعلى للتعاون",
  "تعاون مشترك", "تنسيق مشترك", "بيان مشترك", "دبلوماسي", "دبلوماسية", "سياسة خارجية",
  "정부", "총리", "대통령", "의회", "외교", "양국 관계", "정상회담", "전략적 파트너십",
  "협정", "협약", "양해각서", "공동위원회", "공식 방문", "회담"
];

const ECONOMY_TERMS = [
  "اقتصاد", "اقتصادي", "اقتصادية", "تجارة", "تجاري", "التبادل التجاري", "استثمار", "استثمارات",
  "نفط", "غاز", "طاقة", "كهرباء", "مياه", "موارد مائية", "نقل", "مواصلات", "طريق التنمية",
  "سكك حديد", "ميناء", "موانئ", "جمارك", "منطقة حرة", "تمويل", "مصرف", "مصارف", "بنك",
  "إعمار", "اعمار", "إسكان", "اسكان", "بنى تحتية", "بنية تحتية", "مشروع", "مشاريع",
  "عقد", "عقود", "مقاول", "سوق", "صادرات", "واردات", "زراعة", "صناعة", "اتصالات",
  "경제", "무역", "교역", "투자", "원유", "석유", "가스", "에너지", "전력", "수자원",
  "교통", "개발도로", "철도", "항만", "관세", "금융", "은행", "재건", "주택", "인프라",
  "사업", "계약", "수출", "수입", "산업"
];

const ECONOMY_HEADLINE_TERMS = [
  "التبادل التجاري", "التجارة", "الاستثمار", "الاستثمارات", "النفط", "الغاز", "الطاقة", "الكهرباء",
  "المياه", "النقل", "طريق التنمية", "السكك الحديد", "الموانئ", "الجمارك", "التمويل", "الإعمار",
  "الاسكان", "البنى التحتية", "무역", "교역", "투자", "석유", "가스", "에너지", "전력",
  "수자원", "교통", "개발도로", "철도", "항만", "관세", "금융", "재건", "주택", "인프라"
];

const SECURITY_TERMS = [
  "أمن", "امن", "أمني", "امني", "عسكري", "الجيش", "القوات المسلحة", "الحدود", "أمن الحدود",
  "امن الحدود", "إرهاب", "ارهاب", "داعش", "هجوم", "تفجير", "قصف", "صاروخ", "طائرة مسيرة",
  "مسيّرة", "مسيّرات", "اغتيال", "اشتباك", "سلاح", "ميليشيا", "اعتقال", "عملية أمنية",
  "تحالف دولي", "انسحاب القوات", "الدفاع", "وزارة الدفاع", "وزارة الداخلية",
  "안보", "치안", "군사", "국경", "테러", "IS", "공격", "폭발", "공습", "미사일", "드론",
  "암살", "교전", "무장세력", "체포", "군 철수", "국방"
];

const SECURITY_HEADLINE_TERMS = [
  "أمن الحدود", "امن الحدود", "إرهاب", "ارهاب", "داعش", "هجوم", "تفجير", "قصف", "صاروخ",
  "طائرة مسيرة", "مسيّرة", "اغتيال", "اشتباك", "انسحاب القوات", "التحالف الدولي",
  "안보", "치안", "국경", "테러", "공격", "폭발", "공습", "미사일", "드론", "암살", "군 철수"
];

function compact(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

export function normalizeRoutingText(value = "") {
  return String(value)
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/\u0640/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function hasTerm(text, term) {
  return text.includes(normalizeRoutingText(term));
}

function uniqueTermCount(text, terms) {
  return terms.reduce((count, term) => count + (hasTerm(text, term) ? 1 : 0), 0);
}

function recordOf(article = {}) {
  return article.article && typeof article.article === "object" ? article.article : article;
}

function currentCategoryOf(article = {}) {
  return String(article.category || article.analysis?.category || "").trim().toLowerCase();
}

function titleOf(article = {}) {
  const record = recordOf(article);
  return [
    record.originalTitleArabic,
    article.originalTitleArabic,
    article.titleArabic,
    article.card?.titleKo,
    article.relatedTitle?.titleKo
  ].filter(Boolean).join(" ");
}

function bodyOf(article = {}) {
  const record = recordOf(article);
  const facts = article.cardFacts || {};
  return [
    record.originalTextArabic,
    article.originalTextArabic,
    article.fullTextArabic,
    article.card?.summaryKo,
    article.card?.whyItMatters,
    facts.mainSubjectAr,
    facts.actionAr,
    facts.locationAr,
    facts.resultAr,
    ...(Array.isArray(facts.keyFactsAr) ? facts.keyFactsAr : []),
    ...(Array.isArray(facts.peopleAr) ? facts.peopleAr : []),
    ...(Array.isArray(facts.organizationsAr) ? facts.organizationsAr : [])
  ].filter(Boolean).join(" ");
}

function scoreCategory(title, opening, body, terms) {
  const titleCount = uniqueTermCount(title, terms);
  const openingCount = uniqueTermCount(opening, terms);
  const bodyCount = uniqueTermCount(body, terms);
  return {
    titleCount,
    openingCount,
    bodyCount,
    score: titleCount * 5 + openingCount * 2 + bodyCount
  };
}

function hasIraqAsOpeningActor(opening) {
  if (uniqueTermCount(opening, IRAQ_STRONG_OPENING_TERMS) > 0) return true;
  return /(?:^|[\s،,:؛-])(?:العراق|الجانب العراقي|الوفد العراقي|مسؤولون عراقيون)\s+(?:و|بحث|وقع|اتفق|اكد|أكد|ناقش|شارك|اعلن|أعلن|دعا|استقبل)/u.test(opening)
    || /(?:بين|مع)\s+(?:العراق|الحكومه العراقيه|الجانب العراقي|الوفد العراقي)/u.test(opening)
    || /(?:이라크|이라크 정부|이라크 대표단|이라크 측)\s*(?:과|와|이|가|는|은|정부|대표단)/u.test(opening);
}

export function classifyDirectIraqInternational(article = {}) {
  const currentCategory = currentCategoryOf(article);
  if (currentCategory !== "international") {
    return {
      category: currentCategory,
      changed: false,
      directIraq: false,
      reason: "not-international",
      scores: null
    };
  }

  const rawTitle = titleOf(article);
  const rawBody = bodyOf(article);
  const title = normalizeRoutingText(rawTitle);
  const opening = normalizeRoutingText(rawBody.slice(0, 1400));
  const body = normalizeRoutingText(rawBody.slice(0, 8000));
  const titleHasIraq = uniqueTermCount(title, IRAQ_TITLE_TERMS) > 0;
  const openingHasIraqActor = hasIraqAsOpeningActor(opening);
  const directIraq = titleHasIraq || openingHasIraqActor;

  if (!directIraq) {
    return {
      category: "international",
      changed: false,
      directIraq: false,
      reason: "external-international-context",
      scores: null
    };
  }

  const politics = scoreCategory(title, opening, body, POLITICS_TERMS);
  const economy = scoreCategory(title, opening, body, ECONOMY_TERMS);
  const security = scoreCategory(title, opening, body, SECURITY_TERMS);
  const economyHeadline = uniqueTermCount(title, ECONOMY_HEADLINE_TERMS);
  const securityHeadline = uniqueTermCount(title, SECURITY_HEADLINE_TERMS);
  const scores = {
    politics: politics.score,
    economy: economy.score,
    security: security.score,
    economyHeadline,
    securityHeadline,
    titleHasIraq,
    openingHasIraqActor
  };

  let category = "international";
  let reason = "direct-iraq-but-no-dominant-domestic-topic";

  if (securityHeadline > 0 && security.score >= 5) {
    category = "security";
    reason = "direct-iraq-security-headline";
  } else if (economyHeadline > 0 && economy.score >= politics.score - 1 && economy.score >= security.score) {
    category = "economy";
    reason = "direct-iraq-economic-headline";
  } else if (security.score >= 7 && security.score >= economy.score + 2 && security.score >= politics.score + 2) {
    category = "security";
    reason = "direct-iraq-security-dominant";
  } else if (economy.score >= 7 && economy.score >= politics.score + 3 && economy.score >= security.score) {
    category = "economy";
    reason = "direct-iraq-economy-dominant";
  } else if (politics.score >= 3) {
    category = "politics";
    reason = "direct-iraq-government-or-diplomatic-affairs";
  } else if (economy.score >= 3) {
    category = "economy";
    reason = "direct-iraq-economic-affairs";
  } else if (security.score >= 3) {
    category = "security";
    reason = "direct-iraq-security-affairs";
  }

  return {
    category,
    changed: category !== "international",
    directIraq,
    reason,
    scores
  };
}

export function applyDirectIraqInternationalRouting(article = {}) {
  const result = classifyDirectIraqInternational(article);
  if (!result.changed) return article;

  const from = currentCategoryOf(article);
  return {
    ...article,
    category: result.category,
    analysis: {
      ...(article.analysis && typeof article.analysis === "object" ? article.analysis : {}),
      category: result.category
    },
    categoryRouting: {
      from,
      to: result.category,
      reason: result.reason,
      scores: result.scores,
      locked: true,
      method: "DIRECT_IRAQ_INTERNATIONAL_ROUTER_V1",
      routedAt: new Date().toISOString()
    }
  };
}

export function categorySectionOf(category = "") {
  return {
    bismayah: "politicsItems",
    politics: "politicsItems",
    security: "securityItems",
    economy: "economyItems",
    international: "internationalItems"
  }[String(category).toLowerCase()] || "politicsItems";
}

export function routingSummaryLabel(result = {}) {
  const labels = {
    "direct-iraq-security-headline": "이라크 직접 관련 치안·안보 기사",
    "direct-iraq-economic-headline": "이라크 직접 관련 경제 중심 기사",
    "direct-iraq-security-dominant": "이라크 직접 관련 치안·안보 중심 기사",
    "direct-iraq-economy-dominant": "이라크 직접 관련 경제 중심 기사",
    "direct-iraq-government-or-diplomatic-affairs": "이라크 정부·외교·양국관계 기사",
    "direct-iraq-economic-affairs": "이라크 경제·사업 기사",
    "direct-iraq-security-affairs": "이라크 치안·안보 기사"
  };
  return labels[result.reason] || compact(result.reason || "국제사회 유지");
}
