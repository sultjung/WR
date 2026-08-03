#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const gateScript = path.join(SCRIPT_DIR, "strict-category-gate.mjs");
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "wr-strict-gate-"));
const articlesFile = path.join(tempDir, "articles.json");
const summaryFile = path.join(tempDir, "summary.json");
const padding = "تفاصيل محلية واقتصادية متكررة ".repeat(35);

const articles = [
  {
    articleId: "iraq-gaza-bridge",
    category: "economy",
    contentStatus: "FULL_TEXT",
    originalTitleArabic: "الإعمار تعلن إنجاز تثبيت جسر غزة في موقعه النهائي تمهيداً لافتتاحه",
    originalTextArabic: "بغداد - أعلنت وزارة الإعمار والإسكان والبلديات العامة إنجاز تثبيت جسر غزة ضمن مشروع طرق وجسور في العاصمة العراقية. " + padding
  },
  {
    articleId: "saudi-oil-incidental-iraq",
    category: "economy",
    contentStatus: "FULL_TEXT",
    originalTitleArabic: "رهان ينبع تحت التهديد... المسيرات الحوثية تستهدف نفط السعودية",
    originalTextArabic: "تواجه منشآت النفط السعودية في ينبع تهديداً متزايداً من المسيرات الحوثية وتأثيراً على صادرات المملكة. " + padding + " وورد اسم العراق في مقارنة إقليمية عابرة."
  },
  {
    articleId: "saudi-cabinet-incidental-iraq",
    category: "politics",
    contentStatus: "FULL_TEXT",
    originalTitleArabic: "سياسي / سمو ولي العهد يرأس جلسة مجلس الوزراء في جدة",
    originalTextArabic: "ترأس ولي العهد السعودي جلسة مجلس الوزراء في جدة وبحث المجلس شؤون المملكة. " + padding + " كما أشار بيان مطول إلى العراق ضمن أخبار خارجية متعددة."
  },
  {
    articleId: "iraq-oman-trade",
    category: "economy",
    contentStatus: "FULL_TEXT",
    originalTitleArabic: "العراق وعُمان يبحثان رفع حجم التبادل التجاري والاستثمارات المشتركة",
    originalTextArabic: "بحث مسؤولون من العراق وعمان التجارة والاستثمار المشترك. " + padding
  },
  {
    articleId: "hormuz-market",
    category: "international",
    contentStatus: "FULL_TEXT",
    originalTitleArabic: "مباحثات إقليمية بشأن أمن مضيق هرمز وأسعار النفط العالمية",
    originalTextArabic: "ناقشت دول المنطقة أمن الملاحة في مضيق هرمز وتأثيره في أسعار النفط العالمية. " + padding
  },
  {
    articleId: "iraqi-adjectival-title",
    category: "international",
    contentStatus: "FULL_TEXT",
    originalTitleArabic: "تنسيق عراقي - تركي حول ممرات الطاقة والمياه",
    originalTextArabic: "بحث وفدان من البلدين ممرات الطاقة والمياه والتعاون الإقليمي. " + padding
  },
  {
    articleId: "red-sea-oil-price",
    category: "international",
    contentStatus: "FULL_TEXT",
    originalTitleArabic: "أسعار النفط تتجاوز 100 دولار مع اتساع المخاطر في البحر الأحمر",
    originalTextArabic: "ارتفعت أسعار النفط مع اضطراب الملاحة في البحر الأحمر. " + padding
  },
  {
    articleId: "gulf-oil-export-routes",
    category: "international",
    contentStatus: "FULL_TEXT",
    originalTitleArabic: "حصار الشرايين الكبرى.. كيف تبحث دول الخليج عن بدائل لتصدير النفط؟",
    originalTextArabic: "تبحث دول الخليج عن طرق بديلة لتصدير النفط وتأمين الملاحة. " + padding
  },
  {
    articleId: "bab-mandab-saudi-only",
    category: "international",
    contentStatus: "FULL_TEXT",
    originalTitleArabic: "الحوثيون يغلقون باب المندب على السعودية وقناة السويس تحت الضغط",
    originalTextArabic: "تناول التقرير المواجهة بين الحوثيين والسعودية وحركة الملاحة في باب المندب وقناة السويس. " + padding
  },
  {
    articleId: "iraq-pmf-security",
    category: "security",
    contentStatus: "FULL_TEXT",
    originalTitleArabic: "أول تعليق من الحشد الشعبي بعد الضربات السعودية",
    originalTextArabic: "أصدر الحشد الشعبي بياناً بشأن القصف والضربات التي استهدفت مقاره داخل الأراضي العراقية. " + padding
  },
  {
    articleId: "gaza-reconstruction-incidental-iraq",
    category: "economy",
    contentStatus: "FULL_TEXT",
    originalTitleArabic: "خطة جديدة لإعادة إعمار غزة وتمويل مشاريع الإسكان الفلسطينية",
    originalTextArabic: "ناقش مسؤولون فلسطينيون إعادة إعمار غزة وتمويل الوحدات السكنية. " + padding + " وذُكر العراق في نهاية التقرير ضمن قائمة المواقف العربية."
  }
];

try {
  await fs.writeFile(articlesFile, `${JSON.stringify({ schemaVersion: "1.0", articles }, null, 2)}\n`, "utf8");
  const run = spawnSync(process.execPath, [gateScript], {
    cwd: ROOT,
    env: {
      ...process.env,
      STRICT_GATE_ARTICLES_FILE: articlesFile,
      STRICT_GATE_SUMMARY_FILE: summaryFile,
      STRICT_GATE_PRIMARY_LEAD_CHARS: "700"
    },
    encoding: "utf8"
  });
  assert.equal(run.status, 0, run.stderr || run.stdout || "strict category gate failed");

  const result = JSON.parse(await fs.readFile(articlesFile, "utf8"));
  const retained = new Set(result.articles.map((article) => article.articleId));
  const summary = JSON.parse(await fs.readFile(summaryFile, "utf8"));
  const excluded = new Set(summary.excluded.map((article) => article.articleId));

  for (const id of [
    "iraq-gaza-bridge",
    "iraq-oman-trade",
    "hormuz-market",
    "iraq-pmf-security",
    "iraqi-adjectival-title",
    "red-sea-oil-price",
    "gulf-oil-export-routes"
  ]) {
    assert.ok(retained.has(id), `${id} should be retained`);
  }
  for (const id of [
    "saudi-oil-incidental-iraq",
    "saudi-cabinet-incidental-iraq",
    "bab-mandab-saudi-only",
    "gaza-reconstruction-incidental-iraq"
  ]) {
    assert.ok(excluded.has(id), `${id} should be excluded`);
  }

  assert.equal(summary.method, "STRICT_CATEGORY_GATE_V2");
  console.log("[test:strict-gate] Iraqi primary events retained; foreign-primary incidental mentions excluded");
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}
