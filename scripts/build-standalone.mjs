import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'dist');
const result=await build({absWorkingDir:root,entryPoints:['lib/browser-entry.mjs'],bundle:true,write:false,format:'esm',target:['chrome100','edge100'],minify:true,legalComments:'inline',charset:'utf8'});
const script=result.outputFiles[0].text.replace(/<\/script/gi,'<\\/script');
const css=(await fs.readFile(path.join(root,'public/styles.css'),'utf8')).replace(/^@import[^\n]*\n/,'');
const template=await fs.readFile(path.join(root,'public/index.html'),'utf8');
const csp="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src https://api.deepseek.com https://api.openai.com https://dashscope.aliyuncs.com; object-src 'none'; base-uri 'none'; form-action 'none'";
const html=template.replace('<title>千川研习社 · 教育脚本工作台</title>','<title>千川研习社 · 双击打开版</title>')
 .replace('  <link rel="stylesheet" href="/styles.css">',`  <meta http-equiv="Content-Security-Policy" content="${csp}">\n  <style>${css}</style>`)
 .replace('  <script src="/vendor/papaparse.min.js" defer></script>','')
 .replace('  <script type="module" src="/app.js"></script>','')
 .replace('</body>',`<noscript>请启用浏览器 JavaScript，才能使用工作台。</noscript>\n<script type="module">${script}</script>\n</body>`);
await fs.mkdir(out,{recursive:true});
await fs.writeFile(path.join(out,'千川研习社-双击打开.html'),html);
await fs.copyFile(path.join(root,'THIRD_PARTY_NOTICES.md'),path.join(out,'开源许可.txt'));
await fs.copyFile(path.join(root,'docs/打开工作台.txt'),path.join(out,'先看这里-打开方法.txt'));
console.log(`已生成双击打开版：${path.join(out,'千川研习社-双击打开.html')} (${Buffer.byteLength(html)} bytes)`);
