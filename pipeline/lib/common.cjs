// 公共工具：子进程、ffmpeg/ffprobe、日志
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const FFMPEG = detectTool('ffmpeg');
const FFPROBE = detectTool('ffprobe');
const ROOT = path.resolve(__dirname, '..', '..');

// —— 配置加载：config.json（进仓库）+ config.local.json（gitignore，本机私有：API key/代理/路径）
// 两层深合并，local 覆盖 base；若设置 PIPELINE_CONFIG_OVERRIDES（任务级补丁文件路径，由 web 局部重跑
// 写入 <任务目录>/config.overrides.json），再深合并一层——CLI 不设该变量，行为不变
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
function deepMerge(a, b) {
  const out = { ...a };
  for (const k of Object.keys(b)) out[k] = isObj(b[k]) && isObj(a[k]) ? deepMerge(a[k], b[k]) : b[k];
  return out;
}
function loadConfig() {
  const base = readJson(path.join(ROOT, 'pipeline', 'config.json')) || {};
  const local = readJson(path.join(ROOT, 'pipeline', 'config.local.json')) || {};
  let out = deepMerge(base, local);
  const ov = process.env.PIPELINE_CONFIG_OVERRIDES;
  if (ov && fs.existsSync(ov)) out = deepMerge(out, readJson(ov) || {});
  return out;
}

// —— ffmpeg 探测：config.ffmpeg（目录或 exe 路径）→ PATH → 常见手动安装位（D:/ffmpeg 等）
function detectTool(tool) {
  const exe = process.platform === 'win32' ? `${tool}.exe` : tool;
  const cands = [];
  try {
    const c = JSON.parse(fs.readFileSync(path.join(ROOT, 'pipeline', 'config.json'), 'utf8'));
    if (c.ffmpeg) cands.push(path.join(c.ffmpeg, exe), c.ffmpeg.endsWith(exe) ? c.ffmpeg : null);
  } catch { /* config 不存在/损坏时走后续候选 */ }
  cands.push(exe, `D:/ffmpeg/bin/${exe}`, `C:/ffmpeg/bin/${exe}`);
  for (const p of cands.filter(Boolean)) {
    try {
      const r = spawnSync(p, ['-version'], { encoding: 'utf8', timeout: 10000 });
      if (r.status === 0) return p;
    } catch { /* 继续试下一个 */ }
  }
  return exe; // 全部失败 → 交回 PATH 名，调用时报错（00-checkenv 会报告）
}

function log(tag, msg) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log(`[${t}] [${tag}] ${msg}`);
}

function warn(tag, msg) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log(`[${t}] [${tag}] ⚠ ${msg}`);
}

function run(cmd, args, opts = {}) {
  // Windows 下 spawnSync 不能直接执行 .cmd/.bat，须走 cmd /c
  let finalCmd = cmd, finalArgs = args;
  if (/\.(cmd|bat)$/i.test(cmd) && !opts.shell) {
    finalCmd = process.env.ComSpec || 'cmd.exe';
    finalArgs = ['/d', '/s', '/c', cmd, ...args];
  }
  const r = spawnSync(finalCmd, finalArgs, {
    cwd: opts.cwd || ROOT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 64,
    shell: false,
    ...opts,
  });
  return {
    code: r.status,
    ok: r.status === 0,
    out: (r.stdout || '') + (r.stderr || ''),
    error: r.error ? String(r.error.message) : '',
  };
}

function ffprobe(file) {
  const r = run(FFPROBE, [
    '-v', 'error',
    '-show_entries', 'format=duration,size:stream=index,codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels',
    '-of', 'json', file,
  ]);
  if (!r.ok) throw new Error(`ffprobe 失败: ${file}\n${r.out}`);
  return JSON.parse(r.out);
}

function durationOf(file) {
  const p = ffprobe(file);
  return parseFloat(p.format.duration);
}

// 解码法实测时长：DashScope 返回的 mp3 文件头（Xing/Duration 字段）是错的
// （实测头报 61.6s、解码 66.0s），凡是拿时长做计算的地方必须用这个。
function durationDecoded(file) {
  const r = run(FFMPEG, ['-i', file, '-f', 'null', '-']);
  const ms = [...r.out.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
  if (!r.ok || !ms.length) return durationOf(file); // 兜底退回头信息
  const [, h, m, s] = ms[ms.length - 1];
  return +h * 3600 + +m * 60 + +s;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

function readJson(p, fallback = null) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

function writeJson(p, obj) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(obj, null, 1), 'utf8');
}

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

// —— 响度标准化：测量 → 应用 → 复测迭代（常规一步、异常素材多轮）
// 常规素材（口播/KTV）线性增益一步到位；瞬态峰值高的素材（SAPI 兜底配音等）线性增益会撞
// TP 上限被截断（I 贴不到目标还浪费增益），预测到撞限时自动改走 dynamic（增益跟踪+内部限幅
// 压动态贴目标），并按复测残差迭代，直到实测贴住目标 ±1.5 或耗尽 3 轮处理。
// 视频流 copy、只重编音频，任何合成分支通用。返回 {from,to} LUFS（to=最终实测）；静音/失败返回 null。
function loudnormFile(file, opts = {}) {
  const I = Number(opts.i ?? -14), TP = Number(opts.tp ?? -1.5), LRA = Number(opts.lra ?? 11);
  const base = `I=${I}:TP=${TP}:LRA=${LRA}`;
  // 保持原采样率（loudnorm 内部升到 192k，必须显式指定输出）
  const sr = run(FFPROBE, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate', '-of', 'csv=p=0', file]).out.trim();
  const rate = /^\d+$/.test(sr) ? sr : '44100';
  let from = null, last = null;
  for (let iter = 0; iter < 4; iter++) {
    const m = run(FFMPEG, ['-i', file, '-map', '0:a:0', '-af', `loudnorm=${base}:print_format=json`, '-f', 'null', '-']);
    const jm = m.out.match(/\{\s*"input_i"[\s\S]*?\}/);
    if (!jm) break;
    let j; try { j = JSON.parse(jm[0]); } catch { break; }
    if (String(j.input_i).includes('inf') || !j.input_thresh) break; // 静音轨跳过
    const cur = Number(j.input_i);
    if (from === null) from = cur;
    last = cur;
    if (Math.abs(cur - I) <= 1.5) break;            // 实测已贴住目标 ±1.5，收工
    if (iter >= 3) break;                            // 处理轮数耗尽（最后只剩复测）
    // 线性增益能到目标且不撞 TP → 线性（无损分布一步到位）；否则 dynamic 压动态
    const g = I - cur;
    const clip = Number(j.input_tp) + g > TP - 0.3; // 预测真峰值越过上限（留 0.3 余量）
    const af = `loudnorm=${base}:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:${clip ? 'linear=false' : 'linear=true'}:print_format=summary`;
    const tmp = `${file}.tmp.mp4`; // 必须带 .mp4 扩展名，否则 ffmpeg 推不出封装格式
    fs.existsSync(tmp) && fs.unlinkSync(tmp);
    const r = run(FFMPEG, [
      '-y', '-i', file, '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'copy',
      '-af', af, '-c:a', 'aac', '-b:a', '192k', '-ar', rate,
      '-movflags', '+faststart', tmp,
    ]);
    if (!r.ok || !fs.existsSync(tmp) || fs.statSync(tmp).size < 1024) {
      fs.existsSync(tmp) && fs.unlinkSync(tmp);
      break;
    }
    fs.unlinkSync(file);
    fs.renameSync(tmp, file);
  }
  if (from === null) return null;
  return { from, to: Number((last ?? from).toFixed(1)) };
}

// BGM 查找：任务根目录 bgm.* 优先，其次 assets/bgm.*（用户提供的文件才启用 BGM 功能）
const BGM_EXTS = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'mp4'];
function findBgm(task) {
  for (const dir of [task, path.join(task, 'assets')]) {
    for (const ext of BGM_EXTS) {
      const p = path.join(dir, `bgm.${ext}`);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

// 素材背景图：assets/bg-NN.(jpg|png|webp) 按序号排序（03 场景轮播底图 / 07 KTV 轮播底图共用）
function bgImages(task) {
  const dir = path.join(task, 'assets');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => /^bg-\d+\.(jpe?g|png|webp)$/i.test(f))
    .sort((a, b) => Number(a.match(/bg-(\d+)/i)[1]) - Number(b.match(/bg-(\d+)/i)[1]));
}

module.exports = { FFMPEG, FFPROBE, ROOT, log, warn, run, ffprobe, durationOf, durationDecoded, ensureDir, readJson, writeJson, findBgm, bgImages, loadConfig, deepMerge, loudnormFile, fail };
