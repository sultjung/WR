const END_MARKER = /^(?:الأكثر\s+(?:قراءة|مشاهدة)|الأخبار\s+الأكثر\s+(?:قراءة|مشاهدة)|أخبار\s+ذات\s+صلة|أخبار\s+متعلقة|مواضيع\s+ذات\s+صلة|مقالات\s+ذات\s+صلة|اقرأ\s+أيض(?:ا|اً)|قد\s+يعجبك|الكلمات\s+المفتاحية|الوسوم|تابعنا|شارك(?:\s+عبر)?|most\s+(?:read|viewed|popular)|related\s+(?:news|articles|stories)|read\s+also|you\s+may\s+also\s+like|tags?|share(?:\s+this)?|follow\s+us)$/iu;
const SOCIAL_LINE = /^(?:(?:فيسبوك|تويتر|واتساب|تلغرام|لينكد\s*إن|إكس|facebook|twitter|whatsapp|telegram|linkedin|instagram|rss|x)[\s،,|·\-]*)+$/iu;
const COPYRIGHT_LINE = /^(?:حقوق\s+النشر|جميع\s+الحقوق\s+محفوظة|اشترك\s+في\s+النشرة|copyright\b|all\s+rights\s+reserved|subscribe\s+to)/iu;

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
  const noise = "(?:share|sharing|social|social-links|tags?|keywords?|related|recommended|most-read|most-viewed|popular|sidebar|breadcrumb|newsletter|comments?|advert(?:isement)?|author-box|post-meta)";
  let html = String(value);
  const paired = new RegExp(`<(aside|nav|footer|section|div|ul)\\b[^>]*(?:id|class)=["'][^"']*${noise}[^"']*["'][^>]*>[\\s\\S]*?<\\/\\1>`, "gi");
  for (let pass = 0; pass < 3; pass += 1) html = html.replace(paired, " ");
  return html;
}

function stripTags(value = "") {
  return decodeHtml(removeNoisyContainers(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(?:p|div|li|h1|h2|h3|section|article|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, " "));
}

function normalizedLine(value = "") {
  return String(value).replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim();
}

export function cleanArticleText(value = "") {
  const lines = stripTags(value).split(/\r?\n/).map(normalizedLine).filter(Boolean);
  const kept = [];
  let keptChars = 0;

  for (const line of lines) {
    if (END_MARKER.test(line) && keptChars >= 60) break;
    if (SOCIAL_LINE.test(line) || COPYRIGHT_LINE.test(line)) continue;
    if (/شفق نيوز\s*\|\s*آخر الأخبار العاجلة في العراق وكوردستان والعالم/iu.test(line)) continue;
    if (/^آخر الأخبار العاجلة في العراق وكوردستان والعالم$/iu.test(line)) continue;

    const previous = kept[kept.length - 1];
    if (previous && previous === line) continue;
    kept.push(line);
    keptChars += line.length;
  }

  return kept.join("\n\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}
