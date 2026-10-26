// web/chat-rules.cjs —— 聊天需求文本 → 补丁（P3-4 规则版；qwen 适配器接入后同一出参形态互换）
// 设计：宁缺勿错。一条规则都没匹配 = 明说没听懂，绝不猜着改；
//       多条可同时命中（累积成一次重跑），回复里逐条列出=审计。
// 出参：{ shots, config, rateSet, rateDelta, from, desc }
//       shots/config 与 /api/rerun 补丁同构；from=受影响步骤最大值（1 配音/3 场景/5 合成）。

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
function mergeInto(dst, src) {
  for (const k of Object.keys(src)) {
    if (isObj(src[k]) && isObj(dst[k])) mergeInto(dst[k], src[k]);
    else dst[k] = src[k];
  }
  return dst;
}

function parseNeed(text, techniques) {
  const t = String(text || '');
  const shots = {};
  const config = {};
  const desc = [];
  const cfgPaths = new Set(); // 已写过的 config 键路径（技术库先落的，泛化规则不重复覆盖）
  let from = 0;

  const setIn = (keys, v) => {
    let o = config;
    for (const k of keys.slice(0, -1)) o = o[k] || (o[k] = {});
    o[keys[keys.length - 1]] = v;
  };
  const addShot = (k, v, d) => { if (!(k in shots)) { shots[k] = v; desc.push(d); from = Math.max(from, 3); } };
  const addCfg = (keys, v, d) => {
    const id = keys.join('.');
    if (cfgPaths.has(id)) return;
    cfgPaths.add(id); setIn(keys, v); desc.push(d); from = Math.max(from, 5);
  };

  // ① 技术库点名（整名匹配优先于泛化规则，卡片自带 from/shots/config）
  for (const tech of techniques || []) {
    if (!tech || tech.error || !tech.insert || !tech.name) continue;
    if (!t.includes(tech.name)) continue;
    const ins = tech.insert;
    if (ins.shots) for (const k of Object.keys(ins.shots)) addShot(k, ins.shots[k], `技术库「${tech.name}」：${k} → ${JSON.stringify(ins.shots[k])}`);
    if (ins.config) { mergeInto(config, ins.config); desc.push(`技术库「${tech.name}」：${ins.note || '配方已应用'}`); from = Math.max(from, ins.from || 5); for (const kp of flatPaths(ins.config)) cfgPaths.add(kp); }
  }

  // ② 场景风格 / 画幅
  if (/(演示风|大屏|幻灯|deck)/i.test(t)) addShot('sceneStyle', 'deck', '场景风格 → deck 演示风');
  else if (/(纸感|纸质|浅色|奶油|米色|paper)/i.test(t)) addShot('sceneStyle', 'paper', '场景风格 → paper 纸感浅色');
  else if (/(经典|竖屏大字|classic)/i.test(t)) addShot('sceneStyle', 'classic', '场景风格 → classic 经典');
  // 平台规格（P6）：平台自带画幅。带轻量否定守卫（"别发抖音"不认，正反两种语序都挡）——
  // 拿不准就什么都不做（宁缺勿错），语义拿不准时由 qwen 语义解析兜
  const platNeg = /(不要|别|不是|不用|无需|非|不发|别发)\s*发?\s*(抖音|B站|b站|哔哩|bilibili|视频号|小红书)/i
    || /(抖音|B站|b站|哔哩|bilibili|视频号|小红书)\s*(不发|不要|别发|不了|算了)/i;
  let plat = '';
  if (!platNeg.test(t)) {
    if (/(抖音|douyin)/i.test(t)) plat = 'douyin';
    else if (/(B站|哔哩|bilibili)/i.test(t)) plat = 'bilibili';
    else if (/视频号/.test(t)) plat = 'shipinhao';
    else if (/小红书/.test(t)) plat = 'xiaohongshu';
  }
  if (plat) addShot('platform', plat, `平台 → ${plat}（按 config.platforms 出画幅/时长档）`);
  // 画幅词照常写 width/height：与平台值一致 → 02 放行；矛盾（"发抖音但要横屏"）→ 02 精确 fail
  if (/横屏|16[:：]9/.test(t) && !/竖屏|9[:：]16/.test(t)) { addShot('width', 1920, '画幅 → 横屏 16:9'); addShot('height', 1080, '画幅 → 横屏 16:9'); }
  else if (/竖屏|9[:：]16/.test(t)) { addShot('width', 1080, '画幅 → 竖屏 9:16'); addShot('height', 1920, '画幅 → 竖屏 9:16'); }

  // ③ 封面
  if (/(封面.{0,6}(大字|高对比)|(大字|高对比).{0,4}封面)/.test(t)) addShot('coverStyle', 'bold', '封面 → bold 高对比大字');
  else if (/封面.{0,4}杂志|杂志.{0,4}封面/.test(t)) addShot('coverStyle', 'magazine', '封面 → magazine 杂志留白');
  else if (/封面.{0,4}(科技|暗色)/.test(t)) addShot('coverStyle', 'tech', '封面 → tech 暗色科技');

  // ④ 字幕：先字号（避免「字幕大一点」误触开关词），再开关/高亮
  const cs = /字幕\s*(\d{2,3})\s*号?/.exec(t);
  if (cs) addCfg(['compose', 'captionSize'], Math.min(120, Math.max(30, +cs[1])), `字幕字号 → ${cs[1]}`);
  else if (/字幕.{0,4}(大|加大|变大)/.test(t)) addCfg(['compose', 'captionSize'], 76, '字幕字号 → 76（加大）');
  else if (/字幕.{0,4}(小|减小|变小)/.test(t)) addCfg(['compose', 'captionSize'], 48, '字幕字号 → 48（减小）');
  // 字幕样式：还原/描边意图优先判定——否定句（"去掉黑底条"/"黑底条去掉"两种语序）必须先于
  // bar 匹配，否则含"黑底"二字的否定句会被反着改成黑底条
  const wantOutline = /(描边|换回|改回)/.test(t)
    || /(去掉|取消|关掉).{0,3}(黑底|黑条|底条|字幕条)/.test(t)
    || /(黑底|黑条|底条|字幕条).{0,4}(去掉|取消|关掉|换掉)/.test(t);
  if (wantOutline) addCfg(['compose', 'captionStyle'], 'outline', '字幕样式 → outline 描边白字（缺省）');
  else if (/(黑底|黑条|底条|字幕条)/.test(t)) addCfg(['compose', 'captionStyle'], 'bar', '字幕样式 → bar 黑底实底条');
  if (/(关|关掉|取消|去掉|不要|无需).{0,3}(逐词|卡拉)/.test(t)) addCfg(['compose', 'karaoke'], false, '关闭逐词高亮（整句白字）');
  else if (/(打开|开启|恢复).{0,3}(逐词|卡拉)/.test(t)) addCfg(['compose', 'karaoke'], true, '开启逐词高亮');
  else if (/(关|关掉|取消|去掉|不要|无需).{0,3}字幕/.test(t)) addShot('captions', false, '字幕 → 关');
  else if (/(打开|开启|加上|恢复).{0,3}字幕/.test(t)) addShot('captions', true, '字幕 → 开');

  // ⑤ BGM：降调 / 延迟回声 / 音量
  if (/(关|关掉|取消|去掉|不要).{0,4}(降调|降半音)/.test(t)) addCfg(['compose', 'bgm', 'outroPitchSemitones'], 0, '收尾降调 → 关');
  else if (/(降调|降半音)/.test(t)) {
    const m = /[^0-9]{0,6}(\d{1,2})\s*个半音/.exec(t); // 「降调 3 个半音」「降 3 个半音」都吃
    const n = m ? Math.min(12, Math.max(1, +m[1])) : 2;
    addCfg(['compose', 'bgm', 'outroPitchSemitones'], -n, `BGM 收尾降调 → ${-n} 半音（默认段长 2s）`);
  }
  // 延迟回声：须「回声/echo + 上下文」才动手（位置词/动作词/效果词），疑问句不碰——宁缺勿错
  if (/(回声|echo)/i.test(t)) {
    const off = /(关|关掉|取消|去掉|不要|无需).{0,4}(回声|echo)/i.test(t) || /(回声|echo).{0,4}(关掉|关|取消|去掉)/i.test(t);
    const on = /(结尾|收尾|末尾|片尾|甩)/.test(t)
      || /(加|来|挂|用|带|给|开|上|放|整).{0,6}(回声|echo)/i.test(t)
      || /(回声|echo).{0,4}(收尾|结尾|效果|段)/i.test(t);
    if (off) addCfg(['compose', 'bgm', 'outroEcho'], false, '收尾延迟回声 → 关');
    else if (on) addCfg(['compose', 'bgm', 'outroEcho'], true, 'BGM 收尾延迟回声 → 开（1.5s/强度50 教学档）');
  }
  if (/(BGM|音乐|背景乐|伴奏).{0,6}(小声|轻|低|弱)/i.test(t)) addCfg(['compose', 'bgm', 'volume'], 0.10, 'BGM 音量 → 0.10（更轻）');
  else if (/(BGM|音乐|背景乐|伴奏).{0,6}(大声|响|高|强)/i.test(t)) addCfg(['compose', 'bgm', 'volume'], 0.24, 'BGM 音量 → 0.24（更响）');

  // ⑥ 转场
  if (/转场.{0,5}(慢|长|绵)/.test(t)) addCfg(['compose', 'transitionSec'], 0.8, '转场 → 0.8s 绵长');
  else if (/转场.{0,5}(快|短|干脆)/.test(t)) addCfg(['compose', 'transitionSec'], 0.2, '转场 → 0.2s 干脆');

  // ⑦ 语速（改语速=重配音 → from=1；「快一点/慢一点」须整句独立或带语速/节奏字样，避免「转场快一点」误伤）
  let rateSet = null, rateDelta = 0;
  const rs = /语速\s*([\d.]+)\s*字?/.exec(t);
  if (rs && +rs[1] >= 2 && +rs[1] <= 20) { rateSet = +rs[1]; desc.push(`语速 → ${rateSet} 字/秒（重配音）`); from = Math.max(from, 1); }
  else if (/(语速|节奏).{0,4}(快|加速)/.test(t) || /^(快一点|快一些|加速一下?)$/.test(t.trim())) { rateDelta = 0.6; desc.push('语速 → +0.6 字/秒（重配音）'); from = Math.max(from, 1); }
  else if (/(语速|节奏).{0,4}(慢|减速)/.test(t) || /^(慢一点|慢一些|减速一下?)$/.test(t.trim())) { rateDelta = -0.6; desc.push('语速 → -0.6 字/秒（重配音）'); from = Math.max(from, 1); }

  return {
    shots: Object.keys(shots).length ? shots : null,
    config: Object.keys(config).length ? config : null,
    rateSet,
    rateDelta,
    // 画幅类补丁（platform/width/height）在 02 解析进 timeline → from 必须含 02：
    // addShot 默认给 3，但 --from 3 跳过 02 会留旧画幅时间轴（startRerun 侧还有同口径兜底）
    from: Math.min(Math.max(from, 1), shots.platform || shots.width || shots.height ? 2 : Infinity),
    desc,
  };
}

// 展平嵌套对象的键路径（供 cfgPaths 去重用）
function flatPaths(obj, prefix = []) {
  const out = [];
  for (const k of Object.keys(obj)) {
    const p2 = [...prefix, k];
    if (isObj(obj[k])) out.push(...flatPaths(obj[k], p2));
    else out.push(p2.join('.'));
  }
  return out;
}

// shots 补丁白名单（/api/rerun 与 qwen 语义解析同表——宁 fail 勿兜底的单一出处）
// platform 值必须在 config.platforms 表内（动态查 config，表是加平台的单一出处）
const { loadConfig } = require('../pipeline/lib/common.cjs');
const SHOTS_PATCH = {
  sceneStyle: (v) => ['classic', 'deck', 'paper'].includes(v),
  coverStyle: (v) => ['tech', 'bold', 'magazine'].includes(v),
  captions: (v) => typeof v === 'boolean',
  width: (v) => Number.isInteger(+v) && +v >= 360 && +v <= 4320,
  height: (v) => Number.isInteger(+v) && +v >= 360 && +v <= 4320,
  voice: (v) => typeof v === 'string' && v.length > 0 && v.length < 60,
  targetCharsPerSec: (v) => +v >= 2 && +v <= 20,
  platform: (v) => typeof v === 'string' && /^[a-z][a-z0-9_-]{0,23}$/.test(v) && Object.keys(loadConfig().platforms || {}).includes(v),
};

// —— Editor 轻改（P9）：shots.shots[] 单镜字段白名单 ——
// 与 SHOTS_PATCH 同打法：字段 → 校验函数；身份字段 id/n、镜数与顺序由 /api/editor/shots 守住
// （轻改边界 = 不增删不排序镜头，结构调整归「重剪」段另立项）；类型必填项（keyword/split/title/end）
// 与素材文件存在性由 server 路由做语境校验；口径来源 skills/script.md 二·schema（字段全集扫自现存任务）
const TYPE_WL = ['title', 'bullet', 'split', 'keyword', 'transition', 'end'];
const sMax = (max) => (v) => typeof v === 'string' && v.length <= max;
const SHOT_EDIT = {
  type: (v) => typeof v === 'string' && TYPE_WL.includes(v),
  narration: (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 200,
  title: sMax(80),
  subtitle: sMax(150),
  kicker: sMax(40),
  heading: sMax(60),
  quote: sMax(150),
  keyword: sMax(30),
  note: sMax(150),
  index: sMax(8),
  nav: sMax(20),
  tags: (v) => Array.isArray(v) && v.length <= 8 && v.every((x) => typeof x === 'string' && x.length <= 30),
  items: (v) => Array.isArray(v) && v.length <= 10 && v.every((x) =>
    (typeof x === 'string' && x.length <= 60)
    || (x && typeof x === 'object' && !Array.isArray(x)
      && Object.keys(x).every((k) => k === 't' || k === 'd')
      && typeof x.t === 'string' && x.t.trim().length > 0 && x.t.length <= 60
      && (x.d === undefined || (typeof x.d === 'string' && x.d.length <= 120)))),
  media: (v) => v === '' || sMax(120)(v),
  asset: (v) => v === '' || sMax(120)(v),
};

module.exports = { parseNeed, SHOTS_PATCH, SHOT_EDIT, TYPE_WL };
