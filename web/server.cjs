// web/server.cjs · 本地网页界面（零新增依赖：Node 内置 http + 现有 pipeline）
// 启动: node web/server.cjs [--port 8787]     然后浏览器开 http://127.0.0.1:8787
// 能力: 填文案 → 传素材(可选) → 选音色/语速 → 一键出片（01→06 全链）→ 进度条 → 在线预览成片/封面/QC 抽帧
// 安全: 只监听 127.0.0.1；任务名/文件名白名单；视频预览带 Range（可拖进度条）
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { ROOT, loadConfig, readJson, writeJson, ensureDir, log, warn } = require('../pipeline/lib/common.cjs');
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
    const p = spawn(process.execPath, [path.join(ROOT, 'pipeline', step.file), taskDir], { cwd: ROOT });
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

async function runPipeline(taskDir) {
  state.running = true;
  state.ok = null;
  state.at = Date.now();
  try {
    for (const step of STEPS) {
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
    await runPipeline(item.dir);
    state.done.push({ name: item.name, ok: state.ok });
  }
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
        return {
          name: d,
          hasVideo: fs.existsSync(path.join(dir, '成片.mp4')),
          hasCover: fs.existsSync(path.join(dir, '封面.png')),
          provider: meta.provider || '',
          voice: (meta.voice && (meta.voice.voice || meta.voice.name)) || '',
          dur: meta.duration || 0,
          mt: fs.statSync(dir).mtimeMs,
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

    // —— 任务产物预览（白名单文件名，防穿越）——
    const fm = /^\/file\/([^/]+)\/(.+)$/.exec(p);
    if (fm) {
      const [, taskName, relEnc] = fm;
      if (!NAME_RE.test(taskName)) return json(res, 400, { error: 'bad task' });
      let rel;
      try { rel = decodeURIComponent(relEnc); } catch { return json(res, 400, { error: 'bad encoding' }); }
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
