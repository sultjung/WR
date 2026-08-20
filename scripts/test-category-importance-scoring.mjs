#!/usr/bin/env node
import assert from "node:assert/strict";
import { businessFloorFor } from "./importance-business-rules.mjs";
import {
  categoryFloorFor,
  categoryOf,
  normalizeImportanceCategory,
  starsForScore
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
assert.equal(starsForScore(98), 5);
assert.equal(starsForScore(84), 4);
assert.equal(starsForScore(73), 3.5);
assert.equal(starsForScore(5), 0.5);
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

const nicHanwhaBismayah = {
  category: "bismayah",
  articleUrl: "https://hathalyoum.net/articles/4207696",
  originalTitleArabic: "رئيس الهيئة الوطنية للاستثمار يبحث سير العمل في مشروع بسماية مع شركة هانوا الكورية",
  originalTextArabic: "بحث رئيس الهيئة الوطنية للاستثمار مع ممثل شركة هانوا الكورية سير العمل في مشروع مدينة بسماية الجديدة."
};
const businessFloor = businessFloorFor(nicHanwhaBismayah);
assert.equal(businessFloor.rule, "BISMAYAH_NIC_HANWHA_DIRECT");
assert.equal(businessFloor.score, 98);


const millionHousingCabinet = {
  category: "politics",
  originalTitleArabic: "مجلس الوزراء العراقي يقر حزمة إجراءات ويبحث الاستعدادات لمشروع مليون وحدة سكنية",
  originalTextArabic: "بحث مجلس الوزراء العراقي الاستعدادات الخاصة بمشروع مليون وحدة سكنية في العراق."
};
const millionHousingFloor = businessFloorFor(millionHousingCabinet);
assert.equal(millionHousingFloor.rule, "IRAQ_HOUSING_GENERAL");
assert.ok(millionHousingFloor.score >= 65);

const governmentFormationAndStateArms = {
  category: "politics",
  sourceArabic: "النهار",
  articleUrl: "https://www.annahar.com/arab-world/arabian-levant/338335/example",
  originalTitleArabic: "رئيس الوزراء العراقي يبحث مع المالكي استكمال تشكيل الحكومة وحصر السلاح بيد الدولة",
  originalTextArabic: "بحث رئيس الوزراء استكمال تشكيل الكابينة الوزارية ومكافحة الفساد وحصر السلاح بيد الدولة وفرض سيادة القانون."
};
const politicsFloor = categoryFloorFor(governmentFormationAndStateArms);
assert.equal(politicsFloor.rule, "POLITICS_GOVERNMENT_FORMATION_AND_STATE_ARMS");
assert.equal(politicsFloor.score, 78);

const routinePoliticalMeeting = {
  category: "politics",
  originalTitleArabic: "اجتماع سياسي اعتيادي",
  originalTextArabic: "عقد عدد من أعضاء الحزب اجتماعا اعتياديا وبحثوا شؤونهم الداخلية."
};
assert.equal(categoryFloorFor(routinePoliticalMeeting).score, 0);

const nicChairFormerPmInvestmentMeeting = {
  category: "bismayah",
  originalTitleArabic: "السوداني والياسري يبحثان سبل تنشيط الفرص الاستثمارية في البلاد",
  originalTextArabic: "بحث رئيس ائتلاف الإعمار والتنمية، محمد شياع السوداني، مع رئيس الهيئة الوطنية للاستثمار، عادل الياسري، سبل تنشيط الفرص الاستثمارية في البلاد."
};
const strategicMeetingFloor = businessFloorFor(nicChairFormerPmInvestmentMeeting);
assert.equal(strategicMeetingFloor.rule, "NIC_CHAIR_STRATEGIC_LEADER_INVESTMENT_MEETING");
assert.equal(strategicMeetingFloor.score, 88);
assert.equal(starsForScore(strategicMeetingFloor.score), 4.5);

const routineNicCourtesyMeeting = {
  category: "bismayah",
  originalTitleArabic: "رئيس الهيئة الوطنية للاستثمار يستقبل وفدا للتهنئة",
  originalTextArabic: "استقبل رئيس الهيئة الوطنية للاستثمار وفدا قدم له التهاني في مكتبه."
};
assert.equal(businessFloorFor(routineNicCourtesyMeeting).score, 0);

const newPmAndNicChairInvestmentMeeting = {
  category: "bismayah",
  originalTitleArabic: "علي فالح الزيدي يبحث مع عادل الياسري ملف الاستثمار والإسكان",
  originalTextArabic: "بحث رئيس الوزراء علي فالح الزيدي مع عادل داخل الياسري سبل تنشيط الفرص الاستثمارية والمشاريع السكنية في العراق."
};
const newLeadershipFloor = businessFloorFor(newPmAndNicChairInvestmentMeeting);
assert.equal(newLeadershipFloor.rule, "NIC_CHAIR_STRATEGIC_LEADER_INVESTMENT_MEETING");
assert.equal(newLeadershipFloor.score, 88);

console.log(`[test-category-importance] economyFloor=${floorResult.score}, politicsFloor=${politicsFloor.score}, strategicMeetingFloor=${strategicMeetingFloor.score}, newLeadershipFloor=${newLeadershipFloor.score}, localFloor=${localFloor.score}, directBusinessFloor=${businessFloor.score}`);
