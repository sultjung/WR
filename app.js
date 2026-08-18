(()=>{
  const STORAGE_KEY="wr-selected-article-ids-v2";
  const MAX_EXPORT_ARTICLES=40;
  const CATEGORY_IDS={bismayah:"countBismayah",politics:"countPolitics",economy:"countEconomy",security:"countSecurity",international:"countInternational"};
  const CATEGORY_ORDER={bismayah:0,politics:1,security:2,economy:3,international:4};
  const state={articles:[],membersByGroup:new Map(),filter:"all",selected:new Set(loadSelectedIds())};
  const $=(id)=>document.getElementById(id);
  const escapeHtml=(value)=>String(value??"").replace(/[&<>"']/g,(char)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  const escapeXml=(value)=>String(value??"").replace(/[<>&'\"]/g,(char)=>({"<":"&lt;",">":"&gt;","&":"&amp;","'":"&apos;",'"':"&quot;"}[char]));
  const recordOf=(article)=>article.article&&typeof article.article==="object"?article.article:article;
  const articleId=(article)=>String(article.articleId||recordOf(article).articleId||article.id||"").trim();
  const articleKey=(article)=>articleId(article)||article.eventGroup?.groupId||recordOf(article).canonicalUrl||recordOf(article).articleUrl||recordOf(article).originalTitleArabic;
  const sourceText=(article)=>String(article.originalTextArabic||recordOf(article).originalTextArabic||"").trim();
  const sourceTitle=(article)=>String(article.originalTitleArabic||recordOf(article).originalTitleArabic||"").trim();
  const articleUrl=(article)=>{
    const record=recordOf(article);
    const value=String(article.articleUrl||record.articleUrl||article.canonicalUrl||record.canonicalUrl||"").trim();
    if(!/^https?:\/\//i.test(value)) return "";
    try{
      const url=new URL(value);
      const host=url.hostname.toLowerCase();
      if(host==="news.google.com"||/(^|\.)google\.[a-z.]+$/i.test(host)||/googleusercontent|gstatic/i.test(host)) return "";
      return url.toString();
    }catch{return "";}
  };
  const categoryOf=(article)=>String(article.analysis?.category||article.category||recordOf(article).category||"").toLowerCase();
  const translationOf=(article)=>article.translation&&typeof article.translation==="object"?article.translation:{};
  const translationStatus=(article)=>String(translationOf(article).status||translationOf(article).translationStatus||"PENDING").toLowerCase();
  const translationReady=(article)=>translationStatus(article)==="completed"&&Boolean(String(translationOf(article).titleKo||"").trim())&&Boolean(String(translationOf(article).fullTextKo||"").trim());
  const legacyCardOf=(article)=>article.card&&typeof article.card==="object"?article.card:{};
  const legacyCardReady=(article)=>String(legacyCardOf(article).status||"").toLowerCase()==="completed"&&Boolean(String(legacyCardOf(article).titleKo||"").trim());
  const koTitle=(article)=>String(translationOf(article).titleKo||legacyCardOf(article).titleKo||"").trim()||"한국어 제목 번역 준비 중";
  const fullTranslation=(article)=>String(translationOf(article).fullTextKo||"").trim();
  const legacySummary=(article)=>String(legacyCardOf(article).summaryKo||"").trim();
  const previewText=(article)=>{
    const text=fullTranslation(article).replace(/\s+/g," ").trim();
    if(!text) return "아랍어 원문 전문의 한국어 번역을 준비하고 있습니다.";
    return text.length>360?`${text.slice(0,360).trim()}…`:text;
  };
  const exportSelectable=(article)=>translationReady(article)&&sourceText(article).length>=300&&Boolean(articleId(article));
  const publishedAt=(article)=>recordOf(article).publishedAt||article.publishedAt||"";
  const publishedTime=(article)=>{const value=new Date(publishedAt(article)).getTime();return Number.isFinite(value)?value:null;};
  const sourceName=(article)=>article.source?.arabicName||article.sourceArabic||recordOf(article).sourceArabic||article.sourceHost||"출처 미확인";
  const importanceOf=(article)=>{
    const stored=article.importance||article.analysis?.importance||recordOf(article).importance;
    const score=Number(stored?.score??stored?.finalScore??stored?.ruleScore??article.analysis?.importanceScore??article.importanceScore);
    const savedStars=Number(stored?.stars);
    if(Number.isFinite(savedStars))return {score:Number.isFinite(score)?score:null,stars:Math.max(.5,Math.min(5,Math.round(savedStars*2)/2))};
    if(!Number.isFinite(score))return {score:null,stars:null};
    return {score:Math.max(0,Math.min(100,Math.round(score))),stars:Math.max(.5,Math.min(5,Math.round(score/10)/2))};
  };
  const starRatingHtml=(stars)=>{
    if(stars===null)return "";
    const nodes=[];for(let index=1;index<=5;index+=1){const state=stars>=index?"full":stars>=index-.5?"half":"empty";nodes.push(`<span class="star ${state}" aria-hidden="true">★</span>`);}
    return `<span class="importance-stars" role="img" aria-label="중요도 별점 ${stars.toFixed(1)}점">${nodes.join("")}<span class="star-value">${stars.toFixed(1)}</span></span>`;
  };
  const representatives=()=>state.articles.filter((article)=>article.eventGroup?.isRepresentative!==false);
  const toInputDate=(date)=>{const year=date.getFullYear();const month=String(date.getMonth()+1).padStart(2,"0");const day=String(date.getDate()).padStart(2,"0");return `${year}-${month}-${day}`;};
  const toKstDateKey=(value)=>{
    const date=new Date(value);
    if(Number.isNaN(date.getTime())) return "";
    const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date);
    const map=Object.fromEntries(parts.map((part)=>[part.type,part.value]));
    return `${map.year}-${map.month}-${map.day}`;
  };
  const defaultDateRange=()=>{const end=new Date();const start=new Date(end);start.setDate(start.getDate()-13);return {start:toInputDate(start),end:toInputDate(end)};};
  const reportRangeFor=(value)=>{
    const reportDate=value?new Date(`${value}T00:00:00`):new Date();
    const end=new Date(reportDate);end.setDate(end.getDate()-1);
    const start=new Date(reportDate);start.setDate(start.getDate()-7);
    return {reportDate:toInputDate(reportDate),start:toInputDate(start),end:toInputDate(end)};
  };
  const dateLabel=(value)=>{const date=new Date(value);return Number.isNaN(date.getTime())?"날짜 미확인":new Intl.DateTimeFormat("ko-KR",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}).format(date);};
  const relatedDateLabel=(value)=>{const date=new Date(value);return Number.isNaN(date.getTime())?"":new Intl.DateTimeFormat("ko-KR",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}).format(date);};

  function loadSelectedIds(){
    try{
      const stored=JSON.parse(localStorage.getItem(STORAGE_KEY)||"[]");
      return Array.isArray(stored)?stored.filter((value)=>typeof value==="string"&&value.trim()):[];
    }catch{return [];}
  }
  function saveSelectedIds(){localStorage.setItem(STORAGE_KEY,JSON.stringify([...state.selected]));}
  function setDefaultDateRange(){const range=defaultDateRange();$("startDate").value=range.start;$("endDate").value=range.end;}
  function syncReportRange(value=""){
    const range=reportRangeFor(value||$("reportDate").value);
    $("reportDate").value=range.reportDate;
    $("reportStartDate").value=range.start;
    $("reportEndDate").value=range.end;
  }
  function importanceMatches(stars,filter){
    if(filter==="all")return true;
    if(filter==="pending")return stars===null;
    if(stars===null)return false;
    const [min,max]=filter.split("-").map(Number);return stars>=min&&stars<=max;
  }
  function updateCounts(){
    const items=filteredArticles(false);
    $("countAll").textContent=items.length;
    for(const [category,id] of Object.entries(CATEGORY_IDS)) $(id).textContent=items.filter((item)=>categoryOf(item)===category).length;
    $("countSelected").textContent=state.selected.size;
    $("selectedDownloadCount").textContent=`${state.selected.size}건 선택`;
    $("downloadSelected").disabled=state.selected.size===0;
    $("clearSelected").disabled=state.selected.size===0;
  }
  function compareArticles(a,b,order){
    if(order==="importance-desc"||order==="importance-asc"){
      const aScore=importanceOf(a).stars,bScore=importanceOf(b).stars;
      if(aScore===null&&bScore!==null)return 1;if(aScore!==null&&bScore===null)return -1;
      if(aScore!==null&&bScore!==null&&aScore!==bScore)return order==="importance-asc"?aScore-bScore:bScore-aScore;
      return (publishedTime(b)??0)-(publishedTime(a)??0);
    }
    const aTime=publishedTime(a),bTime=publishedTime(b);
    if(aTime===null&&bTime===null)return sourceTitle(a).localeCompare(sourceTitle(b),"ar");
    if(aTime===null)return 1;if(bTime===null)return -1;
    return order==="oldest"?aTime-bTime:bTime-aTime;
  }
  function membersOf(article){
    const groupId=article.eventGroup?.groupId;if(!groupId)return[article];return state.membersByGroup.get(groupId)||[article];
  }
  function filteredArticles(applySummaryFilter=true){
    const startValue=$("startDate").value,endValue=$("endDate").value;
    const startTime=startValue?new Date(`${startValue}T00:00:00`).getTime():null;
    const endTime=endValue?new Date(`${endValue}T23:59:59.999`).getTime():null;
    const sourceFilter=$("sourceFilter").value,translationFilter=$("translationFilter").value,importanceFilter=$("importanceFilter").value,sortOrder=$("sortOrder").value;
    const query=$("searchInput").value.trim().toLowerCase();
    return representatives().filter((article)=>{
      const key=articleKey(article),time=publishedTime(article);
      if(time!==null&&startTime!==null&&time<startTime)return false;if(time!==null&&endTime!==null&&time>endTime)return false;
      if(applySummaryFilter&&state.filter==="selected"&&!state.selected.has(key))return false;
      if(applySummaryFilter&&!["all","selected"].includes(state.filter)&&categoryOf(article)!==state.filter)return false;
      if(sourceFilter==="ready"&&sourceText(article).length<300)return false;
      if(sourceFilter==="failed"&&sourceText(article).length>=300)return false;
      if(translationFilter!=="all"&&translationStatus(article)!==translationFilter)return false;
      if(!importanceMatches(importanceOf(article).stars,importanceFilter))return false;
      if(query){
        const related=membersOf(article).map((member)=>[member.relatedTitle?.titleKo,sourceTitle(member),sourceName(member)].join(" ")).join(" ");
        const text=[koTitle(article),sourceTitle(article),sourceName(article),fullTranslation(article),related].join(" ").toLowerCase();
        if(!text.includes(query))return false;
      }
      return true;
    }).sort((a,b)=>compareArticles(a,b,sortOrder));
  }
  function categoryLabel(category){return {bismayah:"비스마야",politics:"정치권 동향",economy:"경제·건설",security:"테러·치안",international:"국제사회"}[category]||"미분류";}
  function categoryBadgeClass(category){return ["bismayah","politics","economy","security","international"].includes(category)?`category-${category}`:"category-unknown";}
  function relatedItemHtml(member){
    const url=articleUrl(member),title=escapeHtml(String(member.relatedTitle?.titleKo||sourceTitle(member)||"제목 미확인").trim());
    const meta=[sourceName(member),relatedDateLabel(publishedAt(member))].filter(Boolean).map(escapeHtml).join(" · ");
    return `<li>${url?`<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${title}</a>`:`<span>${title}</span>`}<small>${meta}</small></li>`;
  }
  function relatedNewsHtml(article){
    const related=membersOf(article).filter((member)=>articleId(member)!==articleId(article)).sort((a,b)=>(publishedTime(b)??0)-(publishedTime(a)??0));
    if(!related.length)return"";
    return `<details class="related-news related-news-collapsible"><summary>관련뉴스 ${related.length}건</summary><ul class="related-news-list">${related.map(relatedItemHtml).join("")}</ul></details>`;
  }
  function render(){
    const items=filteredArticles();$("visibleCount").textContent=`${items.length}개 사건 표시`;const list=$("newsList");
    if(!items.length){list.className="news-list empty";list.textContent=state.articles.length?"현재 필터에 맞는 기사가 없습니다.":"수집된 기사가 없습니다.";return;}
    list.className="news-list";
    list.innerHTML=items.map((article)=>{
      const key=articleKey(article),selected=state.selected.has(key),url=articleUrl(article),category=categoryOf(article),importance=importanceOf(article),selectable=exportSelectable(article),ready=translationReady(article);
      const duplicateCount=Math.max(0,membersOf(article).length-1);
      const scoreBadge=importance.stars===null?`<span class="badge importance-pending">별점 평가 대기</span>`:`<span class="badge importance-score">${starRatingHtml(importance.stars)}</span>`;
      const legacyReady=legacyCardReady(article),legacyText=legacySummary(article);const translationBlock=ready?`<p class="translation-preview">${escapeHtml(previewText(article))}</p><details class="full-translation"><summary>전문 펼쳐보기</summary><div class="translation-body">${escapeHtml(fullTranslation(article))}</div><details class="arabic-source"><summary>아랍어 원문 보기</summary><div lang="ar" dir="rtl">${escapeHtml(sourceText(article))}</div></details><div class="collapse-article-row"><button class="collapse-article-button" data-action="collapse-article" type="button">기사 접기 <span aria-hidden="true">↑</span></button></div></details>`:legacyReady&&legacyText?`<p class="translation-preview">${escapeHtml(legacyText)}</p><details class="arabic-source"><summary>아랍어 원문 보기</summary><div lang="ar" dir="rtl">${escapeHtml(sourceText(article))}</div></details>`:`<p class="translation-pending">전문 번역 대기 중입니다. 다음 번역 실행에서 처리됩니다.</p>`;
      return `<article class="news-card ${selected?"selected":""}" data-key="${escapeHtml(key)}">
        <div class="card-top"><div class="meta"><span>${escapeHtml(sourceName(article))}</span><span>${escapeHtml(dateLabel(publishedAt(article)))}</span>${duplicateCount?`<span>동일 사건 보도 ${duplicateCount+1}건</span>`:""}</div><button class="${selected?"primary":""}" data-action="select" type="button" ${selectable?"":"disabled"}>${selected?"선택됨":selectable?"기사 선택":"번역 후 선택"}</button></div>
        <h3>${url?`<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(koTitle(article))}</a>`:escapeHtml(koTitle(article))}</h3>
        ${translationBlock}
        <div class="badges"><span class="badge ${escapeHtml(categoryBadgeClass(category))}">${escapeHtml(categoryLabel(category))}</span>${scoreBadge}${ready?`<span class="badge translation-complete">전문 번역 완료</span>`:legacyReady?`<span class="badge importance-pending">기존 요약 복원</span>`:`<span class="badge importance-pending">전문 번역 대기</span>`}</div>
        <div class="card-actions">${url?`<a href="${escapeHtml(url)}" target="_blank" rel="noopener">언론사 원문 열기</a>`:`<span class="badge disabled">원문 URL 미확보</span>`}<span class="card-source-note">요약 없이 기사 전문을 충실 번역</span></div>
        ${relatedNewsHtml(article)}
      </article>`;
    }).join("");
  }
  function rebuildGroups(){
    state.membersByGroup=new Map();for(const article of state.articles){const groupId=article.eventGroup?.groupId||articleId(article);if(!groupId)continue;if(!state.membersByGroup.has(groupId))state.membersByGroup.set(groupId,[]);state.membersByGroup.get(groupId).push(article);}
  }
  function pruneSelections(){
    const valid=new Set(representatives().filter(exportSelectable).map(articleKey));let changed=false;for(const key of state.selected){if(!valid.has(key)){state.selected.delete(key);changed=true;}}if(changed)saveSelectedIds();
  }
  function setDownloadMessage(message,type=""){
    const node=$("downloadMessage");node.textContent=message;node.className=`report-request-message${type?` ${type}`:""}`;
  }
  function selectedArticles(){
    const byKey=new Map(representatives().map((article)=>[articleKey(article),article]));return [...state.selected].map((key)=>byKey.get(key)).filter(Boolean);
  }
  function validateExportRequest(){
    const reportDate=$("reportDate").value,periodStart=$("reportStartDate").value,periodEnd=$("reportEndDate").value,selected=selectedArticles();
    if(!reportDate||!periodStart||!periodEnd)throw new Error("보고일과 대상기간을 확인해 주세요.");
    if(!selected.length)throw new Error("Word로 내려받을 기사를 먼저 선택해 주세요.");
    if(selected.length>MAX_EXPORT_ARTICLES)throw new Error(`한 번에 최대 ${MAX_EXPORT_ARTICLES}건까지 내려받을 수 있습니다.`);
    const invalid=selected.filter((article)=>!exportSelectable(article));if(invalid.length)throw new Error("전문 번역이 완료되지 않은 기사가 선택돼 있습니다.");
    const outside=selected.filter((article)=>{const date=toKstDateKey(publishedAt(article));return !date||date<periodStart||date>periodEnd;});
    if(outside.length)throw new Error(`대상기간 밖 기사가 ${outside.length}건 선택돼 있습니다. 기사 선택 또는 보고일을 조정해 주세요.`);
    return {reportDate,periodStart,periodEnd,selected};
  }
  function wordParagraph(text,style="Normal",options={}){
    if(text===undefined||text===null||String(text)==="")return"";
    const rtl=options.rtl?'<w:bidi/>':'';const align=options.rtl?'<w:jc w:val="right"/>':'';const runRtl=options.rtl?'<w:rtl/>':'';
    return `<w:p><w:pPr><w:pStyle w:val="${style}"/>${rtl}${align}</w:pPr><w:r><w:rPr>${runRtl}</w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
  }
  function paragraphs(text,style="Normal",options={}){
    return String(text||"").replace(/\r\n?/g,"\n").split(/\n+/).map((part)=>wordParagraph(part||" ",style,options)).join("");
  }
  function pageBreak(){return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';}
  function documentXml({reportDate,periodStart,periodEnd,selected}){
    const sorted=[...selected].sort((a,b)=>(CATEGORY_ORDER[categoryOf(a)]??99)-(CATEGORY_ORDER[categoryOf(b)]??99)||(publishedTime(a)??0)-(publishedTime(b)??0));
    const body=[];
    body.push(wordParagraph("WR SELECTED ARTICLES","Title"));
    body.push(wordParagraph("주간상황보고서 GPT 입력용 선별 기사 자료","Heading1"));
    body.push(wordParagraph("[REPORT_METADATA]","Meta"));
    body.push(wordParagraph(`문서 유형: WR_SELECTED_ARTICLES`,"Meta"));
    body.push(wordParagraph(`스키마 버전: 2.0`,"Meta"));
    body.push(wordParagraph(`보고일: ${reportDate}`,"Meta"));
    body.push(wordParagraph(`보고기간 시작일: ${periodStart}`,"Meta"));
    body.push(wordParagraph(`보고기간 종료일: ${periodEnd}`,"Meta"));
    body.push(wordParagraph(`선택 기사 수: ${sorted.length}`,"Meta"));
    body.push(wordParagraph(`파일 생성일시: ${new Intl.DateTimeFormat("ko-KR",{timeZone:"Asia/Seoul",dateStyle:"long",timeStyle:"medium"}).format(new Date())} KST`,"Meta"));
    body.push(wordParagraph("[/REPORT_METADATA]","Meta"));
    body.push(wordParagraph("이 문서는 기사 요약본이 아니라 선택한 기사의 한국어 전문 번역과 아랍어 원문을 함께 담은 GPT 입력용 자료입니다.","Normal"));
    body.push(pageBreak());
    sorted.forEach((article,index)=>{
      const importance=importanceOf(article).stars;const groupId=String(article.eventGroup?.groupId||"");const related=membersOf(article).filter((member)=>articleId(member)!==articleId(article));
      body.push(wordParagraph(`[ARTICLE_BEGIN]`,"Meta"));
      body.push(wordParagraph(`기사 번호: ${index+1}`,"Meta"));
      body.push(wordParagraph(`기사 ID: ${articleId(article)}`,"Meta"));
      body.push(wordParagraph(`동일사건 그룹 ID: ${groupId||"없음"}`,"Meta"));
      body.push(wordParagraph(`카테고리: ${categoryLabel(categoryOf(article))}`,"Meta"));
      body.push(wordParagraph(`중요도 별점: ${importance===null?"미평가":`${importance.toFixed(1)} / 5.0`}`,"Meta"));
      body.push(wordParagraph(`보도일시: ${publishedAt(article)}`,"Meta"));
      body.push(wordParagraph(`언론사: ${sourceName(article)}`,"Meta"));
      body.push(wordParagraph(`원문 URL: ${articleUrl(article)||"미확보"}`,"Meta"));
      body.push(wordParagraph("한국어 제목 번역","Heading2"));
      body.push(wordParagraph(koTitle(article),"Normal"));
      body.push(wordParagraph("한국어 본문 전문 번역","Heading2"));
      body.push(paragraphs(fullTranslation(article),"Normal"));
      body.push(wordParagraph("아랍어 제목","Heading2"));
      body.push(wordParagraph(sourceTitle(article),"Arabic",{rtl:true}));
      body.push(wordParagraph("아랍어 원문","Heading2"));
      body.push(paragraphs(sourceText(article),"Arabic",{rtl:true}));
      if(related.length){
        body.push(wordParagraph("관련기사","Heading2"));
        related.forEach((member,relatedIndex)=>body.push(wordParagraph(`${relatedIndex+1}. ${member.relatedTitle?.titleKo||sourceTitle(member)} / ${sourceName(member)} / ${publishedAt(member)} / ${articleUrl(member)||"URL 미확보"}`,"Meta")));
      }
      body.push(wordParagraph(`[ARTICLE_END]`,"Meta"));
      if(index<sorted.length-1)body.push(pageBreak());
    });
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`;
  }
  async function buildDocx(payload){
    if(typeof JSZip==="undefined")throw new Error("Word 생성 모듈을 불러오지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.");
    const zip=new JSZip();
    zip.file("[Content_Types].xml",`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`);
    zip.folder("_rels").file(".rels",`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`);
    zip.folder("word").file("document.xml",documentXml(payload));
    zip.folder("word").file("styles.xml",`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Malgun Gothic" w:hAnsi="Malgun Gothic" w:eastAsia="맑은 고딕" w:cs="Arial"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="120" w:line="320" w:lineRule="auto"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/><w:pPr><w:spacing w:before="220" w:after="160"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="Heading 2"/><w:pPr><w:spacing w:before="180" w:after="100"/></w:pPr><w:rPr><w:b/><w:sz w:val="23"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Meta"><w:name w:val="Meta"/><w:pPr><w:spacing w:after="60"/></w:pPr><w:rPr><w:color w:val="555555"/><w:sz w:val="18"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Arabic"><w:name w:val="Arabic"/><w:pPr><w:bidi/><w:jc w:val="right"/><w:spacing w:after="120" w:line="320" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:rtl/><w:sz w:val="22"/></w:rPr></w:style></w:styles>`);
    const now=new Date().toISOString();
    zip.folder("docProps").file("core.xml",`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>WR Selected Articles ${escapeXml(payload.reportDate)}</dc:title><dc:creator>WR News Monitor</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`);
    zip.folder("docProps").file("app.xml",`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>WR News Monitor</Application></Properties>`);
    return zip.generateAsync({type:"blob",compression:"DEFLATE",compressionOptions:{level:6},mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"});
  }
  async function downloadSelectedArticles(){
    try{
      const payload=validateExportRequest();setDownloadMessage("선택 기사 Word 자료를 생성하고 있습니다…");
      const blob=await buildDocx(payload);const fileName=`WR_SELECTED_ARTICLES_${payload.reportDate}.docx`;const url=URL.createObjectURL(blob);const anchor=document.createElement("a");anchor.href=url;anchor.download=fileName;document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
      setDownloadMessage(`${payload.selected.length}건의 전문 번역 기사를 ${fileName}로 내려받았습니다. 주간상황보고서 GPT에 그대로 업로드하면 됩니다.`,"success");
    }catch(error){setDownloadMessage(error.message||String(error),"error");}
  }
  function apply(){updateCounts();render();}
  async function init(){
    setDefaultDateRange();syncReportRange();
    try{
      const stamp=Date.now();const response=await fetch(`./data/articles.json?v=${stamp}`,{cache:"no-store"});if(!response.ok)throw new Error(`articles HTTP ${response.status}`);const payload=await response.json();const loaded=Array.isArray(payload)?payload:(payload.articles||[]);state.articles=loaded.filter((article)=>!String(article.articleUrl||article.canonicalUrl||"").includes("/5235833-"));rebuildGroups();pruneSelections();$("updatedAt").textContent=payload.generatedAt?`최종 업데이트 ${dateLabel(payload.generatedAt)}`:"초기 구조 준비 완료";
    }catch(error){$("updatedAt").textContent="데이터 로드 실패";console.error(error);}apply();
  }
  document.querySelectorAll(".summary-card").forEach((button)=>button.addEventListener("click",()=>{state.filter=button.dataset.filter;document.querySelectorAll(".summary-card").forEach((item)=>item.classList.toggle("active",item===button));apply();}));
  ["startDate","endDate","sortOrder","importanceFilter","sourceFilter","translationFilter"].forEach((id)=>$(id).addEventListener("change",apply));
  $("reportDate").addEventListener("change",(event)=>{syncReportRange(event.target.value);setDownloadMessage("");});
  $("reportDate").addEventListener("input",(event)=>{if(event.target.value)syncReportRange(event.target.value);});
  $("searchInput").addEventListener("input",apply);
  $("downloadSelected").addEventListener("click",downloadSelectedArticles);
  $("clearSelected").addEventListener("click",()=>{state.selected.clear();saveSelectedIds();setDownloadMessage("");apply();});
  $("resetFilters").addEventListener("click",()=>{setDefaultDateRange();$("sortOrder").value="importance-desc";$("importanceFilter").value="all";$("sourceFilter").value="all";$("translationFilter").value="all";$("searchInput").value="";state.filter="all";document.querySelectorAll(".summary-card").forEach((item)=>item.classList.toggle("active",item.dataset.filter==="all"));apply();});
  document.addEventListener("click",(event)=>{
    const button=event.target.closest("button[data-action]");
    if(!button||button.disabled)return;
    const action=button.dataset.action;
    const card=button.closest(".news-card");
    if(action==="collapse-article"){
      const details=button.closest(".full-translation");
      if(details)details.open=false;
      card?.scrollIntoView({behavior:"smooth",block:"start"});
      return;
    }
    if(action!=="select")return;
    const key=card?.dataset.key;if(!key)return;
    if(state.selected.has(key))state.selected.delete(key);
    else if(state.selected.size>=MAX_EXPORT_ARTICLES){setDownloadMessage(`한 번에 최대 ${MAX_EXPORT_ARTICLES}건까지 선택할 수 있습니다.`,"error");return;}
    else state.selected.add(key);
    saveSelectedIds();setDownloadMessage("");apply();
  });
  const scrollTopButton=$("scrollTopButton");
  const syncScrollTopButton=()=>{
    const visible=window.scrollY>600;
    scrollTopButton.classList.toggle("visible",visible);
    scrollTopButton.setAttribute("aria-hidden",String(!visible));
  };
  window.addEventListener("scroll",syncScrollTopButton,{passive:true});
  scrollTopButton.addEventListener("click",()=>window.scrollTo({top:0,behavior:"smooth"}));
  syncScrollTopButton();
  init();
})();
