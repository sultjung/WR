(()=>{
  const originalFetch=window.fetch.bind(window);
  const normalize=(value="")=>String(value).replace(/[\u064B-\u065F\u0670]/g,"").replace(/\u0640/g,"").replace(/[إأآٱ]/g,"ا").replace(/ى/g,"ي").replace(/ة/g,"ه").replace(/\s+/g," ").trim();
  const hasAny=(text,terms)=>{const value=normalize(text);return terms.some((term)=>value.includes(normalize(term)));};
  const count=(text,terms)=>{const value=normalize(text);return terms.reduce((sum,term)=>sum+(value.includes(normalize(term))?1:0),0);};
  const clamp=(value)=>Math.max(0,Math.min(100,Math.round(value)));
  const record=(article)=>article.article&&typeof article.article==="object"?article.article:article;
  const category=(article)=>String(article.analysis?.category||article.category||record(article).category||"").toLowerCase();
  const textOf=(article)=>{
    const item=record(article);
    return [item.originalTitleArabic,article.originalTitleArabic,item.descriptionArabic,article.descriptionArabic,item.originalTextArabic,article.originalTextArabic,article.translation?.titleKo,article.translation?.previewKo,article.translation?.fullTextKo].filter(Boolean).join("\n");
  };
  const sourceOf=(article)=>`${article.sourceArabic||""} ${article.source?.arabicName||""}`;
  const urlOf=(article)=>record(article).articleUrl||article.articleUrl||"";
  const bodyOf=(article)=>record(article).originalTextArabic||article.originalTextArabic||"";
  const decisions=["قرار","قرارات","توجيه","توجيهات","تصويت","قانون","مرسوم","اتفاق","مذكرة تفاهم","تنفيذ","تخصيص","تمويل","إقالة","إعفاء","تعيين","استقالة"];
  const reliable=["وكالة الأنباء العراقية","واع","مجلس الوزراء","مجلس النواب","رئاسة الوزراء","البنك المركزي العراقي","شفق نيوز","السومرية","شبكة 964","الجزيرة","رويترز","فرانس برس","أسوشيتد برس","CNN Arabic","Kurdistan24"];
  function sourceScore(article,text){const source=sourceOf(article);if(hasAny(`${source}\n${text}`,["بيان رسمي","أعلن مكتب رئيس الوزراء","ذكرت الدائرة الإعلامية"]))return 10;if(hasAny(source,reliable))return 8;if(urlOf(article)&&bodyOf(article).length>=500)return 6;if(urlOf(article))return 4;return 1;}
  function calculate(article){
    const text=textOf(article),cat=category(article),reliability=sourceScore(article,text);let score=reliability;
    if(cat==="bismayah"){
      const b=hasAny(text,["بسماية","مدينة بسماية الجديدة","مشروع بسماية"]),h=hasAny(text,["شركة هانوا","هانوا","Hanwha"]),n=hasAny(text,["الهيئة الوطنية للاستثمار","رئيس الهيئة الوطنية للاستثمار"]),business=count(text,["استئناف المشروع","استكمال المشروع","العقد","مستحقات","دفعات","تمويل","ضمان","تنفيذ","وحدات سكنية","تسليم","صيانة"]);
      score+=(b&&h?50:b&&n?47:b?42:h&&n?38:n?25:0)+Math.min(25,business*5+(hasAny(text,["رئيس الوزراء","مجلس الوزراء","مكتب رئيس الوزراء"])?5:0))+Math.min(15,(hasAny(text,decisions)?8:2)+(business>=2?7:2));
    }else if(cat==="politics"){
      const national=["رئيس الوزراء","مجلس الوزراء","مجلس النواب","المحكمة الاتحادية","رئاسة الجمهورية","الإطار التنسيقي"],senior=["وزير","رئيس الهيئة الوطنية للاستثمار","محافظ البنك المركزي","رئيس مجلس النواب"],policy=["تشكيل الحكومة","التشكيلة الوزارية","الموازنة","قانون الاستثمار","عقد حكومي","مكافحة الفساد","حصر السلاح","إقالة","تعيين"];
      score+=hasAny(text,national)&&hasAny(text,policy)?40:hasAny(text,national)&&hasAny(text,decisions)?34:hasAny(text,senior)&&hasAny(text,decisions)?28:hasAny(text,national)?20:hasAny(text,senior)?12:5;
      score+=Math.min(20,count(text,["الهيئة الوطنية للاستثمار","مشاريع الإسكان","العقود الاستثمارية","الاستثمار الأجنبي","شركة أجنبية","بسماية"])*5);
      score+=Math.min(20,count(text,["أزمة","احتجاجات","انقسام","استقالة","إقالة","تصويت","حكومة جديدة","حل البرلمان","فساد"])*4+(hasAny(text,decisions)?5:0));
      score+=Math.min(10,(hasAny(text,decisions)?7:3));
    }else if(cat==="economy"){
      const housing=["مشروع سكني","مشاريع سكنية","وحدات سكنية","مدن جديدة","مدينة سكنية","الإسكان","بسماية"],investment=["استثمار","عقد","عقود","مستثمر","قانون الاستثمار","إعفاءات جمركية","تمويل","تحويلات خارجية","ضمانات"],national=["الموازنة","العجز","الدين العام","البنك المركزي","سعر الصرف","النفط","صادرات النفط","الغاز","أوبك","الموانئ","طريق التنمية"];
      score+=Math.min(35,count(text,[...housing,...investment])*4+(hasAny(text,housing)?7:0));
      score+=Math.min(25,count(text,national)*4+(hasAny(text,decisions)?5:0));
      score+=Math.min(20,count(text,["شركة أجنبية","الاستثمار الأجنبي","تحويلات خارجية","الاعتماد المستندي","الكمارك","الضرائب","شركة هانوا"])*5);
      score+=Math.min(10,count(text,["مليار","تريليون","مشروع استراتيجي","مشروع وطني","آلاف الوحدات","اتفاقية دولية"])*3+(hasAny(text,["تنفيذ","بدء","افتتاح","توقيع"])?4:0));
    }else if(cat==="security"){
      score+=Math.min(35,count(text,["إرهاب","إرهابي","داعش","هجوم إرهابي","تفجير","انفجار","عبوة ناسفة","انتحاري","اغتيال","قصف","صاروخ","طائرة مسيرة","اشتباكات مسلحة","خلية إرهابية"])*5+(hasAny(text,["قتل","مقتل","إصابة","جرح","استهداف","هاجم","انفجرت","اعتقال","إحباط"])?8:0));
      score+=hasAny(text,["بسماية","بغداد","مطار بغداد","المدائن","النهروان","طريق بغداد"])?25:hasAny(text,["العراق","العراقي","القوات الأمنية العراقية","الحشد الشعبي","جهاز مكافحة الإرهاب"])?15:0;
      score+=Math.min(15,count(text,["قتلى","جرحى","ضحايا","هجوم واسع","حالة الطوارئ","إغلاق الطرق","تعليق الرحلات"])*4);
      score+=Math.min(15,count(text,["أجانب","شركة أجنبية","سفارة","بعثة دبلوماسية","إجلاء","تحذير أمني"])*5);
    }else if(cat==="international"){
      score+=Math.min(35,count(text,["العراق","الحكومة العراقية","رئيس الوزراء العراقي","بغداد","الحدود العراقية","الأجواء العراقية"])*8+(hasAny(text,decisions)?3:0));
      score+=Math.min(15,count(text,["الولايات المتحدة","أمريكا","إيران","تركيا","السعودية","الكويت","الأردن","سوريا","الإمارات","كوريا","الصين","الأمم المتحدة","أوبك","صندوق النقد الدولي","البنك الدولي"])*5);
      score+=Math.min(25,count(text,["عقوبات","اتفاق","حدود","مياه","غاز","كهرباء","نفط","تجارة","أمن","قصف","تأشيرات","رحلات جوية","طريق التنمية","استثمار"])*4);
      score+=Math.min(15,count(text,["بسماية","شركة هانوا","الهيئة الوطنية للاستثمار","الشركات الكورية","المشاريع السكنية","الاستثمار الأجنبي"])*5);
    }
    if(!urlOf(article))score-=10;if(bodyOf(article).length<100)score-=8;if(article.eventGroup?.isRepresentative===false)score-=15;return clamp(score);
  }
  function hasStoredScore(article){const stored=article.importance||article.analysis?.importance||article.article?.importance;return Number.isFinite(Number(stored?.score??stored?.finalScore??stored?.ruleScore??article.analysis?.importanceScore??article.importanceScore));}
  window.fetch=async(...args)=>{
    const response=await originalFetch(...args);const url=String(args[0]||"");
    if(!/\/data\/articles\.json(?:\?|$)/.test(url))return response;
    try{
      const payload=await response.clone().json();const articles=Array.isArray(payload)?payload:payload.articles;
      if(Array.isArray(articles))for(const article of articles){if(!hasStoredScore(article))article.importance={score:calculate(article),scoringMethod:"CATEGORY_RULES_BROWSER_FALLBACK",scoredAt:new Date().toISOString()};}
      return new Response(JSON.stringify(payload),{status:response.status,statusText:response.statusText,headers:response.headers});
    }catch{return response;}
  };
})();
