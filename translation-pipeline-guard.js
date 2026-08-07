(()=>{
  const originalFetch=window.fetch.bind(window);
  const PIPELINE_VERSION="FULL_TRANSLATION_V1";
  window.fetch=async(...args)=>{
    const response=await originalFetch(...args);
    const url=String(args[0]||"");
    if(!/\/data\/articles\.json(?:\?|$)/.test(url)) return response;
    try{
      const payload=await response.clone().json();
      const articles=Array.isArray(payload)?payload:payload.articles;
      if(Array.isArray(articles)){
        for(const article of articles){
          const translation=article?.translation;
          if(!translation||String(translation.pipelineVersion||"")===PIPELINE_VERSION) continue;
          article.translation={
            status:"PENDING",
            translationStatus:"PENDING",
            pipelineVersion:PIPELINE_VERSION,
            titleKo:"",
            fullTextKo:"",
            resetReason:"LEGACY_TRANSLATION_HIDDEN_IN_BROWSER"
          };
        }
      }
      return new Response(JSON.stringify(payload),{status:response.status,statusText:response.statusText,headers:response.headers});
    }catch{return response;}
  };
})();
