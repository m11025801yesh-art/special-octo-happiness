import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emptyState, InputError } from './lib/domain.mjs';
import { createWorkspace } from './lib/workspace.mjs';
import { mergeCatalog } from './lib/catalog.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(root,'.data');
fs.mkdirSync(dataDir,{recursive:true,mode:0o700});
const stateFile = path.join(dataDir,'workspace.json');
let state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile,'utf8')) : emptyState();
if (!fs.existsSync(stateFile)) {
  const profile=path.join(root,'config/product-profile.json');
  if (fs.existsSync(profile)) state.product=JSON.parse(fs.readFileSync(profile,'utf8'));
}
if(process.env.QIANCHUAN_NO_CATALOG!=='1') mergeCatalog(state,JSON.parse(fs.readFileSync(path.join(root,'config/product-profile.json'),'utf8')));
const workspace=createWorkspace({initial:state,environmentKey:()=>process.env.QIANCHUAN_AI_KEY||'',environmentProvider:process.env.QIANCHUAN_AI_PROVIDER||'deepseek',persist:next=>{
  const temp=`${stateFile}.tmp`;
  fs.writeFileSync(temp,JSON.stringify(next,null,2),{mode:0o600});
  fs.renameSync(temp,stateFile);
}});
function respond(res,code,value) { res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(value)); }
async function bodyOf(req) {
  const chunks=[]; let bytes=0;
  for await (const chunk of req) { bytes += chunk.length; if (bytes > 2_000_000) throw new InputError('上传内容过大，单次上限 2MB'); chunks.push(chunk); }
  const content=Buffer.concat(chunks).toString('utf8');
  try { return content ? JSON.parse(content) : {}; } catch { throw new InputError('请求不是有效 JSON'); }
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
      if (req.method==='GET' && route==='/api/state') return respond(res,200,workspace.getState());
      if (req.method==='GET' && route==='/api/export') {
        res.setHeader('Content-Disposition','attachment; filename="qianchuan-workspace.json"');
        return respond(res,200,workspace.exportState());
      }
      if (req.method!=='POST') return respond(res,404,{error:'接口不存在'});
      if (!req.headers['content-type']?.startsWith('application/json')) return respond(res,415,{error:'请使用 JSON 请求'});
      const b=await bodyOf(req);
      if (!b || typeof b!=='object' || Array.isArray(b)) throw new InputError('请求格式不正确');
      return respond(res,200,await workspace.request(route,b));
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
