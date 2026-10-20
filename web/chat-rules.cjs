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
  else if (/(经典|竖屏大字|classic)/i.test(t)) addShot('sceneStyle', 'classic', '场景风格 → classic 经典');
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
  if (/(关|关掉|取消|去掉|不要|无需).{0,3}(逐词|卡拉)/.test(t)) addCfg(['compose', 'karaoke'], false, '关闭逐词高亮（整句白字）');
  else if (/(打开|开启|恢复).{0,3}(逐词|卡拉)/.test(t)) addCfg(['compose', 'karaoke'], true, '开启逐词高亮');
  else if (/(关|关掉|取消|去掉|不要|无需).{0,3}字幕/.test(t)) addShot('captions', false, '字幕 → 关');
  else if (/(打开|开启|加上|恢复).{0,3}字幕/.test(t)) addShot('captions', true, '字幕 → 开');

  // ⑤ BGM：降调 / 音量
  if (/(关|关掉|取消|去掉|不要).{0,4}(降调|降半音)/.test(t)) addCfg(['compose', 'bgm', 'outroPitchSemitones'], 0, '收尾降调 → 关');
  else if (/(降调|降半音)/.test(t)) {
    const m = /[^0-9]{0,6}(\d{1,2})\s*个半音/.exec(t); // 「降调 3 个半音」「降 3 个半音」都吃
    const n = m ? Math.min(12, Math.max(1, +m[1])) : 2;
    addCfg(['compose', 'bgm', 'outroPitchSemitones'], -n, `BGM 收尾降调 → ${-n} 半音（默认段长 2s）`);
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
    from: Math.max(from, 1),
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

module.exports = { parseNeed };
