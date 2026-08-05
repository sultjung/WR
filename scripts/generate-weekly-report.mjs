#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const ROOT=process.cwd();
const INPUT_FILE=path.resolve(process.env.REPORT_INPUT_FILE||path.join(ROOT,"work","report-input.json"));
const OIL_FILE=path.resolve(process.env.REPORT_OIL_FILE||path.join(ROOT,"work","oil-prices.json"));
const PROMPT_FILE=path.resolve(process.env.REPORT_PROMPT_FILE||path.join(ROOT,"prompts","weekly-report-editor.md"));
const OUTPUT_FILE=path.resolve(process.env.REPORT_CONTENT_OUT||path.join(ROOT,"work","report-content.json"));
const API_KEY=String(process.env.OPENAI_API_KEY||"").trim();
const MODEL=String(process.env.REPORT_MODEL||"gpt-5.1").trim();
const FALLBACKS=String(process.env.REPORT_MODEL_FALLBACKS||"gpt-5,gpt-4.1").split(",").map((value)=>value.trim()).filter(Boolean);
const REASONING=String(process.env.REPORT_REASONING||"high").trim();
const TIMEOUT_MS=Math.max(60000,Number(process.env.REPORT_AI_TIMEOUT_MS||300000));
const MAX_OUTPUT_TOKENS=Math.max(4000,Number(process.env.REPORT_MAX_OUTPUT_TOKENS||14000));

function fail(message){throw new Error(`[weekly-report-ai] ${message}`);}
function compact(value=""){return String(value).replace(/\s+/g," ").trim();}

const reportItemSchema={
  type:"object",
  additionalProperties:false,
  required:["articleIds","dateLabel","headline","details","implication","tableHeaders","tableRows"],
  properties:{
    articleIds:{type:"array",minItems:1,items:{type:"string"}},
    dateLabel:{type:"string"},
    headline:{type:"string",minLength:1,maxLength:260},
    details:{type:"array",maxItems:5,items:{type:"string",maxLength:500}},
    implication:{type:"string",maxLength:500},
    tableHeaders:{type:"array",maxItems:5,items:{type:"string",maxLength:80}},
    tableRows:{type:"array",maxItems:20,items:{type:"array",maxItems:5,items:{type:"string",maxLength:500}}}
  }
};

const schema={
  type:"object",
  additionalProperties:false,
  required:["politicsItems","securityItems","terrorStats","terrorEvidenceArticleIds","economyItems","internationalTopic","internationalItems","impactItems"],
  properties:{
    politicsItems:{type:"array",items:reportItemSchema},
    securityItems:{type:"array",items:reportItemSchema},
    terrorStats:{
      type:"object",
      additionalProperties:false,
      required:["total","armedAttack","ied","assassination","protest","shooting","suicideBombing"],
      properties:{
        total:{type:"integer",minimum:0},
        armedAttack:{type:"integer",minimum:0},
        ied:{type:"integer",minimum:0},
        assassination:{type:"integer",minimum:0},
        protest:{type:"integer",minimum:0},
        shooting:{type:"integer",minimum:0},
        suicideBombing:{type:"integer",minimum:0}
      }
    },
    terrorEvidenceArticleIds:{type:"array",items:{type:"string"}},
    economyItems:{type:"array",items:reportItemSchema},
    internationalTopic:{type:"string",maxLength:160},
    internationalItems:{type:"array",items:reportItemSchema},
    impactItems:{type:"array",minItems:1,maxItems:3,items:{type:"string",minLength:1,maxLength:500}}
  }
};

function extractText(response){
  if(typeof response.output_text==="string"&&response.output_text.trim()) return response.output_text;
  const parts=[];
  for(const item of Array.isArray(response.output)?response.output:[]){
    for(const content of Array.isArray(item.content)?item.content:[]){
      if((content.type==="output_text"||content.type==="text")&&typeof content.text==="string") parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

async function callModel(model,prompt,input){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),TIMEOUT_MS);
  const base={
    model,
    store:false,
    instructions:prompt,
    input:[{role:"user",content:[{type:"input_text",text:JSON.stringify(input)}]}],
    max_output_tokens:MAX_OUTPUT_TOKENS,
    text:{
      verbosity:"low",
      format:{type:"json_schema",name:"iraq_weekly_report",description:"Selected-article-only Korean weekly report structure",strict:true,schema}
    }
  };
  const attempts=[{...base,reasoning:{effort:REASONING}},base];
  let lastError=null;
  try{
    for(const payload of attempts){
      try{
        const response=await fetch("https://api.openai.com/v1/responses",{
          method:"POST",
          headers:{Authorization:`Bearer ${API_KEY}`,"Content-Type":"application/json"},
          body:JSON.stringify(payload),
          signal:controller.signal
        });
        const raw=await response.text();
        let json={};
        try{json=JSON.parse(raw);}catch{/* handled below */}
        if(!response.ok){
          const message=json?.error?.message||raw.slice(0,500)||`HTTP ${response.status}`;
          if(payload.reasoning&&response.status===400){lastError=new Error(message);continue;}
          throw new Error(`${model}: ${message}`);
        }
        const text=extractText(json);
        if(!text) throw new Error(`${model}: empty structured output`);
        return {model,responseId:json.id||"",usage:json.usage||{},content:JSON.parse(text)};
      }catch(error){lastError=error;if(error?.name==="AbortError") throw new Error(`${model}: timed out after ${TIMEOUT_MS}ms`);}
    }
  }finally{clearTimeout(timer);}
  throw lastError||new Error(`${model}: request failed`);
}

function allItems(content){return [...content.politicsItems,...content.securityItems,...content.economyItems,...content.internationalItems];}
function validate(content,selectedIds,request){
  const expected=new Set(selectedIds);
  const used=new Set();
  for(const item of allItems(content)){
    if(!compact(item.headline)) fail("빈 보고서 항목 제목이 있습니다.");
    if(!/^\d{1,2}\.\d{1,2}(?:~\d{1,2})?$/.test(compact(item.dateLabel))) fail(`날짜 형식이 M.D가 아닙니다: ${item.dateLabel}`);
    for(const id of item.articleIds){
      if(!expected.has(id)) fail(`선택되지 않은 기사 ID가 결과에 포함됐습니다: ${id}`);
      used.add(id);
    }
    if(item.tableHeaders.length){
      if(!item.tableRows.length) fail(`표 머리글은 있으나 행이 없습니다: ${item.headline}`);
      for(const row of item.tableRows){if(row.length!==item.tableHeaders.length) fail(`표 열 수가 일치하지 않습니다: ${item.headline}`);}
    }else if(item.tableRows.length){fail(`표 행은 있으나 머리글이 없습니다: ${item.headline}`);}
  }
  const missing=[...expected].filter((id)=>!used.has(id));
  if(missing.length) fail(`선택 기사 중 보고서에 반영되지 않은 ID가 있습니다: ${missing.join(",")}`);
  const stats=content.terrorStats;
  const sum=stats.armedAttack+stats.ied+stats.assassination+stats.protest+stats.shooting+stats.suicideBombing;
  if(stats.total!==sum) fail(`테러 총계(${stats.total})와 세부 합계(${sum})가 일치하지 않습니다.`);
  for(const id of content.terrorEvidenceArticleIds){if(!expected.has(id)) fail(`테러 집계 근거에 선택되지 않은 ID가 있습니다: ${id}`);}
  if(!content.impactItems.length) fail("그룹/건설 영향이 비어 있습니다.");
  const forbidden=/\bAI\b|프롬프트|자동\s*생성|선택\s*기사|모델/i;
  const serialized=JSON.stringify(content);
  if(forbidden.test(serialized)) fail("최종 보고서에 제작 과정 문구가 포함됐습니다.");
  return {...content,requestPeriod:{start:request.periodStart,end:request.periodEnd,reportDate:request.reportDate}};
}

if(!API_KEY) fail("OPENAI_API_KEY가 없습니다.");
const [reportInput,oil,prompt]=await Promise.all([
  fs.readFile(INPUT_FILE,"utf8").then(JSON.parse),
  fs.readFile(OIL_FILE,"utf8").then(JSON.parse),
  fs.readFile(PROMPT_FILE,"utf8")
]);
const selectedIds=reportInput.request.selectedArticleIds;
const aiInput={
  reportRequest:reportInput.request,
  officialOilPrices:oil,
  selectedArticles:reportInput.selectedArticles,
  requiredOutputLanguage:"Korean",
  requiredReportStructure:"실제 건설, 이라크 주간 종합상황보고 양식"
};
let result=null;
let lastError=null;
for(const model of [MODEL,...FALLBACKS.filter((value)=>value!==MODEL)]){
  try{result=await callModel(model,prompt,aiInput);break;}catch(error){lastError=error;console.warn(`[weekly-report-ai] model failed: ${error.message}`);}
}
if(!result) throw lastError||new Error("all report models failed");
const validated=validate(result.content,selectedIds,reportInput.request);
const output={
  pipelineVersion:"WEEKLY_REPORT_V1",
  generatedAt:new Date().toISOString(),
  model:result.model,
  responseId:result.responseId,
  usage:result.usage,
  request:reportInput.request,
  oil,
  report:validated
};
await fs.mkdir(path.dirname(OUTPUT_FILE),{recursive:true});
await fs.writeFile(OUTPUT_FILE,`${JSON.stringify(output,null,2)}\n`,`utf8`);
console.log(`[weekly-report-ai] complete model=${result.model}, articles=${selectedIds.length}, politics=${validated.politicsItems.length}, security=${validated.securityItems.length}, economy=${validated.economyItems.length}, international=${validated.internationalItems.length}`);
