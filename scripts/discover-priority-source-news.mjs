#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const ROOT = process.cwd();
const INPUT = path.resolve(process.env.PRIORITY_DISCOVERY_INPUT_FILE || path.join(ROOT, "data", "recovered-articles.json"));
const OUTPUT = path.resolve(process.env.PRIORITY_DISCOVERY_OUTPUT_FILE || INPUT);
const SEEDS = path.resolve(process.env.PRIORITY_DISCOVERY_SEEDS_FILE || path.join(ROOT, "config", "priority-news-seeds.json"));
const TIMEOUT = Number(process.env.PRIORITY_DISCOVERY_TIMEOUT_MS || 18000);
const LOOKBACK = Number(process.env.NEWS_DISCOVERY_DAYS || 14);
const MAX_DETAILS = Number(process.env.PRIORITY_DISCOVERY_MAX_DETAIL_FETCHES || 60);

const SOURCES = String(process.env.PRIORITY_DISCOVERY_TEST_BASE || "") ? [
  { id: "nic", name: "الهيئة الوطنية للاستثمار", type: "official", base: `${process.env.PRIORITY_DISCOVERY_TEST_BASE}/nic/`, hosts: ["127.0.0.1"], pathPrefix: "/nic/", endpoints: ["feed"] },
  { id: "hathalyoum", name: "هذا اليوم", type: "aggregator", base: `${process.env.PRIORITY_DISCOVERY_TEST_BASE}/hatha/`, hosts: ["127.0.0.1"], pathPrefix: "/hatha/", endpoints: [] }
] : [
  { id: "nic", name: "الهيئة الوطنية للاستثمار", type: "official", base: "https://investpromo.gov.iq/ar/", hosts: ["investpromo.gov.iq"], endpoints: ["/ar/feed/", "/ar/category/arabic-news/", "/wp-sitemap.xml"] },
  { id: "hathalyoum", name: "هذا اليوم", type: "aggregator", base: "https://hathalyoum.net/", hosts: ["hathalyoum.net"], endpoints: ["/rss", "/sitemap.xml"] }
];

const decode = (v = "") => String(v).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&nbsp;/gi, " ").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").trim();
const strip = (v = "") => decode(String(v).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const norm = (v = "") => strip(v).normalize("NFKC").replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "").replace(/\u0640/g, "").replace(/[إأآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim().toLowerCase();
const host = (url = "") => { try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };
const cleanUrl = (url = "") => { try { const u = new URL(decode(url)); u.hash = ""; for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(k)) u.searchParams.delete(k); return u.toString(); } catch { return ""; } };
const own = (source, url) => { try { const parsed = new URL(url); const hostMatch = source.hosts.some((h) => host(url) === h || host(url).endsWith(`.${h}`)); return hostMatch && (!source.pathPrefix || parsed.pathname.startsWith(source.pathPrefix)); } catch { return false; } };
const articleLike = (url = "") => { try { const p = new URL(url).pathname; return /^https?:/.test(url) && p !== "/" && !/\/(?:feed|rss|category|tag|author)(?:\/|$)/i.test(p) && !/\.(?:jpg|png|pdf|mp4)$/i.test(p) && (/\d{4,}/.test(p) || p.split("/").filter(Boolean).length >= 2); } catch { return false; } };
const parseDate = (v = "") => { const d = new Date(v); return Number.isNaN(d.getTime()) ? "" : d.toISOString(); };
const recent = (v = "") => !v || new Date(v).getTime() >= Date.now() - LOOKBACK * 86400000;
const tag = (block, name) => decode(String(block).match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1] || "");
const meta = (html, name) => decode(String(html).match(new RegExp(`<meta[^>]+(?:property|name)=["']${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]+content=["']([^"']+)["']`, "i"))?.[1] || "");
const priority = (value, source) => {
  const t = norm(value);
  const b = /(?:^|\s)بسمايه(?:\s|$)/u.test(t);
  const h = ["هانوا", "هانهوا", "hanwha", "한화"].some((x) => t.includes(norm(x)));
  const n = ["الهيئة الوطنية للاستثمار", "الهيأة الوطنية للاستثمار", "رئيس الهيئة الوطنية للاستثمار", "عادل الياسري", "عادل داخل الياسري", "حيدر مكية"].some((x) => t.includes(norm(x)));
  return b || (h && (n || t.includes(norm("العراق")))) || (source.id === "nic" && n);
};

async function fetchText(url) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { redirect: "follow", signal: controller.signal, headers: { "user-agent": "Mozilla/5.0 (compatible; WR-Priority-Discovery/1.0)", "accept-language": "ar-IQ,ar;q=0.9" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return { body: await r.text(), url: r.url || url, type: r.headers.get("content-type") || "" };
  } finally { clearTimeout(timer); }
}
function parseIndex(body, baseUrl, source) {
  const out = [];
  for (const block of String(body).match(/<(?:item|entry)>[\s\S]*?<\/(?:item|entry)>/gi) || []) {
    const url = cleanUrl(block.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] || tag(block, "link") || tag(block, "guid"));
    if (articleLike(url)) out.push({ title: strip(tag(block, "title")), url, date: parseDate(tag(block, "pubDate") || tag(block, "published") || tag(block, "updated")), desc: strip(tag(block, "description") || tag(block, "summary")) });
  }
  for (const block of String(body).match(/<url>[\s\S]*?<\/url>/gi) || []) {
    const url = cleanUrl(tag(block, "loc"));
    if (articleLike(url)) out.push({ title: strip(tag(block, "news:title") || tag(block, "title")), url, date: parseDate(tag(block, "lastmod")), desc: "" });
  }
  for (const match of String(body).matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url; try { url = new URL(decode(match[1]), baseUrl).toString(); } catch { continue; }
    const title = strip(match[2]);
    if (title.length >= 12 && own(source, url) && articleLike(url)) out.push({ title, url: cleanUrl(url), date: "", desc: "" });
  }
  return out;
}
function pageInfo(html, fallback) {
  return {
    title: strip(String(html).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || meta(html, "og:title") || meta(html, "twitter:title")),
    date: parseDate(meta(html, "article:published_time") || String(html).match(/<time[^>]+datetime=["']([^"']+)["']/i)?.[1] || ""),
    desc: strip(meta(html, "og:description") || meta(html, "description")),
    canonical: cleanUrl(String(html).match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1] || meta(html, "og:url") || fallback)
  };
}
function external(html, base, source) {
  const links = [];
  for (const m of String(html).matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url; try { url = new URL(decode(m[1]), base).toString(); } catch { continue; }
    const h = host(url); if (!h || own(source, url) || /facebook|instagram|youtube|twitter|tiktok/.test(h) || !articleLike(url)) continue;
    links.push({ url: cleanUrl(url), score: /المصدر|الخبر كاملا|اقرا الخبر/.test(norm(m[2])) ? 50 : 0 });
  }
  return links.sort((a, b) => b.score - a.score)[0]?.url || "";
}
async function discover(source, seedUrls) {
  const endpoints = [source.base, ...source.endpoints.map((e) => new URL(e, source.base).toString())];
  const found = seedUrls.filter((u) => own(source, u)).map((url) => ({ title: "", url: cleanUrl(url), date: "", desc: "", seed: true }));
  const debug = [];
  for (const endpoint of endpoints) {
    try { const r = await fetchText(endpoint); const items = parseIndex(r.body, r.url, source); found.push(...items); debug.push({ endpoint, ok: true, count: items.length }); }
    catch (e) { debug.push({ endpoint, ok: false, error: String(e.message || e).slice(0, 120) }); }
  }
  const unique = [...new Map(found.filter((x) => x.url && recent(x.date)).map((x) => [x.url, x])).values()].sort((a, b) => Number(b.seed) - Number(a.seed) || new Date(b.date || 0) - new Date(a.date || 0));
  const ready = unique.filter((x) => priority(`${x.title} ${x.desc}`, source));
  const details = [];
  for (const item of unique.filter((x) => !ready.includes(x)).slice(0, MAX_DETAILS)) {
    try { const r = await fetchText(item.url); const p = pageInfo(r.body, r.url); details.push({ ...item, title: p.title || item.title, date: p.date || item.date, desc: p.desc || item.desc, pageUrl: p.canonical, publisherUrl: source.type === "aggregator" ? external(r.body, r.url, source) : "" }); } catch {}
  }
  return { source, debug, matched: [...ready, ...details].filter((x) => priority(`${x.title} ${x.desc}`, source) && recent(x.date)) };
}

let seedConfig = { urls: [] }; try { seedConfig = JSON.parse(await fs.readFile(SEEDS, "utf8")); } catch {}
const seedUrls = (seedConfig.urls || []).filter((x) => x.enabled !== false && x.url).map((x) => x.url);
const discoveries = [];
for (const source of SOURCES) discoveries.push(await discover(source, seedUrls));
const input = JSON.parse(await fs.readFile(INPUT, "utf8"));
const articles = [...(input.articles || [])];
const byUrl = new Map(articles.map((a, i) => [cleanUrl(a.articleUrl || a.discoveryUrl), i]).filter(([k]) => k));
const byTitle = new Map(articles.map((a, i) => [norm(a.originalTitleArabic), i]).filter(([k]) => k));
let added = 0; let upgraded = 0;
for (const { source, matched } of discoveries) for (const item of matched) {
  const sourceUrl = item.pageUrl || item.url; const articleUrl = item.publisherUrl || sourceUrl; const fallback = source.type === "aggregator" && !item.publisherUrl;
  const candidate = { schemaVersion: "1.0", articleId: `priority-${createHash("sha256").update(articleUrl).digest("base64url").slice(0, 24)}`, keywordId: "bismayah-priority-source-001", category: "bismayah", priority: 100,
    queryArabic: "بسماية OR الهيئة الوطنية للاستثمار OR شركة هانوا", requiredTerms: [], optionalTerms: ["بسماية", "الهيئة الوطنية للاستثمار", "شركة هانوا", "هانوا"], excludedTerms: [], originalTitleArabic: item.title,
    sourceArabic: source.name, sourceHomepage: source.base, publishedAt: item.date || new Date().toISOString(), descriptionArabic: item.desc || "", discoveryUrl: sourceUrl, articleUrl,
    discoveryMethod: item.publisherUrl ? "priority-aggregator-source-link" : "priority-source-index", language: "ar", discoveryStatus: "DISCOVERED", urlStatus: "RECOVERED",
    urlRecoveryMethod: item.publisherUrl ? "priority-aggregator-source-link" : "priority-source-index", recoveredSourceId: source.id, allowAggregatorFallback: fallback, contentStatus: "PENDING", errorCode: null, discoveredAt: new Date().toISOString() };
  const index = byUrl.get(cleanUrl(articleUrl)) ?? byTitle.get(norm(candidate.originalTitleArabic));
  if (index !== undefined) {
    const old = articles[index]; const upgrade = (!old.articleUrl || old.urlStatus !== "RECOVERED") && candidate.articleUrl;
    articles[index] = { ...old, ...(upgrade ? { articleUrl: candidate.articleUrl, urlStatus: "RECOVERED", urlRecoveryMethod: candidate.urlRecoveryMethod, recoveredSourceId: candidate.recoveredSourceId, allowAggregatorFallback: candidate.allowAggregatorFallback, errorCode: null } : {}), priorityDiscovery: { sourceId: source.id, detectedAt: new Date().toISOString() } };
    if (upgrade) upgraded += 1;
  } else { byUrl.set(cleanUrl(articleUrl), articles.length); byTitle.set(norm(candidate.originalTitleArabic), articles.length); articles.push(candidate); added += 1; }
}
articles.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0) || Number(b.priority || 0) - Number(a.priority || 0));
const payload = { ...input, generatedAt: new Date().toISOString(), count: articles.length, recoveredCount: articles.filter((a) => a.urlStatus === "RECOVERED" && a.articleUrl).length,
  failedCount: articles.filter((a) => a.urlStatus !== "RECOVERED" || !a.articleUrl).length, priorityDiscovery: { matched: discoveries.reduce((n, x) => n + x.matched.length, 0), added, upgraded, sources: discoveries.map((x) => ({ sourceId: x.source.id, matched: x.matched.length, debug: x.debug })) }, articles };
await fs.writeFile(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`[priority-discovery] matched=${payload.priorityDiscovery.matched} added=${added} upgraded=${upgraded} total=${articles.length}`);
