import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {emptyState,demoState} from '../lib/domain.mjs';
import {createWorkspace} from '../lib/workspace.mjs';
import {catalogScripts,mergeCatalog} from '../lib/catalog.mjs';
import {scripts,batch} from '../config/script-catalog.mjs';
import {analyzeVideo} from '../lib/ai.mjs';

const profile=JSON.parse(fs.readFileSync(new URL('../config/product-profile.json',import.meta.url),'utf8'));
test('手动保存产品原文和链接，视频先收藏再补文案，未提供内容时不调用模型',async()=>{
 const initial=emptyState();initial.product=profile;const w=createWorkspace({initial});
 await w.request('/api/product',{...profile,sourceNotes:'产品资料测试原文',sourceUrl:'https://example.com/product'});
 assert.equal(w.getState().product.sourceNotes,'产品资料测试原文');
 await w.request('/api/videos/link',{url:'分享这条视频 https://v.douyin.com/example/ 复制打开'});
 const v=w.getState().videos[0];assert.equal(v.url,'https://v.douyin.com/example/');assert.equal(v.transcript,'');
 await w.request('/api/videos/link',{url:v.url});assert.equal(w.getState().videos.length,1);
 let called=false;await assert.rejects(analyzeVideo(v,async()=>{called=true;}),/补充逐字稿/);assert.equal(called,false);
 await assert.rejects(w.request('/api/videos/link',{url:'javascript:alert(1)'}),/来源链接/);
 await assert.rejects(w.request('/api/videos',{}),/至少填写/);
 await w.request('/api/comments',{text:'测试评论：空间向量看不懂'});
 await assert.rejects(w.request('/api/agent/create',{count:1,videoIds:[v.id]}),/待补逐字稿/);
 await w.request('/api/videos/update',{id:v.id,title:'补齐后的参考',transcript:'这是一条测试逐字稿。'});
 assert.equal(w.getState().videos.length,1);assert.equal(w.getState().videos[0].url,v.url);
 assert.equal(w.getState().videos[0].transcript,'这是一条测试逐字稿。');
 await w.request('/api/agent/create',{count:1,videoIds:[v.id]});
 await assert.rejects(w.request('/api/videos/update',{id:v.id,transcript:'试图修改已引用资料'}),/已被脚本或 Agent/);
 assert.equal(w.getState().videos[0].transcript,'这是一条测试逐字稿。');
});
test('20条Agent脚本均为完整成稿，来源为产品资料，不污染评论统计',()=>{
 const state=mergeCatalog(emptyState(),profile);
 assert.equal(state.scripts.length,20);assert.equal(new Set(state.scripts.map(s=>s.id)).size,20);
 assert.deepEqual(['A','B','C'].map(line=>state.scripts.filter(s=>s.line===line).length),[7,7,6]);
 assert.equal(state.comments.length,0);assert.equal(state.themes.length,0);
 assert.equal(new Set(scripts.map(s=>s.shots[0][1])).size,20);
 for(const s of state.scripts){
  assert.equal(s.mode,'agent');assert.equal(s.result.shots.length,5);
  assert.ok(s.result.sourceProductFacts.length>=2);assert.deepEqual(s.result.sourceCommentIds,[]);assert.deepEqual(s.result.sourceVideoIds,[]);
  assert.match(s.result.researchBasis,/尚未/);assert.equal(s.productSnapshot.price,profile.price);
  const voices=s.result.shots.map(x=>x.voice).join('');
  assert.ok(voices.length>160&&voices.length<350,s.code+' spoken length');
  assert.doesNotMatch(voices,/\[|拍摄时|保证提分|限时|全科清北|实体书|159元|199元/);
  for(const shot of s.result.shots)for(const key of ['seconds','voice','visual','overlay','purpose'])assert.equal(typeof shot[key],'string');
 }
 assert.equal(Object.keys(batch.facts).length,6);
});
test('内置脚本只追加一次，不覆盖已有资料、用户脚本或修改',()=>{
 const s=demoState();const originalComments=structuredClone(s.comments);
 s.scripts.push({id:'user-script',result:{title:'用户内容'}});
 mergeCatalog(s,profile);s.scripts[1].result.title='用户修改后的标题';mergeCatalog(s,profile);
 assert.equal(s.scripts.length,21);assert.equal(s.scripts[1].result.title,'用户修改后的标题');assert.deepEqual(s.comments,originalComments);
});
test('保存失败会回滚内存状态及密钥，不显示虚假的已保存结果',async()=>{
 const initial=demoState();
 const w=createWorkspace({initial,persist:()=>{throw new Error('quota exceeded');},localMode:true});
 await assert.rejects(w.request('/api/comments',{text:'一条尚未保存的评论',source:'测试'}),/quota/);
 assert.equal(w.getState().comments.length,12);
 await assert.rejects(w.request('/api/settings',{provider:'openai',model:'gpt-4.1-mini',key:'test-only-not-a-real-key'}),/quota/);
 assert.equal(w.getState().settings.provider,'deepseek');assert.equal(w.getState().ai.configured,false);
});
test('产品资料脚本可人工保存新版本与复盘，保留原资料快照',async()=>{
 const initial=emptyState();initial.product=profile;initial.scripts=catalogScripts(profile);
 const w=createWorkspace({initial,localMode:true});const original=w.getState().scripts[0];
 await w.request('/api/scripts/edit',{id:original.id,title:'新开头',voices:original.result.shots.map((x,i)=>i===0?'先看看下一步学什么。':x.voice)});
 const latest=w.getState().scripts.at(-1);assert.equal(latest.version,2);assert.deepEqual(latest.productSnapshot,original.productSnapshot);
 await w.request('/api/reviews',{scriptId:latest.id,label:'待投放数据测试',ctr:3,baseline:{ctr:4}});
 assert.equal(w.getState().reviews[0].recommendations[0].priority,'优先测试');
 assert.equal(w.getState().stats.themes.length,0);
});
