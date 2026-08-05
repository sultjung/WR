import fs from "node:fs/promises";
import path from "node:path";
import {normalizeReportClusterReferences} from "./report-cluster-reference-normalizer.mjs";

const ROOT=process.cwd();
const INPUT_FILE=path.resolve(process.env.REPORT_INPUT_FILE||path.join(ROOT,"work","report-input.json"));
const originalFetch=globalThis.fetch;
let reportInputPromise=null;

const REPORT_TERM_REPLACEMENTS=[
  {pattern:/\bAI\b/gi,replacement:"인공지능"},
  {pattern:/프롬프트/g,replacement:"편집 지침"},
  {pattern:/자동\s*생성/g,replacement:"생성"},
  {pattern:/선택\s*기사/g,replacement:"입력 기사"},
  {pattern:/모델/g,replacement:"방식"}
];

function isResponsesApiRequest(input){
  const raw=typeof input==="string"?input:input?.url;
  try{
    const url=new URL(raw);
    return url.hostname==="api.openai.com"&&url.pathname==="/v1/responses";
  }catch{return false;}
}

function adaptRequestInit(input,init){
  if(!isResponsesApiRequest(input)||typeof init?.body!=="string") return init;
  let payload;
  try{payload=JSON.parse(init.body);}catch{return init;}
  if(String(payload?.model||"").startsWith("gpt-4.1")){
    delete payload.reasoning;
    if(payload.text&&payload.text.verbosity==="low") payload.text.verbosity="medium";
    console.log("[weekly-report-ai] adapted gpt-4.1 fallback request");
    return {...init,body:JSON.stringify(payload)};
  }
  return init;
}

function routingInput(reportInput){
  return {
    ...reportInput,
    reportClusters:(reportInput?.reportClusters||[]).map((cluster)=>({
      ...cluster,
      allowedSections:cluster.targetSection==="politicsItems"||cluster.targetSection==="economyItems"
        ? ["politicsItems","economyItems"]
        : [cluster.targetSection].filter(Boolean)
    }))
  };
}

async function getReportInput(){
  if(!reportInputPromise){
    reportInputPromise=fs.readFile(INPUT_FILE,"utf8").then(JSON.parse).then(routingInput);
  }
  return reportInputPromise;
}

function sanitizeReportTerms(value,pathLabel="report"){
  if(typeof value==="string"){
    let next=value;
    for(const {pattern,replacement} of REPORT_TERM_REPLACEMENTS){
      pattern.lastIndex=0;
      if(pattern.test(next)){
        pattern.lastIndex=0;
        next=next.replace(pattern,replacement);
      }
    }
    if(next!==value){
      console.warn(`[weekly-report-ai] normalized report terminology at ${pathLabel}`);
    }
    return next;
  }
  if(Array.isArray(value)){
    return value.map((entry,index)=>sanitizeReportTerms(entry,`${pathLabel}[${index}]`));
  }
  if(value&&typeof value==="object"){
    for(const [key,entry] of Object.entries(value)){
      value[key]=sanitizeReportTerms(entry,`${pathLabel}.${key}`);
    }
  }
  return value;
}

async function normalizeStructuredText(text){
  if(typeof text!=="string"||!text.trim()) return text;
  let parsed;
  try{parsed=JSON.parse(text);}catch{return text;}
  const normalized=normalizeReportClusterReferences(parsed,await getReportInput(),console);
  sanitizeReportTerms(normalized);
  return JSON.stringify(normalized);
}

async function normalizeResponsePayload(payload){
  if(typeof payload?.output_text==="string"){
    payload.output_text=await normalizeStructuredText(payload.output_text);
  }
  for(const item of Array.isArray(payload?.output)?payload.output:[]){
    for(const content of Array.isArray(item?.content)?item.content:[]){
      if((content?.type==="output_text"||content?.type==="text")&&typeof content.text==="string"){
        content.text=await normalizeStructuredText(content.text);
      }
    }
  }
  return payload;
}

function rebuiltResponse(payload,response){
  const headers=new Headers(response.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  headers.set("content-type","application/json");
  return new Response(JSON.stringify(payload),{
    status:response.status,
    statusText:response.statusText,
    headers
  });
}

if(typeof originalFetch!=="function"){
  throw new Error("[weekly-report-ai] global fetch is unavailable");
}

globalThis.fetch=async function sanitizedReportFetch(input,init){
  const adaptedInit=adaptRequestInit(input,init);
  const response=await originalFetch(input,adaptedInit);
  if(!isResponsesApiRequest(input)||!response.ok) return response;
  try{
    const payload=await response.clone().json();
    return rebuiltResponse(await normalizeResponsePayload(payload),response);
  }catch(error){
    console.warn(`[weekly-report-ai] structured-output normalization skipped: ${error.message}`);
    return response;
  }
};
