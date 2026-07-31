(()=>{
  const tierOf=(score)=>{
    if(score>=90)return "importance-tier-90";
    if(score>=80)return "importance-tier-80";
    if(score>=70)return "importance-tier-70";
    if(score>=60)return "importance-tier-60";
    if(score>=40)return "importance-tier-40";
    return "importance-tier-low";
  };
  const apply=()=>{
    document.querySelectorAll(".badge.importance-score").forEach((badge)=>{
      const match=badge.textContent.match(/(\d{1,3})/);
      if(!match)return;
      badge.classList.remove("importance-tier-90","importance-tier-80","importance-tier-70","importance-tier-60","importance-tier-40","importance-tier-low");
      badge.classList.add(tierOf(Number(match[1])));
    });
  };
  const observer=new MutationObserver(apply);
  const start=()=>{
    const target=document.getElementById("newsList")||document.body;
    observer.observe(target,{childList:true,subtree:true});
    apply();
  };
  document.readyState==="loading"?document.addEventListener("DOMContentLoaded",start):start();
})();
