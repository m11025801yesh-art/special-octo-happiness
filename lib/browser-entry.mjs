import Papa from 'papaparse';
import profile from '../config/product-profile.json';
import { emptyState, InputError } from './domain.mjs';
import { createWorkspace } from './workspace.mjs';
import { mergeCatalog } from './catalog.mjs';

globalThis.Papa=Papa;
const storageKey='qianchuan.personal.workspace.v1';
const networkFetch=globalThis.fetch.bind(globalThis);
let workspace,initializationError='',knownValue;
try {
  knownValue=localStorage.getItem(storageKey);
  const initial=knownValue?JSON.parse(knownValue):emptyState();
  if (!knownValue) initial.product=profile;
  if(initial.schemaVersion!==1 || !initial.product || !Array.isArray(initial.comments) || !initial.settings) throw new Error('资料格式不正确');
  mergeCatalog(initial,profile);
  workspace=createWorkspace({initial,localMode:true,persist:next=>{
    if(localStorage.getItem(storageKey)!==knownValue) throw new InputError('另一窗口已更新资料，请先刷新本页再操作，避免覆盖新内容');
    const json=JSON.stringify(next);
    try{localStorage.setItem(storageKey,json);knownValue=json;}
    catch{throw new InputError('浏览器未能保存资料，本次更改未生效。请检查是否使用隐私模式或存储空间已满，并导出已有资料备份。');}
  }});
}catch{
  initializationError='无法读取本机资料。请使用 Chrome 或 Edge 的普通窗口打开这个 HTML 文件；如果已有资料，请保留浏览器数据，不要清除缓存。';
}
const response=(status,value)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8'}});
globalThis.fetch=async(input,options={})=>{
  if(typeof input!=='string' || !input.startsWith('/api/')) return networkFetch(input,options);
  if(initializationError) return response(500,{error:initializationError});
  try{
    if(!options.method || options.method==='GET'){
      if(input==='/api/state')return response(200,workspace.getState());
      if(input==='/api/export')return response(200,workspace.exportState());
      if(input==='/api/health')return response(200,{ok:true,edition:'downloadable'});
      return response(404,{error:'操作不存在'});
    }
    const body=JSON.parse(options.body||'{}');
    return response(200,await workspace.request(input,body));
  }catch(error){
    let message=error instanceof InputError?error.message:'操作未完成，请检查内容后重试';
    if(message.includes('无法连接 AI 服务')) message='浏览器无法连接 AI 服务。请检查本机网络、服务商的地区与浏览器跨域限制；本次没有生成结果，其他本地功能仍可使用。';
    return response(400,{error:message});
  }
};

if(!location.hash) location.hash='scripts';
await import('../public/app.js');
