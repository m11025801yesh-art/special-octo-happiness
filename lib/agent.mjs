import { InputError, required, text, id, now, themeStats, structureStats } from './domain.mjs';
import { cluster, analyzeVideo, mapProduct, generateScript } from './ai.mjs';

// Each step is a separate transaction. Research inputs are frozen at task creation.
export function agentReadiness(state, configured) {
  return [
    { label:'产品资料', ready:Boolean(state.product.name && state.product.features && state.product.delivery), detail:'需要产品名、具体功能和交付内容', page:'product' },
    { label:'真实评论', ready:state.comments.length>0, detail:state.comments.length ? `已导入 ${state.comments.length} 条；每任务分析最近 250 条以内` : '请粘贴真实评论，每行一条；不会编造大盘频次', page:'insights' },
    { label:'AI 连接', ready:configured, detail:configured ? '已配置密钥，执行时仍需服务商接受请求' : '请在 AI 连接中配置并测试；不要把密钥发到聊天里', page:'settings' },
  ];
}

export function createAgentTask(state, body) {
  required(state.product.name,'产品名称'); required(state.product.features,'产品卖点'); required(state.product.delivery,'交付内容');
  if (!state.comments.length) throw new InputError('请先导入真实评论；Agent 不会用虚构痛点生成市场统计');
  const count=Number(body.count ?? 3);
  if (typeof body.count==='boolean' || !Number.isInteger(count) || count<1 || count>20) throw new InputError('每批请生成 1–20 条脚本');
  const lines=body.lines ?? ['A','B','C'];
  if (!Array.isArray(lines) || !lines.length || lines.length>3 || new Set(lines).size!==lines.length || lines.some(x=>!['A','B','C'].includes(x))) throw new InputError('请选择不重复的 A / B / C 创作线');
  const videoIds=body.videoIds ?? [];
  if (!Array.isArray(videoIds) || videoIds.length>5 || new Set(videoIds).size!==videoIds.length || videoIds.some(x=>!state.videos.some(v=>v.id===x))) throw new InputError('最多选择 5 条有效参考视频');
  if (videoIds.some(x=>!state.videos.find(v=>v.id===x).transcript?.trim())) throw new InputError('所选视频有待补逐字稿的链接，请先补充内容再交给 Agent');
  if ((state.agentTasks?.length || 0)>=20) throw new InputError('当前最多保留 20 个 Agent 任务，请先使用已有任务');
  const context=structuredClone({product:state.product,comments:state.comments.slice(-250),videos:state.videos.filter(v=>videoIds.includes(v.id)),competitors:state.competitors,themes:[],mappings:[],scripts:[],reviews:[]});
  const steps=[{kind:'themes',label:'按语义整理痛点与兴趣'},...context.videos.map(v=>({kind:'video',videoId:v.id,label:`拆解：${v.title}`})),{kind:'mappings',label:'对应产品能力，检查演示与证据缺口'},{kind:'briefs',label:'按样本频次安排创作方向'},...Array.from({length:count},(_,index)=>({kind:'script',index,label:`第 ${index+1} 条：创作 → 用户视角自检 → 按需修订`}))].map(s=>({...s,id:id(),status:'pending',attempts:0}));
  return {id:id(),createdAt:now(),title:text(body.title,200)||`${count} 条教育脚本`,count,lines:[...lines],direction:text(body.direction,6000),duration:text(body.duration,100)||'45–60 秒',status:'pending',context,briefs:[],steps,scriptIds:[],maxModelCalls:3+videoIds.length+3*count,error:'',notice:'仅统计本任务导入样本；无参考视频时不作爆款结构推断。每条最多修订一轮，成交效果需要投放验证。'};
}

async function makeBriefs(task, call) {
  const c=task.context, themes=themeStats(c).filter(t=>t.label!=='待人工归类');
  const usable=new Set(c.mappings.filter(m=>m.fit!=='缺少能力').map(m=>m.themeId));
  if (!themes.some(t=>usable.has(t.id))) throw new InputError('现有痛点没有可用的产品对应能力，请补充产品或竞品资料后建立新任务');
  const slots=Array.from({length:task.count},(_,i)=>({index:i,line:task.lines[i%task.lines.length]}));
  const output=await call(`安排教育脚本创作选题。按 slots 顺序返回恰好 ${task.count} 项，line 必须与 slots 相同。优先考虑高频主题和高频结构，但产品适配与证据优先，不能选择“缺少能力”的主题。各条方向必须不同，避免同稿换标题。参考视频只取本次材料；没有视频则 videoId 为空字符串，不得声称爆款验证。部分对应必须在 direction 中明确适用边界。返回 {"briefs":[{"line":"A|B|C","themeId":"真实主题ID","videoId":"真实视频ID或空字符串","direction":"具体切入角度、演示动作及适用边界","rationale":"选题理由，区分频次观察与创意假设"}]}。`,{product:c.product,themes,mappings:c.mappings,structures:structureStats(c.videos),videos:c.videos,slots,direction:task.direction});
  if (!Array.isArray(output.briefs) || output.briefs.length!==task.count) throw new InputError('Agent 选题数量不完整，本步骤未保存');
  const seen=new Set();
  return output.briefs.map((b,i)=>{
    if (!b || b.line!==slots[i].line || !usable.has(b.themeId) || !themes.some(t=>t.id===b.themeId) || typeof b.videoId!=='string' || (b.videoId && !c.videos.some(v=>v.id===b.videoId))) throw new InputError('Agent 选题引用或创作线无效，本步骤未保存');
    const direction=required(b.direction,'选题方向',6000),rationale=required(b.rationale,'选题理由',4000);
    const normalized=direction.normalize('NFKC').replace(/[\s\p{P}]/gu,'');
    if (seen.has(normalized)) throw new InputError('Agent 返回重复选题，本步骤未保存');
    seen.add(normalized);
    return {line:b.line,themeId:b.themeId,videoId:b.videoId,direction,rationale};
  });
}

export async function advanceAgent(task, call) {
  const step=task.steps.find(s=>s.status!=='completed');
  if (!step) return {done:true};
  const context=task.context;
  if (step.kind==='themes') context.themes=await cluster(context,call);
  else if (step.kind==='video') {
    const video=context.videos.find(v=>v.id===step.videoId);
    video.analysis=await analyzeVideo(video,call);
  } else if (step.kind==='mappings') context.mappings=await mapProduct(context,call);
  else if (step.kind==='briefs') task.briefs=await makeBriefs(task,call);
  else if (step.kind==='script') {
    const brief=task.briefs[step.index];
    const body={...brief,mode:brief.videoId?'rewrite':'create',duration:task.duration,direction:`${task.direction}\n${brief.direction}\n选题依据：${brief.rationale}`};
    const output=await generateScript(context,body,call);
    const script={id:id(),createdAt:now(),mode:body.mode,line:body.line,version:1,parentId:null,reviewId:null,themeId:body.themeId,agentTaskId:task.id,productSnapshot:structuredClone(context.product),...output};
    task.scriptIds.push(script.id); step.scriptId=script.id;
    step.status='completed'; step.completedAt=now();
    task.status=task.steps.every(s=>s.status==='completed')?'completed':'pending';
    task.error=''; return {script,done:task.status==='completed'};
  }
  step.status='completed'; step.completedAt=now(); task.error='';
  task.status=task.steps.every(s=>s.status==='completed')?'completed':'pending';
  return {done:task.status==='completed'};
}

export function taskSummary(task) {
  const {context,...summary}=task;
  return {...summary,sampleCount:context.comments.length,videoCount:context.videos.length,themes:themeStats(context),structures:structureStats(context.videos),mappings:context.mappings,videoAnalyses:context.videos.filter(v=>v.analysis).map(v=>({id:v.id,title:v.title,analysis:v.analysis}))};
}
