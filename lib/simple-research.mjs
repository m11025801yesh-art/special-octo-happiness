import {id,required,InputError,themeStats,structureStats} from './domain.mjs';
import {cluster,analyzeVideo,mapProduct} from './ai.mjs';

export function researchSnapshot(input,state={}){
 const comments=structuredClone((state.comments||[]).slice(-250));
 const seen=new Set();
 const pasted=(input.references?input.references.split(/\n\s*(?:---+|===+)\s*\n/).map(s=>s.trim()).filter(Boolean):[]).filter(t=>{const key=t.replace(/\s/g,'');if(seen.has(key))return false;seen.add(key);return true;});
 if(pasted.length>5)throw new InputError('每次最多分析 5 条参考视频，请减少参考文案');
 const videos=pasted.map((transcript,i)=>({id:id(),title:`本次参考 ${i+1}`,transcript,source:'本次粘贴',url:'',category:'未标注',visualNotes:'',performance:'',structure:'',style:'',analysis:null}));
 const normalized=new Set(pasted.map(t=>t.replace(/\s/g,'')));
 for(const v of [...(state.videos||[])].reverse()){
  if(videos.length===5)break;
  if(v.transcript?.trim()&&!normalized.has(v.transcript.replace(/\s/g,''))){videos.push(structuredClone(v));normalized.add(v.transcript.replace(/\s/g,''));}
 }
 // Only the product typed for this task is authoritative; do not merge old product claims.
 return {product:{name:'本次产品',features:input.product,delivery:input.product,audience:input.requirements},comments,videos,competitors:structuredClone((state.competitors||[]).slice(-10)),themes:[],mappings:[],videoIndex:0,strategyIndex:0,strategies:[],questions:[],externalCollection:'未接入平台自动采集；频次仅代表本次提供的样本。'};
}
export function researchStats(research){
 const keywords=new Map();
 for(const t of research.themes){
  if(t.label==='待人工归类')continue;
  for(const word of new Set(t.keywords||[])){
   // Count exact mentions in unique comments, never model-supplied frequencies.
   const ids=new Set(research.comments.filter(c=>word&&c.text.includes(word)).map(c=>c.id));
   if(ids.size)keywords.set(word,{label:word,count:ids.size,commentIds:[...ids]});
  }
 }
 return {themes:themeStats(research),keywords:[...keywords.values()].sort((a,b)=>b.count-a.count),structures:structureStats(research.videos)};
}
export function nextResearchStage(r){return r.comments.length?'themes':r.videos.length?'video':'strategy';}
export async function runResearchStep(task,call){
 const r=task.research;
 if(task.stage==='themes'){
  r.themes=await cluster(r,call);task.stage=r.videos.length?'video':'mappings';
 }else if(task.stage==='video'){
  const v=r.videos[r.videoIndex];v.analysis=await analyzeVideo(v,call);r.videoIndex++;
  task.stage=r.videoIndex<r.videos.length?'video':r.themes.some(t=>t.label!=='待人工归类')?'mappings':'strategy';
 }else if(task.stage==='mappings'){
  const usable=r.themes.filter(t=>t.label!=='待人工归类');
  r.mappings=usable.length?await mapProduct({...r,themes:usable},call):[];
  if(usable.some(t=>r.mappings.filter(m=>m.themeId===t.id).length!==1))throw new InputError('产品对应分析缺少主题或重复，请重试');
  task.stage='strategy';
 }else{
  const backtrack=task.stage==='rethink';
  const index=backtrack?task.index:(r.strategyIndex||0);
  const slots=[{index,angle:task.learning.angles[index]}];
  const out=await call(`融合调研：${backtrack?'上一稿未能打动目标用户，请回到人群痛点、产品匹配、竞品演示和参考结构重新诊断，再安排当前脚本；不是只润色措辞。':'依据产品、需求和真实样本统计安排创作策略。'}优先考虑频次高且适配产品的痛点与结构，不能把高频等同有效。无评论时用标注的需求假设，themeId 为空；有相关已归类主题时从其ID选择，不相关则留空并解释。部分对应必须明确边界；缺少产品能力不能用改写掩盖。研究已提供的竞品，借鉴演示方法，不得复制竞品功能作为自己的权益。无竞品或证据不足时列出具体待补调研问题，不能声称已经外部搜索。按 slots 顺序返回每项 {"strategies":[{"index":0,"themeId":"主题ID或空字符串","videoId":"参考ID或空字符串","featureQuote":"本次产品原文连续引文","fit":"直接对应|部分对应|缺少能力","angle":"新颖且具体的切入观点","mechanism":"痛点如何对应产品，以及边界","demonstration":"输入、操作、输出的可拍演示","rationale":"选择依据，区分频次观察和假设","competitorIds":["确实参考的竞品ID"],"researchQuestions":["还需要补的调研资料"]}]}。`,{product:task.input.product,requirements:task.input.requirements,learning:task.learning,stats:researchStats(r),comments:r.comments,mappings:r.mappings,videos:r.videos,competitors:r.competitors,slots,previousStrategy:backtrack?r.strategies[task.index]:null,previousDraft:backtrack?task.draft:null,audit:task.audit,performanceReview:task.feedback?.review||null});
  if(!Array.isArray(out.strategies)||out.strategies.length!==slots.length)throw new InputError('创作策略数量不完整');
  const strategies=out.strategies.map((s,i)=>{
   if(s.index!==slots[i].index||typeof s.themeId!=='string'||typeof s.videoId!=='string'||(s.themeId&&!r.themes.some(t=>t.id===s.themeId&&t.label!=='待人工归类'))||(s.videoId&&!r.videos.some(v=>v.id===s.videoId))||!['直接对应','部分对应','缺少能力'].includes(s.fit))throw new InputError('策略包含无效主题、视频或对应关系');
   for(const key of ['featureQuote','angle','mechanism','demonstration','rationale'])required(s[key],'创作策略字段',4000);
   if(!task.input.product.includes(s.featureQuote))throw new InputError('策略引用了产品原文中不存在的能力');
   if(!Array.isArray(s.competitorIds)||s.competitorIds.some(x=>!r.competitors.some(c=>c.id===x)))throw new InputError('策略引用了不存在的竞品');
   if(!Array.isArray(s.researchQuestions)||s.researchQuestions.length>20)throw new InputError('调研问题格式不完整');
   s.researchQuestions=s.researchQuestions.map(q=>required(q,'调研问题',2000));
   if(s.themeId&&r.mappings.some(m=>m.themeId===s.themeId&&m.fit==='缺少能力'))s.fit='缺少能力';
   return s;
  });
  for(const s of strategies)r.strategies[s.index]=s;
  r.questions=[...new Set([...r.questions,...strategies.flatMap(s=>s.researchQuestions)])];
  task.history.push({index:backtrack?task.index:-1,revision:task.revision,label:backtrack?'回溯痛点、匹配与参考结构':'研究后的创作策略',strategies:structuredClone(strategies)});
  if(strategies.some(s=>s.fit==='缺少能力')){
   r.questions=[...new Set([...r.questions,'补充与所选痛点对应的真实产品能力或更换目标痛点，再创建新一轮创作。'])];task.stage='blocked';task.status='needs_materials';
  }else if(backtrack)task.stage='revise';
  else{r.strategyIndex=index+1;task.stage=r.strategyIndex<task.learning.count?'strategy':'draft';}
 }
}
