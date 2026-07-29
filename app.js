(()=>{
  const state={articles:[],groups:new Map(),filter:"all",selected:new Set()};
  const $=(id)=>document.getElementById(id);
  const CATEGORY_IDS={bismayah:"countBismayah",politics:"countPolitics",economy:"countEconomy",security:"countSecurity",international:"countInternational"};
  const escapeHtml=(value)=>String(value??"").replace(/[&<>"']/g,(char)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  const articleKey=(article)=>article.eventGroup?.groupId||article.articleId||article.id||article.article?.canonicalUrl||article.article?.articleUrl||article.originalTitleArabic;
  const articleUrl=(article)=>{
    const value=String(article.article?.articleUrl||article.articleUrl||"").trim();
    if(!/^https?:\/\//i.test(value)) return "";
    try{
      const url=new URL(value);
      const host=url.hostname.toLowerCase();
      if(host==="news.google.com"||/(^|\.)google\.[a-z.]+$/i.test(host)||/googleusercontent|gstatic/i.test(host)) return "";
      return url.toString();
    }catch{return "";}
  };
  const categoryOf=(article)=>String(article.analysis?.category||article.category||"").toLowerCase();
  const translationStatus=(article)=>String(article.translation?.translationStatus||article.translation?.status||article.translationStatus||"PENDING").toLowerCase();
  const contentReady=(article)=>Boolean(article.article?.originalTextArabic||article.originalTextArabic)&&Boolean(articleUrl(article));
  const publishedAt=(article)=>article.article?.publishedAt||article.publishedAt||"";
  const publishedTime=(article)=>{
    const value=new Date(publishedAt(article)).getTime();
    return Number.isFinite(value)?value:null;
  };
  const sourceName=(article)=>article.source?.arabicName||article.sourceArabic||"출처 미확인";
  const koTitle=(article)=>article.translation?.titleKo||article.titleKo||"번역 대기";
  const arTitle=(article)=>article.article?.originalTitleArabic||article.originalTitleArabic||"";
  const preview=(article)=>article.translation?.previewKo||article.translation?.fullTextKo||article.previewKo||"한국어 번역이 아직 생성되지 않았습니다.";
  const representatives=()=>state.articles.filter((article)=>article.eventGroup?.isRepresentative!==false);
  const dateLabel=(value)=>{
    const date=new Date(value);
    return Number.isNaN(date.getTime())?"날짜 미확인":new Intl.DateTimeFormat("ko-KR",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}).format(date);
  };
  function updateCounts(){
    const items=representatives();
    $("countAll").textContent=items.length;
    for(const [category,id] of Object.entries(CATEGORY_IDS)) $(id).textContent=items.filter((item)=>categoryOf(item)===category).length;
    $("countSelected").textContent=state.selected.size;
  }
  function compareByDate(a,b,order){
    const aTime=publishedTime(a);
    const bTime=publishedTime(b);
    if(aTime===null&&bTime===null) return arTitle(a).localeCompare(arTitle(b),"ar");
    if(aTime===null) return 1;
    if(bTime===null) return -1;
    return order==="oldest"?aTime-bTime:bTime-aTime;
  }
  function filteredArticles(){
    const period=$("periodFilter").value;
    const sourceFilter=$("sourceFilter").value;
    const translationFilter=$("translationFilter").value;
    const sortOrder=$("sortOrder").value;
    const query=$("searchInput").value.trim().toLowerCase();
    const cutoff=new Date();
    if(period!=="all") cutoff.setDate(cutoff.getDate()-Number(period));
    return representatives().filter((article)=>{
      const key=articleKey(article);
      const date=new Date(publishedAt(article));
      if(period!=="all"&&!Number.isNaN(date.getTime())&&date<cutoff) return false;
      if(state.filter==="selected"&&!state.selected.has(key)) return false;
      if(!["all","selected"].includes(state.filter)&&categoryOf(article)!==state.filter) return false;
      if(sourceFilter==="ready"&&!contentReady(article)) return false;
      if(sourceFilter==="failed"&&contentReady(article)) return false;
      if(translationFilter!=="all"&&translationStatus(article)!==translationFilter) return false;
      if(query){
        const group=state.groups.get(article.eventGroup?.groupId);
        const groupSources=(group?.sources||[]).map((item)=>item.sourceArabic).join(" ");
        const text=[koTitle(article),arTitle(article),sourceName(article),preview(article),groupSources].join(" ").toLowerCase();
        if(!text.includes(query)) return false;
      }
      return true;
    }).sort((a,b)=>compareByDate(a,b,sortOrder));
  }
  function categoryLabel(category){
    return {bismayah:"비스마야",politics:"정치권 동향",economy:"경제·건설",security:"테러·치안",international:"국제사회"}[category]||"미분류";
  }
  function categoryBadgeClass(category){
    return ["bismayah","politics","economy","security","international"].includes(category)
      ? `category-${category}`
      : "category-unknown";
  }
  function relatedSourcesHtml(article){
    const group=state.groups.get(article.eventGroup?.groupId);
    const sources=(group?.sources||[]).filter((item)=>item.articleUrl);
    if(sources.length<=1) return "";
    return `<details class="related-sources"><summary>관련 보도 ${sources.length}건</summary><div class="card-actions">${sources.map((item)=>`<a href="${escapeHtml(item.articleUrl)}" target="_blank" rel="noopener">${escapeHtml(item.sourceArabic||"원문")}</a>`).join("")}</div></details>`;
  }
  function render(){
    const items=filteredArticles();
    $("visibleCount").textContent=`${items.length}개 사건 표시`;
    const list=$("newsList");
    if(!items.length){
      list.className="news-list empty";
      list.textContent=state.articles.length?"현재 필터에 맞는 기사가 없습니다.":"수집된 기사가 없습니다.";
      return;
    }
    list.className="news-list";
    list.innerHTML=items.map((article)=>{
      const key=articleKey(article);
      const selected=state.selected.has(key);
      const url=articleUrl(article);
      const category=categoryOf(article);
      const recommendation=article.analysis?.recommendation||"검토 대기";
      const reason=article.analysis?.recommendationReason||"분석 결과가 아직 없습니다.";
      const duplicateCount=Number(article.eventGroup?.duplicateCount||0);
      return `<article class="news-card ${selected?"selected":""}" data-key="${escapeHtml(key)}">
        <div class="card-top">
          <div class="meta"><span>${escapeHtml(sourceName(article))}</span><span>${escapeHtml(dateLabel(publishedAt(article)))}</span>${duplicateCount?`<span>동일 사건 보도 ${duplicateCount+1}건</span>`:""}</div>
          <button class="${selected?"primary":""}" data-action="select" type="button">${selected?"선택됨":"보고서 선택"}</button>
        </div>
        <h3>${url?`<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(koTitle(article))}</a>`:escapeHtml(koTitle(article))}</h3>
        <p class="arabic-title" lang="ar">${escapeHtml(arTitle(article))}</p>
        <p class="preview">${escapeHtml(preview(article))}</p>
        <div class="badges"><span class="badge ${escapeHtml(categoryBadgeClass(category))}">${escapeHtml(categoryLabel(category))}</span><span class="badge">${escapeHtml(recommendation)}</span>${duplicateCount?`<span class="badge">중복 묶음</span>`:""}</div>
        <p class="preview"><strong>추천 사유</strong> ${escapeHtml(reason)}</p>
        <div class="card-actions">
          ${url?`<a href="${escapeHtml(url)}" target="_blank" rel="noopener">대표 아랍어 원문</a>`:`<span class="badge disabled">원문 URL 미확보</span>`}
          <button data-action="translation" type="button" disabled>전체 번역 보기</button>
        </div>
        ${relatedSourcesHtml(article)}
      </article>`;
    }).join("");
  }
  function apply(){updateCounts();render();}
  async function init(){
    try{
      const stamp=Date.now();
      const [articleResponse,groupResponse]=await Promise.all([
        fetch(`./data/articles.json?v=${stamp}`,{cache:"no-store"}),
        fetch(`./data/event-groups.json?v=${stamp}`,{cache:"no-store"})
      ]);
      if(!articleResponse.ok) throw new Error(`articles HTTP ${articleResponse.status}`);
      const payload=await articleResponse.json();
      state.articles=Array.isArray(payload)?payload:(payload.articles||[]);
      if(groupResponse.ok){
        const groupPayload=await groupResponse.json();
        state.groups=new Map((groupPayload.groups||[]).map((group)=>[group.groupId,group]));
      }
      $("updatedAt").textContent=payload.generatedAt?`최종 업데이트 ${dateLabel(payload.generatedAt)}`:"초기 구조 준비 완료";
    }catch(error){
      $("updatedAt").textContent="데이터 로드 실패";
      console.error(error);
    }
    apply();
  }
  document.querySelectorAll(".summary-card").forEach((button)=>button.addEventListener("click",()=>{
    state.filter=button.dataset.filter;
    document.querySelectorAll(".summary-card").forEach((item)=>item.classList.toggle("active",item===button));
    apply();
  }));
  ["periodFilter","sortOrder","sourceFilter","translationFilter"].forEach((id)=>$(id).addEventListener("change",apply));
  $("searchInput").addEventListener("input",apply);
  $("resetFilters").addEventListener("click",()=>{
    $("periodFilter").value="14";
    $("sortOrder").value="newest";
    $("sourceFilter").value="all";
    $("translationFilter").value="all";
    $("searchInput").value="";
    state.filter="all";
    document.querySelectorAll(".summary-card").forEach((item)=>item.classList.toggle("active",item.dataset.filter==="all"));
    apply();
  });
  document.addEventListener("click",(event)=>{
    const button=event.target.closest("button[data-action='select']");
    if(!button) return;
    const card=button.closest(".news-card");
    const key=card?.dataset.key;
    if(!key) return;
    state.selected.has(key)?state.selected.delete(key):state.selected.add(key);
    apply();
  });
  init();
})();
