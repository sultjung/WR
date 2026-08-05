#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import {
  articleIdOf,
  cardIsCurrent,
  categoryOf,
  isRepresentative,
  sourceTextOf,
  sourceTitleOf
} from "./article-card-core.mjs";

const ROOT=process.cwd();
const EVENT_FILE=process.env.GITHUB_EVENT_PATH||process.env.REPORT_EVENT_FILE;
const ARTICLES_FILE=path.resolve(process.env.REPORT_ARTICLES_FILE||path.join(ROOT,"data","articles.json"));
const REQUEST_OUT=path.resolve(process.env.REPORT_REQUEST_OUT||path.join(ROOT,"work","report-request.json"));
const INPUT_OUT=path.resolve(process.env.REPORT_INPUT_OUT||path.join(ROOT,"work","report-input.json"));
const MAX_ARTICLES=Math.max(1,Math.min(30,Number(process.env.REPORT_MAX_ARTICLES||20)));
const MAX_SOURCE_CHARS=Math.max(4000,Number(process.env.REPORT_SOURCE_MAX_CHARS||18000));

function fail(message){throw new Error(`[report-request] ${message}`);}
function compact(value=""){return String(value).replace(/\s+/g," ").trim();}
function isDate(value){return /^\d{4}-\d{2}-\d{2}$/.test(String(value||""))&&!Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());}
function addDays(value,days){const date=new Date(`${value}T00:00:00Z`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);}
function kstDateKey(value){
  const date=new Date(value);
  if(Number.isNaN(date.getTime())) return "";
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date);
  const map=Object.fromEntries(parts.map((part)=>[part.type,part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}
function recordOf(article={}){return article.article&&typeof article.article==="object"?article.article:article;}
function sourceNameOf(article={}){const record=recordOf(article);return compact(article.source?.arabicName||article.sourceArabic||record.sourceArabic||article.sourceHost||"");}
function publishedAtOf(article={}){const record=recordOf(article);return String(article.publishedAt||record.publishedAt||"");}
function urlOf(article={}){const record=recordOf(article);return String(article.articleUrl||record.articleUrl||article.canonicalUrl||record.canonicalUrl||"").trim();}
function scoreOf(article={}){
  const stored=article.importance||article.analysis?.importance||recordOf(article).importance||{};
  const value=Number(stored.score??stored.finalScore??stored.ruleScore??article.analysis?.importanceScore??article.importanceScore);
  return Number.isFinite(value)?Math.max(0,Math.min(100,Math.round(value))):null;
}
function getPayloadMarker(body=""){
  const match=String(body).match(/<!--\s*WR_REPORT_REQUEST_V1\s*([\s\S]*?)-->/i);
  if(!match) fail("요청 본문에서 WR_REPORT_REQUEST_V1 데이터를 찾지 못했습니다.");
  try{return JSON.parse(match[1].trim());}catch(error){fail(`요청 JSON을 해석하지 못했습니다: ${error.message}`);}
}
function normalizeRelated(article,allArticles){
  const groupId=article.eventGroup?.groupId;
  if(!groupId) return [];
  return allArticles
    .filter((candidate)=>candidate!==article&&candidate.eventGroup?.groupId===groupId)
    .slice(0,8)
    .map((candidate)=>({
      articleId:articleIdOf(candidate),
      titleKo:compact(candidate.relatedTitle?.titleKo||candidate.card?.titleKo||""),
      titleArabic:sourceTitleOf(candidate),
      source:sourceNameOf(candidate),
      publishedAt:publishedAtOf(candidate),
      url:urlOf(candidate)
    }));
}

if(!EVENT_FILE) fail("GITHUB_EVENT_PATH가 없습니다.");
const event=JSON.parse(await fs.readFile(EVENT_FILE,"utf8"));
const owner=String(process.env.GITHUB_REPOSITORY_OWNER||"").trim();
const requester=String(event.issue?.user?.login||event.sender?.login||"").trim();
if(owner&&requester!==owner) fail(`저장소 소유자(${owner})가 아닌 요청은 실행할 수 없습니다.`);
const request=getPayloadMarker(event.issue?.body||"");
if(Number(request.version)!==1) fail("지원하지 않는 요청 버전입니다.");
for(const key of ["reportDate","periodStart","periodEnd"]){if(!isDate(request[key])) fail(`${key} 날짜 형식이 올바르지 않습니다.`);}
if(request.periodStart>request.periodEnd) fail("보고기간 시작일이 종료일보다 늦습니다.");
if(request.periodEnd>=request.reportDate) fail("보고기간 종료일은 보고일보다 앞서야 합니다.");
const periodDays=Math.round((new Date(`${request.periodEnd}T00:00:00Z`)-new Date(`${request.periodStart}T00:00:00Z`))/86400000)+1;
if(periodDays<1||periodDays>14) fail("보고기간은 1~14일만 허용합니다.");
const selectedIds=[...new Set((Array.isArray(request.selectedArticleIds)?request.selectedArticleIds:[]).map((value)=>String(value).trim()).filter(Boolean))];
if(!selectedIds.length) fail("선택 기사 ID가 없습니다.");
if(selectedIds.length>MAX_ARTICLES) fail(`선택 기사는 최대 ${MAX_ARTICLES}건입니다.`);

const articlePayload=JSON.parse(await fs.readFile(ARTICLES_FILE,"utf8"));
const allArticles=Array.isArray(articlePayload)?articlePayload:(articlePayload.articles||[]);
const byId=new Map(allArticles.map((article,index)=>[articleIdOf(article,index),article]));
const selected=[];
for(const id of selectedIds){
  const article=byId.get(id);
  if(!article) fail(`기사 ID를 찾을 수 없습니다: ${id}`);
  if(!isRepresentative(article)) fail(`대표기사가 아닌 항목은 직접 선택할 수 없습니다: ${id}`);
  if(!cardIsCurrent(article)) fail(`한국어 카드 요약이 완료되지 않았거나 최신 상태가 아닙니다: ${id}`);
  const source=sourceTextOf(article);
  if(source.length<300) fail(`아랍어 원문이 300자 미만입니다: ${id}`);
  const publishedDate=kstDateKey(publishedAtOf(article));
  if(!publishedDate||publishedDate<request.periodStart||publishedDate>request.periodEnd){
    fail(`보고기간 밖 기사입니다: ${id} (${publishedDate||"날짜 미확인"})`);
  }
  selected.push({
    articleId:id,
    category:categoryOf(article),
    source:sourceNameOf(article),
    publishedAt:publishedAtOf(article),
    publishedDate,
    articleUrl:urlOf(article),
    importanceScore:scoreOf(article),
    titleArabic:sourceTitleOf(article),
    originalTextArabic:source.slice(0,MAX_SOURCE_CHARS),
    cardFacts:article.cardFacts||{},
    card:{
      titleKo:compact(article.card?.titleKo||""),
      summaryKo:compact(article.card?.summaryKo||""),
      keyPoints:Array.isArray(article.card?.keyPoints)?article.card.keyPoints.map(compact).filter(Boolean).slice(0,5):[],
      whyItMatters:compact(article.card?.whyItMatters||"")
    },
    relatedNews:normalizeRelated(article,allArticles)
  });
}

const sorted=selected.sort((a,b)=>a.publishedAt.localeCompare(b.publishedAt)||String(b.importanceScore??0).localeCompare(String(a.importanceScore??0)));
const outputRequest={
  version:1,
  issueNumber:Number(event.issue?.number||0),
  requester,
  repository:String(process.env.GITHUB_REPOSITORY||"sultjung/WR"),
  reportDate:request.reportDate,
  periodStart:request.periodStart,
  periodEnd:request.periodEnd,
  periodDays,
  selectedArticleIds:selectedIds,
  oilTargetDates:[addDays(request.reportDate,-2),addDays(request.reportDate,-1)],
  requestedAt:new Date().toISOString()
};
const reportInput={
  request:outputRequest,
  selectedArticles:sorted,
  editorialConstraints:{
    selectedArticlesOnly:true,
    noInventedFacts:true,
    noUnverifiedForecasts:true,
    dateFormat:"M.D",
    reportTone:"실제 사내 주간상황보고서와 같은 짧고 단정한 보고문체",
    maximumItems:MAX_ARTICLES
  }
};
await fs.mkdir(path.dirname(REQUEST_OUT),{recursive:true});
await fs.writeFile(REQUEST_OUT,`${JSON.stringify(outputRequest,null,2)}\n`,`utf8`);
await fs.writeFile(INPUT_OUT,`${JSON.stringify(reportInput,null,2)}\n`,`utf8`);
const filename=`건설_이라크 주간 종합상황보고(${Number(request.reportDate.slice(5,7))}월 ${Number(request.reportDate.slice(8,10))}일).docx`;
if(process.env.GITHUB_OUTPUT){
  await fs.appendFile(process.env.GITHUB_OUTPUT,`report_date=${request.reportDate}\nperiod_start=${request.periodStart}\nperiod_end=${request.periodEnd}\nselected_count=${selected.length}\nreport_filename=${filename}\n`,`utf8`);
}
console.log(`[report-request] prepared issue=${outputRequest.issueNumber}, articles=${selected.length}, period=${request.periodStart}..${request.periodEnd}, oil=${outputRequest.oilTargetDates.join(",")}`);
