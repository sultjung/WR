import fs from "node:fs/promises";
import path from "node:path";
import {normalizeReportClusterReferences} from "./report-cluster-reference-normalizer.mjs";

const ROOT=process.cwd();
const INPUT_FILE=path.resolve(process.env.REPORT_INPUT_FILE||path.join(ROOT,"work","report-input.json"));
const originalFetch=globalThis.fetch;
let reportInputPromise=null;

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

async function normalizeStructuredText(text){
  if(typeof text!=="string"||!text.trim()) return text;
  let parsed;
  try{parsed=JSON.parse(text);}catch{return text;}
  const normalized=normalizeReportClusterReferences(parsed,await getReportInput(),console);
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
