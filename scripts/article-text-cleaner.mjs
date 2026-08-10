const END_MARKERS = [
  /^(?:الأكثر\s+(?:قراءة|مشاهدة)|الأخبار\s+الأكثر\s+(?:قراءة|مشاهدة))/iu,
  /^(?:(?:المزيد|مزيد)\s+من\s+)?(?:أخبار|الأخبار|مقالات|المقالات|مواضيع|المواضيع|مواد|المواد)\s+(?:ذات\s+صلة|متعلقة|مرتبطة)/iu,
  /^(?:اقرأ\s+أيض(?:ا|اً)|قد\s+يعجبك|قد\s+يهمك|تابع\s+القراءة|المزيد\s+من\s+(?:العراق|الأخبار))/iu,
  /^(?:الكلمات\s+المفتاحية|الدلالات|الوسوم|المصادر|تابع\s+آخر\s+أخبار|تابعنا|شارك(?:\s+عبر)?)/iu,
  /^(?:وصلات|روابط)$/iu,
  /^(?:المقال|الخبر)\s+(?:السابق|التالي)\s*[:：]/iu,
  /^(?:السابق|التالي)\s*[:：]/iu,
  /^(?:pinterest)$/iu,
  /^(?:.*\|\s*)?(?:https?:\/\/)?(?:www\.)?iraq\.shafaqna\.com\/?$/iu,
  /^(?:most\s+(?:read|viewed|popular)|related\s+(?:news|articles|stories)|more\s+related\s+articles|read\s+also|you\s+may\s+also\s+like|tags?|sources?|share(?:\s+this)?|follow\s+us)/iu
];
const SOCIAL_LINE = /^(?:(?:فيسبوك|تويتر|واتساب|تلغرام|لينكد\s*إن|إنستغرام|إكس|facebook|twitter|whatsapp|telegram|linkedin|instagram|rss|x)[\s،,|·\-]*)+$/iu;
const COPYRIGHT_LINE = /^(?:حقوق\s+النشر|جميع\s+الحقوق\s+محفوظة|اشترك\s+في\s+النشرة|copyright\b|all\s+rights\s+reserved|subscribe\s+to)/iu;
const LEADING_UI_LINE = /^(?:أنت\s+هنا|الرئيسية|أخبار\s+رئيسية|الأخبار\s+الرئيسية|آخر\s+الأخبار|أحدث\s+الأخبار|جميع\s+الأخبار|سياسة|السياسة|العراق|متابعة|شارك\s+القصة|حجم\s+الخط|الخط|news|politics|home|follow-up)$/iu;
const READ_MORE_LINE = /^(?:إ?قر[اأ]ء|اقرأ)\s+(?:المزيد|المز[يی]د)$/iu;
const BYLINE_LINE = /^(?:بقلم|كتب(?:ت)?|إعداد|تحرير)\s+/iu;
const DATE_LINE = /^(?:(?:السبت|الأحد|الاثنين|الثلاثاء|الأربعاء|الخميس|الجمعة)[،,]?\s*)?(?:\d{1,2}\s+(?:يناير|فبراير|مارس|أبريل|ابريل|مايو|يونيو|يوليو|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر)\s+\d{4}|\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})(?:\s+.*)?$/iu;
const MEDIA_CAPTION_LINE = /(?:-|–|—)\s*(?:إكس|فيسبوك|تويتر|إنستغرام|x|facebook|twitter|instagram)$/iu;

function decodeHtml(value = "") {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&lrm;|&rlm;/gi, " ")
    .replace(/&#8206;|&#8207;|&#x200e;|&#x200f;/gi, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, " ");
}

function removeNoisyContainers(value = "") {
  const noise = "(?:share|sharing|social|social-links|tags?|keywords?|related|recommended|more-news|latest-news|latest_news|recent-news|most-read|most-viewed|popular|sidebar|breadcrumb|breadcrumbs|newsletter|comments?|advert(?:isement)?|author-box|post-meta|article-meta)";
  let html = String(value)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(?:script|style|noscript|svg|iframe|form|button)\b[\s\S]*?<\/(?:script|style|noscript|svg|iframe|form|button)>/gi, " ")
    .replace(/<blockquote\b[^>]*(?:twitter|instagram|facebook)[^>]*>[\s\S]*?<\/blockquote>/gi, " ");
  const paired = new RegExp(`<(aside|nav|footer|section|div|ul|figure)\\b[^>]*(?:id|class)=["'][^"']*${noise}[^"']*["'][^>]*>[\\s\\S]*?<\\/\\1>`, "gi");
  for (let pass = 0; pass < 4; pass += 1) html = html.replace(paired, " ");
  return html;
}

function stripTags(value = "") {
  return decodeHtml(String(value)
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(?:p|div|li|h1|h2|h3|h4|section|article|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, " "));
}
function normalizedLine(value = "") { return String(value).replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim(); }
function semanticText(value = "") {
  const html = removeNoisyContainers(value);
  const blocks = [];
  for (const match of html.matchAll(/<(p|h1|h2|h3|h4|li|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const line = normalizedLine(stripTags(match[2]));
    if (line) blocks.push(line);
  }
  const joined = blocks.join("\n");
  return joined.length >= 120 ? joined : stripTags(html);
}
function comparable(value = "") {
  return normalizedLine(value).replace(/\s*[|｜]\s*[^|｜]{2,80}$/u, "").replace(/[.،,:؛!?؟"'“”‘’\-–—|｜]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}
function isTitleDuplicate(line = "", title = "") {
  const a = comparable(line), b = comparable(title);
  return Boolean(a && b && (a === b || (a.length >= 24 && b.startsWith(a)) || (b.length >= 24 && a.startsWith(b))));
}
function isEndMarker(line = "") { return END_MARKERS.some((pattern) => pattern.test(line)); }

function articleStartIndex(lines = [], title = "") {
  if (!title) return 0;
  const anchors = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (isTitleDuplicate(lines[index], title)) anchors.push(index);
  }
  // News portals sometimes repeat the target title once in a latest-news card and
  // again as the real article H1. The last title occurrence is the safest body anchor.
  return anchors.length ? anchors[anchors.length - 1] + 1 : 0;
}

export function cleanArticleText(value = "", { title = "" } = {}) {
  const allLines = semanticText(value).split(/\r?\n/).map(normalizedLine).filter(Boolean);
  const lines = allLines.slice(articleStartIndex(allLines, title));
  const kept = [];
  let keptChars = 0, bodyStarted = false;
  for (const line of lines) {
    if (isEndMarker(line) && keptChars >= 60) break;
    if (SOCIAL_LINE.test(line) || COPYRIGHT_LINE.test(line) || READ_MORE_LINE.test(line)) continue;
    if (!bodyStarted) {
      if (LEADING_UI_LINE.test(line) || BYLINE_LINE.test(line) || DATE_LINE.test(line)) continue;
      if (MEDIA_CAPTION_LINE.test(line) || isTitleDuplicate(line, title)) continue;
      if (/^[-–—>]+$/.test(line)) continue;
    }
    if (/شفق نيوز\s*\|\s*آخر الأخبار العاجلة في العراق وكوردستان والعالم/iu.test(line)) continue;
    if (/^آخر الأخبار العاجلة في العراق وكوردستان والعالم$/iu.test(line)) continue;
    const previous = kept[kept.length - 1];
    if (previous && comparable(previous) === comparable(line)) continue;
    kept.push(line); keptChars += line.length; bodyStarted = true;
  }
  return kept.join("\n\n").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
}
