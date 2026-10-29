// web/server.cjs · 本地网页界面（零新增依赖：Node 内置 http + 现有 pipeline）
// 启动: node web/server.cjs [--port 8787]     然后浏览器开 http://127.0.0.1:8787
// 能力: 填文案 → 传素材(可选) → 选音色/语速 → 一键出片（01→06 全链）→ 进度条 → 在线预览成片/封面/QC 抽帧
// 安全: 只监听 127.0.0.1；任务名/文件名白名单；视频预览带 Range（可拖进度条）
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { ROOT, loadConfig, deepMerge, readJson, writeJson, ensureDir, log, warn, BGM_EXTS, readCloneVoices, writeCloneVoices, deriveCloneTarget } = require('../pipeline/lib/common.cjs');
const { parseNeed, SHOTS_PATCH, SHOT_EDIT, TYPE_WL, EDIT_TASK_FIELDS } = require('./chat-rules.cjs');
const { qwenParse } = require('./chat-qwen.cjs');
const { splitter } = require('./splitter.cjs');

const cfg = loadConfig();
const PORT = Number((process.argv.indexOf('--port') > -1 && process.argv[process.argv.indexOf('--port') + 1]) || 8787);
const OUTPUT = path.join(ROOT, 'output');
const STEPS = [
  { n: 1, name: '配音 TTS', file: '01-tts.cjs' },
  { n: 2, name: '时间轴编译', file: '02-compile.cjs' },
  { n: 3, name: '场景生成', file: '03-scenes.cjs' },
  { n: 4, name: '场景渲染', file: '04-render.cjs' },
  { n: 5, name: '合成', file: '05-compose.cjs' },
  { n: 6, name: '质检 QC', file: '06-qc.cjs' },
];
const VOICES = [
  { id: 'loongstella_v3.1', name: '飒爽新闻女（默认）' },
  { id: 'wenhuaiqing_v3.1', name: '温婉亲和女' },
  { id: 'longjielidou_v3.1', name: '灵动俏皮女' },
  { id: 'yuxiaoyun_v3.1', name: '知性御姐女' },
  { id: 'xuyanchu_v3.1', name: '沉稳男声' },
];

// —— 运行态（内存，重启丢失无妨——产物都在任务目录里）——
// queue：批量变体队列（P2-6）。一次提交 N 条 → 逐条全链跑，每条独立任务目录
const state = { running: false, task: '', step: 0, stepName: '', lines: [], ok: null, at: 0, queue: [], done: [] };
const NAME_RE = /^[\w一-鿿-]{1,40}$/;

// —— 素材库（P7-1）：library/<kind>/ 本地免版权素材缓存；选用=复制进 output/<task>/assets/ ——
// 文件名白名单只许目录内 basename（防 ../ 穿越）；扩展名与管线契约同表（BGM=findBgm、图片=bg-NN/jpg·png·webp）
const LIB = path.join(ROOT, 'library');
const LIB_KINDS = {
  bgm: { label: 'BGM', dir: 'bgm', exts: BGM_EXTS },
  images: { label: '图片', dir: 'images', exts: ['jpg', 'jpeg', 'png', 'webp'] },
  clips: { label: '视频片段', dir: 'clips', exts: ['mp4', 'mov', 'webm', 'mkv'] },
};
const LIB_NAME_RE = /^[\w\-. 一-鿿()（）【】]{1,120}$/;
const LIB_EXT = (n) => (String(n).split('.').pop() || '').toLowerCase();

function libraryList() {
  const kinds = {};
  for (const [kind, def] of Object.entries(LIB_KINDS)) {
    const dir = ensureDir(path.join(LIB, def.dir));
    kinds[kind] = fs.readdirSync(dir)
      .filter((f) => !f.startsWith('.') && def.exts.includes(LIB_EXT(f)))
      .map((f) => { const st = fs.statSync(path.join(dir, f)); return { name: f, size: st.size, mt: st.mtimeMs }; })
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  return { root: LIB, kinds };
}

// 复制库内 BGM 进任务 assets：统一命名 bgm.<ext>，先清同任务旧 bgm.*（findBgm 按表返回，留旧会歧义）
function libBgmInto(src, adir) {
  ensureDir(adir);
  for (const old of fs.readdirSync(adir)) if (/^bgm\.(\w+)$/i.test(old)) fs.unlinkSync(path.join(adir, old));
  const target = `bgm.${LIB_EXT(src)}`;
  fs.copyFileSync(src, path.join(adir, target));
  return target;
}

function libraryAdd(kind, name, task, mode) {
  const def = LIB_KINDS[kind];
  if (!def) return { error: `kind 非法: ${kind}（白名单: ${Object.keys(LIB_KINDS).join(' / ')}）`, status: 400 };
  if (!LIB_NAME_RE.test(name) || /[\\/]/.test(name)) return { error: `文件名非法: ${name}（只许库内文件名，不带路径）`, status: 400 };
  if (!def.exts.includes(LIB_EXT(name))) return { error: `不支持的类型: ${name}（可选: ${def.exts.join(' / ')}）`, status: 400 };
  const src = path.join(LIB, def.dir, name);
  if (!fs.existsSync(src)) return { error: `素材库里没有这个文件: ${name}（先放进 library\\${def.dir}\\ 再刷新）`, status: 404 };
  if (!NAME_RE.test(task)) return { error: 'bad task', status: 400 };
  const tdir = path.join(OUTPUT, task);
  if (!fs.existsSync(path.join(tdir, 'shots.json'))) return { error: `任务不存在: ${task}`, status: 404 };
  const adir = path.join(tdir, 'assets');
  if (kind === 'bgm') {
    const written = libBgmInto(src, adir);
    return { ok: true, written: `assets/${written}`, note: '已设为任务 BGM——从第 2 步重跑生效（卡点 + 混音）' };
  }
  if (kind === 'images' && mode === 'bg') {
    ensureDir(adir);
    let n = 0;
    for (const f of fs.readdirSync(adir)) { const m = /^bg-(\d+)\./i.exec(f); if (m) n = Math.max(n, Number(m[1])); }
    const written = `bg-${String(n + 1).padStart(2, '0')}.${LIB_EXT(name)}`;
    fs.copyFileSync(src, path.join(adir, written));
    return { ok: true, written: `assets/${written}`, note: '已作背景图加入——从第 3 步重跑生效（场景轮播）' };
  }
  const target = path.join(adir, name);
  if (fs.existsSync(target)) return { error: `任务里已有同名文件: assets/${name}（先删掉或换名再加）`, status: 409 };
  ensureDir(adir);
  fs.copyFileSync(src, target);
  return { ok: true, written: `assets/${name}`, note: '已复制进任务——分镜 shots.json 的 media 按文件名引用，改分镜后重跑对应步骤' };
}

// —— AI 生图（P7-2）：qwen-image OpenAI 兼容同步端点（千问AI平台 maas 域名——探针实测 2026-10-23：
//   dashscope.aliyuncs.com 老域名无 images 路径=空 body 404；qwen-image-3.0 免费额度尽=403 提示；turbo/pro 可用）——
// 只由网页手动触发，管线六步永不自动调用（零成本默认的硬保证）；key 只在 config.local/环境变量，永不出现在响应里
const IMG_MODELS = ['qwen-image-3.0-pro', 'qwen-image-3.0', 'qwen-image-2.1-pro', 'qwen-image-2.1-turbo'];
let imgBusy = false;

function imagegenState() {
  const ig = cfg.imagegen || {};
  const key = ig.key || process.env.DASHSCOPE_API_KEY || (cfg.voice?.dashscope?.key) || '';
  const where = ig.key ? 'imagegen.key' : (process.env.DASHSCOPE_API_KEY ? '环境变量 DASHSCOPE_API_KEY' : ((cfg.voice?.dashscope?.key) ? 'voice.dashscope.key' : '未配置'));
  return { enabled: ig.enabled !== false && !!key, model: String(ig.model || 'qwen-image-2.1-turbo'), size: String(ig.size || '1024x1920'), where, key };
}

// 尺寸白名单：auto 或 WxH（以线上服务实测口径为准：面积 512²~2560²、宽高比 ≤8:1）——请求与 config 默认值都过这道
function checkImgSize(s) {
  if (s === 'auto') return null;
  const m = /^(\d{3,4})x(\d{3,4})$/.exec(String(s || ''));
  if (!m) return `size 格式非法: ${s}（写法 1024x1920，或 auto）`;
  const w = Number(m[1]), h = Number(m[2]);
  const area = w * h;
  if (area < 512 * 512 || area > 2560 * 2560) return `size 面积超界: ${s}（服务实测限 512x512 ~ 2560x2560 总像素）`;
  if (Math.max(w, h) / Math.min(w, h) > 8) return `size 宽高比超界: ${s}（上限 8:1）`;
  return null;
}

async function genImage(prompt, size) {
  const st = imagegenState();
  const ig = cfg.imagegen || {};
  if (!IMG_MODELS.includes(st.model)) throw new Error(`config.imagegen.model 非法: ${st.model}（白名单: ${IMG_MODELS.join(' / ')}）`);
  const bad = checkImgSize(size);
  if (bad) throw new Error(bad);
  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), Number(ig.timeoutMs) || 180000);
  try {
    const r = await fetch(String(ig.endpoint), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${st.key}` },
      body: JSON.stringify({ model: st.model, prompt, size, n: 1, prompt_extend: ig.promptExtend !== false, watermark: ig.watermark === true }),
      signal: ctl.signal,
    });
    const txt = await r.text();
    let j = {};
    try { j = JSON.parse(txt); } catch { /* 非 JSON 响应（如空 body 404）→ 原文进错误 */ }
    if (!r.ok) {
      const em = (j.error && j.error.message) || j.message || txt.slice(0, 300) || '(空响应)';
      const hint = j.error && j.error.code === 'insufficient_quota' ? '——额度不足：充值，或在控制台关闭「仅用免费额度」（qwen-image-3.0 系列当前卡在这）' : '';
      throw new Error(`接口 ${r.status}: ${em}${hint}`);
    }
    const url = j.data && j.data[0] && j.data[0].url;
    if (!url) throw new Error('响应缺 data[0].url：' + (txt.slice(0, 300) || '(空响应)'));
    // 官方口径：结果 URL 只有 24 小时——立即下载落盘
    const ir = await fetch(url, { signal: ctl.signal });
    if (!ir.ok) throw new Error(`下载生成图失败: HTTP ${ir.status}`);
    const buf = Buffer.from(await ir.arrayBuffer());
    if (buf.length < 100 || buf[0] !== 0x89 || buf[1] !== 0x50 || buf[3] !== 0x47) throw new Error('下载内容不是有效 PNG');
    return { buf, ms: Date.now() - t0, usage: j.usage || null };
  } finally { clearTimeout(timer); }
}

function libSaveImage(buf) {
  const dir = ensureDir(path.join(LIB, 'images'));
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
  let name = `ai-${stamp}.png`;
  for (let n = 2; fs.existsSync(path.join(dir, name)); n++) name = `ai-${stamp}-${n}.png`;
  fs.writeFileSync(path.join(dir, name), buf);
  return name;
}

// —— 声音复刻（P8，探针实测 2026-10-26：dashscope 老域名这条路是通的不用 WorkspaceId；创建失败不计费）——
// 同一个 customization 端点换 input.action：create_voice / list_voice / query_voice / delete_voice
// target_model 必须与后续合成模型一致——直接用现役 qwen-audio-3.1-tts-flash，零换模型；
// 音色清单落 pipeline/voice-clone.json（账号私有不进 git），01 出片时按 voiceId 找回 targetModel 且禁用兜底
let cloneBusy = false;

function cloneState() {
  const c = (cfg.voice || {}).clone || {};
  const key = c.key || process.env.DASHSCOPE_API_KEY || (cfg.voice?.dashscope?.key) || '';
  const where = c.key ? 'voice.clone.key' : (process.env.DASHSCOPE_API_KEY ? '环境变量 DASHSCOPE_API_KEY' : ((cfg.voice?.dashscope?.key) ? 'voice.dashscope.key' : '未配置'));
  return {
    enabled: c.enabled !== false && !!key, key, where,
    endpoint: String(c.endpoint || 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization'),
    targetModel: String(c.targetModel || 'qwen-audio-3.1-tts-flash'),
    prefix: String(c.prefix || 'myvoice'),
    maxLen: Number(c.maxPromptAudioLength) || 15,
    languageHints: Array.isArray(c.languageHints) && c.languageHints.length ? c.languageHints : ['zh'],
    timeoutMs: Number(c.timeoutMs) || 60000,
    deployTimeoutSec: Number(c.deployTimeoutSec) || 90,
  };
}

// enrollment 端点统一 POST（model 固定 voice-enrollment）；非 2xx 带 status/额度提示抛错
async function enroll(st, input, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs || st.timeoutMs);
  try {
    const r = await fetch(st.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${st.key}` },
      body: JSON.stringify({ model: 'voice-enrollment', input }),
      signal: ctl.signal,
    });
    const txt = await r.text();
    let j = {};
    try { j = JSON.parse(txt); } catch { /* 非 JSON → 原文进错误 */ }
    if (!r.ok) {
      const em = j.message || (j.error && j.error.message) || txt.slice(0, 300) || '(空响应)';
      const err = new Error(`复刻接口 ${r.status}: ${em}${r.status === 403 ? '——额度/权限：查账户余额与「仅用免费额度」开关（Qwen 系列复刻创建按官方口径 ¥0.01/次）' : ''}`);
      err.status = r.status === 400 ? 400 : (r.status === 403 ? 403 : 502);
      throw err;
    }
    return j;
  } finally { clearTimeout(timer); }
}

function push(line) {
  state.lines.push(line);
  if (state.lines.length > 200) state.lines.shift();
}

function runStep(taskDir, step) {
  return new Promise((resolve) => {
    state.step = step.n;
    state.stepName = step.name;
    push(`—— 第 ${step.n}/6 步 ${step.name} ——`);
    // 任务级 config 补丁（web 局部重跑写入）：存在则经环境变量交给 common.cjs loadConfig 深合并
    const ovPath = path.join(taskDir, 'config.overrides.json');
    const env = { ...process.env, ...(fs.existsSync(ovPath) ? { PIPELINE_CONFIG_OVERRIDES: ovPath } : {}) };
    const p = spawn(process.execPath, [path.join(ROOT, 'pipeline', step.file), taskDir], { cwd: ROOT, env });
    let buf = '';
    p.stdout.on('data', (d) => {
      buf += d.toString();
      const ls = buf.split(/\r?\n/);
      buf = ls.pop();
      ls.filter(Boolean).forEach(push);
    });
    p.stderr.on('data', (d) => d.toString().split(/\r?\n/).filter(Boolean).forEach(push));
    p.on('close', (code) => resolve(code === 0));
  });
}

async function runPipeline(taskDir, from = 1, to = 6) {
  state.running = true;
  state.ok = null;
  state.at = Date.now();
  try {
    if (from > 1) push(`局部重跑：从第 ${from} 步起（复用此前产物）${to < 6 ? ` 至第 ${to} 步` : ''}`);
    for (const step of STEPS) {
      if (step.n < from || step.n > to) continue;
      const ok = await runStep(taskDir, step);
      if (!ok) {
        state.ok = false;
        push(`✗ 第 ${step.n} 步失败——看上方日志定位（常见：网络/磁盘/素材缺失）`);
        return;
      }
    }
    state.ok = true;
    push('✓ 全链完成——刷新预览区看成片');
  } catch (e) {
    state.ok = false;
    push('✗ 管线异常：' + String(e).slice(0, 200));
  } finally {
    state.running = false;
    state.step = 0;
  }
}

// 批量队列泵：state.queue 里逐条取任务跑全链；单条失败不中断队列（失败也记入 done）
async function pumpQueue() {
  if (state.running || !state.queue.length) return;
  while (state.queue.length) {
    const item = state.queue.shift();
    state.task = item.name;
    if (state.queue.length || item.batchTotal > 1) {
      push(`══ 变体 ${item.batchIndex}/${item.batchTotal}：${item.name} ══`);
    }
    await runPipeline(item.dir, item.from || 1, item.to || 6);
    state.done.push({ name: item.name, ok: state.ok });
  }
}

// qwen 状态（P3-5）：ok=false 时界面明示原因（quota=额度用尽，需通知用户）并降级规则模式
let llmState = { on: false, ok: null, error: null, kind: null, at: 0 };
function llmOnNow() {
  const cfg = loadConfig();
  return (cfg.llm || {}).enabled !== false && !!(cfg.voice && cfg.voice.dashscope && cfg.voice.dashscope.key);
}

// —— 共享重跑引擎（P3-4 抽取）：/api/rerun 与聊天框同用 ——
// 校验（白名单 SHOTS_PATCH，宁 fail 勿兜底）→ 落盘 shots/config 补丁 → 排队跑。返回 {error} 或 {ok:true, from}
// 口播漂移检测（P9 整串式 → P11 逐镜式）：与 01 buildNarration 同归一逐镜比对 audio/narrationSeg.json——
// 整串拼接对「换序不换字/增删后拼回同文」免疫，这类结构变更同样要重配音，盲区由 seg 序列堵。
// 旧任务（P11 前配的音，无 seg 清单）回退整串对 narration.txt 的旧口径。
function narrationDrift(dir, shots) {
  const list = ((shots && shots.shots) || []).map((s) => String((s || {}).narration || '').trim().replace(/\s+/g, ' '));
  const segDoc = readJson(path.join(dir, 'audio', 'narrationSeg.json'));
  if (segDoc && Array.isArray(segDoc.seg)) {
    const prev = segDoc.seg.map((x) => String(x || '').replace(/\s+/g, ' ')); // 落盘前已 trim 归一，这里只压空白防口径漂移
    return prev.length !== list.length || prev.some((x, i) => x !== list[i]);
  }
  const nt = path.join(dir, 'narration.txt'); // 01 写的是任务根目录（与 02/03 读取同处）
  const want = list.join('');
  const prev = fs.existsSync(nt) ? fs.readFileSync(nt, 'utf8').replace(/\s+/g, ' ').trim() : '';
  return want !== prev;
}

function startRerun(name, dir, from, patch, config, resetConfig, to = 6) {
  const sj = path.join(dir, 'shots.json');
  if (!fs.existsSync(sj)) return { error: '任务不存在' };
  if (!Number.isInteger(from) || from < 1 || from > 6) return { error: 'from 必须是 1~6' };
  patch = patch && typeof patch === 'object' ? patch : {};
  const shots = readJson(sj) || {};
  // 平台补丁（P6）：platform/width/height 同补 = 语义矛盾宁 fail；platform 是画幅单一出处 →
  // 旧任务遗留的显式 width/height 让位删除（否则与平台表打架触发 02 冲突 fail）。
  // 画幅类补丁在 02 解析进 timeline，from 必须含 02——--from 3 会跳过 02 留旧画幅时间轴
  if (patch.platform && (patch.width != null || patch.height != null)) return { error: 'platform 与 width/height 只能二选一（平台规格自带画幅）' };
  if (patch.platform || patch.width != null || patch.height != null) from = Math.min(from, 2);
  for (const k of Object.keys(patch)) {
    if (!SHOTS_PATCH[k]) return { error: `不支持的 shots 字段: ${k}（可改: ${Object.keys(SHOTS_PATCH).join(' / ')}）` };
    if (!SHOTS_PATCH[k](patch[k])) return { error: `字段值非法: ${k}=${JSON.stringify(patch[k])}` };
    shots[k] = patch[k];
  }
  if (patch.platform) { delete shots.width; delete shots.height; }
  // 口播漂移硬钳制：口播 ≠ 上次配音 → from 必须含 01（拿旧音频对新词会把 02 时间轴带沟里；与 P6 画幅钳制同款）
  if (narrationDrift(dir, shots)) from = Math.min(from, 1);
  writeJson(sj, shots);
  // config 补丁：深合并进任务级 config.overrides.json（经 PIPELINE_CONFIG_OVERRIDES 让全步骤生效）；resetConfig 清空
  const ovPath = path.join(dir, 'config.overrides.json');
  if (resetConfig && fs.existsSync(ovPath)) fs.unlinkSync(ovPath);
  if (config && typeof config === 'object') writeJson(ovPath, deepMerge(readJson(ovPath) || {}, config));
  log('07-web', `局部重跑 ${name}：从第 ${from} 步起${Object.keys(patch).length ? ' · shots ' + Object.keys(patch).join(',') : ''}${config ? ' · config 补丁已应用' : ''}${resetConfig ? ' · 已清空 config 补丁' : ''}`);
  state.lines = [];
  state.done = [];
  state.task = name;
  state.queue.push({ name, dir, from, to: Math.max(to, from), batchTotal: 1 });
  pumpQueue(); // 异步跑，进度走 /api/status 轮询
  return { ok: true, from };
}
// 技术库读取（techniques/*.json，坏文件带 error 直示）
function loadTechniques() {
  const dir = path.join(ROOT, 'techniques');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
  return files.map((f) => {
    const t = readJson(path.join(dir, f));
    // manual 级 = 素材契约型知识卡（判据+做法，无一键补丁），new 级 = 施工期卡（货架标"待实现"禁按钮）——两者都允许省 insert
    if (!t || !t.id || !t.name || (!t.insert && t.tier !== 'manual' && t.tier !== 'new')) return { id: f.replace(/\.json$/, ''), name: f, error: '配方缺 id/name/insert 字段（manual/new 级可省 insert）' };
    return t;
  });
}

// —— HTTP 工具 ——
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 60 * 1024 * 1024) { reject(new Error('body too large')); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
};

// 视频/图片预览：带 Range 的静态文件（只允许任务目录内的白名单产物，防路径穿越）
function serveFile(req, res, fp) {
  if (!fs.existsSync(fp) || !fs.statSync(fp).isFile()) return json(res, 404, { error: 'not found' });
  const ext = path.extname(fp).toLowerCase();
  const size = fs.statSync(fp).size;
  const range = req.headers.range;
  const rs = range ? Number(range.replace('bytes=', '').split('-')[0]) : 0;
  const re = range ? (Number(range.replace('bytes=', '').split('-')[1]) || size - 1) : size - 1;
  res.writeHead(range ? 206 : 200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Content-Length': re - rs + 1,
    ...(range ? { 'Content-Range': `bytes ${rs}-${re}/${size}` } : {}),
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(fp, { start: rs, end: re }).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;

  try {
    // —— API ——
    if (p === '/api/meta') {
      const igSt = imagegenState(); // 只回传状态不回传 key
      const cSt = cloneState();
      return json(res, 200, {
        voices: VOICES,
        defaultVoice: (cfg.voice?.dashscope || {}).voice || 'loongstella_v3.1',
        defaultRate: Number((cfg.voice?.dashscope || {}).targetCharsPerSec || 7.2),
        running: state.running,
        platforms: Object.entries(cfg.platforms || {}).map(([id, v]) => ({ id, label: v.label || id, width: v.width, height: v.height })),
        sizes: [{ w: 1080, h: 1920, label: '竖屏 9:16' }, { w: 1920, h: 1080, label: '横屏 16:9' }, { w: 1080, h: 1080, label: '方形 1:1' }],
        imagegen: { enabled: igSt.enabled, model: igSt.model, size: igSt.size, where: igSt.where },
        clone: {
          enabled: cSt.enabled, targetModel: cSt.targetModel, where: cSt.where,
          voices: readCloneVoices().map((v) => ({ ...v, targetModel: v.targetModel || deriveCloneTarget(v.voiceId) })),
        },
      });
    }
    if (p === '/api/status') {
      return json(res, 200, { ...state, lines: state.lines.slice(-80) });
    }
    if (p === '/api/tasks' && req.method === 'GET') {
      const dirs = fs.existsSync(OUTPUT) ? fs.readdirSync(OUTPUT).filter((d) => fs.existsSync(path.join(OUTPUT, d, 'shots.json'))) : [];
      const tasks = dirs.map((d) => {
        const dir = path.join(OUTPUT, d);
        const meta = readJson(path.join(dir, 'audio', 'meta.json')) || {};
        const shots = readJson(path.join(dir, 'shots.json')) || {};
        return {
          name: d,
          hasVideo: fs.existsSync(path.join(dir, '成片.mp4')),
          hasCover: fs.existsSync(path.join(dir, '封面.png')),
          provider: meta.provider || '',
          voice: (meta.voice && (meta.voice.voice || meta.voice.name)) || '',
          dur: meta.duration || 0,
          mt: fs.statSync(dir).mtimeMs,
          style: shots.sceneStyle || 'classic',      // 局部重跑面板预填
          cover: shots.coverStyle || 'tech',
          caps: shots.captions !== false,
          hasOv: fs.existsSync(path.join(dir, 'config.overrides.json')), // 任务级 config 补丁生效中
        };
      }).sort((a, b) => b.mt - a.mt);
      return json(res, 200, tasks);
    }
    if (p === '/api/stepstatus' && req.method === 'GET') {
      const name = String(u.searchParams.get('name') || '').trim();
      if (!NAME_RE.test(name)) return json(res, 400, { error: 'bad task' });
      const dir = path.join(OUTPUT, name);
      if (!fs.existsSync(path.join(dir, 'shots.json'))) return json(res, 404, { error: '任务不存在' });
      const ex = (...s) => fs.existsSync(path.join(dir, ...s));
      const count = (sub) => { try { return fs.readdirSync(path.join(dir, sub)).length; } catch { return 0; } };
      const meta = readJson(path.join(dir, 'audio', 'meta.json')) || {};
      const tl = readJson(path.join(dir, 'timeline.json')) || {};
      const qcTxt = ex('qc-report.txt') ? fs.readFileSync(path.join(dir, 'qc-report.txt'), 'utf8') : '';
      let qc = null;
      if (qcTxt) {
        const mm = /(\d+)\s*\/\s*(\d+)[^\n]*通过/.exec(qcTxt); // 「——— 18/18 机械项通过」汇总行
        const failCount = (qcTxt.match(/^\s*✗/gm) || []).length;
        qc = { done: true, pass: mm ? +mm[1] : null, total: mm ? +mm[2] : null, failCount, ok: failCount === 0 && (!mm || +mm[1] === +mm[2]) };
      }
      return json(res, 200, {
        name,
        voice: { ok: ex('audio', 'voice.mp3'), duration: meta.duration || 0, provider: meta.provider || '', charsPerSec: meta.charsPerSec || 0, clone: !!(meta.voice && meta.voice.clone) },
        timeline: { ok: ex('timeline.json'), shots: Array.isArray(tl.shots) ? tl.shots.length : 0, total: Array.isArray(tl.shots) ? tl.shots.reduce((a, s) => a + (Number(s.dur) || 0), 0) : 0 },
        scenes: { ok: count('scenes') > 0, count: count('scenes') },
        segments: { ok: count('segments') > 0, count: count('segments'), cover: ex('封面.png') },
        video: { ok: ex('成片.mp4'), mtime: ex('成片.mp4') ? fs.statSync(path.join(dir, '成片.mp4')).mtimeMs : 0 },
        qc,
        drift: narrationDrift(dir, readJson(path.join(dir, 'shots.json')) || {}),
      });
    }
    if (p === '/api/create' && req.method === 'POST') {
      if (state.running || state.queue.length) return json(res, 409, { error: '有任务正在跑/排队，等它完成' });
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const name = String(body.name || '').trim() || `web-${new Date().toISOString().slice(5, 16).replace(/[-:T]/g, '')}`;
      if (!NAME_RE.test(name)) return json(res, 400, { error: '任务名只能用中英文/数字/横线，≤40 字' });
      const split = splitter(body.text);
      if (split.error) return json(res, 400, { error: split.error });

      // 批量变体（P2-6）：hooks 每行一个开头钩子 → 替换首镜口播+大字标题，出 N 条 A/B 测试版本
      const hooks = (Array.isArray(body.hooks) ? body.hooks : [])
        .map((h) => String(h || '').trim().replace(/\s+/g, ' ')).filter(Boolean).slice(0, 5);
      const variants = hooks.length >= 2
        ? hooks.map((hook, i) => ({
            name: `${name}-v${i + 1}`,
            shots: split.shots.map((s, k) => (k === 0
              ? { ...s, narration: hook, title: hook } // 首镜整段换成钩子（title 镜；首镜必为 title，splitter 保证）
              : s)),
          }))
        : [{ name, shots: split.shots }];

      const written = [];
      const COVER_STYLES = ['tech', 'bold', 'magazine'];
      const coverStyle = String(body.coverStyle || 'tech');
      if (!COVER_STYLES.includes(coverStyle)) return json(res, 400, { error: `封面风格非法: ${coverStyle}（可选: ${COVER_STYLES.join(' / ')}）` });
      // 场景风格（P2-9）：classic / deck，白名单 400 与 03 同表
      const SCENE_STYLES = ['classic', 'deck', 'paper'];
      const sceneStyle = String(body.sceneStyle || 'classic');
      if (!SCENE_STYLES.includes(sceneStyle)) return json(res, 400, { error: `场景风格非法: ${sceneStyle}（可选: ${SCENE_STYLES.join(' / ')}）` });
      // 平台发布规格（P6）：白名单=config.platforms 表；选平台就不发 width/height——
      // shots.platform 是画幅单一出处（02 查表解析），两处并存宁 400 勿兜底
      const PLATFORMS = cfg.platforms || {};
      const platform = body.platform ? String(body.platform) : '';
      if (platform && !PLATFORMS[platform]) return json(res, 400, { error: `平台规格非法: ${platform}（可选: ${Object.keys(PLATFORMS).join(' / ') || 'config.platforms 未配置'}）` });
      if (platform && (body.width != null || body.height != null)) return json(res, 400, { error: 'platform 与 width/height 只能二选一（平台规格自带画幅）' });
      // 素材库选用 BGM（P7-1）：与自带上传二选一（老口径自带优先；同传宁 400 勿静默丢一份）
      const bgmLib = body.bgmFromLibrary ? String(body.bgmFromLibrary) : '';
      if (bgmLib && body.bgm) return json(res, 400, { error: 'BGM 自带上传与素材库选用只能二选一（清掉其中一个再出片）' });
      let bgmLibSrc = '';
      if (bgmLib) {
        if (!LIB_NAME_RE.test(bgmLib) || /[\\/]/.test(bgmLib) || !BGM_EXTS.includes(LIB_EXT(bgmLib))) return json(res, 400, { error: `素材库 BGM 文件名非法: ${bgmLib}（可选扩展名: ${BGM_EXTS.join(' / ')}）` });
        bgmLibSrc = path.join(LIB, 'bgm', bgmLib);
        if (!fs.existsSync(bgmLibSrc)) return json(res, 404, { error: `素材库里没有这个文件: ${bgmLib}（先放进 library\\bgm\\ 再刷新）` });
      }
      for (const v of variants) {
        if (!NAME_RE.test(v.name)) return json(res, 400, { error: `变体任务名非法: ${v.name}` });
        const dir = ensureDir(path.join(OUTPUT, v.name));
        const shots = {
          title: v.name,
          ...(platform ? { platform } : { width: Number(body.width) || 1080, height: Number(body.height) || 1920 }),
          fps: cfg.output?.fps || 30,
          shots: v.shots,
          voice: String(body.voice || cfg.voice?.dashscope?.voice || ''),
          coverStyle, // 封面风格（P2-8）：03 白名单校验后注入 cover-* class
          sceneStyle, // 场景风格（P2-9）：classic / deck（deck=演示风+章节导航条+硬切）
          captions: body.captions !== false, // 字幕烧录开关（P2-9）：false=复刻样片纯画面+旁白
        };
        if (body.rate > 0) shots.targetCharsPerSec = Number(body.rate); // 任务级语速（01 残差校正）
        writeJson(path.join(dir, 'shots.json'), shots);
        // 素材：背景图（base64，按序命名 bg-NN）+ BGM——变体共享同一套素材
        const assets = Array.isArray(body.assets) ? body.assets.slice(0, 9) : [];
        if (assets.length || body.bgm || bgmLibSrc) ensureDir(path.join(dir, 'assets'));
        assets.forEach((a, i) => {
          const m = /^data:image\/(jpe?g|png|webp);base64,(.+)$/.exec(String(a) || '');
          if (!m) return;
          const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
          fs.writeFileSync(path.join(dir, 'assets', `bg-${String(i + 1).padStart(2, '0')}.${ext}`), Buffer.from(m[2], 'base64'));
        });
        if (body.bgm) {
          const mb = /^data:audio\/(mpeg|mp3);base64,(.+)$/.exec(String(body.bgm) || '');
          if (mb) fs.writeFileSync(path.join(dir, 'assets', 'bgm.mp3'), Buffer.from(mb[2], 'base64'));
        } else if (bgmLibSrc) {
          libBgmInto(bgmLibSrc, path.join(dir, 'assets')); // 素材库 BGM（P7-1）：复制为 assets/bgm.<ext>
        }
        written.push({ name: v.name, dir, shots: v.shots });
      }
      if (body.draft) {
        // 向导草稿：只落 shots.json + 素材，不进队列、不配音（零花费），回传分镜供确认
        const w = written[0];
        log('07-web', `向导草稿 ${w.name} · ${w.shots.length} 镜（未出片，待确认）`);
        return json(res, 200, { ok: true, draft: true, name: w.name, shotCount: w.shots.length, shots: w.shots, platform, sceneStyle, coverStyle });
      }
      log('07-web', `${written.length > 1 ? `批量变体 ${written.length} 条` : '新任务'} ${written.map((w) => w.name).join('、')} · ${split.shots.length} 镜 · 音色 ${written.length && body.voice || cfg.voice?.dashscope?.voice || ''}${body.rate ? ` · ${body.rate} 字/秒` : ''}`);
      state.lines = [];
      state.done = [];
      state.task = written[0].name;
      written.forEach((w, i) => state.queue.push({ ...w, batchIndex: i + 1, batchTotal: written.length }));
      pumpQueue(); // 异步跑，进度走 /api/status 轮询
      return json(res, 200, { ok: true, name: written[0].name, batch: written.map((w) => w.name) });
    }

    // —— 局部重跑（P3-1）：复用上游产物从指定步骤重跑；可选 shots/config 补丁（白名单，宁 fail 勿兜底）——
    if (p === '/api/rerun' && req.method === 'POST') {
      if (state.running || state.queue.length) return json(res, 409, { error: '有任务正在跑/排队，等它完成' });
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const name = String(body.name || '').trim();
      if (!NAME_RE.test(name)) return json(res, 400, { error: 'bad task' });
      const r = startRerun(name, path.join(OUTPUT, name), Number(body.from) || 3, body.shots, body.config, body.resetConfig, body.to != null ? Math.min(6, Math.max(1, Number(body.to) || 6)) : 6);
      if (r.error) return json(res, r.error === '任务不存在' ? 404 : 400, { error: r.error });
      return json(res, 200, { ok: true, name, from: r.from });
    }

    // —— Editor 精修（P9 轻改 → P11 结构版）：字段编辑 + 镜头增删/排序 + 任务级参数 → 回写 shots.json 走局部重跑 ——
    // 结构调整以身份键（id 或 n，与 02 的 s.id||序号 口径兼容）匹配：保留镜的键必须原样且在原清单内、不重复；
    // 新镜不给键（id 型文档服务端补发 s9X+，n 型文档按新位置重排）；结构变化=口播切分重排 → 硬钳 from=1。
    // 建议 from 与漂移判定同一出处 narrationDrift（P11 起逐镜比对，换序/增删不再被整串拼接盲区放过）
    if (p === '/api/editor/shots' && req.method === 'GET') {
      const name = String(u.searchParams.get('name') || '').trim();
      if (!NAME_RE.test(name)) return json(res, 400, { error: 'bad task' });
      const dir = path.join(OUTPUT, name);
      const sj = path.join(dir, 'shots.json');
      if (!fs.existsSync(sj)) return json(res, 404, { error: '任务不存在或没有 shots.json' });
      const ad = path.join(dir, 'assets');
      const assets = fs.existsSync(ad) ? fs.readdirSync(ad).filter((f) => fs.statSync(path.join(ad, f)).isFile()).sort() : [];
      const shots = readJson(sj) || {};
      const sl = Array.isArray(shots.shots) ? shots.shots : [];
      // 时长表（时间轴页按镜头宽）：timeline.json 按 id 对齐，对不上按位序兜；无/坏文件 = null（等宽渲染）
      const tl = readJson(path.join(dir, 'timeline.json')) || {};
      let durs = null, tlTotal = 0;
      if (Array.isArray(tl.shots) && tl.shots.length === sl.length) {
        const byId = new Map(tl.shots.map((t) => [String(t.id), t]));
        durs = sl.map((s, i) => {
          const t = (('id' in s && byId.get(String(s.id))) || ('n' in s && byId.get(`s${String(s.n).padStart(2, '0')}`)) || tl.shots[i]);
          const d = Number(t && t.dur) || 0;
          tlTotal += d;
          return d || null;
        });
        if (durs.some((d) => !d)) durs = null;
      }
      return json(res, 200, {
        name, shots, assets, types: TYPE_WL, fields: Object.keys(SHOT_EDIT),
        taskFields: EDIT_TASK_FIELDS, platforms: Object.keys(loadConfig().platforms || {}),
        tailOnlyDel: !sl.some((s) => s && ('id' in s || 'n' in s)), // 无键文档只能删尾部（见 POST 守卫）
        durations: durs, total: durs ? tlTotal : 0,
        narrationDrift: narrationDrift(dir, shots),
        busy: !!(state.running || state.queue.length),
      });
    }
    if (p === '/api/editor/shots' && req.method === 'POST') {
      if (state.running || state.queue.length) return json(res, 409, { error: '有任务正在跑/排队——等它完成再保存（避免写入与流水线读取打架）' });
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const name = String(body.name || '').trim();
      if (!NAME_RE.test(name)) return json(res, 400, { error: 'bad task' });
      const dir = path.join(OUTPUT, name);
      const sj = path.join(dir, 'shots.json');
      if (!fs.existsSync(sj)) return json(res, 404, { error: '任务不存在' });
      const orig = readJson(sj) || {};
      const origList = Array.isArray(orig.shots) ? orig.shots : [];
      const list = body.shots;
      if (!Array.isArray(list) || list.length < 1 || list.length > 60) return json(res, 400, { error: 'shots 须为 1~60 镜数组' });
      // —— 身份键匹配（P11 结构守卫）：原文档用 id 还是 n，一查即定 ——
      const keyOf = (s) => (s && 'id' in s ? s.id : (s && 'n' in s ? s.n : null));
      const idStyle = origList.some((s) => s && 'id' in s);
      const nStyle = !idStyle && origList.some((s) => s && 'n' in s);
      const origPool = new Set(origList.map(keyOf).filter((k) => k !== null));
      // —— 升级模式（时间轴页「补发 id」向导）：原无键 → 每镜配全新唯一 id，镜序/口播逐位不动 ——
      // 只在「不增删、不换序、不改口播」时放行自造 id（否则仍走下面 origPool 拒），把身份体系从无键升到有键
      const nz = (x) => String(x || '').trim().replace(/\s+/g, ' ');
      const upgrading = !idStyle && !nStyle && list.length === origList.length && list.every((s) => s && s._new !== true && typeof s.id === 'string' && s.id)
        && list.every((s, i) => nz(s.narration) === nz(origList[i].narration)) && !('n' in (list[0] || {}));
      const seen = new Set();
      const ad = path.join(dir, 'assets');
      for (let i = 0; i < list.length; i++) {
        const s = list[i], idx = `第 ${i + 1} 镜`;
        if (!s || typeof s !== 'object' || Array.isArray(s)) return json(res, 400, { error: `${idx} 不是对象` });
        if (s._new === true) { delete s.id; delete s.n; } // 客户端标记的新镜：不带身份、不参与匹配
        const k = keyOf(s);
        if (k !== null) {
          if (!origPool.has(k) && !(upgrading && typeof k === 'string')) return json(res, 400, { error: `${idx} 的 id/n=${JSON.stringify(k)} 不在原任务里（保留镜须带原身份键，新镜不要自造键）` });
          if (seen.has(k)) return json(res, 400, { error: `${idx} 身份键 ${JSON.stringify(k)} 重复（一镜一键）` });
          seen.add(k);
        }
        // 字段白名单 + 值校验（宁 fail 勿兜底）；id/n 是身份键不走 SHOT_EDIT
        for (const fk of Object.keys(s)) {
          if (fk === 'id' || fk === 'n' || fk === '_new') continue;
          if (!SHOT_EDIT[fk]) return json(res, 400, { error: `${idx} 不支持的字段: ${fk}（可改: ${Object.keys(SHOT_EDIT).join(' / ')}）` });
          if (!SHOT_EDIT[fk](s[fk])) return json(res, 400, { error: `${idx} 字段值非法: ${fk}=${JSON.stringify(s[fk]).slice(0, 100)}` });
        }
        // 类型必填（03/06 会炸的坑提前到保存前；口径 skills/script.md）
        if ((s.type === 'keyword') && !(s.keyword || '').trim()) return json(res, 400, { error: `${idx} keyword 型必须填 keyword` });
        if (s.type === 'split') {
          if (!(s.media || '').trim()) return json(res, 400, { error: `${idx} split 型必须选 media（分栏配图）` });
          if (!(Array.isArray(s.items) && s.items.length) && !(s.note || '').trim()) return json(res, 400, { error: `${idx} split 型需要 items 或 note 至少一项` });
        }
        if ((s.type === 'title' || s.type === 'end') && !(s.title || '').trim()) return json(res, 400, { error: `${idx} ${s.type} 型必须填 title` });
        // 素材文件早校验（02/03 的报错提前到花钱/排队前）
        for (const fk of ['media', 'asset']) {
          const v = String(s[fk] || '');
          if (v) {
            if (v.includes('..') || /[/\\:*?"<>|]/.test(v)) return json(res, 400, { error: `${idx} ${fk} 文件名非法: ${v}` });
            if (!fs.existsSync(path.join(ad, v))) return json(res, 404, { error: `${idx} ${fk} 指向的素材不存在: assets/${v}（先在控制台素材区传入）` });
          }
        }
      }
      // 至少保留一张标题卡（首句大字的版式承重墙；删光了 03 的 title 版式就没了）
      if (!list.some((s) => s.type === 'title')) return json(res, 400, { error: '删镜头后至少要留一张标题卡（title 型）' });
      // 身份键归位：n 型按新位置重排（01 注释/编号语义=n 在序列中的位序）；id 型新镜服务端补发 s9X+ 不与 02 兜底序号撞
      // （三条分支统一先剥 _new 运输标记——不许泄漏进 shots.json）
      let finalList = list.map((s) => { if ('_new' in s) { const { _new, ...rest } = s; return rest; } return s; });
      if (nStyle) finalList = finalList.map((s, i) => ({ ...s, n: i + 1 }));
      else if (idStyle) {
        const used = new Set(list.map(keyOf).filter((x) => typeof x === 'string'));
        let next = 91;
        finalList = finalList.map((s) => {
          if ('id' in s) return s;
          while (used.has(`s${next}`)) next++;
          const id = `s${next}`; used.add(id); next++;
          return { ...s, id };
        });
      }
      // 结构变化判定 → 音频切分必须重做，钳 from=1。
      // 必须用「重排/补发前的身份序列」比原序——n 型重排会把换序信息抹掉（[1,3,2]→[1,2,3] 看似没动）
      const hasNew = list.some((s) => s && s._new === true);
      const keptLen = list.filter((s) => s && s._new !== true).length;
      let structural;
      if (idStyle || nStyle) {
        const identSeq = list.map((s) => (s && s._new === true ? null : keyOf(s)));
        structural = keptLen !== origList.length || hasNew || identSeq.some((k, i) => k !== keyOf(origList[i]));
      } else {
        structural = keptLen !== origList.length || hasNew;
      }
      // 无键文档（id/n 皆无，splitter 产物）按位匹配：保留镜（非 _new）必须与原前缀逐位对位，
      // 即「只能删尾部 + 任意位置插新镜」——「删中间 + 补尾」与「原序」在按位语义下不可分，宁拦不猜
      if (!idStyle && !nStyle) {
        const keptIdx = list.map((s, i) => (s && s._new === true ? -1 : i)).filter((i) => i >= 0);
        const shrinking = keptIdx.length !== origList.length;
        if (keptIdx.some((li, ki) => ki >= origList.length || list[li].narration !== origList[ki].narration)) {
          return json(res, 400, { error: shrinking
            ? '该任务分镜无身份键：删镜时不允许同时换序（保留镜须与原第 1..N 镜逐位对位，即只能删尾部）。要完整结构操作，可给 shots.json 各镜手动补 id 字段升级为有键文档'
            : '该任务分镜无身份键：不删镜时不允许换序（保留镜须逐位对位）。要重排镜头，可给 shots.json 各镜手动补 id 字段升级为有键文档' });
        }
      }
      // 任务级参数补丁（P11）：白名单子集 + 与 SHOTS_PATCH 同套值校验；platform 与 width/height 二选一
      const taskPatch = body.task && typeof body.task === 'object' ? body.task : null;
      let taskChanged = false;
      if (taskPatch) {
        for (const k of Object.keys(taskPatch)) {
          if (!EDIT_TASK_FIELDS.includes(k)) return json(res, 400, { error: `任务级参数不支持: ${k}（可改: ${EDIT_TASK_FIELDS.join(' / ')}；音色/语速请走控制台重跑面板）` });
          if (taskPatch[k] !== null && !SHOTS_PATCH[k](taskPatch[k])) return json(res, 400, { error: `任务级参数值非法: ${k}=${JSON.stringify(taskPatch[k])}（null=清除该参数）` });
          if (orig[k] !== taskPatch[k]) taskChanged = true;
        }
        if (taskPatch.platform != null && (taskPatch.width != null || taskPatch.height != null)) return json(res, 400, { error: 'platform 与 width/height 只能二选一（平台规格自带画幅）' });
      }
      const merged = { ...orig, shots: finalList };
      if (taskPatch) {
        for (const k of Object.keys(taskPatch)) {
          if (taskPatch[k] === null) delete merged[k]; // null=清除（回全局默认）
          else merged[k] = taskPatch[k];
        }
        if ('platform' in taskPatch) { delete merged.width; delete merged.height; } // 平台是画幅单一出处（P6 同口径）：选了/清了平台都清掉显式画幅
        else if (taskPatch.width != null || taskPatch.height != null) delete merged.platform;
      }
      const drift = narrationDrift(dir, merged); // 漂移要比「改后 + 打补丁后」的口播，拿 orig 比等于永远同步
      // 钳 1 双条件：文本漂移，或结构变更（无键文档按位匹配有歧义——即便整串拼回旧序也绝不免配音）
      let from = drift || structural ? 1 : 2;
      if (upgrading) from = Math.min(from, 2); // 升级补 id：至少重编译把 id 烘进 timeline.json（免重配音）
      if (taskChanged) {
        // 任务级参数受影响最早步骤：画幅/平台=02、风格/字幕开关=03/05 → 保守取 2 与现 from 的较小
        from = Math.min(from, 2);
      }
      fs.copyFileSync(sj, sj + '.bak'); // 备份 = 本次保存前状态
      writeJson(sj, merged);
      log('07-web', `Editor 保存 ${name}：${finalList.length} 镜${upgrading ? '（补 id 升级）' : structural ? '（结构变更：增删/排序）' : ''}${taskChanged ? '（任务级参数已改）' : ''} · 口播${drift ? '有漂移 → from 1' : '未动 → from 2'}${body.rerun ? '' : '（未重跑）'}`);
      let rerun = null;
      if (body.rerun) {
        const r = startRerun(name, dir, from, {}, null, false);
        if (r.error) return json(res, 400, { error: `已保存，但重跑未排上: ${r.error}` });
        rerun = { from: r.from };
      }
      return json(res, 200, { ok: true, narrationDrift: drift, structural, upgraded: upgrading, from, rerun, backup: 'shots.json.bak', doc: merged });
    }

    // —— 技术库货架（P3-3）：techniques/*.json 每技术一配方；坏文件不藏、以 error 态直示 ——
    if (p === '/api/techniques' && req.method === 'GET') {
      return json(res, 200, loadTechniques());
    }

    // —— 素材库（P7-1）：library/ 列表 + 选用复制进任务 assets ——
    if (p === '/api/library' && req.method === 'GET') {
      return json(res, 200, libraryList());
    }
    if (p === '/api/library/add' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const r = libraryAdd(String(body.kind || ''), String(body.name || ''), String(body.task || ''), String(body.mode || ''));
      if (r.error) return json(res, r.status || 400, { error: r.error });
      return json(res, 200, r);
    }

    // —— AI 生图（P7-2）：手动触发 → 存 library/images →（可选）作背景图附加入任务；管线六步永不自动调用 ——
    if (p === '/api/txt2img' && req.method === 'POST') {
      const st = imagegenState();
      if (!st.enabled) return json(res, 400, { error: `生图未启用（key 来源: ${st.where}）——在 pipeline/config.local.json 给 voice.dashscope.key（复用）或 imagegen.key（单独密钥）填 DashScope key，或设环境变量 DASHSCOPE_API_KEY；生图按张计费` });
      if (imgBusy) return json(res, 409, { error: '已有一张图在生成中，等它完成再点' });
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const prompt = String(body.prompt || '').trim();
      if (!prompt) return json(res, 400, { error: 'prompt 不能为空' });
      if (prompt.length > 2000) return json(res, 400, { error: `prompt 过长（${prompt.length} 字符，上限 2000）` });
      const size = String(body.size || st.size || 'auto');
      const badSize = checkImgSize(size);
      if (badSize) return json(res, 400, { error: `${badSize}（常用: auto / 1024x1920 / 1920x1024 / 1024x1024 / 1024x1440）` });
      // 附加入选任务：花钱前先校验（不许生成成功后才发现任务不对）
      const attachTask = String(body.attachTask || '');
      if (attachTask) {
        if (!NAME_RE.test(attachTask)) return json(res, 400, { error: 'bad task' });
        if (!fs.existsSync(path.join(OUTPUT, attachTask, 'shots.json'))) return json(res, 404, { error: `任务不存在: ${attachTask}` });
      }
      imgBusy = true;
      try {
        const { buf, ms, usage } = await genImage(prompt, size);
        const name = libSaveImage(buf);
        const attach = attachTask ? libraryAdd('images', name, attachTask, String(body.attachMode || '') === 'as-is' ? 'as-is' : 'bg') : null;
        log('07-web', `AI 生图 ${name} · ${st.model} · ${size} · ${(ms / 1000).toFixed(1)}s${usage ? ' · ' + JSON.stringify(usage) : ''}${attach && attach.ok ? ` → ${attach.written}` : ''}`);
        return json(res, 200, { ok: true, name, saved: `library/images/${name}`, ms, attach, dataUrl: 'data:image/png;base64,' + buf.toString('base64') });
      } catch (e) {
        warn('07-web', `AI 生图失败: ${e.message}`);
        return json(res, 502, { error: `生图失败: ${e.message}` });
      } finally { imgBusy = false; }
    }

    // —— 声音复刻三路由（P8）：创建(含审核轮询) / 同步远端状态 / 删除 ——
    if (p === '/api/voice/clone' && req.method === 'POST') {
      const st = cloneState();
      if (!st.enabled) return json(res, 400, { error: `克隆未启用（key 来源: ${st.where}）——在 pipeline/config.local.json 给 voice.dashscope.key（复用）或 voice.clone.key（单独密钥）填 DashScope key，或设环境变量 DASHSCOPE_API_KEY；复刻 Qwen 系列按官方口径 ¥0.01/次（创建失败不计费），合成按所选模型计费` });
      if (cloneBusy) return json(res, 409, { error: '已有一个复刻任务在进行中，等它完成' });
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const audio = String(body.audio || '');
      const m = /^data:audio\/(mpeg|mp3|wav|x-wav|mp4|m4a|x-m4a|aac|ogg|flac);base64,([A-Za-z0-9+/=]+)$/.exec(audio);
      if (!m) return json(res, 400, { error: '样本须为 base64 Data URI 且是音频（audio/mpeg|wav|m4a|aac|ogg|flac）' });
      const bytes = Math.floor(m[2].length * 0.75);
      if (bytes < 5000) return json(res, 400, { error: `样本太小（${bytes}B）——录 10~20 秒干净人声（无 BGM、少混响）再复刻` });
      if (bytes > 15 * 1024 * 1024) return json(res, 400, { error: `样本过大（${(bytes / 1048576).toFixed(1)}MB，上限 15MB）——10~20 秒 mp3 远远够` });
      const sampleName = String(body.sampleName || '').slice(0, 60);
      cloneBusy = true;
      try {
        const j = await enroll(st, {
          action: 'create_voice', target_model: st.targetModel, prefix: st.prefix,
          audio, language_hints: st.languageHints, max_prompt_audio_length: st.maxLen,
        });
        const voiceId = j.output && j.output.voice_id;
        if (!voiceId) throw Object.assign(new Error('复刻响应缺 output.voice_id：' + JSON.stringify(j).slice(0, 300)), { status: 502 });
        // 审核态轮询 DEPLOYING → OK/UNDEPLOYED；查询抖动按未就绪继续（上限 deployTimeoutSec，超时存 DEPLOYING 交给「同步」）
        let status = 'DEPLOYING';
        const t0 = Date.now();
        while (Date.now() - t0 < st.deployTimeoutSec * 1000) {
          try {
            const q = await enroll(st, { action: 'query_voice', voice_id: voiceId });
            status = (q.output && q.output.status) || 'DEPLOYING';
            if (status !== 'DEPLOYING') break;
          } catch { /* 刚创建可能查询不到，按审核中继续 */ }
          await new Promise((r) => setTimeout(r, 2500));
        }
        const voices = readCloneVoices().filter((v) => v.voiceId !== voiceId);
        voices.unshift({ voiceId, status, targetModel: st.targetModel, sampleName, createdAt: new Date().toISOString() });
        writeCloneVoices(voices);
        log('07-web', `声音复刻 ${voiceId} · ${status} · 样本 ${sampleName || '(未记名)'} · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
        const note = status === 'OK' ? '已就绪——上方「配音音色」下拉选它出片（克隆音色不走兜底换声）'
          : status === 'UNDEPLOYED' ? '审核未通过——换一段更干净的样本（10~20 秒、无 BGM）重新复刻'
          : '审核中——稍后点「↻ 同步」刷新状态再用';
        return json(res, 200, { ok: true, voiceId, status, note });
      } catch (e) {
        warn('07-web', `声音复刻失败: ${e.message}`);
        return json(res, e.status || 502, { error: `复刻失败: ${e.message}` });
      } finally { cloneBusy = false; }
    }
    if (p === '/api/voice/clone/sync' && req.method === 'POST') {
      const st = cloneState();
      if (!st.enabled) return json(res, 400, { error: `克隆未启用（key 来源: ${st.where}）` });
      try {
        const j = await enroll(st, { action: 'list_voice', page_size: 50, page_index: 0 });
        const remote = (j.output && j.output.voice_list) || [];
        const known = readCloneVoices();
        // 远端为准（本地被删/改的以远端状态覆盖）；本地元数据（样本名/时间）能带上就带上
        const voices = remote.map((r) => {
          const k = known.find((v) => v.voiceId === r.voice_id);
          return {
            voiceId: r.voice_id,
            status: r.status || 'OK',
            targetModel: (k && k.targetModel) || deriveCloneTarget(r.voice_id),
            sampleName: (k && k.sampleName) || '',
            createdAt: (k && k.createdAt) || r.gmt_create || '',
          };
        });
        writeCloneVoices(voices);
        log('07-web', `声音复刻同步：远端 ${voices.length} 个音色`);
        return json(res, 200, { ok: true, voices });
      } catch (e) {
        warn('07-web', `声音复刻同步失败: ${e.message}`);
        return json(res, e.status || 502, { error: `同步失败: ${e.message}` });
      }
    }
    if (p === '/api/voice/clone/delete' && req.method === 'POST') {
      const st = cloneState();
      if (!st.enabled) return json(res, 400, { error: `克隆未启用（key 来源: ${st.where}）` });
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const voiceId = String(body.voiceId || '');
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,119}$/.test(voiceId)) return json(res, 400, { error: 'bad voiceId' });
      const known = readCloneVoices();
      if (!known.some((v) => v.voiceId === voiceId)) return json(res, 404, { error: `本地清单没有 ${voiceId}——先点「↻ 同步」拉取账号里的音色` });
      try {
        await enroll(st, { action: 'delete_voice', voice_id: voiceId });
        writeCloneVoices(known.filter((v) => v.voiceId !== voiceId));
        log('07-web', `声音复刻删除 ${voiceId}`);
        return json(res, 200, { ok: true, note: '已删除——若某任务仍选用它，出片会明确报错，去表单换个音色' });
      } catch (e) {
        warn('07-web', `声音复刻删除失败: ${e.message}`);
        return json(res, e.status || 502, { error: `删除失败: ${e.message}` });
      }
    }

    // —— 任务持久聊天框（P3-4）：chat.json 多线程；需求解析→补丁→共享重跑引擎；聊天历史=改动审计 ——
    if (p === '/api/chat' && req.method === 'GET') {
      const name = String(u.searchParams.get('name') || '').trim();
      if (!NAME_RE.test(name)) return json(res, 400, { error: 'bad task' });
      const chat = readJson(path.join(OUTPUT, name, 'chat.json')) || { threads: [], activeThread: null };
      const th = (chat.threads || []).find((x) => x.id === chat.activeThread) || null;
      return json(res, 200, {
        activeThread: chat.activeThread || null,
        threadTitles: (chat.threads || []).map((x) => ({ id: x.id, title: x.title })),
        messages: th ? th.messages : [],
        llm: { on: llmOnNow(), degraded: llmState.on && llmState.ok === false, error: llmState.error, kind: llmState.kind, at: llmState.at },
      });
    }
    if (p === '/api/chat' && req.method === 'POST') {
      if (state.running || state.queue.length) return json(res, 409, { error: '有任务正在跑/排队，等它完成' });
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const name = String(body.name || '').trim();
      if (!NAME_RE.test(name)) return json(res, 400, { error: 'bad task' });
      const dir = path.join(OUTPUT, name);
      if (!fs.existsSync(path.join(dir, 'shots.json'))) return json(res, 404, { error: '任务不存在' });
      const text = String(body.text || '').trim();
      if (!text || text.length > 500) return json(res, 400, { error: '需求文本为空或超过 500 字' });
      // 线程：无活跃线程或显式 newThread 时开新线程
      const chatPath = path.join(dir, 'chat.json');
      const chat = readJson(chatPath) || { threads: [], activeThread: null };
      if (!Array.isArray(chat.threads)) chat.threads = [];
      if (body.newThread || !chat.activeThread || !chat.threads.find((x) => x.id === chat.activeThread)) {
        const id = `t${chat.threads.length + 1}-${Date.now().toString(36)}`;
        chat.threads.push({ id, title: text.slice(0, 20), createdAt: Date.now(), messages: [] });
        chat.activeThread = id;
      }
      const th = chat.threads.find((x) => x.id === chat.activeThread);
      th.messages.push({ role: 'user', text, at: Date.now() });
      // 需求解析（P3-5）：qwen 语义优先（开启且有 key），失败/关闭 → 规则模式；错误种类明示
      const cfg = loadConfig();
      const llmOn = (cfg.llm || {}).enabled !== false && !!(cfg.voice && cfg.voice.dashscope && cfg.voice.dashscope.key);
      let need, via = 'rules';
      if (llmOn) {
        try {
          need = await qwenParse(text, {
            shots: readJson(path.join(dir, 'shots.json')) || {},
            overrides: readJson(path.join(dir, 'config.overrides.json')) || {},
            techniques: loadTechniques().filter((x) => !x.error).map((x) => ({ name: x.name, insert: x.insert })),
          }, cfg);
          llmState = { on: true, ok: true, error: null, kind: null, at: Date.now() };
          via = 'qwen';
        } catch (e) {
          llmState = { on: true, ok: false, error: e.message, kind: e.kind || 'api', at: Date.now() };
          warn('07-web', `qwen 解析失败（${e.kind || 'api'}）：${e.message} —— 降级规则模式`);
          need = parseNeed(text, loadTechniques());
        }
      } else {
        need = parseNeed(text, loadTechniques());
      }
      let reply, started = false;
      if (!need.desc.length) {
        reply = '没听懂这句需求，任务没动。试试：换演示风 / 字幕大一点 / 收尾降调 3 个半音 / 关闭字幕 / BGM 小声一点 / 转场绵长 / 语速 8 字——或直接说技术库里的名字（如「BGM 收尾降调」）。';
      } else {
        // 语速相对调整：基于任务当前值（shots 优先，回退全局默认），钳进 4.5~9
        let patch = need.shots || {};
        if (need.rateSet) patch = { ...patch, targetCharsPerSec: need.rateSet };
        else if (need.rateDelta) {
          const cur = (readJson(path.join(dir, 'shots.json')) || {}).targetCharsPerSec || loadConfig().voice?.targetCharsPerSec || 7.2;
          patch = { ...patch, targetCharsPerSec: Math.min(9, Math.max(4.5, +(cur + need.rateDelta).toFixed(1))) };
        }
        const r = startRerun(name, dir, need.from, patch, need.config, false);
        if (r.error) reply = `需求已记录，但重跑失败：${r.error}`;
        else {
          started = true;
          reply = `已理解 ${need.desc.length} 处改动，从第 ${need.from} 步重跑中：\n${need.desc.map((d, i) => `${i + 1}. ${d}`).join('\n')}\n——改动已累积写入本任务（补丁叠加不覆盖），聊天记录即审计日志，可继续追加需求。`;
        }
      }
      if (llmState.on && llmState.ok === false) reply += `\n⚠️ qwen 暂不可用（${llmState.kind === 'quota' ? '额度用尽/限流' : llmState.kind === 'network' ? '网络不通' : '接口错误'}：${llmState.error}），本轮已降级规则模式；恢复后自动切回。`;
      else if (via === 'qwen') reply += '\n（由 qwen 语义解析）';
      th.messages.push({ role: 'assistant', text: reply, at: Date.now(), via, ops: need.desc.length ? { from: need.from, shots: need.shots, config: need.config, rateSet: need.rateSet, rateDelta: need.rateDelta } : undefined, started });
      writeJson(chatPath, chat);
      return json(res, 200, { reply, started, activeThread: chat.activeThread });
    }

    // —— 任务产物预览（白名单文件名，防穿越）——
    const fm = /^\/file\/([^/]+)\/(.+)$/.exec(p);
    if (fm) {
      const [, taskEnc, relEnc] = fm;
      // 先 decode 再白名单校验（P2-1 原则）：pathname 保留百分号编码，
      // 中文任务名（AI短剧变现 → AI%E7%9F%AD...）不解码必过不了 NAME_RE
      let taskName, rel;
      try {
        taskName = decodeURIComponent(taskEnc);
        rel = decodeURIComponent(relEnc);
      } catch { return json(res, 400, { error: 'bad encoding' }); }
      if (!NAME_RE.test(taskName)) return json(res, 400, { error: 'bad task' });
      const allowed = /^[\w一-鿿.\- \/]+$/.test(rel) && !rel.includes('..');
      const fp = path.join(OUTPUT, taskName, rel);
      if (!allowed || !fp.startsWith(path.join(OUTPUT, taskName))) return json(res, 400, { error: 'bad path' });
      return serveFile(req, res, fp);
    }

    // —— 页面 ——
    if (p === '/' || p === '/index.html') {
      const html = fs.readFileSync(path.join(ROOT, 'web', 'public', 'index.html'), 'utf8');
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      return res.end(html);
    }
    if (p === '/console') {
      const html = fs.readFileSync(path.join(ROOT, 'web', 'public', 'console.html'), 'utf8');
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      return res.end(html);
    }
    if (p === '/editor') {
      const html = fs.readFileSync(path.join(ROOT, 'web', 'public', 'editor.html'), 'utf8');
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      return res.end(html);
    }
    if (p === '/timeline') {
      const html = fs.readFileSync(path.join(ROOT, 'web', 'public', 'timeline.html'), 'utf8');
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      return res.end(html);
    }
    if (p === '/wizard') {
      const html = fs.readFileSync(path.join(ROOT, 'web', 'public', 'wizard.html'), 'utf8');
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      return res.end(html);
    }
    json(res, 404, { error: 'unknown route' });
  } catch (e) {
    json(res, 500, { error: String(e).slice(0, 300) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  log('07-web', `本地网页界面已启动：http://127.0.0.1:${PORT}  （Ctrl+C 停止）`);
});
