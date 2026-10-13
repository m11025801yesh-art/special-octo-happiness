import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspace} from '../lib/workspace.mjs';
import {emptyState,InputError} from '../lib/domain.mjs';
import {createSimpleTask} from '../lib/simple-agent.mjs';

const input={product:'9.9元虚拟产品，包含学情诊断与规划。',requirements:'给高中家长写1条45秒脚本，先讲诊断。',references:'先找出问题，再演示怎么解决。'};
function model({failAudit=false,alwaysReject=false,count=1}={}){
 const calls=[];let audits=0,failed=false;
 return {calls,call:async(task,p)=>{
  calls.push({task,p});
  if(task.startsWith('简洁创作：先学习'))return {audience:'高中家长',requirementsSummary:input.requirements,count,angles:Array.from({length:count},(_,i)=>`方向${i+1}`),productFacts:[{claim:'提供诊断',quote:'学情诊断'}],referenceLessons:[{quote:'先找出问题',lesson:'问题先行再演示'}]};
  if(task.startsWith('简洁创作：现在换成')){
   if(failAudit&&!failed){failed=true;throw new InputError('模拟连接中断');}
   audits++;const reject=alwaysReject||audits===1;
   return {persuasive:!reject,reason:reject?'我还不知道实际怎么诊断':'现在我能理解具体操作，愿意进一步了解',issues:reject?['把诊断过程拍具体']:[],purchaseBarriers:reject?['担心只拿到空报告']:[],blockingEvidence:alwaysReject?['缺真实诊断样例']:[],nextTest:'测试不同开头的点击表现'};
  }
  return {script:{title:`脚本${p.number}`,angle:p.angle,structure:'问题 → 演示 → 引导',sourceCommentIds:[],sourceVideoIds:[],shots:[0,1,2].map(i=>({seconds:`${i*10}–${i*10+10}s`,voice:p.audit?'修订后展示具体诊断动作。':'看看孩子哪里卡住了。',visual:'展示真实资料',overlay:'诊断',purpose:'解释交付'})),critique:{strengths:['具体'],weaknesses:[],nextTest:'比较开头'},evidenceGaps:[]},changes:p.audit?['补充诊断操作画面，回应购买疑虑']:[]};
 }};
}
async function create(w){return (await w.request('/api/simple/create',input)).taskId;}
async function step(w){const t=w.getState().simpleTasks[0];return w.request('/api/ai/simple-step',{id:t.id,cursor:t.cursor});}
async function finish(w){for(let i=0;i<30;i++){if(w.getState().simpleTasks[0].stage==='done')return;const r=await step(w);if(r.taskError)throw new Error(r.taskError);}throw new Error('incomplete');}

test('三个输入即可创作，不需要评论；先审阅再修改，修改后必须再次审阅',async()=>{
 const m=model(),w=createWorkspace({initial:emptyState(),modelCall:m.call});await create(w);await finish(w);
 assert.equal(m.calls.length,5);assert.equal(w.getState().comments.length,0);assert.equal(w.getState().themes.length,0);
 const s=w.getState().scripts[0];assert.equal(s.audit.persuasive,true);assert.match(s.result.status,/自检通过/);assert.deepEqual(s.result.sourceCommentIds,[]);
 assert.equal(s.attempts.filter(x=>x.audit).length,2);assert.equal(s.attempts.filter(x=>x.changes?.length).length,1);
 assert.match(m.calls.at(-1).p.script.shots[0].voice,/修订后/);
 const t=w.getState().simpleTasks[0];await w.request('/api/ai/simple-step',{id:t.id,cursor:0});assert.equal(m.calls.length,5);
});
test('三轮仍不打动用户时，保留问题，不能假装通过；每轮修改后都再审',async()=>{
 const m=model({alwaysReject:true}),w=createWorkspace({modelCall:m.call});await create(w);await finish(w);
 assert.equal(m.calls.length,9);const s=w.getState().scripts[0];assert.equal(s.audit.persuasive,false);assert.match(s.result.status,/仍有疑虑/);
 assert.equal(s.attempts.filter(x=>x.audit).length,4);assert.equal(s.attempts.filter(x=>x.changes?.length).length,3);assert.ok(s.result.evidenceGaps.includes('缺真实诊断样例'));
});
test('审阅失败保留初稿，重启后从审阅继续；密钥缺失时保留输入',async()=>{
 const m=model({failAudit:true});let saved;
 let w=createWorkspace({modelCall:m.call,persist:s=>{saved=s;}});await create(w);await step(w);await step(w);
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
