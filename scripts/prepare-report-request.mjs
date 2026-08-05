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
const MAX_ARTICLES=Math.max(1,Math.min(60,Number(process.env.REPORT_MAX_ARTICLES||40)));
const MAX_SOURCE_CHARS=Math.max(4000,Number(process.env.REPORT_SOURCE_MAX_CHARS||18000));
const TOTAL_SOURCE_MAX_CHARS=Math.max(80000,Number(process.env.REPORT_TOTAL_SOURCE_MAX_CHARS||240000));
const SECTION_ORDER={politicsItems:0,securityItems:1,economyItems:2,internationalItems:3};
const CATEGORY_SECTION={bismayah:"politicsItems",politics:"politicsItems",security:"securityItems",economy:"economyItems",international:"internationalItems"};
const STOPWORDS=new Set([
  "대한","관련","이라크","비스마야","기사","발표","보도","정부","위원회","회의","통해","대해","위해","이번","지난","해당","주요","새로운","추가","현재","현지",
  "العراق","العراقي","العراقية","العراقيه","الحكومة","الحكومه","اللجنة","اللجنه","مجلس","وزارة","وزاره","قال","أكد","اكد","أعلن","اعلن","حول","على","الى","إلى","في","من","عن","مع","هذا","هذه","ذلك","التي","الذي","بعد","قبل","خلال","اليوم","أمس","امس","بغداد"
]);

function fail(message){throw new Error(`[report-request] ${message}`);}
function compact(value=""){return String(value).replace(/\s+/g," ").trim();}
function isDate(value){return /^\d{4}-\d{2}-\d{2}$/.test(String(value||""))&&!Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());}
function addDays(value,days){const date=new Date(`${value}T00:00:00Z`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);}
function daysBetween(a,b){return Math.abs(new Date(`${a}T00:00:00Z`)-new Date(`${b}T00:00:00Z`))/86400000;}
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
    .map((candidate)=>({articleId:articleIdOf(candidate),titleKo:compact(candidate.relatedTitle?.titleKo||candidate.card?.titleKo||""),titleArabic:sourceTitleOf(candidate),source:sourceNameOf(candidate),publishedAt:publishedAtOf(candidate),url:urlOf(candidate)}));
}
function normalizeForTokens(value=""){
  return String(value).normalize("NFKC").toLowerCase().replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g,"").replace(/[أإآٱ]/g,"ا").replace(/ى/g,"ي").replace(/ة/g,"ه");
}
function tokenSet(value=""){
  const matches=normalizeForTokens(value).match(/[\p{L}\p{N}][\p{L}\p{N}_-]{2,}/gu)||[];
  return new Set(matches.filter((token)=>!STOPWORDS.has(token)&&!/^[0-9]+$/.test(token)));
}
function unionSets(...sets){const result=new Set();for(const set of sets) for(const value of set) result.add(value);return result;}
function overlapStats(left,right){let shared=0;for(const value of left) if(right.has(value)) shared+=1;const union=left.size+right.size-shared;return {shared,jaccard:union?shared/union:0};}
function factsText(article={}){
  const facts=article.cardFacts||{};
  return [facts.mainSubjectAr,facts.actionAr,facts.locationAr,facts.resultAr,...(Array.isArray(facts.keyFactsAr)?facts.keyFactsAr:[]),...(Array.isArray(facts.peopleAr)?facts.peopleAr:[]),...(Array.isArray(facts.organizationsAr)?facts.organizationsAr:[])].filter(Boolean).join(" ");
}
function entityText(article={}){
  const facts=article.cardFacts||{};
  return [facts.mainSubjectAr,...(Array.isArray(facts.peopleAr)?facts.peopleAr:[]),...(Array.isArray(facts.organizationsAr)?facts.organizationsAr:[])].filter(Boolean).join(" ");
}
function tokenProfile(article={}){
  const title=tokenSet(`${sourceTitleOf(article)} ${article.card?.titleKo||""}`);
  const facts=tokenSet(`${factsText(article)} ${article.card?.summaryKo||""}`);
  const entities=tokenSet(entityText(article));
  return {title,facts,entities,all:unionSets(title,facts,entities)};
}
function initialSection(category){return CATEGORY_SECTION[category]||"politicsItems";}
function clusterSection(categories){const set=new Set(categories);if(set.has("bismayah")||set.has("politics")) return "politicsItems";if(set.has("security")) return "securityItems";if(set.has("economy")) return "economyItems";return "internationalItems";}
function mergeReason(left,right){
  if(left.eventGroupId&&left.eventGroupId===right.eventGroupId) return "existing-event-group";
  if(initialSection(left.category)!==initialSection(right.category)) return "";
  if(daysBetween(left.publishedDate,right.publishedDate)>3) return "";
  const title=overlapStats(left.profile.title,right.profile.title);
  const all=overlapStats(left.profile.all,right.profile.all);
  const entities=overlapStats(left.profile.entities,right.profile.entities);
  if(title.shared>=3&&title.jaccard>=0.45) return "high-title-similarity";
  if(all.shared>=5&&all.jaccard>=0.34&&entities.shared>=1) return "facts-and-entity-similarity";
  if(entities.shared>=2&&title.shared>=2&&all.jaccard>=0.25) return "shared-entities-and-title";
  return "";
}
class UnionFind{
  constructor(size){this.parent=Array.from({length:size},(_,index)=>index);this.rank=Array(size).fill(0);}
  find(value){if(this.parent[value]!==value)this.parent[value]=this.find(this.parent[value]);return this.parent[value];}
  union(a,b){let rootA=this.find(a),rootB=this.find(b);if(rootA===rootB)return;if(this.rank[rootA]<this.rank[rootB])[rootA,rootB]=[rootB,rootA];this.parent[rootB]=rootA;if(this.rank[rootA]===this.rank[rootB])this.rank[rootA]+=1;}
}
function buildClusters(selected){
  const uf=new UnionFind(selected.length);
  const links=[];
  for(let i=0;i<selected.length;i+=1){for(let j=i+1;j<selected.length;j+=1){const reason=mergeReason(selected[i],selected[j]);if(!reason) continue;uf.union(i,j);links.push({left:selected[i].articleId,right:selected[j].articleId,reason});}}
  const groups=new Map();
  for(let index=0;index<selected.length;index+=1){const root=uf.find(index);if(!groups.has(root)) groups.set(root,[]);groups.get(root).push(selected[index]);}
  const clusters=[...groups.values()].map((members)=>{
    const ids=members.map((member)=>member.articleId);
    const idSet=new Set(ids);
    const reasons=[...new Set(links.filter((link)=>idSet.has(link.left)&&idSet.has(link.right)).map((link)=>link.reason))];
    const targetSection=clusterSection(members.map((member)=>member.category));
    const ranked=[...members].sort((a,b)=>(b.importanceScore??-1)-(a.importanceScore??-1)||a.publishedDate.localeCompare(b.publishedDate));
    const ascending=[...members].sort((a,b)=>a.publishedDate.localeCompare(b.publishedDate));
    return {articleIds:ids,targetSection,dateStart:ascending[0].publishedDate,dateEnd:ascending.at(-1).publishedDate,suggestedTitleKo:compact(ranked[0]?.card?.titleKo||""),mergeBasis:reasons.length?reasons:["single-selected-article"]};
  }).sort((a,b)=>SECTION_ORDER[a.targetSection]-SECTION_ORDER[b.targetSection]||a.dateStart.localeCompare(b.dateStart));
  clusters.forEach((cluster,index)=>{cluster.clusterId=`topic-${String(index+1).padStart(2,"0")}`;});
  const clusterByArticleId=new Map();for(const cluster of clusters) for(const id of cluster.articleIds) clusterByArticleId.set(id,cluster);
  return {clusters,clusterByArticleId};
}
function sourceExcerpt(text,maxChars){if(text.length<=maxChars) return {text,truncated:false};const head=Math.floor(maxChars*0.72);const tail=Math.max(800,maxChars-head-12);return {text:`${text.slice(0,head)}\n[...]\n${text.slice(-tail)}`,truncated:true};}

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
const validated=[];
for(const id of selectedIds){
  const article=byId.get(id);
  if(!article) fail(`기사 ID를 찾을 수 없습니다: ${id}`);
  if(!isRepresentative(article)) fail(`대표기사가 아닌 항목은 직접 선택할 수 없습니다: ${id}`);
  if(!cardIsCurrent(article)) fail(`한국어 카드 요약이 완료되지 않았거나 최신 상태가 아닙니다: ${id}`);
  const source=sourceTextOf(article);
  if(source.length<300) fail(`아랍어 원문이 300자 미만입니다: ${id}`);
  const publishedDate=kstDateKey(publishedAtOf(article));
  if(!publishedDate||publishedDate<request.periodStart||publishedDate>request.periodEnd) fail(`보고기간 밖 기사입니다: ${id} (${publishedDate||"날짜 미확인"})`);
  validated.push({articleId:id,article,category:categoryOf(article),eventGroupId:String(article.eventGroup?.groupId||""),source,publishedAt:publishedAtOf(article),publishedDate,importanceScore:scoreOf(article),profile:tokenProfile(article),card:{titleKo:compact(article.card?.titleKo||""),summaryKo:compact(article.card?.summaryKo||"")}});
}

const {clusters,clusterByArticleId}=buildClusters(validated);
const perArticleSourceLimit=Math.max(4000,Math.min(MAX_SOURCE_CHARS,Math.floor(TOTAL_SOURCE_MAX_CHARS/validated.length)));
const selected=validated.map((entry)=>{
  const excerpt=sourceExcerpt(entry.source,perArticleSourceLimit);
  const cluster=clusterByArticleId.get(entry.articleId);
  return {articleId:entry.articleId,topicClusterId:cluster.clusterId,targetSection:cluster.targetSection,category:entry.category,eventGroupId:entry.eventGroupId,source:sourceNameOf(entry.article),publishedAt:entry.publishedAt,publishedDate:entry.publishedDate,articleUrl:urlOf(entry.article),importanceScore:entry.importanceScore,titleArabic:sourceTitleOf(entry.article),originalTextArabic:excerpt.text,sourceTruncated:excerpt.truncated,sourceCharsIncluded:excerpt.text.length,sourceCharsOriginal:entry.source.length,cardFacts:entry.article.cardFacts||{},card:{titleKo:compact(entry.article.card?.titleKo||""),summaryKo:compact(entry.article.card?.summaryKo||""),keyPoints:Array.isArray(entry.article.card?.keyPoints)?entry.article.card.keyPoints.map(compact).filter(Boolean).slice(0,5):[],whyItMatters:compact(entry.article.card?.whyItMatters||"")},relatedNews:normalizeRelated(entry.article,allArticles)};
}).sort((a,b)=>SECTION_ORDER[a.targetSection]-SECTION_ORDER[b.targetSection]||a.publishedDate.localeCompare(b.publishedDate)||(b.importanceScore??-1)-(a.importanceScore??-1));

const outputRequest={version:1,issueNumber:Number(event.issue?.number||0),requester,repository:String(process.env.GITHUB_REPOSITORY||"sultjung/WR"),reportDate:request.reportDate,periodStart:request.periodStart,periodEnd:request.periodEnd,periodDays,selectedArticleIds:selectedIds,oilTargetDates:[addDays(request.reportDate,-2),addDays(request.reportDate,-1)],requestedAt:new Date().toISOString()};
const reportInput={request:outputRequest,reportClusters:clusters,selectedArticles:selected,editorialConstraints:{selectedArticlesOnly:true,noInventedFacts:true,noUnverifiedForecasts:true,mergeAllArticlesWithinTopicCluster:true,categoryOrder:["politicsItems","securityItems","economyItems","internationalItems"],chronologicalWithinCategory:true,dateFormat:"M.D",reportTone:"실제 사내 주간상황보고서와 같은 짧고 단정한 보고문체",maximumSelectedArticles:MAX_ARTICLES,sourceCharsPerArticle:perArticleSourceLimit}};
await fs.mkdir(path.dirname(REQUEST_OUT),{recursive:true});
await fs.writeFile(REQUEST_OUT,`${JSON.stringify(outputRequest,null,2)}\n`,`utf8`);
await fs.writeFile(INPUT_OUT,`${JSON.stringify(reportInput,null,2)}\n`,`utf8`);
const filename=`건설_이라크 주간 종합상황보고(${Number(request.reportDate.slice(5,7))}월 ${Number(request.reportDate.slice(8,10))}일).docx`;
if(process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT,`report_date=${request.reportDate}\nperiod_start=${request.periodStart}\nperiod_end=${request.periodEnd}\nselected_count=${selected.length}\ncluster_count=${clusters.length}\nreport_filename=${filename}\n`,`utf8`);
console.log(`[report-request] prepared issue=${outputRequest.issueNumber}, articles=${selected.length}, clusters=${clusters.length}, sourceLimit=${perArticleSourceLimit}, period=${request.periodStart}..${request.periodEnd}, oil=${outputRequest.oilTargetDates.join(",")}`);
