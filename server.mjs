import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emptyState, demoState, importComments, ruleThemes, themeStats, structureStats, buildReview, templateScript, required, text, safeUrl, id, now, InputError } from './lib/domain.mjs';
import { providers, chat, cluster, analyzeVideo, mapProduct, generateScript } from './lib/ai.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(root,'.data');
fs.mkdirSync(dataDir,{recursive:true,mode:0o700});
const stateFile = path.join(dataDir,'workspace.json');
let state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile,'utf8')) : emptyState();
if (!fs.existsSync(stateFile)) {
  const profile=path.join(root,'config/product-profile.json');
  if (fs.existsSync(profile)) state.product=JSON.parse(fs.readFileSync(profile,'utf8'));
}
let sessionKey = '', sessionProvider = null, busy = false;
const envProvider = process.env.QIANCHUAN_AI_PROVIDER || 'deepseek';
function save() {
  const temp = `${stateFile}.tmp`;
  fs.writeFileSync(temp,JSON.stringify(state,null,2),{mode:0o600});
  fs.renameSync(temp,stateFile);
}
function aiKey() { return sessionProvider === state.settings.provider ? sessionKey : state.settings.provider === envProvider ? (process.env.QIANCHUAN_AI_KEY || '') : ''; }
function publicState() { return { ...state, stats:{ themes:themeStats(state), structures:structureStats(state.videos) }, ai:{ configured:Boolean(aiKey()), busy, keySource:sessionProvider === state.settings.provider ? '当前服务进程' : aiKey() ? '环境变量' : '未连接', providers:Object.entries(providers).map(([key,p])=>({key,name:p.name,model:p.model})) } }; }
function respond(res,code,value) { res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(value)); }
async function bodyOf(req) {
  const chunks=[]; let bytes=0;
  for await (const chunk of req) { bytes += chunk.length; if (bytes > 2_000_000) throw new InputError('上传内容过大，单次上限 2MB'); chunks.push(chunk); }
  const content=Buffer.concat(chunks).toString('utf8');
  try { return content ? JSON.parse(content) : {}; } catch { throw new InputError('请求不是有效 JSON'); }
}
function scriptItem(result,body,extra={}) {
  const parent = state.scripts.find(s=>s.id===body.parentId);
  return { id:id(),createdAt:now(),mode:body.mode || 'template',version:parent ? parent.version+1 : 1,parentId:parent?.id || null,reviewId:body.reviewId || null,themeId:body.themeId,result,productSnapshot:structuredClone(state.product),...extra };
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
    state.scripts.push(scriptItem(result,{mode:'manual',parentId:original.id,themeId:original.themeId},{productSnapshot:structuredClone(original.productSnapshot)}));
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
const port=Number(process.env.PORT || 3000), host=process.env.HOST || '127.0.0.1';
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  try {
    const route=new URL(req.url,'http://localhost').pathname;
    if (route.startsWith('/api/')) {
      if (req.headers.origin && req.headers.origin!==`http://${req.headers.host}` && req.headers.origin!==`https://${req.headers.host}`) return respond(res,403,{error:'不允许跨站访问'});
      if (req.method==='GET' && route==='/api/health') return respond(res,200,{ok:true,app:'千川研习社'});
      if (req.method==='GET' && route==='/api/state') return respond(res,200,publicState());
      if (req.method==='GET' && route==='/api/export') {
        res.setHeader('Content-Disposition','attachment; filename="qianchuan-workspace.json"');
        return respond(res,200,{...state,exportedAt:now()});
      }
      if (req.method!=='POST') return respond(res,404,{error:'接口不存在'});
      if (!req.headers['content-type']?.startsWith('application/json')) return respond(res,415,{error:'请使用 JSON 请求'});
      const b=await bodyOf(req);
      if (!b || typeof b!=='object' || Array.isArray(b)) throw new InputError('请求格式不正确');
      if (busy) return respond(res,409,{error:'AI 正在分析，请等待完成后再保存资料'});
      if (route.startsWith('/api/ai/')) {
        busy=true;
        try { return respond(res,200,await runAI(route,b)); } finally { busy=false; }
      }
      return respond(res,200,await mutate(route,b));
    }
    const assets = {'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/styles.css':['styles.css','text/css; charset=utf-8']};
    if (route==='/vendor/papaparse.min.js' && req.method==='GET') {
      res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'public, max-age=86400'});
      return fs.createReadStream(path.join(root,'node_modules/papaparse/papaparse.min.js')).pipe(res);
    }
    const asset=assets[route];
    if (!asset || req.method!=='GET') {res.writeHead(404); return res.end('Not found');}
    res.writeHead(200,{'Content-Type':asset[1],'Cache-Control':'no-cache'});
    fs.createReadStream(path.join(root,'public',asset[0])).pipe(res);
  } catch(error) {
    respond(res,error instanceof InputError?400:500,{error:error instanceof InputError?error.message:'服务发生异常，请检查服务端状态后重试'});
    if (!(error instanceof InputError)) console.error('Request failed:',error.name);
  }
});
server.listen(port,host,()=>console.log(`千川研习社已启动，监听 ${host}:${server.address().port}`));
