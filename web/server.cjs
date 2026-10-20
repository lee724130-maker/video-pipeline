// web/server.cjs · 本地网页界面（零新增依赖：Node 内置 http + 现有 pipeline）
// 启动: node web/server.cjs [--port 8787]     然后浏览器开 http://127.0.0.1:8787
// 能力: 填文案 → 传素材(可选) → 选音色/语速 → 一键出片（01→06 全链）→ 进度条 → 在线预览成片/封面/QC 抽帧
// 安全: 只监听 127.0.0.1；任务名/文件名白名单；视频预览带 Range（可拖进度条）
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { ROOT, loadConfig, deepMerge, readJson, writeJson, ensureDir, log, warn } = require('../pipeline/lib/common.cjs');
const { parseNeed, SHOTS_PATCH } = require('./chat-rules.cjs');
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

async function runPipeline(taskDir, from = 1) {
  state.running = true;
  state.ok = null;
  state.at = Date.now();
  try {
    if (from > 1) push(`局部重跑：从第 ${from} 步起（复用此前产物）`);
    for (const step of STEPS) {
      if (step.n < from) continue;
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
    await runPipeline(item.dir, item.from || 1);
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
function startRerun(name, dir, from, patch, config, resetConfig) {
  const sj = path.join(dir, 'shots.json');
  if (!fs.existsSync(sj)) return { error: '任务不存在' };
  if (!Number.isInteger(from) || from < 1 || from > 6) return { error: 'from 必须是 1~6' };
  patch = patch && typeof patch === 'object' ? patch : {};
  const shots = readJson(sj) || {};
  for (const k of Object.keys(patch)) {
    if (!SHOTS_PATCH[k]) return { error: `不支持的 shots 字段: ${k}（可改: ${Object.keys(SHOTS_PATCH).join(' / ')}）` };
    if (!SHOTS_PATCH[k](patch[k])) return { error: `字段值非法: ${k}=${JSON.stringify(patch[k])}` };
    shots[k] = patch[k];
  }
  writeJson(sj, shots);
  // config 补丁：深合并进任务级 config.overrides.json（经 PIPELINE_CONFIG_OVERRIDES 让全步骤生效）；resetConfig 清空
  const ovPath = path.join(dir, 'config.overrides.json');
  if (resetConfig && fs.existsSync(ovPath)) fs.unlinkSync(ovPath);
  if (config && typeof config === 'object') writeJson(ovPath, deepMerge(readJson(ovPath) || {}, config));
  log('07-web', `局部重跑 ${name}：从第 ${from} 步起${Object.keys(patch).length ? ' · shots ' + Object.keys(patch).join(',') : ''}${config ? ' · config 补丁已应用' : ''}${resetConfig ? ' · 已清空 config 补丁' : ''}`);
  state.lines = [];
  state.done = [];
  state.task = name;
  state.queue.push({ name, dir, from, batchTotal: 1 });
  pumpQueue(); // 异步跑，进度走 /api/status 轮询
  return { ok: true, from };
}
// 技术库读取（techniques/*.json，坏文件带 error 直示）
function loadTechniques() {
  const dir = path.join(ROOT, 'techniques');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
  return files.map((f) => {
    const t = readJson(path.join(dir, f));
    if (!t || !t.id || !t.name || !t.insert) return { id: f.replace(/\.json$/, ''), name: f, error: '配方缺 id/name/insert 字段' };
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
      return json(res, 200, {
        voices: VOICES,
        defaultVoice: (cfg.voice?.dashscope || {}).voice || 'loongstella_v3.1',
        defaultRate: Number((cfg.voice?.dashscope || {}).targetCharsPerSec || 7.2),
        running: state.running,
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
      const SCENE_STYLES = ['classic', 'deck'];
      const sceneStyle = String(body.sceneStyle || 'classic');
      if (!SCENE_STYLES.includes(sceneStyle)) return json(res, 400, { error: `场景风格非法: ${sceneStyle}（可选: ${SCENE_STYLES.join(' / ')}）` });
      for (const v of variants) {
        if (!NAME_RE.test(v.name)) return json(res, 400, { error: `变体任务名非法: ${v.name}` });
        const dir = ensureDir(path.join(OUTPUT, v.name));
        const shots = {
          title: v.name,
          width: Number(body.width) || 1080,
          height: Number(body.height) || 1920,
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
        if (assets.length || body.bgm) ensureDir(path.join(dir, 'assets'));
        assets.forEach((a, i) => {
          const m = /^data:image\/(jpe?g|png|webp);base64,(.+)$/.exec(String(a) || '');
          if (!m) return;
          const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
          fs.writeFileSync(path.join(dir, 'assets', `bg-${String(i + 1).padStart(2, '0')}.${ext}`), Buffer.from(m[2], 'base64'));
        });
        if (body.bgm) {
          const mb = /^data:audio\/(mpeg|mp3);base64,(.+)$/.exec(String(body.bgm) || '');
          if (mb) fs.writeFileSync(path.join(dir, 'assets', 'bgm.mp3'), Buffer.from(mb[2], 'base64'));
        }
        written.push({ name: v.name, dir });
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
      const r = startRerun(name, path.join(OUTPUT, name), Number(body.from) || 3, body.shots, body.config, body.resetConfig);
      if (r.error) return json(res, r.error === '任务不存在' ? 404 : 400, { error: r.error });
      return json(res, 200, { ok: true, name, from: r.from });
    }

    // —— 技术库货架（P3-3）：techniques/*.json 每技术一配方；坏文件不藏、以 error 态直示 ——
    if (p === '/api/techniques' && req.method === 'GET') {
      return json(res, 200, loadTechniques());
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
    json(res, 404, { error: 'unknown route' });
  } catch (e) {
    json(res, 500, { error: String(e).slice(0, 300) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  log('07-web', `本地网页界面已启动：http://127.0.0.1:${PORT}  （Ctrl+C 停止）`);
});
