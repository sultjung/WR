#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { classifyDirectIraqInternational } from "./direct-iraq-category-routing.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const runner = path.join(SCRIPT_DIR, "reclassify-direct-iraq-international.mjs");
const padding = "تفاصيل إضافية عن الاجتماع والملفات المشتركة بين الجانبين. ".repeat(25);

const cases = [
  {
    id: "turkey-iraq-strategic-partnership",
    expected: "politics",
    article: {
      articleId: "turkey-iraq-strategic-partnership",
      category: "international",
      originalTitleArabic: "تركيا والعراق يعززان الشراكة الاستراتيجية بتوقيع اتفاقيات متعددة المجالات",
      originalTextArabic: "بحث رئيس الوزراء العراقي مع الوفد التركي العلاقات الثنائية والشراكة الاستراتيجية وجرى توقيع اتفاقيات ومذكرات تفاهم بين الحكومتين. " + padding
    }
  },
  {
    id: "iraq-oman-trade-investment",
    expected: "economy",
    article: {
      articleId: "iraq-oman-trade-investment",
      category: "international",
      originalTitleArabic: "العراق وعُمان يبحثان زيادة التبادل التجاري والاستثمارات المشتركة",
      originalTextArabic: "ناقش الجانبان التجارة والاستثمار والمشاريع والطاقة ورفع حجم الصادرات والواردات بين البلدين. " + padding
    }
  },
  {
    id: "iraq-turkey-energy-water",
    expected: "economy",
    article: {
      articleId: "iraq-turkey-energy-water",
      category: "international",
      originalTitleArabic: "تنسيق عراقي تركي بشأن الطاقة والمياه وطريق التنمية",
      originalTextArabic: "بحث العراق وتركيا مشروعات الطاقة والمياه والنقل والسكك الحديد وطريق التنمية والاستثمارات في البنى التحتية. " + padding
    }
  },
  {
    id: "iraq-turkey-border-security",
    expected: "security",
    article: {
      articleId: "iraq-turkey-border-security",
      category: "international",
      originalTitleArabic: "العراق وتركيا يتفقان على تعزيز أمن الحدود ومكافحة الإرهاب",
      originalTextArabic: "بحثت وزارتا الدفاع والداخلية أمن الحدود ومكافحة داعش والإرهاب والتنسيق العسكري بين القوات العراقية والتركية. " + padding
    }
  },
  {
    id: "hormuz-global-market",
    expected: "international",
    article: {
      articleId: "hormuz-global-market",
      category: "international",
      originalTitleArabic: "مخاطر مضيق هرمز ترفع أسعار النفط العالمية",
      originalTextArabic: "ارتفعت أسعار برنت ودبي الخام بسبب أمن الملاحة وطرق الشحن في الخليج من دون أن يكون العراق طرفاً مباشراً في الحدث. " + padding
    }
  }
];

for (const item of cases) {
  const result = classifyDirectIraqInternational(item.article);
  assert.equal(result.category, item.expected, `${item.id}: expected ${item.expected}, got ${result.category}`);
}

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "wr-direct-iraq-routing-"));
const articlesFile = path.join(tempDir, "articles.json");
const summaryFile = path.join(tempDir, "summary.json");
try {
  await fs.writeFile(articlesFile, `${JSON.stringify({ schemaVersion: "1.0", articles: cases.map((item) => item.article) }, null, 2)}\n`, "utf8");
  const run = spawnSync(process.execPath, [runner], {
    cwd: ROOT,
    env: {
      ...process.env,
      DIRECT_IRAQ_ROUTING_ARTICLES_FILE: articlesFile,
      DIRECT_IRAQ_ROUTING_SUMMARY_FILE: summaryFile
    },
    encoding: "utf8"
  });
  assert.equal(run.status, 0, run.stderr || run.stdout || "direct Iraq routing script failed");
  const result = JSON.parse(await fs.readFile(articlesFile, "utf8"));
  const byId = new Map(result.articles.map((article) => [article.articleId, article]));
  for (const item of cases) {
    assert.equal(byId.get(item.id)?.category, item.expected, `${item.id}: persisted category mismatch`);
  }
  assert.equal(byId.get("turkey-iraq-strategic-partnership")?.categoryRouting?.method, "DIRECT_IRAQ_INTERNATIONAL_ROUTER_V1");
  const summary = JSON.parse(await fs.readFile(summaryFile, "utf8"));
  assert.equal(summary.routedCount, 4);
  
const cabinetHousing = {
  category: "politics",
  originalTitleArabic: "مجلس الوزراء العراقي يقر حزمة إجراءات ويبحث الاستعدادات لمشروع مليون وحدة سكنية",
  originalTextArabic: "بحث مجلس الوزراء الاستعدادات لتنفيذ مشروع وطني للإسكان."
};
const cabinetHousingResult = classifyDirectIraqInternational(cabinetHousing);
assert.equal(cabinetHousingResult.category, "economy");
assert.equal(cabinetHousingResult.changed, true);
assert.equal(cabinetHousingResult.reason, "iraq-government-housing-policy");

console.log("[test:direct-iraq-routing] direct Iraq bilateral articles routed to politics/economy/security; external market context retained as international");
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}
