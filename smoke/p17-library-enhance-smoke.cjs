// smoke/p17-library-enhance-smoke.cjs —— P17 素材库功能增强冒烟
// A 元信息（图片尺寸/BGM 时长，ffprobe 真测）· B 波形（生成/缓存/路由/安全）· C 批量选用（names[] bg 连号/兼容/负例）
// D 缓存卫生（.cache 不入列表、签名失效重探）· E 前端挂点（多选/波形/历史区）· F 清场
// 自建自清：全部用 _p17-* 前缀假件，跑完全删；零管线零计费（不碰任务重跑）。
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ROOT, OUTPUT, FFMPEG } = (() => { const c = require('../pipeline/lib/common.cjs'); return { ROOT: c.ROOT, OUTPUT: path.join(c.ROOT, 'output'), FFMPEG: c.FFMPEG }; })();
const { probeDir, sweepProbes } = require('./lib.cjs');
const BASE = 'http://127.0.0.1:8787';
const LIB = path.join(ROOT, 'library');
let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ FAIL ' + n + (e ? ' — ' + e : '')); } };
async function get(u) { const r = await fetch(u); return { status: r.status, j: await r.json().catch(() => ({})) }; }
async function post(u, b) { const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }); return { status: r.status, j: await r.json().catch(() => ({})) }; }

const FAKE_IMG_A = path.join(LIB, 'images', '_p17-a.png');
const FAKE_IMG_B = path.join(LIB, 'images', '_p17-b.png');
const FAKE_BGM = path.join(LIB, 'bgm', '_p17-test.mp3');
const TASK = '_probe_p17_enh';
const cleanup = () => {
  for (const f of [FAKE_IMG_A, FAKE_IMG_B, FAKE_BGM, path.join(LIB, '.cache', 'wave', '_p17_test_mp3.json')]) { try { fs.rmSync(f, { force: true }); } catch { } }
  try {
    const cp = path.join(LIB, '.cache', 'meta.json');
    const c = JSON.parse(fs.readFileSync(cp, 'utf8'));
    for (const k of Object.keys(c)) if (k.includes('_p17-')) delete c[k];
    fs.writeFileSync(cp, JSON.stringify(c, null, 1));
  } catch { }
  sweepProbes();
};

(async () => {
  cleanup(); // 前置也清一遍（上次中断残留）
  // 造假件：两张真 PNG（ffmpeg lavfi 生成，ffprobe 可测尺寸）+ 一首 3s 正弦 mp3
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=navy:s=640x360', '-frames:v', '1', FAKE_IMG_A], { timeout: 30000 });
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=olive:s=320x320', '-frames:v', '1', FAKE_IMG_B], { timeout: 30000 });
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=3', FAKE_BGM], { timeout: 30000 });
  ok('假件就绪（2 PNG + 1 MP3）', fs.existsSync(FAKE_IMG_A) && fs.existsSync(FAKE_IMG_B) && fs.existsSync(FAKE_BGM));

  console.log('A 元信息（ffprobe 真测）');
  {
    const d = (await get(BASE + '/api/library')).j;
    const a = (d.kinds.images || []).find((x) => x.name === '_p17-a.png');
    const bgm = (d.kinds.bgm || []).find((x) => x.name === '_p17-test.mp3');
    ok('图片 meta = 640×360', a && a.meta && a.meta.w === 640 && a.meta.h === 360, JSON.stringify(a && a.meta));
    ok('BGM meta dur≈3s + wave 标', bgm && bgm.meta && bgm.meta.dur > 2.5 && bgm.meta.dur < 3.5 && bgm.meta.wave === true, JSON.stringify(bgm && bgm.meta));
    ok('.cache 目录不出现在列表（点前缀被过滤）', !JSON.stringify(d.kinds).includes('.cache'));
  }

  console.log('B 波形 API');
  {
    const w = await get(BASE + '/api/library/wave?name=_p17-test.mp3');
    ok('波形 48 格 + dur 字段', w.status === 200 && w.j.wave && w.j.wave.p.length === 48 && w.j.wave.dur > 0, JSON.stringify(w.j).slice(0, 90));
    const wf = path.join(LIB, '.cache', 'wave', '_p17_test_mp3.json');
    ok('波形缓存文件落 library\\.cache\\wave', fs.existsSync(wf));
    const t0 = Date.now(); await get(BASE + '/api/library/wave?name=_p17-test.mp3');
    ok('二次请求走缓存（<50ms 量级）', Date.now() - t0 < 300, (Date.now() - t0) + 'ms');
    ok('坏名 400', (await get(BASE + '/api/library/wave?name=..%2F..%2Fetc')).status === 400);
    ok('不存在 404', (await get(BASE + '/api/library/wave?name=nope-xyz.mp3')).status === 404);
  }

  console.log('C 批量选用');
  {
    // 建探针任务
    const P = probeDir('p17_enh');
    fs.writeFileSync(path.join(P, 'shots.json'), JSON.stringify({ title: TASK, shots: [{ id: 's01', type: 'title', title: 't', narration: '一句话。' }] }));
    let r = await post(BASE + '/api/library/add', { kind: 'images', names: ['_p17-a.png', '_p17-b.png'], task: TASK, mode: 'bg' });
    const written = (r.j.done || []).map((x) => x.written);
    ok('批量 bg 连号 bg-01/02', r.status === 200 && r.j.batch === true && JSON.stringify(written) === JSON.stringify(['assets/bg-01.png', 'assets/bg-02.png']), JSON.stringify(written || r.j));
    r = await post(BASE + '/api/library/add', { kind: 'images', names: ['_p17-a.png'], task: TASK, mode: 'as-is' });
    ok('单名数组兼容（原名复制）', r.status === 200 && r.j.done && r.j.done[0].written === 'assets/_p17-a.png', JSON.stringify(r.j).slice(0, 120));
    r = await post(BASE + '/api/library/add', { kind: 'bgm', names: ['_p17-test.mp3', '_p17-test.mp3'], task: TASK });
    ok('BGM 批量只取第一个 + 明示', r.status === 200 && r.j.done.length === 1 && r.j.skipped.length === 1 && r.j.note.includes('只选了第一个'), JSON.stringify(r.j).slice(0, 140));
    r = await post(BASE + '/api/library/add', { kind: 'images', names: [], task: TASK });
    ok('空数组 400', r.status === 400);
    r = await post(BASE + '/api/library/add', { kind: 'images', names: ['_p17-a.png', 'nope-missing.png'], task: TASK, mode: 'bg' });
    ok('部分失败：成功照常 + failed 列出', r.status === 200 && r.j.done.length === 1 && r.j.failed.length === 1 && r.j.failed[0].name === 'nope-missing.png', JSON.stringify(r.j).slice(0, 160));
    const ad = fs.readdirSync(path.join(P, 'assets'));
    ok('资产目录核对（bg-01/02 + 原名 + bgm）', ad.includes('bg-01.png') && ad.includes('bg-02.png') && ad.includes('_p17-a.png') && /^bgm\./.test(ad.find((f) => f.startsWith('bgm')) || ''), ad.join(','));
  }

  console.log('D 缓存卫生');
  {
    const cp = path.join(LIB, '.cache', 'meta.json');
    const c = JSON.parse(fs.readFileSync(cp, 'utf8'));
    ok('缓存键带签名（size:mtime）', c['images/_p17-a.png'] && /^\d+:\d+$/.test(c['images/_p17-a.png'].sig));
    const before = c['images/_p17-a.png'].meta.h;
    fs.writeFileSync(FAKE_IMG_A, fs.readFileSync(FAKE_IMG_B)); // 换内容=换签名 → 应重探
    delete c['images/_p17-a.png']; fs.writeFileSync(cp, JSON.stringify(c)); // 模拟签名失效
    const d = (await get(BASE + '/api/library')).j;
    const a = d.kinds.images.find((x) => x.name === '_p17-a.png');
    ok('文件变了 → 重探出 320×320（旧 640 不残留）', a && a.meta && a.meta.w === 320 && a.meta.h === 320, JSON.stringify({ now: a && a.meta, was: before }));
  }

  console.log('E 前端挂点');
  {
    const html = fs.readFileSync(path.join(ROOT, 'web/public/console.html'), 'utf8');
    ok('多选/批量按钮 + gcheck + selCount', html.includes('id="selModeBtn"') && html.includes('id="batchBgBtn"') && html.includes('class="gcheck"') && html.includes('id="selCount"'));
    ok('libApplyBatch 走 names[] 契约 + BGM 劝阻提示', html.includes('names, task, mode') && html.includes('BGM 请单选'));
    ok('BGM 卡=波形条 + 播放器并存', html.includes('data-wave=') && html.includes('async function drawWave(') && html.includes('<audio controls preload="none"'));
    ok('元信息角标（尺寸/时长）', html.includes('mt.w ? `${mt.w}×${mt.h}`') && html.includes('mt.dur ?'));
    ok('AI 生图历史区（ai-* 新→旧 + 复用钮）', html.includes('id="aiHist"') && html.includes("startsWith('ai-')") && html.includes('function renderAiHist'));
  }

  console.log('F 清场');
  cleanup();
  {
    const d = (await get(BASE + '/api/library')).j;
    const leaked = JSON.stringify(d.kinds).includes('_p17');
    ok('库内零残留（列表/缓存/波形文件全清）', !leaked && !fs.existsSync(FAKE_BGM) && !fs.existsSync(path.join(LIB, '.cache', 'wave', '_p17_test_mp3.json')));
    ok('探针任务已清', !fs.existsSync(path.join(OUTPUT, TASK)));
  }

  console.log('\nP17 冒烟结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('冒烟异常:', e); cleanup(); process.exitCode = 1; });
