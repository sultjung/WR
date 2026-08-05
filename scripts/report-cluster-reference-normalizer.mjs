const SECTION_NAMES=["politicsItems","securityItems","economyItems","internationalItems"];

function compact(value=""){return String(value).replace(/\s+/g," ").trim();}

function uniqueClusterIds(value){
  return [...new Set(Array.isArray(value)?value.map((id)=>String(id||"").trim()).filter(Boolean):[])];
}

function allowedSectionsOf(cluster={}){
  return Array.isArray(cluster.allowedSections)&&cluster.allowedSections.length
    ? [...new Set(cluster.allowedSections)]
    : [cluster.targetSection].filter(Boolean);
}

function occurrenceRank(occurrence,cluster){
  const clusterCount=uniqueClusterIds(occurrence.item.clusterIds).length;
  const targetPenalty=occurrence.section===cluster.targetSection?0:1;
  const sectionOrder=SECTION_NAMES.indexOf(occurrence.section);
  return [clusterCount,targetPenalty,sectionOrder<0?99:sectionOrder,occurrence.itemIndex];
}

function compareRanks(left,right){
  const length=Math.max(left.length,right.length);
  for(let index=0;index<length;index+=1){
    const delta=(left[index]??0)-(right[index]??0);
    if(delta) return delta;
  }
  return 0;
}

export function normalizeReportClusterReferences(content,reportInput,logger=console){
  const result=content&&typeof content==="object"?content:{};
  const clusters=Array.isArray(reportInput?.reportClusters)?reportInput.reportClusters:[];
  const clusterMeta=new Map(clusters.map((cluster)=>[cluster.clusterId,cluster]));
  const occurrences=new Map();

  for(const section of SECTION_NAMES){
    const items=Array.isArray(result[section])?result[section]:[];
    result[section]=items;
    for(let itemIndex=0;itemIndex<items.length;itemIndex+=1){
      const item=items[itemIndex]||{};
      const ids=uniqueClusterIds(item.clusterIds);
      item.clusterIds=ids;
      for(const clusterId of ids){
        if(!clusterMeta.has(clusterId)) continue;
        if(!occurrences.has(clusterId)) occurrences.set(clusterId,[]);
        occurrences.get(clusterId).push({section,item,itemIndex});
      }
    }
  }

  const keeperByCluster=new Map();
  for(const [clusterId,candidates] of occurrences){
    const cluster=clusterMeta.get(clusterId);
    const allowed=new Set(allowedSectionsOf(cluster));
    const valid=candidates.filter((candidate)=>allowed.has(candidate.section));
    if(!valid.length) continue;
    valid.sort((left,right)=>compareRanks(occurrenceRank(left,cluster),occurrenceRank(right,cluster)));
    keeperByCluster.set(clusterId,valid[0]);
  }

  for(const section of SECTION_NAMES){
    const sanitized=[];
    for(let itemIndex=0;itemIndex<result[section].length;itemIndex+=1){
      const item=result[section][itemIndex];
      const originalIds=uniqueClusterIds(item.clusterIds);
      const keptIds=[];
      for(const clusterId of originalIds){
        const keeper=keeperByCluster.get(clusterId);
        if(keeper&&keeper.section===section&&keeper.item===item){
          keptIds.push(clusterId);
          continue;
        }
        const cluster=clusterMeta.get(clusterId);
        const reason=!cluster
          ? "unknown-cluster"
          : !allowedSectionsOf(cluster).includes(section)
            ? `section-not-allowed:${section}`
            : "duplicate-reference";
        logger.warn?.(`[weekly-report-ai] removed ${reason} ${clusterId} from ${section}: ${compact(item.headline)}`);
      }
      item.clusterIds=keptIds;
      if(keptIds.length){
        sanitized.push(item);
      }else{
        logger.warn?.(`[weekly-report-ai] dropped empty item from ${section}: ${compact(item.headline)}`);
      }
    }
    result[section]=sanitized;
  }

  return result;
}
