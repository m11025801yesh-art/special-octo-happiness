import test from 'node:test';
import assert from 'node:assert/strict';
import { demoState, emptyState, templateScript, InputError } from '../lib/domain.mjs';
import { createWorkspace } from '../lib/workspace.mjs';
import { createAgentTask } from '../lib/agent.mjs';
import { generateScript } from '../lib/ai.mjs';

// These model replies are test fixtures, not claims of real model performance.
function modelFixture({failScriptAt=0,missingCapability=false}={}){
 const calls=[];let scripts=0,failed=false;
 const call=async(task,p)=>{
  calls.push({task,p:structuredClone(p)});
  if(task.startsWith('按用户表达'))return {themes:[{label:'错题反复',need:'找到不会的具体环节',keywords:['错题'],commentIds:p.comments.slice(0,2).map(c=>c.id)}]};
  if(task.startsWith('分析该视频'))return {structure:'场景问题 → 操作演示',hook:'具体问题开头',transfer:'迁移演示节奏',style:['口语'],beats:[{quote:p.transcript.slice(0,5),part:'场景问题',mechanism:'待验证'}],hypotheses:['待投放验证'],limits:['无同周期指标']};
  if(task.startsWith('评估痛点'))return {mappings:p.themes.filter(t=>t.label!=='待人工归类').map(t=>({themeId:t.id,fit:missingCapability?'缺少能力':'部分对应',feature:'学情诊断',mechanism:'先定位薄弱点',demonstration:'展示真实报告',evidence:'缺失',gap:'待补报告示例',competitorLearning:'补同类诊断样例'}))};
  if(task.startsWith('安排教育脚本'))return {briefs:p.slots.map(s=>({line:s.line,themeId:p.themes[0].id,videoId:p.videos[0]?.id||'',direction:`第 ${s.index+1} 个切入点：演示诊断报告，适用边界待核实`,rationale:'按本任务样本频次选题，效果是假设'}))};
  if(task.startsWith('作为持怀疑'))return {needsRevision:false,issues:[],purchaseBarriers:['需核验真实报告'],nextTest:'对照开头'};
  scripts++;
  if(scripts===failScriptAt&&!failed){failed=true;throw new InputError('测试模拟：服务商限流');}
  const result=templateScript({...demoState(),product:p.product,comments:p.comments,themes:[p.theme]}, {themeId:p.theme.id,line:p.productLine.name});
  result.title=`模拟成稿 ${scripts}`;result.sourceVideoIds=p.reference?[p.reference.id]:[];return result;
 };
 return {call,calls};
}
const current=(w)=>w.getState().agentTasks.at(-1);
const step=(w)=>{const t=current(w);return w.request('/api/ai/agent-step',{id:t.id,stepId:t.steps.find(s=>s.status!=='completed').id});};
async function complete(w){for(let i=0;i<30;i++){const t=current(w);if(t.status==='completed')return t;const out=await step(w);if(out.taskError)throw new Error(out.taskError);}throw new Error('did not finish');}

test('无素材不伪造任务；无密钥可计划、不能执行；数量和视频输入有上限',async()=>{
 assert.throws(()=>createAgentTask(emptyState(),{}));
 const initial=demoState();
 for(const b of [{count:21},{count:0},{count:1.2},{lines:['A','A']},{videoIds:['missing']}])assert.throws(()=>createAgentTask(initial,b));
 const w=createWorkspace({initial});await w.request('/api/agent/create',{count:20});
 assert.equal(current(w).steps.length,23);assert.equal(current(w).maxModelCalls,63);
 await assert.rejects(step(w),/配置并测试/);assert.equal(current(w).steps[0].attempts,0);
 assert.equal(w.getState().scripts.length,0);
});

test('20 条完整任务：真实引用、A7 B7 C6、保存研究记录；已完成步骤幂等',async()=>{
 const initial=demoState(),mock=modelFixture();let saved;
 const w=createWorkspace({initial,modelCall:mock.call,persist:s=>{saved=s;}});
 await w.request('/api/agent/create',{count:20,videoIds:[initial.videos[0].id]});
 const t=await complete(w),state=w.getState();
 assert.equal(t.scriptIds.length,20);assert.equal(t.status,'completed');
 assert.deepEqual(['A','B','C'].map(l=>state.scripts.filter(s=>s.line===l).length),[7,7,6]);
 assert.equal(mock.calls.length,44);assert.equal(t.themes.find(x=>x.label==='错题反复').count,2);assert.equal(t.structures[0].count,1);
 for(const s of state.scripts){assert.equal(s.attempts.length,2);assert.equal(s.agentTaskId,t.id);assert.ok(s.result.sourceCommentIds.length);assert.equal(s.result.sourceVideoIds[0],initial.videos[0].id);}
 assert.ok(saved.agentTasks[0].context);assert.equal(t.context,undefined);
 const restarted=createWorkspace({initial:saved,modelCall:mock.call});
 await restarted.request('/api/ai/agent-step',{id:t.id,stepId:t.steps[0].id});
 assert.equal(mock.calls.length,44);assert.equal(restarted.getState().scripts.length,20);
});

test('失败只重跑当前步，已完成成稿保留；暂停和重启后仍可续跑',async()=>{
 const mock=modelFixture({failScriptAt:2});let saved;
 let w=createWorkspace({initial:demoState(),modelCall:mock.call,persist:s=>{saved=s;}});
 await w.request('/api/agent/create',{count:3});
 for(let i=0;i<5;i++)await step(w);
 assert.equal(current(w).status,'failed');assert.match(current(w).error,/限流/);assert.equal(w.getState().scripts.length,1);
 assert.equal(current(w).steps[4].status,'failed');assert.equal(current(w).steps[4].attempts,1);
 await w.request('/api/agent/pause',{id:current(w).id});assert.equal(current(w).status,'paused');
 w=createWorkspace({initial:saved,modelCall:mock.call,persist:s=>{saved=s;}});
 await complete(w);
 assert.equal(w.getState().scripts.length,3);assert.equal(current(w).steps[4].attempts,2);
 assert.equal(mock.calls.filter(c=>c.task.startsWith('按用户表达')).length,1);
});

test('任务快照隔离产品修改、保护引用；成稿支持关联复盘继续迭代',async()=>{
 const initial=demoState(),mock=modelFixture();const w=createWorkspace({initial,modelCall:mock.call});
 await w.request('/api/agent/create',{count:1});
 await w.request('/api/product',{...initial.product,name:'修改后的新产品'});
 await assert.rejects(w.request('/api/delete',{collection:'comments',id:initial.comments[0].id}),/Agent 任务引用/);
 await complete(w);
 const script=w.getState().scripts[0];assert.equal(script.productSnapshot.name,initial.product.name);
 await w.request('/api/reviews',{scriptId:script.id,label:'测试数据',ctr:1,baseline:{ctr:3}});
 await w.request('/api/ai/script',{mode:'iterate',line:'A',parentId:script.id,reviewId:w.getState().reviews[0].id,themeId:script.themeId});
 assert.equal(w.getState().scripts.length,2);assert.equal(w.getState().scripts[1].version,2);
 assert.equal(w.getState().scripts[1].productSnapshot.name,initial.product.name);
 assert.ok(mock.calls.some(c=>c.p.performanceReview?.metrics.ctr===1));
});

test('能力缺口阻止强行出稿；保存失败不显示已完成',async()=>{
 const mock=modelFixture({missingCapability:true});const w=createWorkspace({initial:demoState(),modelCall:mock.call});
 await w.request('/api/agent/create',{count:1});for(let i=0;i<3;i++)await step(w);
 assert.equal(current(w).status,'failed');assert.match(current(w).error,/没有可用的产品/);assert.equal(w.getState().scripts.length,0);
 let fail=false;
 const w2=createWorkspace({initial:demoState(),modelCall:modelFixture().call,persist:()=>{if(fail)throw new Error('disk full');}});
 await w2.request('/api/agent/create',{count:1});fail=true;
 await assert.rejects(step(w2),/disk full/);assert.equal(current(w2).steps[0].status,'pending');assert.equal(current(w2).themes.length,0);
});

test('脚本不能引用工作台中存在、但未提供给本次模型的评论',async()=>{
 const s=demoState(),theme=s.themes[0];const r=templateScript(s,{themeId:theme.id});
 const outside=s.comments.find(c=>!theme.commentIds.includes(c.id));assert.ok(outside);
 r.sourceCommentIds=[outside.id];
 await assert.rejects(generateScript(s,{themeId:theme.id},async()=>r),/不存在的来源/);
});
