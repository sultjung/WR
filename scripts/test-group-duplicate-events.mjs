#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const GROUP_SCRIPT = path.join(SCRIPT_DIR, "group-duplicate-events.mjs");
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "wr-event-grouping-"));
const articlesFile = path.join(tempDir, "articles.json");
const groupsFile = path.join(tempDir, "event-groups.json");

const sharedMeetingLead = [
  "ناقش مكتب التمثيل التجاري المصري في بغداد",
  "مع الهيئة الوطنية للاستثمار العراقية",
  "تعزيز التعاون الاستثماري بين مصر والعراق",
  "وتيسير حركة المستثمرين والزيارات المتبادلة بين مجتمعي الأعمال"
].join(" ");

const articles = [
  {
    articleId: "ahram",
    category: "bismayah",
    publishedAt: "2026-08-02T12:43:00.000Z",
    originalTitleArabic: "مباحثات مصرية عراقية لفتح آفاق جديدة للتعاون الاستثماري وتفعيل الزيارات المتبادلة بين مجتمعي الأعمال",
    originalTextArabic: sharedMeetingLead,
    sourceArabic: "بوابة الأهرام"
  },
  {
    articleId: "amwal",
    category: "bismayah",
    publishedAt: "2026-08-02T12:40:58.000Z",
    originalTitleArabic: "مصر والعراق تبحثان تسهيل حركة المستثمرين وتعزيز الاستثمارات المشتركة",
    originalTextArabic: sharedMeetingLead,
    sourceArabic: "أموال الغد"
  },
  {
    articleId: "youm7",
    category: "bismayah",
    publishedAt: "2026-08-02T11:06:54.000Z",
    originalTitleArabic: "التمثيل التجاري في بغداد يبحث مع الهيئة الوطنية للاستثمار العراقية تعزيز التعاون المشترك",
    originalTextArabic: sharedMeetingLead,
    sourceArabic: "youm7.com"
  },
  {
    articleId: "elbalad",
    category: "bismayah",
    publishedAt: "2026-08-02T10:26:00.000Z",
    originalTitleArabic: "التمثيل التجاري يبحث تعزيز التعاون وتيسير حركة المستثمرين بين مصر والعراق",
    originalTextArabic: sharedMeetingLead,
    sourceArabic: "صدى البلد"
  },
  {
    articleId: "related",
    category: "bismayah",
    publishedAt: "2026-08-02T10:20:00.000Z",
    originalTitleArabic: "تعزيز التعاون الاقتصادي بين مصر والعراق",
    originalTextArabic: sharedMeetingLead,
    sourceArabic: "fixture"
  },
  {
    articleId: "security-counterexample",
    category: "bismayah",
    publishedAt: "2026-08-02T12:42:00.000Z",
    originalTitleArabic: "مصر والعراق تبحثان تعزيز التعاون الأمني ومكافحة الإرهاب",
    originalTextArabic: "بحث مسؤولون التعاون الأمني بين مصر والعراق ومكافحة الإرهاب.",
    sourceArabic: "fixture"
  },
  {
    articleId: "oil-counterexample",
    category: "bismayah",
    publishedAt: "2026-08-02T13:10:00.000Z",
    originalTitleArabic: "مصر والعراق تبحثان استثمارات مشتركة في قطاع النفط",
    originalTextArabic: "ناقش وزيرا النفط في مصر والعراق فرص الاستثمار المشترك في قطاع الطاقة.",
    sourceArabic: "fixture"
  },
  {
    articleId: "newturk-kirkuk-strike",
    category: "security",
    publishedAt: "2026-08-10T20:35:00.000Z",
    originalTitleArabic: "العراق.. قصف جوي يدمر 8 أوكار لتنظيم داعش في كركوك",
    originalTextArabic: "نفذت القوات العراقية قصفا جويا في كركوك أدى إلى تدمير 8 أوكار لتنظيم داعش بالكامل.",
    sourceArabic: "newturkpost.com"
  },
  {
    articleId: "anadolu-kirkuk-strike",
    category: "security",
    publishedAt: "2026-08-10T12:16:00.000Z",
    originalTitleArabic: "العراق.. تدمير 8 كهوف لداعش بضربات جوية في كركوك",
    originalTextArabic: "أعلنت السلطات العراقية تدمير 8 كهوف ومخابئ لداعش خلال ضربات جوية في محافظة كركوك.",
    sourceArabic: "Anadolu Ajansı"
  },
  {
    articleId: "kirkuk-arrest-counterexample",
    category: "security",
    publishedAt: "2026-08-10T13:00:00.000Z",
    originalTitleArabic: "اعتقال 8 مطلوبين في كركوك خلال عملية أمنية",
    originalTextArabic: "أعلنت القوات العراقية اعتقال 8 مطلوبين في كركوك خلال عملية أمنية منفصلة.",
    sourceArabic: "fixture"
  },
  {
    articleId: "hewar-baghdad-dialogue",
    category: "politics",
    publishedAt: "2026-08-21T09:00:00.000Z",
    originalTitleArabic: "رئيس الوزراء علي الزيدي في حوار بغداد الثامن يعلن المضي في مكافحة الفساد وتهيئة مليون قطعة أرض سكنية للمواطنين",
    originalTextArabic: "أكد رئيس مجلس الوزراء علي فالح الزيدي خلال مؤتمر حوار بغداد الثامن المضي في مكافحة الفساد وتهيئة مليون قطعة أرض سكنية وتأمين الرواتب.",
    sourceArabic: "المعهد العراقي للحوار"
  },
  {
    articleId: "nina-baghdad-dialogue",
    category: "politics",
    publishedAt: "2026-08-21T11:07:00.000Z",
    originalTitleArabic: "الزيدي في مؤتمر حوار بغداد الثامن: العراق يمر بفترة عصيبة ولدينا أكثر من حل للمشكلات الاقتصادية",
    originalTextArabic: "قال رئيس الوزراء علي فالح الزيدي خلال حوار بغداد الثامن إن مشروع مليون قطعة أرض سكنية قريب جداً وإن الرواتب مؤمنة.",
    sourceArabic: "وكالة نينا"
  },
  {
    articleId: "other-pm-event-counterexample",
    category: "politics",
    publishedAt: "2026-08-21T10:00:00.000Z",
    originalTitleArabic: "رئيس الوزراء علي الزيدي يستقبل وفداً اقتصادياً في بغداد",
    originalTextArabic: "استقبل رئيس مجلس الوزراء علي فالح الزيدي وفداً اقتصادياً لبحث الاستثمارات.",
    sourceArabic: "fixture"
  },
  {
    articleId: "president-dialogue-counterexample",
    category: "politics",
    publishedAt: "2026-08-21T10:30:00.000Z",
    originalTitleArabic: "الرئيس العراقي: حصر السلاح بيد الدولة قرار وطني",
    originalTextArabic: "قال رئيس الجمهورية خلال مؤتمر حوار بغداد الثامن إن حصر السلاح قرار وطني، فيما تحدث رئيس الوزراء علي فالح الزيدي في جلسة منفصلة.",
    sourceArabic: "fixture"
  }
];

try {
  await fs.writeFile(articlesFile, `${JSON.stringify({ articles }, null, 2)}\n`, "utf8");

  const run = spawnSync(process.execPath, [GROUP_SCRIPT], {
    cwd: ROOT,
    env: {
      ...process.env,
      EVENT_GROUP_ARTICLES_FILE: articlesFile,
      EVENT_GROUP_GROUPS_FILE: groupsFile
    },
    encoding: "utf8"
  });

  assert.equal(run.status, 0, run.stderr || run.stdout || "event grouping script failed");

  const result = JSON.parse(await fs.readFile(groupsFile, "utf8"));
  const expectedMembers = new Set(["ahram", "amwal", "youm7", "elbalad", "related"]);
  const meetingGroup = result.groups.find((group) =>
    group.memberArticleIds.some((articleId) => expectedMembers.has(articleId))
  );

  assert.ok(meetingGroup, "expected Egypt-Iraq investment meeting group");
  assert.deepEqual(
    new Set(meetingGroup.memberArticleIds),
    expectedMembers,
    "all rewrites of the same meeting must be grouped together"
  );
  assert.ok(
    result.matches.some((match) =>
      match.reason === "SAME_BILATERAL_INVESTMENT_MEETING"
      || match.reason === "SAME_BILATERAL_INVESTMENT_NEWS_BURST"
    ),
    "expected a semantic bilateral-event match reason"
  );

  for (const counterexample of ["security-counterexample", "oil-counterexample"]) {
    assert.ok(
      !meetingGroup.memberArticleIds.includes(counterexample),
      `${counterexample} must remain outside the meeting group`
    );
  }

  const strikeGroup = result.groups.find((group) =>
    group.memberArticleIds.includes("newturk-kirkuk-strike")
  );
  assert.ok(strikeGroup, "expected Kirkuk ISIS airstrike group");
  assert.deepEqual(
    new Set(strikeGroup.memberArticleIds),
    new Set(["newturk-kirkuk-strike", "anadolu-kirkuk-strike"]),
    "semantic rewrites of the same ISIS strike must be grouped together"
  );
  assert.ok(
    result.matches.some((match) =>
      match.reason === "SAME_SECURITY_STRIKE_INCIDENT"
      && new Set([match.left, match.right]).has("newturk-kirkuk-strike")
      && new Set([match.left, match.right]).has("anadolu-kirkuk-strike")
    ),
    "expected a semantic security-incident match reason"
  );
  assert.ok(
    !strikeGroup.memberArticleIds.includes("kirkuk-arrest-counterexample"),
    "same-place same-number but different security event must remain separate"
  );

  const dialogueGroup = result.groups.find((group) =>
    group.memberArticleIds.includes("hewar-baghdad-dialogue")
  );
  assert.ok(dialogueGroup, "expected Baghdad Dialogue prime-minister session group");
  assert.deepEqual(
    new Set(dialogueGroup.memberArticleIds),
    new Set(["hewar-baghdad-dialogue", "nina-baghdad-dialogue"]),
    "same Baghdad Dialogue prime-minister session must be grouped, without absorbing other events"
  );
  assert.ok(
    result.matches.some((match) => match.reason === "SAME_BAGHDAD_DIALOGUE_PM_SESSION"),
    "expected a Baghdad Dialogue session match reason"
  );
  assert.ok(
    !dialogueGroup.memberArticleIds.includes("president-dialogue-counterexample"),
    "a different Baghdad Dialogue speaker must not hide the prime-minister session as a related article"
  );

  console.log("[test:events] bilateral and security semantic rewrites grouped; unrelated stories kept separate");
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}
