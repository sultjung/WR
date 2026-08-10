#!/usr/bin/env node
import assert from "node:assert/strict";
import { cleanArticleText } from "./article-text-cleaner.mjs";

const noisy = `
<article>
  <div class="share-buttons">فيسبوك تويتر واتساب</div>
  <p>أعلن البنك المركزي العراقي وصول دفعة جديدة من الدولار إلى بغداد.</p>
  <p>وتهدف الدفعة إلى دعم السيولة واستقرار سوق الصرف.</p>
  <h2>الأكثر مشاهدة</h2>
  <ul><li>خبر اقتصادي آخر</li><li>خبر دولي آخر</li></ul>
</article>`;

assert.equal(
  cleanArticleText(noisy),
  "أعلن البنك المركزي العراقي وصول دفعة جديدة من الدولار إلى بغداد.\n\nوتهدف الدفعة إلى دعم السيولة واستقرار سوق الصرف."
);

const legitimate = `
<p>قال المسؤول إن التحويلات ستصل شهرياً.</p>
<p>وأضاف أن قيمتها السنوية ستتراوح بين 8 و10 مليارات دولار.</p>
<p>فيسبوك</p>
<p>الكلمات المفتاحية</p>
<p>الدولار</p>`;

assert.equal(
  cleanArticleText(legitimate),
  "قال المسؤول إن التحويلات ستصل شهرياً.\n\nوأضاف أن قيمتها السنوية ستتراوح بين 8 و10 مليارات دولار."
);

const duplicate = "<p>النص الأول للخبر.</p><p>النص الأول للخبر.</p><p>النص الثاني للخبر.</p>";
assert.equal(cleanArticleText(duplicate), "النص الأول للخبر.\n\nالنص الثاني للخبر.");

console.log("[article-text-cleaner] passed");
