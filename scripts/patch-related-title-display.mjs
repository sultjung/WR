#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const file = path.join(process.cwd(), "app.js");
let source = await fs.readFile(file, "utf8");

const replacements = [
  {
    from: 'const displayRelatedTitle=(article)=>cardTitle(article)||arTitle(article)||"제목 미확인";',
    to: 'const displayRelatedTitle=(article)=>String(article.relatedTitle?.titleKo||"").trim()||cardTitle(article)||arTitle(article)||"제목 미확인";'
  },
  {
    from: 'koTitle(member),arTitle(member),sourceName(member),preview(member)',
    to: 'displayRelatedTitle(member),arTitle(member),sourceName(member),preview(member)'
  }
];

let changed = false;
for (const { from, to } of replacements) {
  if (source.includes(to)) continue;
  if (!source.includes(from)) throw new Error(`app.js patch target not found: ${from}`);
  source = source.replace(from, to);
  changed = true;
}

if (changed) {
  await fs.writeFile(file, source, "utf8");
  console.log("[related-title-ui] app.js updated to display and search Korean related-news titles");
} else {
  console.log("[related-title-ui] app.js already uses Korean related-news titles");
}
