#!/usr/bin/env node
import fs from "node:fs/promises";

const files=[
  "config/arabic-keywords.json",
  "config/arabic-sources.json",
  "config/categories.json",
  "config/entity-dictionary.json",
  "config/exclusion-rules.json",
  "data/articles.json"
];

for(const file of files){
  const raw=await fs.readFile(file,"utf8");
  const parsed=JSON.parse(raw);
  if(!parsed.schemaVersion) throw new Error(`${file}: schemaVersion missing`);
}

const keywordConfig=JSON.parse(await fs.readFile("config/arabic-keywords.json","utf8"));
const ids=keywordConfig.keywords.map((item)=>item.keywordId);
if(new Set(ids).size!==ids.length) throw new Error("Duplicate keywordId found");
if(keywordConfig.keywords.some((item)=>!item.arabicQuery||!/[؀-ۿ]/.test(item.arabicQuery))) throw new Error("Every enabled query must contain Arabic text");

const sourceConfig=JSON.parse(await fs.readFile("config/arabic-sources.json","utf8"));
const sourceIds=sourceConfig.sources.map((item)=>item.sourceId);
if(new Set(sourceIds).size!==sourceIds.length) throw new Error("Duplicate sourceId found");

console.log(`Configuration valid: ${files.length} JSON files, ${ids.length} keywords, ${sourceIds.length} sources`);
