#!/usr/bin/env node
import assert from "node:assert/strict";
import {normalizeReportClusterReferences} from "./report-cluster-reference-normalizer.mjs";

function item(headline,clusterIds){
  return {headline,clusterIds,dateLabel:"8.1",details:[],implication:"",tableHeaders:[],tableRows:[]};
}

const logs=[];
const logger={warn:(message)=>logs.push(message)};
const reportInput={
  reportClusters:[
    {clusterId:"topic-07",targetSection:"politicsItems",allowedSections:["politicsItems","economyItems"]},
    {clusterId:"topic-08",targetSection:"politicsItems",allowedSections:["politicsItems","economyItems"]},
    {clusterId:"topic-17",targetSection:"internationalItems",allowedSections:["internationalItems"]}
  ]
};
const content={
  politicsItems:[item("국내 정치 종합",["topic-07","topic-08"])],
  securityItems:[],
  economyItems:[item("이라크 재정·투자환경",["topic-07"]),item("물류·에너지 시장",["topic-08"])],
  internationalItems:[item("호르무즈·홍해 해상 리스크",["topic-07","topic-08","topic-17"])],
  terrorStats:{total:0,armedAttack:0,ied:0,assassination:0,protest:0,shooting:0,suicideBombing:0},
  terrorEvidenceClusterIds:[],
  impactItems:["영향"]
};

normalizeReportClusterReferences(content,reportInput,logger);
assert.deepEqual(content.politicsItems,[]);
assert.deepEqual(content.economyItems.map((entry)=>entry.clusterIds),[["topic-07"],["topic-08"]]);
assert.deepEqual(content.internationalItems.map((entry)=>entry.clusterIds),[["topic-17"]]);
assert.ok(logs.some((message)=>message.includes("section-not-allowed:internationalItems topic-07")));
assert.ok(logs.some((message)=>message.includes("duplicate-reference topic-07")));

const missingOnly={
  politicsItems:[],securityItems:[],economyItems:[],
  internationalItems:[item("잘못된 국제사회 항목",["topic-07"])],
  terrorStats:{total:0,armedAttack:0,ied:0,assassination:0,protest:0,shooting:0,suicideBombing:0},
  terrorEvidenceClusterIds:[],impactItems:["영향"]
};
normalizeReportClusterReferences(missingOnly,reportInput,{warn:()=>{}});
assert.deepEqual(missingOnly.internationalItems,[]);

console.log("[test-report-cluster-reference-normalizer] passed");
