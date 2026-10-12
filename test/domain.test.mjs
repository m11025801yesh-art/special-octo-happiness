import test from 'node:test';
import assert from 'node:assert/strict';
import Papa from 'papaparse';
import { emptyState, demoState, importComments, ruleThemes, themeStats, structureStats, buildReview, templateScript, validateScript, validateThemes } from '../lib/domain.mjs';
import { parseJSON, chat, cluster, analyzeVideo, mapProduct, generateScript } from '../lib/ai.mjs';

test('批量导入去重、保留来源，出错时不会部分写入',()=>{
  const s=emptyState();
  assert.deepEqual(importComments(s,{rows:[{text:'错题又错了！',source:'抖音'},{text:'错题 又错了',source:'另一视频'},{text:'没有时间整理'}]}),{added:2,duplicates:1});
  assert.equal(s.comments[0].source,'抖音');
  assert.throws(()=>importComments(s,{rows:[{text:'新内容'},{text:'另一个新内容',url:'javascript:alert(1)'}]}));
  assert.equal(s.comments.length,2);
  assert.throws(()=>importComments(s,{rows:[{text:'!!!'}]}));
});
test('CSV 支持中文、多行和双引号，导出防止公式执行',()=>{
  const raw='评论,来源\r\n"孩子说""不懂""，怎么办？","抖音"\r\n"第一句\n第二句",小红书';
  const parsed=Papa.parse(raw,{header:true});
  assert.equal(parsed.errors.length,0);assert.equal(parsed.data.length,2);
  assert.equal(parsed.data[0].评论,'孩子说"不懂"，怎么办？');assert.equal(parsed.data[1].评论,'第一句\n第二句');
  const output=Papa.unparse([{评论:'=1+1'}],{escapeFormulae:true});
  assert.match(output,/'=1\+1/);
});
test('主题频次按去重评论计算，允许一个样本多个主题，未知主题不硬分',()=>{
  const s=emptyState();importComments(s,{text:'刷题又错了，错题本没用\n不懂怎么安排时间\n我想要紫色的封面',source:'测试'});
  s.themes=ruleThemes(s.comments);const stats=themeStats(s);
  assert.ok(stats.some(t=>t.label==='待人工归类'&&t.count===1));
  assert.ok(stats.every(t=>t.count===1&&t.percent===33.3));
  s.themes[0].commentIds.push(s.themes[0].commentIds[0]);assert.equal(themeStats(s)[0].count,1);
});
test('AI 主题只接受真实样本 ID，未覆盖样本保持可见',()=>{
  const s=demoState();
  assert.throws(()=>validateThemes({themes:[{label:'伪造',commentIds:['fake']}]},s.comments));
  const result=validateThemes({themes:[{label:'一个主题',commentIds:[s.comments[0].id]}]},s.comments);
  assert.equal(result[1].label,'待人工归类');assert.equal(result[1].commentIds.length,11);
});
test('结构按完整结构计数，不将视频的不同阶段重复计数',()=>{
  const s=demoState(),stats=structureStats(s.videos);assert.equal(stats.length,1);assert.equal(stats[0].count,2);
});
function fixture(){const s=demoState();const result=templateScript(s,{});s.scripts.push({id:'script1',version:1,result});return s;}
test('漏斗复盘使用正确分母、零值与用户基准，缺数据不捏造',()=>{
  const s=fixture();const r=buildReview({scriptId:'script1',label:'测试批次',impressions:1000,clicks:50,conversions:0,plays:800,plays3:400,completes:80,baseline:{ctr:6,cvr:2,hold3:60}},s.scripts);
  assert.deepEqual(r.metrics,{ctr:5,cvr:0,hold3:50,completion:10});
  assert.equal(r.recommendations.filter(x=>x.priority==='优先测试').length,3);
  assert.equal(r.recommendations.find(x=>x.metric==='completion').priority,'需要对照');
  const direct=buildReview({scriptId:'script1',label:'手动',ctr:0},s.scripts);
  assert.equal(direct.metrics.ctr,0);assert.equal(direct.metrics.cvr,null);
});
test('拒绝矛盾计数、无效百分比、计数百分比冲突和零分母',()=>{
  const s=fixture();const base={scriptId:'script1',label:'测试'};
  for(const fields of [{impressions:2,clicks:3},{ctr:101},{ctr:-1},{ctr:true},{impressions:0,clicks:0,ctr:0},{impressions:100,clicks:10,ctr:5},{plays:20,plays3:10,completes:15},{clicks:1.5,impressions:5}]) assert.throws(()=>buildReview({...base,...fields},s.scripts));
});
test('规则骨架需要产品与评论，不制造 AI 自检通过结论',()=>{
  assert.throws(()=>templateScript(emptyState(),{}));
  const s=demoState();const r=templateScript(s,{line:'C'});
  assert.match(r.title,/C线/);assert.match(r.angle,/规则模板/);assert.ok(r.evidenceGaps.length);
  assert.equal(validateScript(r,s),r);
  assert.throws(()=>validateScript({...r,sourceCommentIds:['fake']},s));
  assert.throws(()=>validateScript({...r,sourceCommentIds:[]},s));
  assert.throws(()=>validateScript({...r,evidenceGaps:'错误的格式'},s));
});
test('模型适配器不会用模板掩盖请求失败；解析 JSON 失败明确报错',async()=>{
  assert.deepEqual(parseJSON('```json\n{"ok":true}\n```'),{ok:true});
  assert.throws(()=>parseJSON('不是 JSON'));
  await assert.rejects(chat({provider:'deepseek'},'', 'test',{}),/尚未连接/);
  const fetcher=async(url,options)=>{assert.equal(url,'https://api.deepseek.com/v1/chat/completions');assert.equal(options.headers.Authorization,'Bearer test-secret');return new Response(JSON.stringify({choices:[{message:{content:'{"ok":true}'}}]}));};
  assert.deepEqual(await chat({provider:'deepseek',model:'test'},'test-secret','test',{}, {fetcher}),{ok:true});
  await assert.rejects(chat({provider:'deepseek'},'test','test',{}, {fetcher:async()=>new Response('private provider error',{status:401})}),/密钥未通过/);
});
test('视频拆解只保存来自原文的引用；产品对应只接受已知主题',async()=>{
  const s=demoState();
  await assert.rejects(analyzeVideo(s.videos[0],async()=>({structure:'结构',hook:'开头',transfer:'迁移',beats:[{quote:'不存在的句子'}],style:[],hypotheses:[],limits:[]})),/原文引用/);
  await assert.rejects(mapProduct(s,async()=>({mappings:[{themeId:'fake',fit:'直接对应'}]})),/无效主题/);
  const themes=await cluster(s,async()=>({themes:[{label:'真实主题',commentIds:[s.comments[0].id]}]}));assert.equal(themes.length,2);
});
test('生成、自检、按需修订最多三次调用，保留完整来源与历次输出',async()=>{
  const s=demoState(),theme=s.themes[0],r=templateScript(s,{themeId:theme.id});let calls=0;
  const call=async(task,payload)=>{calls++;assert.equal(payload.product.name,s.product.name);return calls===2?{needsRevision:true,issues:['演示不够具体'],purchaseBarriers:['缺材料'],nextTest:'验证开头'}:structuredClone(r);};
  const out=await generateScript(s,{themeId:theme.id,mode:'create',line:'A'},call);
  assert.equal(calls,3);assert.equal(out.attempts.length,3);assert.equal(out.input.productLine.name,'A');
  assert.equal(s.scripts.length,0,'生成函数不应提前写入未完成草稿');
});
test('无需修订时两次模型调用；不允许关联其他脚本复盘',async()=>{
  const s=demoState(),r=templateScript(s,{themeId:s.themes[0].id});let calls=0;
  const out=await generateScript(s,{themeId:s.themes[0].id},async()=>++calls===2?{needsRevision:false,issues:[],purchaseBarriers:[],nextTest:'对照测试'}:r);
  assert.equal(calls,2);assert.equal(out.attempts.length,2);
  s.scripts.push({id:'a',result:r});s.reviews.push({id:'review',scriptId:'b'});
  await assert.rejects(generateScript(s,{themeId:s.themes[0].id,parentId:'a',reviewId:'review'},async()=>r),/不对应/);
});
