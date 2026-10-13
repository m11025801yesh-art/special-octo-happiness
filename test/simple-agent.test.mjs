import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspace} from '../lib/workspace.mjs';
import {emptyState,InputError} from '../lib/domain.mjs';
import {createSimpleTask} from '../lib/simple-agent.mjs';

const input={product:'9.9元虚拟产品，包含学情诊断与规划。',requirements:'给高中家长写1条45秒脚本，先讲诊断。',references:'先找出问题，再演示怎么解决。'};
function model({failAudit=false,alwaysReject=false,count=1,gap=false}={}){
 const calls=[];let audits=0,failed=false;
 return {calls,call:async(task,p)=>{
  calls.push({task,p});
  if(task.startsWith('简洁创作：先学习'))return {audience:'高中家长',requirementsSummary:input.requirements,count,angles:Array.from({length:count},(_,i)=>`方向${i+1}`),productFacts:[{claim:'提供诊断',quote:'学情诊断'}],referenceLessons:[{quote:'先找出问题',lesson:'问题先行再演示'}]};
  if(task.startsWith('按用户表达'))return {themes:[{label:'诊断问题',need:'找准薄弱点',keywords:['诊断','并不存在的高频词'],commentIds:p.comments.map(c=>c.id)}]};
  if(task.startsWith('评估痛点'))return {mappings:p.themes.map(t=>({themeId:t.id,fit:gap?'缺少能力':'直接对应',feature:'学情诊断',mechanism:'按错题找原因',demonstration:'展示诊断过程',evidence:'用户产品原文',gap:'缺少效果数据',competitorLearning:'需真实样例'}))};
  if(task.startsWith('分析该视频'))return {structure:'场景问题 → 操作演示',hook:'问题先行',format:'根据文案，画面未知',style:['短句'],beats:[{part:'场景问题',quote:p.transcript.slice(0,5),mechanism:'先回应疑问'}],hypotheses:['可能引发共鸣'],limits:['无投放证据'],transfer:'展示诊断过程'};
  if(task.startsWith('融合调研'))return {strategies:p.slots.map(slot=>({...slot,themeId:p.stats.themes[0]?.id||'',videoId:p.videos[0]?.id||'',featureQuote:'学情诊断',fit:gap?'缺少能力':'直接对应',mechanism:'诊断定位问题，不保证提分',demonstration:'打开样例，展示薄弱点与规划',rationale:'结合本次样本选择，效果待验证',competitorIds:p.competitors.map(c=>c.id),researchQuestions:['补充真实报告样例']}))};
  if(task.startsWith('简洁创作：现在换成')){
   if(failAudit&&!failed){failed=true;throw new InputError('模拟连接中断');}
   audits++;const reject=alwaysReject||audits===1;
   return {persuasive:!reject,reason:reject?'我还不知道实际怎么诊断':'现在我能理解具体操作，愿意进一步了解',issues:reject?['把诊断过程拍具体']:[],purchaseBarriers:reject?['担心只拿到空报告']:[],blockingEvidence:alwaysReject?['缺真实诊断样例']:[],nextTest:'测试不同开头的点击表现'};
  }
  return {script:{title:`脚本${p.number}`,angle:p.angle,structure:'问题 → 演示 → 引导',sourceCommentIds:(p.comments||[]).map(c=>c.id),sourceVideoIds:p.strategy?.videoId?[p.strategy.videoId]:[],shots:[0,1,2].map(i=>({seconds:`${i*10}–${i*10+10}s`,voice:p.audit?'修订后展示具体诊断动作。':'看看孩子哪里卡住了。',visual:'展示真实资料',overlay:'诊断',purpose:'解释交付'})),critique:{strengths:['具体'],weaknesses:[],nextTest:'比较开头'},evidenceGaps:[]},changes:p.audit?['补充诊断操作画面，回应购买疑虑']:[]};
 }};
}
async function create(w){return (await w.request('/api/simple/create',input)).taskId;}
async function step(w){const t=w.getState().simpleTasks[0];return w.request('/api/ai/simple-step',{id:t.id,cursor:t.cursor});}
async function finish(w){for(let i=0;i<300;i++){if(w.getState().simpleTasks[0].stage==='done'||w.getState().simpleTasks[0].stage==='blocked')return;const r=await step(w);if(r.taskError)throw new Error(r.taskError);}throw new Error('incomplete');}

test('三个输入即可创作，不需要评论；先审阅再修改，修改后必须再次审阅',async()=>{
 const m=model(),w=createWorkspace({initial:emptyState(),modelCall:m.call});await create(w);await finish(w);
 assert.equal(m.calls.length,8);assert.equal(w.getState().comments.length,0);assert.equal(w.getState().themes.length,0);
 const s=w.getState().scripts[0];assert.equal(s.audit.persuasive,true);assert.match(s.result.status,/自检通过/);assert.deepEqual(s.result.sourceCommentIds,[]);
 assert.equal(s.attempts.filter(x=>x.audit).length,2);assert.equal(s.attempts.filter(x=>x.changes?.length).length,1);
 assert.match(m.calls.at(-1).p.script.shots[0].voice,/修订后/);
 const t=w.getState().simpleTasks[0];await w.request('/api/ai/simple-step',{id:t.id,cursor:0});assert.equal(m.calls.length,8);
});
test('三轮仍不打动用户时，保留问题，不能假装通过；每轮修改后都再审',async()=>{
 const m=model({alwaysReject:true}),w=createWorkspace({modelCall:m.call});await create(w);await finish(w);
 assert.equal(m.calls.length,14);const s=w.getState().scripts[0];assert.equal(s.audit.persuasive,false);assert.match(s.result.status,/仍有疑虑/);
 assert.equal(s.attempts.filter(x=>x.audit).length,4);assert.equal(s.attempts.filter(x=>x.changes?.length).length,3);assert.ok(s.result.evidenceGaps.includes('缺真实诊断样例'));
});
test('审阅失败保留初稿，重启后从审阅继续；密钥缺失时保留输入',async()=>{
 const m=model({failAudit:true});let saved;
 let w=createWorkspace({modelCall:m.call,persist:s=>{saved=s;}});await create(w);while(w.getState().simpleTasks[0].stage!=='audit')await step(w);
 const failure=await step(w);assert.match(failure.taskError,/连接中断/);assert.ok(saved.simpleTasks[0].draft);assert.equal(saved.simpleTasks[0].stage,'audit');
 w=createWorkspace({initial:saved,modelCall:m.call});await finish(w);assert.equal(m.calls.filter(c=>c.task.includes('写一条新脚本')).length,1);
 const missing=createWorkspace();await create(missing);await assert.rejects(step(missing),/首次使用/);assert.deepEqual(missing.getState().simpleTasks[0].input,input);
});
test('需求可生成多条；学习引用必须来自提供的原文，链接不能冒充已读取视频',async()=>{
 const m=model({count:2}),w=createWorkspace({modelCall:m.call});await create(w);await finish(w);assert.equal(w.getState().scripts.length,2);
 assert.throws(()=>createSimpleTask({...input,references:'https://example.com/video'}),/补充口播/);
 const invalid=createWorkspace({modelCall:async()=>({audience:'家长',requirementsSummary:'一条',count:1,angles:['诊断'],productFacts:[{claim:'保分',quote:'不存在的保证'}],referenceLessons:[]})});await create(invalid);assert.match((await step(invalid)).taskError,/不在原文/);assert.equal(invalid.getState().simpleTasks[0].learning,null);
});
test('保存失败不提前推进步骤或伪造成稿',async()=>{
 let fail=false;const w=createWorkspace({modelCall:model().call,persist:()=>{if(fail)throw new Error('storage full');}});await create(w);fail=true;
 await assert.rejects(step(w),/storage full/);assert.equal(w.getState().simpleTasks[0].cursor,0);assert.equal(w.getState().scripts.length,0);
});

test('一键使用真实评论、跨类目视频、竞品；频次从原始样本计算，失败回溯研究',async()=>{
 const initial=emptyState();initial.comments=[{id:'c1',text:'想先诊断哪里不会',source:'手动评论'},{id:'c2',text:'诊断后怎么学',source:'手动评论'},{id:'c3',text:'不知先补哪科',source:'手动评论'}];
 initial.videos=[{id:'v1',title:'美妆参考',category:'美妆',transcript:'先看问题再示范用法。'}];initial.competitors=[{id:'cp1',name:'竞品',features:'演示一份诊断样例',evidence:'手动录入'}];
 const m=model(),w=createWorkspace({initial,modelCall:m.call});await create(w);await finish(w);
 const t=w.getState().simpleTasks[0];assert.equal(t.research.stats.themes[0].count,3);assert.deepEqual(t.research.stats.keywords.map(k=>[k.label,k.count]),[['诊断',2]]);assert.equal(t.research.stats.structures[0].count,2);
 assert.equal(t.history.filter(h=>h.strategies).length,2);assert.equal(m.calls.filter(c=>c.task.startsWith('融合调研')).at(-1).p.audit.persuasive,false);
 assert.deepEqual(w.getState().scripts[0].result.sourceCommentIds,['c1','c2','c3']);assert.deepEqual(t.research.strategies[0].competitorIds,['cp1']);
 await assert.rejects(w.request('/api/delete',{collection:'videos',id:'v1'}),/任务引用/);
});
test('产品无法解决时停止并列出缺口，不强行成稿',async()=>{
 const m=model({gap:true}),w=createWorkspace({modelCall:m.call});await create(w);await finish(w);
 const t=w.getState().simpleTasks[0];assert.equal(t.stage,'blocked');assert.equal(t.status,'needs_materials');assert.equal(w.getState().scripts.length,0);assert.ok(t.research.questions.length);
 const n=m.calls.length;await step(w);assert.equal(m.calls.length,n);
});
test('投放复盘回到同一流程生成 V2，旧版、原始产品和复盘依据保留',async()=>{
 const m=model(),w=createWorkspace({modelCall:m.call});await create(w);await finish(w);
 const parent=w.getState().scripts[0];await w.request('/api/reviews',{scriptId:parent.id,label:'测试批次',ctr:'1',cvr:'2',hold3:'20',baseline:{ctr:'3',cvr:'2',hold3:'35'}});
 const review=w.getState().reviews[0];const r=await w.request('/api/simple/from-review',{reviewId:review.id});
 for(let i=0;i<300;i++){const t=w.getState().simpleTasks.find(t=>t.id===r.taskId);if(t.stage==='done')break;const res=await w.request('/api/ai/simple-step',{id:t.id,cursor:t.cursor});assert.ok(!res.taskError,res.taskError);}
 const v2=w.getState().scripts[1];assert.equal(v2.version,2);assert.equal(v2.parentId,parent.id);assert.equal(v2.reviewId,review.id);assert.equal(v2.input.product,input.product);assert.deepEqual(w.getState().scripts[0],parent);
 const write=m.calls.filter(c=>c.task.includes('写一条新脚本')).at(-1);assert.equal(write.p.performanceReview.id,review.id);assert.equal(write.p.previousVersion.title,parent.result.title);
});
test('素材边界：新产品覆盖旧资料；文案内空行不是多视频；虚构参考 ID 拒绝保存',async()=>{
 const state=emptyState();state.product.features='旧版实体书';state.videos=[{id:'only-link',url:'https://example.com',transcript:''}];
 const t=createSimpleTask({...input,references:'第一段\n\n第二段'},state);assert.equal(t.research.videos.length,1);assert.equal(t.research.product.features,input.product);
 const m=model(),w=createWorkspace({modelCall:async(task,p)=>{const out=await m.call(task,p);if(out.strategies)out.strategies[0].videoId='fabricated';return out;}});await create(w);
 while(w.getState().simpleTasks[0].stage!=='strategy')await step(w);
 assert.match((await step(w)).taskError,/无效主题、视频/);assert.equal(w.getState().simpleTasks[0].history.length,0);
});

test('20条分步安排策略，避免一次模型输出20份详细研究超限',async()=>{
 const m=model({count:20}),w=createWorkspace({modelCall:m.call});await create(w);await finish(w);
 assert.equal(w.getState().scripts.length,20);assert.equal(w.getState().simpleTasks[0].research.strategies.length,20);
 for(const c of m.calls.filter(c=>c.task.startsWith('融合调研')))assert.equal(c.p.slots.length,1);
});
