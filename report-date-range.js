(()=>{
  const toInputDate=(date)=>{
    const year=date.getFullYear();
    const month=String(date.getMonth()+1).padStart(2,"0");
    const day=String(date.getDate()).padStart(2,"0");
    return `${year}-${month}-${day}`;
  };

  function initReportDateRange(){
    const reportDate=document.getElementById("reportDate");
    const periodStart=document.getElementById("reportStartDate");
    const periodEnd=document.getElementById("reportEndDate");
    if(!reportDate||!periodStart||!periodEnd) return;

    periodStart.readOnly=true;
    periodEnd.readOnly=true;
    periodStart.setAttribute("aria-readonly","true");
    periodEnd.setAttribute("aria-readonly","true");
    periodStart.title="보고일 기준 7일 전으로 자동 설정됩니다.";
    periodEnd.title="보고일 기준 1일 전으로 자동 설정됩니다.";

    const syncRange=()=>{
      const value=String(reportDate.value||"").trim();
      if(!/^\d{4}-\d{2}-\d{2}$/.test(value)){
        periodStart.value="";
        periodEnd.value="";
        return;
      }

      const base=new Date(`${value}T00:00:00`);
      if(Number.isNaN(base.getTime())){
        periodStart.value="";
        periodEnd.value="";
        return;
      }

      const start=new Date(base);
      const end=new Date(base);
      start.setDate(start.getDate()-7);
      end.setDate(end.getDate()-1);
      periodStart.value=toInputDate(start);
      periodEnd.value=toInputDate(end);
    };

    reportDate.addEventListener("change",syncRange);
    reportDate.addEventListener("input",syncRange);
    syncRange();
  }

  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",initReportDateRange,{once:true});
  }else{
    initReportDateRange();
  }
})();
