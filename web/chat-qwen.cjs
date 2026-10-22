// web/chat-qwen.cjs —— qwen 语义解析（P3-5）：需求文本 + 任务当前状态 → 与规则版同构的补丁出参
// 严格模式：只认 JSON；字段白名单 + 范围校验，宁 fail 勿兜底——任何越权/越界都抛错，
// 由调用方捕获后降级规则模式（并把错误种类 quota/api/network 明示给用户）。

const { llmChat } = require('./llm-dashscope.cjs');
const { SHOTS_PATCH } = require('./chat-rules.cjs');

// config 补丁白名单：键路径 → 范围校验（与管线内 fail-fast 同口径，LLM 越权直接整单拒绝）
const CFG_RANGE = {
  'compose.captionSize': (v) => Number.isInteger(+v) && +v >= 30 && +v <= 120,
  'compose.karaoke': (v) => typeof v === 'boolean',
  'compose.transitionSec': (v) => +v >= 0 && +v <= 2,
  'compose.fadeOutSec': (v) => +v >= 0 && +v <= 5,
  'compose.bgm.volume': (v) => +v >= 0 && +v <= 1,
  'compose.bgm.outroPitchSemitones': (v) => Number.isInteger(+v) && +v >= -12 && +v <= 0,
  'compose.bgm.outroPitchSec': (v) => +v >= 0.2 && +v <= 8,
  'compose.bgm.outroEcho': (v) => typeof v === 'boolean',
  'compose.bgm.outroEchoSec': (v) => +v >= 0.2 && +v <= 8,
  'compose.bgm.outroEchoWet': (v) => +v >= 1 && +v <= 100,
};
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);

function systemPrompt(ctx) {
  const techNames = (ctx.techniques || []).map((t) => t.name).join('、') || '（暂无）';
  return `你是视频剪辑助手，把用户的中文改片需求解析成 JSON 补丁。只输出一个 JSON 对象，不要任何解释、不要 Markdown 代码块。
可改字段（其余键一律禁止出现）：
- shots: {"sceneStyle":"classic"|"deck"|"paper", "coverStyle":"tech"|"bold"|"magazine", "captions":布尔, "width":360-4320整数, "height":360-4320整数, "targetCharsPerSec":2-20}
- config（只许这些键路径，值须在范围内）: compose.captionSize(30-120整数), compose.karaoke(布尔), compose.transitionSec(0-2), compose.fadeOutSec(0-5), compose.bgm.volume(0-1), compose.bgm.outroPitchSemitones(-12~0整数，负=降调，0=关), compose.bgm.outroPitchSec(0.2-8), compose.bgm.outroEcho(布尔，收尾延迟回声开关), compose.bgm.outroEchoSec(0.2-8), compose.bgm.outroEchoWet(1-100，回声强度)
- rateSet: 语速绝对值(2-20，无则null)；rateDelta: 语速增减(-2~2，无则0)
- from: 受影响步骤最大值——改语速=1；改 sceneStyle/coverStyle/captions/width/height=3；改 config=5（都没改=1）
- desc: 每处改动一句中文短描述，数组
技术库已有技术（用户点名时直接套用其默认参数）：${techNames}
当前任务状态：shots=${JSON.stringify(ctx.shots || {})}；已生效补丁=${JSON.stringify(ctx.overrides || {})}
规则：只解析明确的改动指令；用户给的数字优先于当前值/默认值；没有可解析的改动时输出 {"desc":[],"from":1}。`;
}

function throwKind(msg, kind) { const e = new Error(msg); e.kind = kind || 'parse'; throw e; }

async function qwenParse(text, ctx, cfg) {
  const raw = await llmChat(cfg, [
    { role: 'system', content: systemPrompt(ctx) },
    { role: 'user', content: text },
  ], true);
  let j;
  try {
    j = JSON.parse(String(raw).replace(/^```(json)?\s*/i, '').replace(/```\s*$/, '').trim());
  } catch { throwKind(`LLM 输出不是合法 JSON：${raw.slice(0, 80)}`); }
  if (!isObj(j)) throwKind('LLM 输出不是对象');
  // shots 白名单
  const shots = {};
  if (j.shots != null) {
    if (!isObj(j.shots)) throwKind('shots 不是对象');
    for (const k of Object.keys(j.shots)) {
      if (!SHOTS_PATCH[k]) throwKind(`shots 越权字段：${k}`);
      if (!SHOTS_PATCH[k](j.shots[k])) throwKind(`shots 非法值：${k}=${JSON.stringify(j.shots[k])}`);
      shots[k] = j.shots[k];
    }
  }
  // config 白名单（键路径 + 范围）
  const config = {};
  if (j.config != null) {
    if (!isObj(j.config)) throwKind('config 不是对象');
    const leaves = [];
    (function walk(o, pre) {
      for (const k of Object.keys(o)) {
        const p2 = [...pre, k];
        if (isObj(o[k])) walk(o[k], p2);
        else leaves.push([p2, o[k]]);
      }
    })(j.config, []);
    for (const [p2, v] of leaves) {
      const id = p2.join('.');
      if (!CFG_RANGE[id]) throwKind(`config 越权键路径：${id}`);
      if (!CFG_RANGE[id](v)) throwKind(`config 非法值：${id}=${JSON.stringify(v)}`);
      let o = config;
      for (const k of p2.slice(0, -1)) o = o[k] || (o[k] = {});
      o[p2[p2.length - 1]] = v;
    }
  }
  // rate / from / desc
  const rateSet = j.rateSet == null ? null : (Number.isFinite(+j.rateSet) && +j.rateSet >= 2 && +j.rateSet <= 20 ? +j.rateSet : throwKind(`rateSet 越界：${j.rateSet}`));
  const rateDelta = j.rateDelta == null ? 0 : (Number.isFinite(+j.rateDelta) && Math.abs(+j.rateDelta) <= 2 ? +j.rateDelta : throwKind(`rateDelta 越界：${j.rateDelta}`));
  const fromNum = Number(j.from);
  const from = Number.isInteger(fromNum) && fromNum >= 1 && fromNum <= 6 ? fromNum : 1;
  const desc = Array.isArray(j.desc) ? j.desc.filter((x) => typeof x === 'string' && x.trim()).slice(0, 8).map((x) => x.trim()) : [];
  return { shots: Object.keys(shots).length ? shots : null, config: Object.keys(config).length ? config : null, rateSet, rateDelta, from, desc };
}

module.exports = { qwenParse };
