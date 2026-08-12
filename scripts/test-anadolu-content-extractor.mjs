#!/usr/bin/env node
import assert from "node:assert/strict";
import { cleanArticleText } from "./article-text-cleaner.mjs";
import { extractAnadoluCandidates } from "./article-source-extractors.mjs";

const modernArabicArticle = `
<html>
  <meta name="description" content="موجز قصير لا يمثل متن الخبر الكامل">
  <body>
    <div class="relative embed-responsive prose max-w-none selectionShareable">
      <p>أصيب ثلاثة جنود عراقيين، الثلاثاء، إثر انفجار عبوة ناسفة استهدفت دورية للجيش في محافظة كركوك شمالي البلاد.</p>
      <p>وقال مصدر أمني للأناضول إن العبوة انفجرت أثناء مرور الدورية في منطقة وادي الشاي التابعة للمحافظة.</p>
      <p>وأضاف المصدر أن الانفجار أسفر عن إصابة ثلاثة جنود بجروح متفاوتة، ونقلوا إلى مستشفى قريب لتلقي العلاج.</p>
      <p>وأوضح أن قوة أمنية وصلت إلى مكان الحادث وبدأت عملية تفتيش بحثاً عن منفذي الهجوم.</p>
      <p>ولم تعلن أي جهة مسؤوليتها عن التفجير حتى وقت نشر الخبر، فيما تواصل القوات العراقية التحقيق في ملابساته.</p>
    </div>
  </body>
</html>`;

const modernCandidates = extractAnadoluCandidates(modernArabicArticle);
assert.equal(modernCandidates.length, 1);
const modernText = cleanArticleText(modernCandidates[0]);
assert.match(modernText, /أصيب ثلاثة جنود عراقيين/);
assert.match(modernText, /تواصل القوات العراقية التحقيق/);
assert.ok(modernText.length >= 300);
assert.doesNotMatch(modernText, /موجز قصير/);

const legacyArabicArticle = `
<div class="detay-icerik">
  <p class="selectionShareable">أعلنت السلطات العراقية بدء التحقيق في الحادث.</p>
  <p class="selectionShareable">وأكدت استمرار الإجراءات الأمنية في المنطقة.</p>
</div>`;
const legacyCandidates = extractAnadoluCandidates(legacyArabicArticle);
assert.equal(legacyCandidates.length, 1);
assert.match(cleanArticleText(legacyCandidates[0]), /استمرار الإجراءات الأمنية/);

console.log("[anadolu-content-extractor] passed");
