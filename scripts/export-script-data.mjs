import fs from 'node:fs/promises';
import {batch,scripts} from '../config/script-catalog.mjs';
import {catalogScripts} from '../lib/catalog.mjs';
const profile=JSON.parse(await fs.readFile(new URL('../config/product-profile.json',import.meta.url),'utf8'));
await fs.mkdir(new URL('../dist/',import.meta.url),{recursive:true});
await fs.writeFile(new URL('../dist/20条脚本数据.json',import.meta.url),JSON.stringify({batch,definitions:scripts,scripts:catalogScripts(profile)},null,2));
console.log('已导出20条完整脚本数据');
