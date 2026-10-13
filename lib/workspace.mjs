import { emptyState, demoState, importComments, ruleThemes, themeStats, structureStats, buildReview, templateScript, required, text, safeUrl, videoInput, id, now, InputError } from './domain.mjs';
import { providers, chat, cluster, analyzeVideo, mapProduct, generateScript } from './ai.mjs';
import { agentReadiness, createAgentTask, advanceAgent, taskSummary } from './agent.mjs';
import { createSimpleTask, advanceSimpleTask } from './simple-agent.mjs';

// Shared state machine for the cloud server and the downloadable browser edition.
export function createWorkspace({initial=emptyState(),persist=()=>{},environmentKey=()=>'',environmentProvider='deepseek',localMode=false,modelCall}={}) {
let state=structuredClone(initial),sessionKey='',sessionProvider=null,busy=false;
state.agentTasks ??= [];
state.simpleTasks ??= [];
function save(){ persist(structuredClone(state)); }
function aiKey(){ return sessionProvider===state.settings.provider ? sessionKey : state.settings.provider===environmentProvider ? environmentKey() : ''; }
function publicState(){ return structuredClone({...state,agentTasks:state.agentTasks.map(taskSummary),agentReadiness:agentReadiness(state,Boolean(aiKey())),localMode,stats:{themes:themeStats(state),structures:structureStats(state.videos)},ai:{configured:Boolean(aiKey()),busy,keySource:sessionProvider===state.settings.provider ? (localMode?'当前网页会话':'当前服务进程') : aiKey()?'环境变量':'未连接',providers:Object.entries(providers).map(([key,p])=>({key,name:p.name,model:p.model}))}}); }
function scriptItem(result,body,extra={}) {
  const parent = state.scripts.find(s=>s.id===body.parentId);
  return { id:id(),createdAt:now(),mode:body.mode || 'template',line:body.line||null,version:parent ? parent.version+1 : 1,parentId:parent?.id || null,reviewId:body.reviewId || null,themeId:body.themeId,result,productSnapshot:structuredClone(state.product),...extra };
}
async function mutate(route,b) {
  if (route === '/api/simple/create') {
    if(state.simpleTasks.length>=20)throw new InputError('当前已保留 20 批创作，请先使用已有结果');
    const task=createSimpleTask(b);state.simpleTasks.push(task);save();return {state:publicState(),taskId:task.id};
  } else if (route === '/api/agent/create') {
    const task=createAgentTask(state,b);state.agentTasks.push(task);save();return {state:publicState(),taskId:task.id};
  } else if (route === '/api/agent/pause') {
    const task=state.agentTasks.find(t=>t.id===b.id);
    if (!task) throw new InputError('Agent 任务不存在');
    if (task.status!=='completed') task.status='paused';
  } else if (route === '/api/product') {
    const product = {};
    for (const field of ['name','audience','price','delivery','features','evidence','boundaries','trackA','trackB','trackC','cta','sourceNotes']) product[field] = text(b[field],field==='name'?200:12000);
    product.sourceUrl=safeUrl(b.sourceUrl);
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
  } else if (route === '/api/videos' || route === '/api/videos/link') {
    const input=videoInput(b);
    if (route==='/api/videos/link') {
      required(input.url,'视频链接');
      if(state.videos.some(v=>v.url===input.url)) return {state:publicState(),message:'这个链接已保存，可在视频库中补充文案'};
    }
    state.videos.push({id:id(),...input,analysis:null,createdAt:now()});
  } else if (route === '/api/videos/update') {
    const original=state.videos.find(v=>v.id===b.id);
    if(!original) throw new InputError('视频资料不存在');
    if(state.scripts.some(s=>s.result.sourceVideoIds.includes(b.id)) || state.agentTasks.some(t=>t.context.videos.some(v=>v.id===b.id))) throw new InputError('该视频已被脚本或 Agent 任务引用，请新建一条资料，保留原始依据');
    Object.assign(original,videoInput({...original,...b}),{analysis:null,updatedAt:now()});
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
    state.scripts.push(scriptItem(result,{mode:'manual',parentId:original.id,themeId:original.themeId},{productSnapshot:structuredClone(original.productSnapshot),line:original.line||original.input?.productLine?.name||null,input:original.input?structuredClone(original.input):undefined,...(original.agentTaskId?{agentTaskId:original.agentTaskId}:{})}));
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
    if (['comments','videos'].includes(b.collection) && state.agentTasks.some(t=>t.context[b.collection].some(x=>x.id===b.id))) throw new InputError('这条素材被 Agent 任务引用，请保留以便核验研究来源');
    state[b.collection]=state[b.collection].filter(x=>x.id!==b.id);
    if (b.collection==='comments') state.themes=state.themes.map(t=>({...t,commentIds:t.commentIds.filter(x=>x!==b.id)})).filter(t=>t.commentIds.length);
    state.mappings=[];
  } else throw new InputError('未知操作');
  save(); return { state:publicState() };
}
async function runAI(route,b) {
  const call=modelCall || ((task,payload)=>chat(state.settings,aiKey(),task,payload));
  if(route==='/api/ai/simple-step'){
    let task=state.simpleTasks.find(t=>t.id===b.id);
    if(!task)throw new InputError('创作任务不存在');
    if(!Number.isInteger(b.cursor)||b.cursor<0||b.cursor>task.cursor)throw new InputError('创作进度不匹配，请刷新');
    if(b.cursor<task.cursor||task.stage==='done')return {state:publicState(),done:task.stage==='done'};
    if(!aiKey()&&!modelCall)throw new InputError('首次使用请先连接 AI；你填写的资料已保存，连接后可以继续');
    const previous=structuredClone(task);
    try{const output=await advanceSimpleTask(task,call);if(output.script)state.scripts.push(output.script);}
    catch(error){task=previous;task.status='failed';task.error=error instanceof InputError?error.message:'这一步未完成，已保存此前结果，可以继续';state.simpleTasks[state.simpleTasks.findIndex(t=>t.id===task.id)]=task;}
    save();return {state:publicState(),done:task.stage==='done',taskError:task.error||''};
  }
  if (route === '/api/ai/agent-step') {
    let task=state.agentTasks.find(t=>t.id===b.id);
    if (!task) throw new InputError('Agent 任务不存在');
    const step=task.steps.find(s=>s.id===b.stepId);
    if (!step) throw new InputError('Agent 步骤不存在，请刷新任务');
    if (step.status==='completed') return {state:publicState(),done:task.status==='completed'};
    if (task.steps.find(s=>s.status!=='completed')?.id!==step.id) throw new InputError('请按顺序执行 Agent 步骤');
    if (!aiKey() && !modelCall) throw new InputError('请先在 AI 连接中配置并测试模型，再启动任务');
    const beforeTask=structuredClone(task);
    try {
      step.attempts++; task.status='pending';
      const output=await advanceAgent(task,call);
      if(output.script) state.scripts.push(output.script);
    } catch(error) {
      task=beforeTask;
      const failed=task.steps.find(s=>s.id===step.id);
      failed.attempts++;failed.status='failed';
      task.status='failed';task.error=error instanceof InputError?error.message:'本步骤未完成，请重试；此前步骤与成稿已保留';
      state.agentTasks[state.agentTasks.findIndex(t=>t.id===task.id)]=task;
    }
    save();return {state:publicState(),done:task.status==='completed',taskError:task.error||''};
  }
  if (route === '/api/ai/test') { const result=await call('仅返回 {"ok":true}',{}); if (result.ok!==true) throw new InputError('模型未返回预期结果'); return { message:'连接成功，模型可以正常返回 JSON' }; }
  if (route === '/api/ai/themes') { state.themes=await cluster(state,call); state.mappings=[]; }
  else if (route === '/api/ai/video') {
    const video=state.videos.find(v=>v.id===b.id); if (!video) throw new InputError('视频不存在');
    video.analysis=await analyzeVideo(video,call);
  } else if (route === '/api/ai/mappings') { state.mappings=await mapProduct(state,call); }
  else if (route === '/api/ai/script') {
    if (!['create','rewrite','iterate'].includes(b.mode)) throw new InputError('脚本模式不正确');
    text(b.direction,6000); text(b.duration,100);
    const parent=state.scripts.find(s=>s.id===b.parentId);
    const origin=state.agentTasks.find(t=>t.id===parent?.agentTaskId);
    const source=origin?{...origin.context,scripts:state.scripts,reviews:state.reviews}:state;
    const output=await generateScript(source,b,call);
    state.scripts.push(scriptItem(output.result,b,{attempts:output.attempts,audit:output.audit,input:output.input,productSnapshot:structuredClone(source.product),...(origin?{agentTaskId:origin.id}:{})}));
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
