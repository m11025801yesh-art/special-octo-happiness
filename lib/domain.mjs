export const id = () => globalThis.crypto.randomUUID();
export const now = () => new Date().toISOString();
export function emptyState() {
  return { schemaVersion: 1, product: { name: '', audience: '高中生家长', price: '', delivery: '', features: '', evidence: '', boundaries: '' }, comments: [], themes: [], videos: [], competitors: [], mappings: [], scripts: [], reviews: [], agentTasks: [], settings: { provider: 'deepseek', model: 'deepseek-chat' } };
}
export class InputError extends Error {}
export function required(value, label, max = 20000) {
  if (typeof value !== 'string' || !value.trim()) throw new InputError(`请填写${label}`);
  if (value.length > max) throw new InputError(`${label}内容过长（最多 ${max} 字）`);
  return value.trim();
}
export function text(value, max = 20000) {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > max) throw new InputError('字段类型不正确或内容过长');
  return value.trim();
}
export function safeUrl(value) {
  const u = text(value, 2000);
  if (!u) return '';
  try { if (!['http:', 'https:'].includes(new URL(u).protocol)) throw new Error(); }
  catch { throw new InputError('来源链接必须以 http:// 或 https:// 开头'); }
  return u;
}
const normalize = value => value.normalize('NFKC').replace(/[\s\p{P}]/gu, '').toLowerCase();
export function importComments(state, body) {
  const rows = body.rows ?? required(body.text, '评论内容', 180000).split('\n').filter(x => x.trim()).map(x => ({ text: x, source: body.source, url: body.url, audience: body.audience }));
  if (!Array.isArray(rows) || !rows.length || rows.length > 1000) throw new InputError('每次请导入 1–1000 条评论');
  if (state.comments.length + rows.length > 10000) throw new InputError('当前版本最多保存 10000 条评论，请先导出备份');
  const seen = new Set(state.comments.map(c => normalize(c.text)));
  const additions = []; let duplicates = 0;
  for (const row of rows) {
    const value = required(row.text, '评论', 4000), key = normalize(value);
    if (!key) throw new InputError('评论不能只有标点或空格');
    if (seen.has(key)) { duplicates++; continue; }
    seen.add(key);
    additions.push({ id: id(), text: value, source: text(row.source, 200) || '手动导入', url: safeUrl(row.url), audience: text(row.audience, 200) || state.product.audience, createdAt: now() });
  }
  state.comments.push(...additions);
  return { added: additions.length, duplicates };
}
const rules = [
  { label: '努力很多，方法没有迁移', keywords: ['刷题', '没提高', '没进步', '不会用', '不会做', '换个', '举一反三', '方法'], need: '找到学习投入与实际解题之间的断点' },
  { label: '错题整理后依旧反复错', keywords: ['错题', '又错', '再错', '整理', '复盘'], need: '让错题整理变成能执行的复习动作' },
  { label: '时间不够，安排难落地', keywords: ['时间', '熬夜', '来不及', '计划', '效率', '作业', '安排'], need: '在现有时间内安排清晰、可执行的学习任务' },
  { label: '家长想帮忙，却容易冲突', keywords: ['吵', '沟通', '不听', '家长', '催', '焦虑', '陪'], need: '降低家长参与学习时的沟通成本' },
  { label: '担心买了不适合、坚持不下去', keywords: ['适合', '基础', '坚持', '买过', '价格', '贵', '多少钱', '退款', '有用'], need: '先判断适用边界，再决定是否购买' },
];
export function ruleThemes(comments) {
  const themes = rules.map(r => ({ ...r, id: id(), commentIds: comments.filter(c => r.keywords.some(k => c.text.includes(k))).map(c => c.id), method: '关键词规则', createdAt: now() })).filter(t => t.commentIds.length);
  const assigned = new Set(themes.flatMap(t => t.commentIds));
  const rest = comments.filter(c => !assigned.has(c.id));
  if (rest.length) themes.push({ id: id(), label: '待人工归类', keywords: [], need: '这些样本尚未识别出主题，请人工确认或使用 AI 归类', commentIds: rest.map(c => c.id), method: '关键词规则', createdAt: now() });
  return themes;
}
export function validateThemes(result, comments) {
  if (!Array.isArray(result.themes) || !result.themes.length || result.themes.length > 30) throw new InputError('AI 没有返回有效主题，请重试');
  const valid = new Set(comments.map(c => c.id));
  const themes = result.themes.map(t => {
    if (!Array.isArray(t.commentIds) || t.commentIds.some(v => !valid.has(v))) throw new InputError('AI 引用了不存在的评论，本次结果未保存');
    const refs = [...new Set(t.commentIds)];
    if (!refs.length) throw new InputError('主题缺少原始评论证据');
    return { id: id(), label: required(t.label, '主题', 120), need: text(t.need, 2000), keywords: Array.isArray(t.keywords) ? t.keywords.map(k => text(k, 100)).slice(0, 15) : [], commentIds: refs, method: 'AI 归类 · 待核验', createdAt: now() };
  });
  const assigned = new Set(themes.flatMap(t => t.commentIds));
  const rest = comments.filter(c => !assigned.has(c.id));
  if (rest.length) themes.push({ id: id(), label: '待人工归类', need: 'AI 尚未归类的样本', keywords: [], commentIds: rest.map(c => c.id), method: '待核验', createdAt: now() });
  return themes;
}
export function themeStats(state) {
  const ids = new Set(state.comments.map(c => c.id));
  return state.themes.map(t => {
    const count = new Set(t.commentIds.filter(x => ids.has(x))).size;
    return { ...t, count, percent: state.comments.length ? +(count / state.comments.length * 100).toFixed(1) : 0 };
  }).sort((a,b) => b.count - a.count);
}
export function structureStats(videos) {
  const counts = new Map();
  for (const video of videos) {
    const key = video.analysis?.structure || video.structure;
    if (!key) continue;
    const row = counts.get(key) || { label: key, count: 0, videoIds: [] };
    row.count++; row.videoIds.push(video.id); counts.set(key, row);
  }
  return [...counts.values()].sort((a,b) => b.count - a.count);
}
function optionalNumber(value, label, max = Number.MAX_SAFE_INTEGER) {
  if (value === '' || value == null) return null;
  if (typeof value !== 'number' && typeof value !== 'string') throw new InputError(`${label}必须是数字`);
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > max) throw new InputError(`${label}数值不正确`);
  return n;
}
export function buildReview(body, scripts) {
  const script = scripts.find(s => s.id === body.scriptId);
  if (!script) throw new InputError('请选择已有脚本');
  const counts = {};
  for (const [key,label] of Object.entries({ impressions: '曝光数', clicks: '点击数', conversions: '成交数', plays: '视频播放数', plays3: '播放达到 3 秒次数', completes: '完整播放数', spend: '消耗' })) {
    counts[key] = optionalNumber(body[key],label);
    if (key !== 'spend' && counts[key] != null && !Number.isInteger(counts[key])) throw new InputError(`${label}必须为整数`);
  }
  for (const [num,den] of [['clicks','impressions'],['conversions','clicks'],['plays3','plays'],['completes','plays'],['completes','plays3']]) {
    if (counts[num] != null && counts[den] != null && counts[num] > counts[den]) throw new InputError('漏斗计数不一致，请使用同一统计周期及去重口径');
  }
  const metrics = {}, baseline = {}, origins = {};
  for (const [key,num,den] of [['ctr','clicks','impressions'],['cvr','conversions','clicks'],['hold3','plays3','plays'],['completion','completes','plays']]) {
    const direct = optionalNumber(body[key],key.toUpperCase(),100);
    const hasPair = counts[num] != null && counts[den] != null;
    if (hasPair && counts[den] === 0 && direct != null) throw new InputError('分母为零时无法填写对应比率');
    metrics[key] = hasPair ? (counts[den] > 0 ? counts[num] / counts[den] * 100 : null) : direct;
    if (hasPair && metrics[key] != null && direct != null && Math.abs(metrics[key] - direct) > 0.1) throw new InputError('手填百分比与计数计算结果不一致，请检查数据');
    origins[key] = hasPair ? `${num}/${den}` : direct != null ? '手动百分比' : '未提供';
    baseline[key] = optionalNumber(body.baseline?.[key], '对照基准',100);
  }
  if (Object.values(metrics).every(v => v === null)) throw new InputError('请至少填写一项有效指标或完整的分子、分母');
  const recommendations = [];
  const advice = {
    hold3: ['0–3 秒开头', '测试具体学习场景与反常识开头，画面在第一秒展示问题', '仅更换开头，其余台词、定向和预算保持一致'],
    ctr: ['产品演示与行动引导', '检查观众是否看懂产品做什么、适合谁，以及点击后能看到什么', '对比两种产品演示或行动引导，每轮只改变一处'],
    cvr: ['证据、适用边界与承接页', '核对价格、交付、证据与落地页是否一致，同时排查购买流程', '先确认承接页和交易链路，再测试证据展示段'],
    completion: ['中段节奏与信息密度', '删去重复铺垫，将一个可展示的操作步骤提前', '保持开头一致，对比简洁中段和原版中段'],
  };
  for (const [key,value] of Object.entries(metrics)) {
    if (value == null) continue;
    const below = baseline[key] != null && value < baseline[key];
    const [segment,hypothesis,experiment] = advice[key];
    recommendations.push({ metric: key, segment, value, baseline: baseline[key], priority: below ? '优先测试' : baseline[key] == null ? '需要对照' : '继续观察', hypothesis: below ? hypothesis : baseline[key] == null ? `缺少可比基准，暂不判断好坏。可检查：${hypothesis}` : '当前不低于手填基准，暂不据此重写；结合样本量和其他指标判断。', experiment });
  }
  recommendations.sort((a,b) => (a.priority === '优先测试' ? -1 : 0) - (b.priority === '优先测试' ? -1 : 0));
  return { id: id(), scriptId: script.id, createdAt: now(), label: required(body.label, '投放周期或批次名称', 200), counts, metrics, origins, baseline, recommendations, notes: text(body.notes,4000), caveat: '指标用于提出测试假设，不能单独证明脚本造成了转化变化。请保持人群、出价、版位、周期、归因窗口和事件口径可比。' };
}
export function validateScript(result, state) {
  required(result.title, '脚本标题', 200);
  if (!Array.isArray(result.shots) || result.shots.length < 3 || result.shots.length > 15) throw new InputError('脚本分镜格式不完整，请重试');
  for (const shot of result.shots) {
    for (const key of ['seconds','visual','voice','purpose']) required(shot[key], '分镜内容', 4000);
    text(shot.overlay, 2000);
  }
  for (const [key,items] of [['sourceCommentIds',state.comments],['sourceVideoIds',state.videos]]) {
    if (!Array.isArray(result[key])) throw new InputError('脚本缺少来源索引');
    const valid = new Set(items.map(i => i.id));
    if (result[key].some(x => !valid.has(x))) throw new InputError('脚本包含不存在的来源，本次结果未保存');
  }
  if (!result.sourceCommentIds.length) throw new InputError('脚本至少需要引用一条原始评论');
  required(result.angle,'创作观点',4000);
  if (!result.critique || !Array.isArray(result.critique.weaknesses) || !Array.isArray(result.critique.strengths)) throw new InputError('脚本缺少自检结果');
  for (const items of [result.critique.weaknesses,result.critique.strengths,result.evidenceGaps]) {
    if (!Array.isArray(items) || items.some(x=>typeof x!=='string')) throw new InputError('脚本自检或证据缺口格式不完整');
  }
  required(result.structure,'脚本结构',2000); required(result.critique.nextTest,'测试建议',6000);
  return result;
}
export function templateScript(state, body) {
  const p = state.product;
  required(p.name, '产品名称'); required(p.features,'产品卖点'); required(p.delivery,'交付内容');
  const theme = themeStats(state).find(t => t.id === body.themeId) || themeStats(state).find(t => t.label !== '待人工归类');
  if (!theme) throw new InputError('请先导入评论并整理痛点');
  const c = state.comments.find(c => theme.commentIds.includes(c.id));
  const feature = p.features.split('\n').filter(Boolean)[0];
  const line = ['A','B','C'].includes(body.line) ? body.line : 'A';
  const selectedLine=p[`track${line}`] || feature;
  return {
    title: `${line}线 · ${theme.label}｜脚本骨架`, angle: `围绕“${theme.need}”展示一个具体操作。此版本为规则模板，尚未完成语义匹配。主线要求：${selectedLine}`,
    structure: '真实问题 → 原因假设 → 产品演示 → 适用边界 → 行动引导', sourceCommentIds: c ? [c.id] : [], sourceVideoIds: [],
    shots: [
      { seconds: '0–3s', visual: '展示问题发生时的学习桌面；评论引用请匿名处理', voice: `“${c?.text || theme.label}”——这个问题，你也遇到过吗？`, overlay: theme.label, purpose: '用样本中的真实问题确认受众' },
      { seconds: '3–10s', visual: '对比原先的学习步骤和准备演示的步骤', voice: '先别急着增加任务。我们先把卡住的那一步找出来。', overlay: '先找卡点，再看方法', purpose: '提出可验证的切入点，不诊断所有人的原因' },
      { seconds: '10–25s', visual: `按 ${line} 线准备一个真实操作：${selectedLine}`, voice: `这是${p.name}。[补充与该痛点对应的真实操作：输入什么、怎么做、得到什么。]`, overlay: '真实操作演示待补充', purpose: '证明产品如何作用于痛点；当前为待拍摄占位' },
      { seconds: '25–35s', visual: '展示真实交付清单，只选与主线相关的内容；核对产品档案中的适用边界。', voice: '[用一句话说明这段演示对应哪项真实交付，以及适合什么情况。不要把全部产品资料读进台词。]', overlay: '看清交付与适用范围', purpose: '建立准确的购买预期' },
      { seconds: '35–45s', visual: '展示产品详情页中的目录或样张', voice: `如果你也在找这类方法，可以先查看${p.name}的详细介绍，再判断是否适合。`, overlay: p.price ? `价格与购买页核对：${p.price}` : '查看详情与交付内容', purpose: '给出具体且不夸大的下一步' },
    ],
    critique: { strengths: ['开头引用已导入评论', '展示交付内容并保留适用边界'], weaknesses: ['尚未核实产品与痛点的因果对应', '操作演示仍是占位，需要真实材料', '模板未进行 AI 深度拆解或改写'], nextTest: '先补齐真实演示，再对比两个开头；用实际投放验证。' },
    evidenceGaps: [p.evidence ? '已填写的证据仍需人工核实' : '缺少产品证据', '缺少真实操作镜头'], status: '待补充证据',
  };
}
export function demoState() {
  const state = emptyState();
  state.product = { name: '学习复盘工具包（虚构示例）', audience: '高中生家长与希望改善复习方法的高中生', price: '示例 ¥99，非真实销售报价', delivery: '错因分类表、每周复盘模板、3 段操作示范', features: '把错题按知识遗漏、审题、步骤和计算分类\n用周复盘表安排下一次复习\n用演示视频说明如何填写模板', evidence: '演示占位：暂无真实成效证据；不能承诺提分。', boundaries: '需要学生自己执行；不提供学科授课，不承诺分数或升学结果。' };
  importComments(state,{ rows: [
    '孩子每天刷题到很晚，换个问法还是不会做。','错题本写了好几本，考试同样的题还是又错。','不是不努力，感觉一直刷题没有方法。','作业都写不完，哪有时间整理错题？','想帮孩子安排计划，一说就吵起来。','买过不少资料，最怕又是坚持不了。','有没有具体演示怎么做复盘的？','错题抄完从来没再看，整理是不是白忙了？','基础一般的孩子适合吗？想先看样张。','孩子不愿意听我催，家长到底怎么陪？','时间都花在抄题上了，效率太低。','换个题型就不会做，怎么才能举一反三？'
  ].map(t=>({text:t,source:'虚构演示样本',audience:state.product.audience})) });
  state.themes = ruleThemes(state.comments);
  state.videos = [
    { id:id(),title:'错题本越厚，复习越没头绪？（虚构）',category:'高中教育',source:'虚构结构示例',url:'',transcript:'错题本越厚，复习就越有效吗？先翻开一页，问问自己：这题是没学会，还是没看清？把原因分开，再决定下次练什么。今天先试着给三道错题做分类。',visualNotes:'桌面俯拍；前后对比两张纸；手写标记错因。',performance:'虚构示例，没有播放量或成交数据，不能认定为爆款。',structure:'反常识 → 场景问题 → 操作演示 → 行动引导',style:'克制、短句、具体操作',analysis:null,createdAt:now() },
    { id:id(),title:'护肤步骤很多，先看顺序（跨类目虚构示例）',category:'美妆',source:'虚构结构示例',url:'',transcript:'瓶子摆满一桌，就代表护理更到位吗？先看看你每一步在做什么。把重复的步骤圈出来，留下需要的，再看使用说明。先检查顺序，再决定要不要添新品。',visualNotes:'产品桌面镜头；用便签表示步骤；删去重复便签。',performance:'无真实效果数据，仅用于演示跨类目结构迁移。',structure:'反常识 → 场景问题 → 操作演示 → 行动引导',style:'提问开场、实物演示',analysis:null,createdAt:now() },
  ];
  return state;
}
