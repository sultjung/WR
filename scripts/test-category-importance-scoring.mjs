#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  categoryFloorFor,
  categoryOf,
  normalizeImportanceCategory
} from "./importance-category-rules.mjs";

const nationalStalledProjects = {
  category: "경제/건설",
  sourceArabic: "مجلس النواب",
  articleUrl: "https://example.com/iraq-stalled-projects",
  originalTitleArabic: "البرلمان يفتح ملف المشاريع المتلكئة في العراق",
  originalTextArabic: `البرلمان يفتح ملف المشاريع المتلكئة في العراق.
أعلن مجلس النواب فتح ملف المشاريع المتلكئة في العراق ومتابعة أسباب توقف المشاريع الحكومية.
وتتضمن الإجراءات إعداد تقرير واستضافة الجهات المعنية ووضع توصيات لمعالجة التعثر واستئناف التنفيذ.`
};

assert.equal(normalizeImportanceCategory("경제/건설"), "economy");
assert.equal(normalizeImportanceCategory("construction"), "economy");
assert.equal(categoryOf(nationalStalledProjects), "economy");

const floorResult = categoryFloorFor(nationalStalledProjects);
assert.equal(floorResult.rule, "ECONOMY_NATIONAL_STALLED_PROJECT_OVERSIGHT");
assert.ok(
  floorResult.score >= 78,
  `national stalled-project oversight floor should be >=78, got ${floorResult.score}`
);

const smallLocalDelay = {
  category: "경제/건설",
  sourceArabic: "صحيفة محلية",
  articleUrl: "https://example.com/local-road-delay",
  originalTitleArabic: "تأخر مشروع طريق محلي",
  originalTextArabic: "تأخر مشروع طريق صغير في إحدى القرى بسبب الأحوال الجوية، ولم يصدر قرار حكومي أو إجراء برلماني بشأنه."
};

const localFloor = categoryFloorFor(smallLocalDelay);
assert.equal(localFloor.score, 0, `minor local delay must not receive national oversight floor, got ${localFloor.score}`);

console.log(`[test-category-importance] category=economy, floor=${floorResult.score}, localFloor=${localFloor.score}`);
