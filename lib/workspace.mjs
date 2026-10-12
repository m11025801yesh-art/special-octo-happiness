import { emptyState, demoState, importComments, ruleThemes, themeStats, structureStats, buildReview, templateScript, required, text, safeUrl, id, now, InputError } from './domain.mjs';
import { providers, chat, cluster, analyzeVideo, mapProduct, generateScript } from './ai.mjs';

// Shared state machine for the cloud server and the downloadable browser edition.
export function createWorkspace({initial=emptyState(),persist=()=>{},environmentKey=()=>'',environmentProvider='deepseek',localMode=false}={}) {
let state=structuredClone(initial),sessionKey='',sessionProvider=null,busy=false;
function save(){ persist(structuredClone(state)); }
function aiKey(){ return sessionProvider===state.settings.provider ? sessionKey : state.settings.provider===environmentProvider ? environmentKey() : ''; }
function publicState(){ return structuredClone({...state,localMode,stats:{themes:themeStats(state),structures:structureStats(state.videos)},ai:{configured:Boolean(aiKey()),busy,keySource:sessionProvider===state.settings.provider ? (localMode?'当前网页会话':'当前服务进程') : aiKey()?'环境变量':'未连接',providers:Object.entries(providers).map(([key,p])=>({key,name:p.name,model:p.model}))}}); }
function scriptItem(result,body,extra={}) {
  const parent = state.scripts.find(s=>s.id===body.parentId);
  return { id:id(),createdAt:now(),mode:body.mode || 'template',line:body.line||null,version:parent ? parent.version+1 : 1,parentId:parent?.id || null,reviewId:body.reviewId || null,themeId:body.themeId,result,productSnapshot:structuredClone(state.product),...extra };
}
async function mutate(route,b) {
  if (route === '/api/product') {
    const product = {};
    for (const field of ['name','audience','price','delivery','features','evidence','boundaries','trackA','trackB','trackC','cta']) product[field] = text(b[field],field==='name'?200:12000);
    product.name = required(product.name,'产品名称',200); state.product = product; state.mappings=[];
  } else if (route === '/api/comments') {
    const result=importComments(state,b); state.mappings=[]; save(); return { ...result,state:publicState() };
  } else if (route === '/api/themes/rules') {
    if (!state.comments.length) throw new InputError('请先导入评论');
    state.themes=ruleThemes(state.comments); state.mappings=[];
  } else if (route === '/api/themes/manual') {
    const commentIds = b.commentIds;
    if (!Array.isArray(commentIds) || !commentIds.length || commentIds.some(x=>!state.comments.some(c=>c.id===x))) throw new InputError('请选择有效原始评论');
    const theme = { id:id(),label:required(b.label,'主题名称',120),need:required(b.need,'需求解释',2000),keywords:[],commentIds:[...new Set(commentIds)],method:'人工归类',createdAt:now() };
    state.themes.push(theme); state.mappings=[];
  } else if (route === '/api/videos') {
    state.videos.push({id:id(),title:required(b.title,'视频标题',200),category:text(b.category,100),source:text(b.source,200),url:safeUrl(b.url),transcript:required(b.transcript,'视频逐字稿',30000),visualNotes:text(b.visualNotes,10000),performance:text(b.performance,4000),structure:text(b.structure,1000),style:text(b.style,2000),analysis:null,createdAt:now()});
  } else if (route === '/api/competitors') {
    state.competitors.push({id:id(),name:required(b.name,'竞品名称',200),url:safeUrl(b.url),features:required(b.features,'竞品卖点与演示方法',12000),evidence:text(b.evidence,10000),createdAt:now()}); state.mappings=[];
  } else if (route === '/api/mappings/manual') {
    if (!state.themes.some(t=>t.id===b.themeId)) throw new InputError('请选择有效痛点');
    if (!['直接对应','部分对应','缺少能力'].includes(b.fit)) throw new InputError('请选择对应程度');
    const m={id:id(),themeId:b.themeId,fit:b.fit,createdAt:now(),method:'人工评估'};
    for(const k of ['feature','mechanism','demonstration','evidence','gap','competitorLearning']) m[k]=text(b[k],8000);
    required(m.mechanism,'解决机制'); state.mappings=state.mappings.filter(x=>x.themeId!==b.themeId); state.mappings.push(m);
  } else if (route === '/api/scripts/template') {
    const result=templateScript(state,b); state.scripts.push(scriptItem(result,{...b,mode:'template'}));
  } else if (route === '/api/scripts/edit') {
    const original=state.scripts.find(s=>s.id===b.id);
    if (!original) throw new InputError('脚本不存在');
    if (!Array.isArray(b.voices) || b.voices.length!==original.result.shots.length) throw new InputError('分镜数量不匹配');
    const result=structuredClone(original.result);
    result.title=required(b.title,'脚本标题',200);
    result.shots.forEach((shot,i)=>{shot.voice=required(b.voices[i],'口播台词',4000);});
    result.status='人工修改 · 待核验';
    state.scripts.push(scriptItem(result,{mode:'manual',parentId:original.id,themeId:original.themeId},{productSnapshot:structuredClone(original.productSnapshot),line:original.line||original.input?.productLine?.name||null,input:original.input?structuredClone(original.input):undefined}));
  } else if (route === '/api/reviews') {
    state.reviews.push(buildReview(b,state.scripts));
  } else if (route === '/api/settings') {
    if (!providers[b.provider]) throw new InputError('不支持的 AI 服务商');
    const model = required(b.model,'模型名称',200);
    if (!/^[\w./:-]+$/.test(model)) throw new InputError('模型名称格式不正确');
    state.settings={provider:b.provider,model};
    if (b.key) { sessionKey=required(b.key,'API 密钥',1000); sessionProvider=b.provider; }
    if (b.clearKey) { sessionKey=''; sessionProvider=null; }
  } else if (route === '/api/demo') {
    if (state.product.name || state.comments.length || state.videos.length || state.scripts.length) throw new InputError('示例只可载入空工作台，避免覆盖你的资料');
    const settings=state.settings; state=demoState(); state.settings=settings;
  } else if (route === '/api/delete') {
    if (!['comments','videos','competitors','themes'].includes(b.collection)) throw new InputError('不支持删除该类资料');
    const item=state[b.collection].find(x=>x.id===b.id);
    if (!item) throw new InputError('资料不存在');
    const referenced=state.scripts.some(s => b.collection==='comments' ? s.result.sourceCommentIds.includes(b.id) : b.collection==='videos' ? s.result.sourceVideoIds.includes(b.id) : false);
    if (referenced) throw new InputError('这条素材已被脚本引用，请保留作为来源');
    state[b.collection]=state[b.collection].filter(x=>x.id!==b.id);
    if (b.collection==='comments') state.themes=state.themes.map(t=>({...t,commentIds:t.commentIds.filter(x=>x!==b.id)})).filter(t=>t.commentIds.length);
    state.mappings=[];
  } else throw new InputError('未知操作');
  save(); return { state:publicState() };
}
async function runAI(route,b) {
  const call=(task,payload)=>chat(state.settings,aiKey(),task,payload);
  if (route === '/api/ai/test') { const result=await call('仅返回 {"ok":true}',{}); if (result.ok!==true) throw new InputError('模型未返回预期结果'); return { message:'连接成功，模型可以正常返回 JSON' }; }
  if (route === '/api/ai/themes') { state.themes=await cluster(state,call); state.mappings=[]; }
  else if (route === '/api/ai/video') {
    const video=state.videos.find(v=>v.id===b.id); if (!video) throw new InputError('视频不存在');
    video.analysis=await analyzeVideo(video,call);
  } else if (route === '/api/ai/mappings') { state.mappings=await mapProduct(state,call); }
  else if (route === '/api/ai/script') {
    if (!['create','rewrite','iterate'].includes(b.mode)) throw new InputError('脚本模式不正确');
    text(b.direction,6000); text(b.duration,100);
    const output=await generateScript(state,b,call);
    state.scripts.push(scriptItem(output.result,b,{attempts:output.attempts,audit:output.audit,input:output.input}));
  } else throw new InputError('未知 AI 操作');
  save(); return {state:publicState()};
}

return {
 getState:publicState,
 exportState:()=>structuredClone({...state,exportedAt:now()}),
 async request(route,body){
  if(busy) throw new InputError('AI 正在分析，请等待完成后再保存资料');
  const before=structuredClone(state),beforeKey=sessionKey,beforeProvider=sessionProvider;
  busy=true;
  try { return route.startsWith('/api/ai/') ? await runAI(route,body) : await mutate(route,body); }
  catch(error){ state=before;sessionKey=beforeKey;sessionProvider=beforeProvider;throw error; }
  finally{ busy=false; }
 }
};
}
