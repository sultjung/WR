(()=>{
  const STORAGE_KEY="wr-selected-article-ids-v1";
  const REPORT_REPOSITORY="sultjung/WR";
  const MAX_REPORT_ARTICLES=20;
  const state={articles:[],membersByGroup:new Map(),filter:"all",selected:new Set(loadSelectedIds())};
  const $=(id)=>document.getElementById(id);
  const CATEGORY_IDS={bismayah:"countBismayah",politics:"countPolitics",economy:"countEconomy",security:"countSecurity",international:"countInternational"};
  const escapeHtml=(value)=>String(value??"").replace(/[&<>"']/g,(char)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  const recordOf=(article)=>article.article&&typeof article.article==="object"?article.article:article;
  const articleId=(article)=>String(article.articleId||recordOf(article).articleId||article.id||"").trim();
  const articleKey=(article)=>articleId(article)||article.eventGroup?.groupId||article.article?.canonicalUrl||article.article?.articleUrl||article.originalTitleArabic;
  const sourceText=(article)=>String(article.originalTextArabic||recordOf(article).originalTextArabic||"").trim();
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
  const cardStatus=(article)=>String(article.card?.status||article.cardStatus||article.translation?.translationStatus||article.translation?.status||article.translationStatus||"PENDING").toLowerCase();
  const contentReady=(article)=>sourceText(article).length>=300&&Boolean(articleUrl(article));
  const reportSelectable=(article)=>cardStatus(article)==="completed"&&sourceText(article).length>=300&&Boolean(articleId(article));
  const publishedAt=(article)=>recordOf(article).publishedAt||article.publishedAt||"";
  const publishedTime=(article)=>{const value=new Date(publishedAt(article)).getTime();return Number.isFinite(value)?value:null;};
  const sourceName=(article)=>article.source?.arabicName||article.sourceArabic||recordOf(article).sourceArabic||article.sourceHost||"출처 미확인";
  const cardTitle=(article)=>String(article.card?.titleKo||article.translation?.titleKo||article.titleKo||"").trim();
  const koTitle=(article)=>cardTitle(article)||"한국어 요약 준비 중";
  const arTitle=(article)=>recordOf(article).originalTitleArabic||article.originalTitleArabic||"";
  const displayRelatedTitle=(article)=>String(article.relatedTitle?.titleKo||"").trim()||cardTitle(article)||arTitle(article)||"제목 미확인";
  const preview=(article)=>article.card?.summaryKo||article.translation?.previewKo||article.previewKo||"아랍어 원문에서 구조화된 사실을 추출해 한국어 요약을 준비하고 있습니다.";
  const importanceOf=(article)=>{
    const stored=article.importance||article.analysis?.importance||recordOf(article).importance;
    const score=Number(stored?.score??stored?.finalScore??stored?.ruleScore??article.analysis?.importanceScore??article.importanceScore);
    if(!Number.isFinite(score)) return {score:null};
    return {score:Math.max(0,Math.min(100,Math.round(score)))};
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
  const defaultReportRange=()=>{
    const reportDate=new Date();
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
  function setDefaultReportRange(){const range=defaultReportRange();$("reportDate").value=range.reportDate;$("reportStartDate").value=range.start;$("reportEndDate").value=range.end;}
  function importanceMatches(score,filter){
    if(filter==="all") return true;
    if(filter==="pending") return score===null;
    if(score===null) return false;
    const [min,max]=filter.split("-").map(Number);
    return score>=min&&score<=max;
  }
  function updateCounts(){
    const items=filteredArticles(false);
    $("countAll").textContent=items.length;
    for(const [category,id] of Object.entries(CATEGORY_IDS)) $(id).textContent=items.filter((item)=>categoryOf(item)===category).length;
    $("countSelected").textContent=state.selected.size;
    $("requestReport").disabled=state.selected.size===0;
  }
  function compareArticles(a,b,order){
    if(order==="importance-desc"||order==="importance-asc"){
      const aScore=importanceOf(a).score;
      const bScore=importanceOf(b).score;
      if(aScore===null&&bScore!==null) return 1;
      if(aScore!==null&&bScore===null) return -1;
      if(aScore!==null&&bScore!==null&&aScore!==bScore) return order==="importance-asc"?aScore-bScore:bScore-aScore;
      return (publishedTime(b)??0)-(publishedTime(a)??0);
    }
    const aTime=publishedTime(a),bTime=publishedTime(b);
    if(aTime===null&&bTime===null) return arTitle(a).localeCompare(arTitle(b),"ar");
    if(aTime===null) return 1;
    if(bTime===null) return -1;
    return order==="oldest"?aTime-bTime:bTime-aTime;
  }
  function membersOf(article){
    const groupId=article.eventGroup?.groupId;
    if(!groupId) return [article];
    return state.membersByGroup.get(groupId)||[article];
  }
  function filteredArticles(applySummaryFilter=true){
    const startValue=$("startDate").value;
    const endValue=$("endDate").value;
    const startTime=startValue?new Date(`${startValue}T00:00:00`).getTime():null;
    const endTime=endValue?new Date(`${endValue}T23:59:59.999`).getTime():null;
    const sourceFilter=$("sourceFilter").value;
    const summaryFilter=$("translationFilter").value;
    const importanceFilter=$("importanceFilter").value;
    const sortOrder=$("sortOrder").value;
    const query=$("searchInput").value.trim().toLowerCase();
    return representatives().filter((article)=>{
      const key=articleKey(article);
      const time=publishedTime(article);
      if(time!==null&&startTime!==null&&time<startTime) return false;
      if(time!==null&&endTime!==null&&time>endTime) return false;
      if(applySummaryFilter&&state.filter==="selected"&&!state.selected.has(key)) return false;
      if(applySummaryFilter&&!["all","selected"].includes(state.filter)&&categoryOf(article)!==state.filter) return false;
      if(sourceFilter==="ready"&&!contentReady(article)) return false;
      if(sourceFilter==="failed"&&contentReady(article)) return false;
      if(summaryFilter!=="all"&&cardStatus(article)!==summaryFilter) return false;
      if(!importanceMatches(importanceOf(article).score,importanceFilter)) return false;
      if(query){
        const relatedText=membersOf(article).map((member)=>[displayRelatedTitle(member),arTitle(member),sourceName(member),preview(member)].join(" ")).join(" ");
        const text=[koTitle(article),arTitle(article),sourceName(article),preview(article),relatedText].join(" ").toLowerCase();
        if(!text.includes(query)) return false;
      }
      return true;
    }).sort((a,b)=>compareArticles(a,b,sortOrder));
  }
  function categoryLabel(category){return {bismayah:"비스마야",politics:"정치권 동향",economy:"경제·건설",security:"테러·치안",international:"국제사회"}[category]||"미분류";}
  function categoryBadgeClass(category){return ["bismayah","politics","economy","security","international"].includes(category)?`category-${category}`:"category-unknown";}
  function relatedItemHtml(member){
    const url=articleUrl(member);
    const title=escapeHtml(displayRelatedTitle(member));
    const meta=[sourceName(member),relatedDateLabel(publishedAt(member))].filter(Boolean).map(escapeHtml).join(" · ");
    const titleHtml=url?`<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${title}</a>`:`<span>${title}</span>`;
    return `<li>${titleHtml}<small>${meta}</small></li>`;
  }
  function relatedNewsHtml(article){
    const related=membersOf(article).filter((member)=>articleId(member)!==articleId(article)).sort((a,b)=>(publishedTime(b)??0)-(publishedTime(a)??0));
    if(!related.length) return "";
    const visible=related.slice(0,4);
    const hidden=related.slice(4);
    return `<section class="related-news" aria-label="관련뉴스">
      <div class="related-news-head"><strong>관련뉴스 ${related.length}건</strong><span>동일 사건으로 묶음</span></div>
      <ul class="related-news-list">${visible.map(relatedItemHtml).join("")}</ul>
      ${hidden.length?`<details class="related-news-more"><summary>관련뉴스 ${related.length}건 전체보기</summary><ul class="related-news-list">${hidden.map(relatedItemHtml).join("")}</ul></details>`:""}
    </section>`;
  }
  function render(){
    const items=filteredArticles();
    $("visibleCount").textContent=`${items.length}개 사건 표시`;
    const list=$("newsList");
    if(!items.length){list.className="news-list empty";list.textContent=state.articles.length?"현재 필터에 맞는 기사가 없습니다.":"수집된 기사가 없습니다.";return;}
    list.className="news-list";
    list.innerHTML=items.map((article)=>{
      const key=articleKey(article),selected=state.selected.has(key),url=articleUrl(article),category=categoryOf(article),importance=importanceOf(article),selectable=reportSelectable(article);
      const duplicateCount=Math.max(0,membersOf(article).length-1);
      const scoreBadge=importance.score===null?`<span class="badge importance-pending">중요도 평가 대기</span>`:`<span class="badge importance-score">중요도 ${importance.score}점</span>`;
      return `<article class="news-card ${selected?"selected":""}" data-key="${escapeHtml(key)}">
        <div class="card-top"><div class="meta"><span>${escapeHtml(sourceName(article))}</span><span>${escapeHtml(dateLabel(publishedAt(article)))}</span>${duplicateCount?`<span>동일 사건 보도 ${duplicateCount+1}건</span>`:""}</div><button class="${selected?"primary":""}" data-action="select" type="button" ${selectable?"":"disabled"}>${selected?"선택됨":selectable?"보고서 선택":"요약 후 선택"}</button></div>
        <h3>${url?`<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(koTitle(article))}</a>`:escapeHtml(koTitle(article))}</h3>
        <p class="arabic-title" lang="ar">${escapeHtml(arTitle(article))}</p>
        <p class="preview">${escapeHtml(preview(article))}</p>
        <div class="badges"><span class="badge ${escapeHtml(categoryBadgeClass(category))}">${escapeHtml(categoryLabel(category))}</span>${scoreBadge}${duplicateCount?`<span class="badge related-count-badge">관련뉴스 ${duplicateCount}건</span>`:""}</div>
        <div class="card-actions">${url?`<a href="${escapeHtml(url)}" target="_blank" rel="noopener">아랍어 원문 보기</a>`:`<span class="badge disabled">원문 URL 미확보</span>`}<span class="card-source-note">전문 번역은 생성하지 않음</span></div>
        ${relatedNewsHtml(article)}
      </article>`;
    }).join("");
  }
  function rebuildGroups(){
    state.membersByGroup=new Map();
    for(const article of state.articles){
      const groupId=article.eventGroup?.groupId||articleId(article);
      if(!groupId) continue;
      if(!state.membersByGroup.has(groupId)) state.membersByGroup.set(groupId,[]);
      state.membersByGroup.get(groupId).push(article);
    }
  }
  function pruneSelections(){
    const valid=new Set(representatives().filter(reportSelectable).map(articleKey));
    let changed=false;
    for(const key of state.selected){if(!valid.has(key)){state.selected.delete(key);changed=true;}}
    if(changed) saveSelectedIds();
  }
  function setReportMessage(message,type=""){
    const node=$("reportRequestMessage");
    node.textContent=message;
    node.className=`report-request-message${type?` ${type}`:""}`;
  }
  function selectedArticles(){
    const byKey=new Map(representatives().map((article)=>[articleKey(article),article]));
    return [...state.selected].map((key)=>byKey.get(key)).filter(Boolean);
  }
  function validateReportRequest(){
    const reportDate=$("reportDate").value;
    const periodStart=$("reportStartDate").value;
    const periodEnd=$("reportEndDate").value;
    const selected=selectedArticles();
    if(!reportDate||!periodStart||!periodEnd) throw new Error("보고일과 보고기간을 모두 입력해 주세요.");
    if(periodStart>periodEnd) throw new Error("보고기간 시작일이 종료일보다 늦습니다.");
    if(periodEnd>=reportDate) throw new Error("보고기간 종료일은 보고일보다 앞선 날짜여야 합니다.");
    const days=Math.round((new Date(`${periodEnd}T00:00:00`)-new Date(`${periodStart}T00:00:00`))/86400000)+1;
    if(days<1||days>14) throw new Error("보고기간은 최대 14일까지 설정할 수 있습니다.");
    if(!selected.length) throw new Error("보고서에 반영할 기사를 먼저 선택해 주세요.");
    if(selected.length>MAX_REPORT_ARTICLES) throw new Error(`보고서 생성은 최대 ${MAX_REPORT_ARTICLES}건까지 가능합니다. 현재 ${selected.length}건이 선택돼 있습니다.`);
    const invalid=selected.filter((article)=>!reportSelectable(article));
    if(invalid.length) throw new Error("요약이 완료되지 않았거나 원문이 부족한 기사가 선택돼 있습니다. 선택을 다시 확인해 주세요.");
    const outside=selected.filter((article)=>{const date=toKstDateKey(publishedAt(article));return !date||date<periodStart||date>periodEnd;});
    if(outside.length) throw new Error(`보고기간 밖 기사가 ${outside.length}건 포함돼 있습니다. 기사 날짜 또는 보고기간을 조정해 주세요.`);
    return {reportDate,periodStart,periodEnd,selected};
  }
  function openReportRequest(){
    try{
      const {reportDate,periodStart,periodEnd,selected}=validateReportRequest();
      const payload={version:1,reportDate,periodStart,periodEnd,selectedArticleIds:selected.map(articleId),requestedFrom:"github-pages"};
      const marker=`<!-- WR_REPORT_REQUEST_V1\n${JSON.stringify(payload)}\n-->`;
      const body=[
        marker,
        "## 주간상황보고서 생성 요청",
        "",
        `- 보고일: ${reportDate}`,
        `- 보고기간: ${periodStart} ~ ${periodEnd}`,
        `- 선택 기사: ${selected.length}건`,
        "",
        "이 이슈를 등록하면 저장소 소유자 요청에 한해 GitHub Actions가 고급 AI 편집, 오피넷 국제유가 조회, Word 생성 및 검증을 수행합니다."
      ].join("\n");
      const title=`[REPORT] ${reportDate} 이라크 주간상황보고서 생성`;
      const url=`https://github.com/${REPORT_REPOSITORY}/issues/new?title=${encodeURIComponent(title)}&labels=${encodeURIComponent("report-request")}&body=${encodeURIComponent(body)}`;
      setReportMessage("GitHub 생성 요청 화면을 열었습니다. 내용 확인 후 ‘Submit new issue’를 누르면 생성이 시작됩니다.","success");
      window.open(url,"_blank","noopener");
    }catch(error){setReportMessage(error.message||String(error),"error");}
  }
  function apply(){updateCounts();render();}
  async function init(){
    setDefaultDateRange();
    setDefaultReportRange();
    try{
      const stamp=Date.now();
      const articleResponse=await fetch(`./data/articles.json?v=${stamp}`,{cache:"no-store"});
      if(!articleResponse.ok) throw new Error(`articles HTTP ${articleResponse.status}`);
      const payload=await articleResponse.json();
      state.articles=Array.isArray(payload)?payload:(payload.articles||[]);
      rebuildGroups();
      pruneSelections();
      $("updatedAt").textContent=payload.generatedAt?`최종 업데이트 ${dateLabel(payload.generatedAt)}`:"초기 구조 준비 완료";
    }catch(error){$("updatedAt").textContent="데이터 로드 실패";console.error(error);}
    apply();
  }
  document.querySelectorAll(".summary-card").forEach((button)=>button.addEventListener("click",()=>{state.filter=button.dataset.filter;document.querySelectorAll(".summary-card").forEach((item)=>item.classList.toggle("active",item===button));apply();}));
  ["startDate","endDate","sortOrder","importanceFilter","sourceFilter","translationFilter"].forEach((id)=>$(id).addEventListener("change",apply));
  $("searchInput").addEventListener("input",apply);
  $("requestReport").addEventListener("click",openReportRequest);
  $("resetFilters").addEventListener("click",()=>{
    setDefaultDateRange();
    $("sortOrder").value="importance-desc";
    $("importanceFilter").value="all";
    $("sourceFilter").value="all";
    $("translationFilter").value="all";
    $("searchInput").value="";
    state.filter="all";
    document.querySelectorAll(".summary-card").forEach((item)=>item.classList.toggle("active",item.dataset.filter==="all"));
    apply();
  });
  document.addEventListener("click",(event)=>{
    const button=event.target.closest("button[data-action='select']");
    if(!button||button.disabled) return;
    const card=button.closest(".news-card");
    const key=card?.dataset.key;
    if(!key) return;
    if(state.selected.has(key)) state.selected.delete(key);
    else if(state.selected.size>=MAX_REPORT_ARTICLES){setReportMessage(`보고서는 최대 ${MAX_REPORT_ARTICLES}건까지 선택할 수 있습니다.`,"error");return;}
    else state.selected.add(key);
    saveSelectedIds();
    setReportMessage("");
    apply();
  });
  init();
})();
