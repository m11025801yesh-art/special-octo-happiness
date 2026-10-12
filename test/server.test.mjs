import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { emptyState } from '../lib/domain.mjs';

async function start(dataDir){
  const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:'0',HOST:'127.0.0.1',DATA_DIR:dataDir,QIANCHUAN_AI_KEY:'',QIANCHUAN_NO_CATALOG:'1'},stdio:['ignore','pipe','pipe']});
  const url=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill();reject(new Error('server startup timeout'));},5000);
    child.stdout.on('data',data=>{const match=data.toString().match(/127\.0\.0\.1:(\d+)/);if(match){clearTimeout(timer);resolve(`http://127.0.0.1:${match[1]}`);}});
    child.on('error',reject);child.on('exit',code=>{if(code){clearTimeout(timer);reject(new Error('server startup failed'));}});
  });
  const stop=()=>new Promise(resolve=>{child.once('exit',resolve);child.kill();});
  return {url,stop};
}
test('HTTP 全流程、持久化、版本与密钥隔离',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'qianchuan-http-'));
  await fs.writeFile(path.join(dir,'workspace.json'),JSON.stringify(emptyState()));
  let app=await start(dir);
  const post=async(route,b)=>{const r=await fetch(app.url+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});return {code:r.status,body:await r.json()};};
  try{
    assert.equal((await fetch(app.url+'/')).status,200);
    assert.equal((await fetch(app.url+'/vendor/papaparse.min.js')).status,200);
    assert.equal((await fetch(app.url+'/.data/workspace.json')).status,404);
    assert.equal((await fetch(app.url+'/api/state',{headers:{Origin:'https://untrusted.example'}})).status,403);
    assert.equal((await post('/api/demo',{})).code,200);
    const s=await (await fetch(app.url+'/api/state')).json();
    assert.equal(s.comments.length,12);assert.equal(s.stats.structures[0].count,2);
    assert.equal((await post('/api/demo',{})).code,400,'不能覆盖已有资料');
    const missing=await post('/api/ai/script',{mode:'create',themeId:s.themes[0].id});
    assert.equal(missing.code,400);assert.match(missing.body.error,/尚未连接/);
    const generated=await post('/api/scripts/template',{themeId:s.themes[0].id,line:'B'});
    assert.equal(generated.code,200);const original=generated.body.state.scripts[0];
    assert.match(original.result.title,/B线/);
    const deletion=await post('/api/delete',{collection:'comments',id:original.result.sourceCommentIds[0]});
    assert.equal(deletion.code,400,'被引用样本不可删除');
    const edited=await post('/api/scripts/edit',{id:original.id,title:'人工调整开头',voices:original.result.shots.map((s,i)=>i===0?'新的真实问题开头':s.voice)});
    assert.equal(edited.code,200);assert.equal(edited.body.state.scripts.length,2);
    const latest=edited.body.state.scripts[1];assert.equal(latest.version,2);assert.equal(latest.parentId,original.id);
    assert.notEqual(latest.result.shots[0].voice,original.result.shots[0].voice);
    const review=await post('/api/reviews',{scriptId:latest.id,label:'测试批次',impressions:1000,clicks:50,conversions:3,hold3:30,baseline:{ctr:6,hold3:40}});
    assert.equal(review.code,200);assert.equal(review.body.state.reviews[0].metrics.ctr,5);assert.equal(review.body.state.reviews[0].metrics.cvr,6);
    assert.equal((await post('/api/settings',{provider:'deepseek',model:'deepseek-chat',key:'unit-test-key-not-real'})).code,200);
    const view=await(await fetch(app.url+'/api/state')).text();assert.ok(!view.includes('unit-test-key-not-real'));assert.equal(JSON.parse(view).ai.configured,true);
    const exported=await(await fetch(app.url+'/api/export')).text();assert.ok(!exported.includes('unit-test-key-not-real'));assert.equal(JSON.parse(exported).scripts.length,2);
    const file=await fs.readFile(path.join(dir,'workspace.json'),'utf8');assert.ok(!file.includes('unit-test-key-not-real'));
    await app.stop();app=await start(dir);
    const restored=await(await fetch(app.url+'/api/state')).json();assert.equal(restored.scripts.length,2);assert.equal(restored.reviews.length,1);assert.equal(restored.ai.configured,false);
  }finally{await app.stop();await fs.rm(dir,{recursive:true,force:true});}
});
