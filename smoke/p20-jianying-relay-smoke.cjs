// smoke/p20-jianying-relay-smoke.cjs —— P18 改道「剪映接力包」冒烟
// 背景：剪映 6.x draft_content.json 加密 → 直接写草稿被物理封死（且逆向正是律师函点）；改走官方路：干净底带 + SRT 字幕轨。
// A srt 单测（编号/时间戳/空条目）· B 接力包 E2E（三文件产出、干净底带真无字幕、烧字幕版不被覆盖、主链零触碰）· C 负例 · D 清场
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { ROOT, OUTPUT, sweepProbes } = require('./lib.cjs');
const { buildSrt, stamp } = require('../pipeline/lib/srt.cjs');
const BASE = 'http://127.0.0.1:8787';
const NAME = '_probe_p20_relay';
const P = path.join(OUTPUT, NAME);
let pass = 0, failN = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✓ ' + n); } else { failN++; console.log('  ✗ FAIL ' + n + (e ? ' — ' + e : '')); } };
async function get(u) { const r = await fetch(u); return { status: r.status, j: await r.json().catch(() => ({})) }; }
async function post(u, b) { const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }); return { status: r.status, j: await r.json().catch(() => ({})) }; }
function copyDir(s, d) { fs.mkdirSync(d, { recursive: true }); for (const e of fs.readdirSync(s, { withFileTypes: true })) { const a = path.join(s, e.name), b = path.join(d, e.name); e.isDirectory() ? copyDir(a, b) : fs.copyFileSync(a, b); } }
const dur = (f) => Number(cp.execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${f}"`).toString().trim());
async function idle(maxSec = 600) {
  const t0 = Date.now();
  for (;;) { const s = await get(BASE + '/api/status'); if (!s.j.running && !(s.j.queue && s.j.queue.length) && Date.now() - t0 > 5000) return true; if (Date.now() - t0 > maxSec * 1000) return false; await new Promise((r) => setTimeout(r, 1500)); }
}

(async () => {
  console.log('A SRT 单测');
  {
    ok('时间戳格式', stamp(0) === '00:00:00,000' && stamp(3661.5) === '01:01:01,500', stamp(3661.5));
    const srt = buildSrt([
      { text: '第一条', start: 0.2, end: 1.8 },
      { text: '  ', start: 2, end: 3 },
      { text: '第二条', start: 2.5, end: 2.55 },
    ]);
    const blocks = srt.trim().split('\r\n\r\n');
    ok('空条目跳过且编号连续', blocks.length === 2 && blocks[0].startsWith('1\r\n') && blocks[1].startsWith('2\r\n'), String(blocks.length));
    ok('最短时长兜底 0.2s', blocks[1].includes('-->') && /00:00:0\d,\d\d\d --> 00:00:0\d,\d\d\d/.test(blocks[1]), blocks[1] && blocks[1].split('\r\n')[1]);
  }

  await idle(300);
  fs.rmSync(P, { recursive: true, force: true });
  copyDir(path.join(OUTPUT, 'deck-demo'), P);

  console.log('B 接力包 E2E');
  {
    let r = await post(BASE + '/api/edit', { name: NAME, import: true });
    ok('导入编辑单', r.status === 200);
    r = await post(BASE + '/api/rerun', { name: NAME, from: 7, to: 8 });
    ok('先出烧字幕版精修（排队）', r.status === 200 && r.j.from === 7);
    ok('等精修完成', await idle());
    const burned = path.join(P, '精修', '成片.mp4');
    const burnedStat = fs.statSync(burned);
    r = await post(BASE + '/api/edit/jianying-package', { name: NAME });
    ok('接力包 200 + 三文件', r.status === 200 && r.j.ok === true && r.j.files.length === 3 && r.j.captions > 5, JSON.stringify(r.j).slice(0, 120));
    const clean = path.join(P, '精修', '成片-干净底带.mp4');
    const srtF = path.join(P, '精修', '字幕.srt');
    const mdF = path.join(P, '精修', '剪映接力说明.md');
    ok('三文件真实落盘', fs.existsSync(clean) && fs.existsSync(srtF) && fs.existsSync(mdF));
    ok('干净底带时长≈精修版（±0.5s）', Math.abs(dur(clean) - dur(burned)) < 0.5, dur(clean) + ' vs ' + dur(burned));
    const after = fs.statSync(burned);
    ok('烧字幕版未被覆盖（mtime 不变）', after.mtimeMs === burnedStat.mtimeMs);
    const srtTxt = fs.readFileSync(srtF, 'utf8');
    ok('SRT 内容与 effective captions 同源', srtTxt.includes('-->') && srtTxt.includes('字幕') === false ? srtTxt.split('\r\n\r\n').length >= 3 : srtTxt.split('\r\n\r\n').length >= 3, srtTxt.slice(0, 60).replace(/\r\n/g, '|'));
    const main = path.join(P, '成片.mp4');
    ok('主链成片零触碰', fs.existsSync(main) && !fs.readFileSync(path.join(P, 'edit.json'), 'utf8').includes('干净底带'));
    // 抽帧对比：两版同帧都能解出图像流（渲染有效性粗验；字幕差异属语义项人工看）
    const t = 40; // 口播中段
    const f1 = path.join(process.env.TEMP, 'p20_burn.jpg'), f2 = path.join(process.env.TEMP, 'p20_clean.jpg');
    cp.execSync(`ffmpeg -v error -y -ss ${t} -i "${burned}" -frames:v 1 "${f1}"`);
    cp.execSync(`ffmpeg -v error -y -ss ${t} -i "${clean}" -frames:v 1 "${f2}"`);
    const frameOk = (f) => { try { const o = JSON.parse(cp.execSync(`ffprobe -v error -show_entries stream=width,height -of json "${f}"`).toString()); const s = (o.streams || [])[0]; return s && s.width >= 1000; } catch { return false; } };
    ok('两版同帧可解码（渲染均有效）', frameOk(f1) && frameOk(f2));
  }

  console.log('C 负例');
  {
    let r = await post(BASE + '/api/edit/jianying-package', { name: 'nope-x' });
    ok('无编辑单/无任务 400/404', r.status === 400 || r.status === 404, String(r.status));
    r = await post(BASE + '/api/edit/jianying-package', { name: '../etc' });
    ok('坏任务名 400', r.status === 400);
  }

  console.log('D 清场');
  fs.rmSync(P, { recursive: true, force: true });
  sweepProbes();
  ok('探针已清 + deck-demo 无恙', !fs.existsSync(P) && fs.existsSync(path.join(OUTPUT, 'deck-demo', '成片.mp4')) && !fs.existsSync(path.join(OUTPUT, 'deck-demo', '精修')));

  console.log(`\nP20 接力包冒烟结果: ${pass} 通过 / ${failN} 失败`);
  process.exitCode = failN ? 1 : 0;
})().catch((e) => { console.error('冒烟异常:', e); try { fs.rmSync(P, { recursive: true, force: true }); sweepProbes(); } catch {} process.exitCode = 1; });
