import crypto from "node:crypto";

const TERMS = {
  bismayah: ["بسماية", "مدينة بسماية الجديدة", "مشروع بسماية", "bismayah", "비스마야", "비스마야 신도시"],
  hanwha: ["شركة هانوا", "هانوا", "hanwha", "한화", "한화건설", "한화 건설"],
  nic: ["الهيئة الوطنية للاستثمار", "هيئة الوطنية للاستثمار", "هيئة الاستثمار الوطنية", "national investment commission", "국가투자위원회", "이라크 국가투자위원회"],
  nicChair: ["رئيس الهيئة الوطنية للاستثمار", "رئيس هيئة الاستثمار الوطنية", "رئاسة الهيئة الوطنية للاستثمار", "chairman of the national investment commission", "national investment commission chairman", "nic chairman", "nic chair", "국가투자위원회 의장", "국가투자위원장", "nic 의장", "nic 위원장"],
  chairHeadline: ["رئيس", "رئاسة", "chairman", "chair", "head", "의장", "위원장"],
  personnel: ["تعيين", "تكليف", "إقالة", "إعفاء", "استبدال", "استقالة", "appointed", "appointment", "named", "dismissed", "removed", "replacement", "resigned", "임명", "선임", "해임", "면직", "교체", "사임"],
  decision: ["قرار", "توجيه", "تصويت", "قانون", "مرسوم", "اتفاق", "إقرار", "اعتماد", "تنفيذ", "تخصيص", "تمويل", "إقالة", "إعفاء", "تعيين", "تكليف", "결정", "지시", "승인", "의결", "임명", "해임", "교체", "appointment", "approved", "decision"],
  government: ["رئيس الوزراء", "مجلس الوزراء", "مكتب رئيس الوزراء", "prime minister", "council of ministers", "cabinet", "총리", "국무회의", "총리실"],
  contract: ["استئناف المشروع", "استكمال المشروع", "العقد", "عقود", "مستحقات", "دفعات", "تمويل", "ضمان", "خطاب ضمان", "تنفيذ", "تسليم", "صندوق التقاعد", "contract", "payment", "funding", "finance", "guarantee", "resume", "restart", "relaunch", "미수금", "대금", "지급", "금융", "자금", "보증", "계약", "사업 재개", "공사 재개", "프로젝트 재개", "이행보증"],
  policy: ["قانون الاستثمار", "تعليمات", "صلاحيات", "هيكل", "إعادة هيكلة", "مجلس إدارة", "سياسة الاستثمار", "investment law", "regulation", "authority", "restructuring", "organization", "투자법", "시행규칙", "권한", "조직개편", "정책", "위원회 구성"],
  housing: ["مشروع سكني", "مشاريع سكنية", "وحدات سكنية", "مدن جديدة", "مدينة سكنية", "الإسكان", "housing project", "housing units", "new city", "주택사업", "주거도시", "신도시", "주택 건설"],
  iraq: ["العراق", "العراقي", "بغداد", "iraq", "iraqi", "baghdad", "이라크", "바그다드"]
};

export function normalizeImportanceText(value = "") {
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

const hasAny = (text, terms) => {
  const normalized = normalizeImportanceText(text);
  return terms.some((term) => normalized.includes(normalizeImportanceText(term)));
};

const recordOf = (article = {}) => article.article && typeof article.article === "object" ? article.article : article;

export function importanceArticleText(article = {}) {
  const record = recordOf(article);
  return [
    record.originalTitleArabic, article.originalTitleArabic,
    record.descriptionArabic, article.descriptionArabic,
    record.originalTextArabic, article.originalTextArabic
  ].filter(Boolean).join("\n");
}

function headlineOf(article = {}) {
  const record = recordOf(article);
  return [record.originalTitleArabic, article.originalTitleArabic, article.translation?.titleKo, article.display_title, article.title]
    .filter(Boolean).join("\n");
}

export function importanceArticleId(article = {}, index = 0) {
  const record = recordOf(article);
  return String(article.articleId || record.articleId || article.id || record.id || article.articleUrl || record.articleUrl || `article-${index}`);
}

export function importanceFingerprint(article = {}) {
  const record = recordOf(article);
  const category = String(article.analysis?.category || article.category || record.category || "").trim().toLowerCase();
  return crypto.createHash("sha256").update(`${category}\n${importanceArticleText(article)}`).digest("hex").slice(0, 20);
}

export function businessFloorFor(article = {}) {
  const text = importanceArticleText(article);
  const headline = headlineOf(article);
  const bismayah = hasAny(text, TERMS.bismayah);
  const hanwha = hasAny(text, TERMS.hanwha);
  const nic = hasAny(text, TERMS.nic) || /(^|[^a-z])nic([^a-z]|$)/i.test(text);
  const nicChair = hasAny(text, TERMS.nicChair) || (nic && hasAny(headline, TERMS.chairHeadline));
  const personnel = hasAny(text, TERMS.personnel);
  const governmentDecision = hasAny(text, TERMS.government) && hasAny(text, TERMS.decision);
  const contract = hasAny(text, TERMS.contract);
  const nicPolicy = nic && (hasAny(text, TERMS.policy) || hasAny(text, TERMS.decision));
  const iraqHousing = hasAny(text, TERMS.housing) && hasAny(text, TERMS.iraq);
  const rules = [];

  if (bismayah && hanwha && nic) rules.push([98, "BISMAYAH_NIC_HANWHA_DIRECT", "비스마야 사업·NIC·شركة هانوا가 모두 직접 연결된 최우선 사업 기사임"]);
  if (bismayah && governmentDecision) rules.push([95, "BISMAYAH_GOVERNMENT_DECISION", "총리·국무회의 등 정부 의사결정이 비스마야 사업에 직접 관련됨"]);
  if ((bismayah || hanwha) && contract) rules.push([95, "BISMAYAH_CONTRACT_PAYMENT_EXECUTION", "비스마야 사업의 계약·대금·금융·보증 또는 사업 재개에 직접 관련됨"]);
  if (nic && nicChair && personnel) rules.push([90, "NIC_CHAIR_PERSONNEL_CHANGE", "NIC 의장 임명·해임·교체는 비스마야 사업의 협의 및 의사결정 체계에 직접 영향을 줌"]);
  if (bismayah) rules.push([90, "DIRECT_BISMAYAH", "비스마야 사업을 직접 다룬 기사임"]);
  if (nicPolicy) rules.push([80, "NIC_POLICY_ORGANIZATION", "NIC 정책·권한·조직 또는 주요 의사결정과 관련됨"]);
  if (iraqHousing) rules.push([65, "IRAQ_HOUSING_GENERAL", "이라크 주택·신도시 사업 전반과 관련됨"]);

  const selected = rules.sort((a, b) => b[0] - a[0])[0] || [0, "NONE", ""];
  return { score: selected[0], rule: selected[1], reasonKo: selected[2] };
}
