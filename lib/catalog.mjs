import {batch,scripts} from '../config/script-catalog.mjs';

export function catalogScripts(productProfile){
  return scripts.map(s=>({
    id:`${batch.id}-${s.code}`,code:s.code,line:s.line,createdAt:'2026-10-12T00:00:00+08:00',mode:'agent',version:1,parentId:null,reviewId:null,themeId:null,
    productSnapshot:structuredClone(productProfile),
    input:{productLine:{name:s.line,details:productProfile[`track${s.line}`]},researchHypothesis:s.hypothesis,author:batch.author,batchId:batch.id},
    result:{
      title:`${s.code} · ${s.title}`,angle:s.angle,structure:s.structure,format:s.format,targetAudience:s.audience,
      researchBasis:batch.basis,audienceHypothesis:s.hypothesis,sourceDocuments:batch.sources,sourceProductFacts:s.facts.map(key=>batch.facts[key]),sourceCommentIds:[],sourceVideoIds:[],
      shots:s.shots.map(([seconds,voice,visual,overlay,purpose])=>({seconds,voice,visual,overlay,purpose})),
      critique:{strengths:[s.angle,`购买疑虑：${s.objection}`,`回应方式：${s.response}`],weaknesses:[s.unresolved,'痛点来自产品资料推导，尚未用真实评论及投放验证。'],nextTest:`只改${s.test[0]}。A：${s.test[1]} B：${s.test[2]}。主要观察${s.test[3]}，同时检查${s.test[4]}；保持人群、预算、周期和承接页一致。`},
      evidenceGaps:s.proof.map(x=>`拍摄前核实并备齐：${x}`),status:'Agent 成稿 · 待素材核验与投放测试',
    }
  }));
}
export function mergeCatalog(state,productProfile){
  const existing=new Set(state.scripts.map(s=>s.id));
  state.scripts.push(...catalogScripts(productProfile).filter(s=>!existing.has(s.id)));
  return state;
}
