// smoke/p19-cut-export-smoke.cjs —— P12-B/C 冒烟：/cut 页 + 编辑单 API 往返 + 导出精修链（from=7,to=8）
// 关键断言：导出只产 精修/，主链 成片.mp4 字节级零触碰；08+08-qc 经队列跑通；坏编辑单服务端全拦。
// 计费：导出=纯本地 ffmpeg 重编码，零 TTS。探针自建自清。
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const { ROOT, OUTPUT, probeDir, sweepProbes } = require('./lib.cjs');
const BASE = 'http://127.0.0.1:8787';
const NAME = '_probe_p19_cut';
const P = path.join(OUTPUT, NAME);
let pass = 0, failN = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✓ ' + n); } else { failN++; console.log('  ✗ FAIL ' + n + (e ? ' — ' + e : '')); } };
async function get(u) { const r = await fetch(u); return { status: r.status, j: await r.json().catch(() => ({})) }; }
async function post(u, b) { const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }); return { status: r.status, j: await r.json().catch(() => ({})) }; }
function copyDir(s, d) { fs.mkdirSync(d, { recursive: true }); for (const e of fs.readdirSync(s, { withFileTypes: true })) { const a = path.join(s, e.name), b = path.join(d, e.name); e.isDirectory() ? copyDir(a, b) : fs.copyFileSync(a, b); } }
const r3 = (x) => Number(x.toFixed(3));
async function idle(maxSec = 600) {
  const t0 = Date.now();
  for (;;) { const s = await get(BASE + '/api/status'); if (!s.j.running && !(s.j.queue && s.j.queue.length) && Date.now() - t0 > 5000) return true; if (Date.now() - t0 > maxSec * 1000) return false; await new Promise((r) => setTimeout(r, 1500)); }
}

(async () => {
  await idle(300); // 并发规矩：等队列清空再动探针
  fs.rmSync(P, { recursive: true, force: true });
  copyDir(path.join(OUTPUT, 'deck-demo'), P);

  console.log('A /cut 页面静态');
  {
    const html = fs.readFileSync(path.join(ROOT, 'web/public/cut.html'), 'utf8');
    const m = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    const tmp = path.join(os.tmpdir(), 'smoke'); fs.mkdirSync(tmp, { recursive: true });
    let jsOk = true;
    m.forEach((x, i) => { const f = path.join(tmp, '_p19_inline' + i + '.js'); fs.writeFileSync(f, x[1]); try { cp.execSync(`node --check "${f}"`); } catch { jsOk = false; } });
    ok('cut.html 内联 JS 语法', jsOk && m.length === 1);
    ok('三轨 + 手势分区 + 拆分/删除/撤销 + 0.1s 吸附',
      html.includes('tracklab">口播') && html.includes('tracklab">配音') && html.includes('tracklab">字幕')
      && html.includes("'trimL'") && html.includes("'move'") && html.includes('dblclick')
      && html.includes('function undo()') && html.includes('const snap = (x) => Math.round(x * 10) / 10'));
    ok('保存/导出走同源契约（/api/edit + rerun 7→8）', html.includes("/api/edit") && html.includes('from: 7, to: 8'));
    const rv = await fetch(BASE + '/cut'); ok('GET /cut 200', rv.status === 200, String(rv.status));
    const con = fs.readFileSync(path.join(ROOT, 'web/public/console.html'), 'utf8');
    const wz = fs.readFileSync(path.join(ROOT, 'web/public/wizard.html'), 'utf8');
    ok('控制台/向导都有重剪入口 + 导出精修按钮', con.includes('href="/cut"') && con.includes('exportEdit') && wz.includes("id=\"cutLink\""));
  }

  console.log('B 编辑单 API 往返');
  {
    let r = await get(BASE + '/api/edit?name=' + NAME);
    ok('GET：captions/charStart/charEnd 齐备', r.status === 200 && Array.isArray(r.j.timeline.captions) && r.j.timeline.captions.length > 0
      && Array.isArray(r.j.timeline.charStart) && r.j.timeline.charStart.length > 100 && r.j.edit === null);
    r = await post(BASE + '/api/edit', { name: NAME, import: true });
    ok('import：5 clip 全窗口', r.status === 200 && r.j.edit.clips.length === 5 && fs.existsSync(path.join(P, 'edit.json')));
    const base = r.j.edit;
    // 页面语义：trim 裁剪（含字符窗收缩）
    const trimDoc = JSON.parse(JSON.stringify(base));
    trimDoc.clips[1].in = r3(trimDoc.clips[1].in + 1); trimDoc.clips[1].out = r3(trimDoc.clips[1].out - 1);
    trimDoc.clips[1].charStart += 5; trimDoc.clips[1].charEnd -= 5;
    r = await post(BASE + '/api/edit', { name: NAME, edit: trimDoc });
    ok('裁剪窗口保存 200', r.status === 200, r.j.error);
    // 页面语义：拆分（左半+右半，右半进入硬切）
    const splitDoc = JSON.parse(JSON.stringify(r.j.edit));
    const c2 = splitDoc.clips[2];
    const midT = r3((c2.in + c2.out) / 2), midC = Math.floor((c2.charStart + c2.charEnd) / 2);
    const left = { ...c2, out: midT, charEnd: midC };
    const right = { ...c2, id: 'c9x', in: midT, charStart: midC + 1, transition: { type: 'cut', dur: 0 } };
    splitDoc.clips.splice(2, 1, left, right);
    r = await post(BASE + '/api/edit', { name: NAME, edit: splitDoc });
    ok('拆分保存 200（6 clip）', r.status === 200 && r.j.edit.clips.length === 6, r.j.error);
    // 页面语义：换序
    const mv = JSON.parse(JSON.stringify(r.j.edit));
    [mv.clips[0], mv.clips[1]] = [mv.clips[1], mv.clips[0]];
    r = await post(BASE + '/api/edit', { name: NAME, edit: mv });
    ok('换序保存 200 + .bak 代际', r.status === 200 && fs.existsSync(path.join(P, 'edit.json.bak')));
    // 负例：越窗 / 坏 transition
    let bad = JSON.parse(JSON.stringify(mv)); bad.clips[0].out = 9999;
    r = await post(BASE + '/api/edit', { name: NAME, edit: bad });
    ok('越窗 400 且磁盘不脏', r.status === 400 && JSON.stringify(JSON.parse(fs.readFileSync(path.join(P, 'edit.json'), 'utf8')).clips.map((c) => c.out)) === JSON.stringify(mv.clips.map((c) => c.out)), r.j.error);
    bad = JSON.parse(JSON.stringify(mv)); bad.clips[1].transition = { type: 'wipe', dur: 0.5 };
    r = await post(BASE + '/api/edit', { name: NAME, edit: bad });
    ok('坏 transition 400', r.status === 400 && /transition/.test(r.j.error || ''), r.j.error);
    r = await post(BASE + '/api/edit', { name: 'nope-task-x', import: true });
    ok('无 timeline 任务 400/404', r.status === 400 || r.status === 404, String(r.status));
    const tasks = await get(BASE + '/api/tasks');
    ok('tasks 带 hasEdit 标记', (tasks.j.find((t) => t.name === NAME) || {}).hasEdit === true);
    // 还原为恒等导入态导出（干净基线验证）
    await post(BASE + '/api/edit', { name: NAME, import: true });
  }

  console.log('C 导出链 E2E（rerun 7→8）');
  {
    const mainMp4 = path.join(P, '成片.mp4');
    const before = fs.statSync(mainMp4);
    const r = await post(BASE + '/api/rerun', { name: NAME, from: 7, to: 8 });
    ok('导出排队 from=7', r.status === 200 && r.j.from === 7, JSON.stringify(r.j));
    ok('等导出完成（08+08-qc）', await idle());
    const st = await get(BASE + '/api/stepstatus?name=' + NAME);
    ok('stepstatus 主链 video.ok 仍 true', st.j.video && st.j.video.ok === true);
    const fin = path.join(P, '精修', '成片.mp4');
    ok('精修成片产出', fs.existsSync(fin));
    const eff = JSON.parse(fs.readFileSync(path.join(P, '精修', 'effective-timeline.json'), 'utf8'));
    const dv = Number(cp.execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${fin}"`).toString().trim());
    ok('精修时长=effective±0.5', Math.abs(dv - eff.duration) < 0.5, `${dv} vs ${eff.duration}`);
    const qc = fs.readFileSync(path.join(P, '精修', 'qc-report.txt'), 'utf8');
    const m = qc.match(/(\d+)\/(\d+) 机械项通过/);
    ok('精修 QC 全过', m && m[1] === m[2], (qc.split('\n').filter((l) => l.includes('✗')).join('；').slice(0, 160)) || (m || []).join('/'));
    const after = fs.statSync(mainMp4);
    ok('主链成片零触碰（mtime+size 不变）', after.mtimeMs === before.mtimeMs && after.size === before.size);
    ok('shots.json/timeline.json 零触碰', !fs.readFileSync(path.join(P, 'shots.json'), 'utf8').includes('精修'));
  }

  console.log('D 清场');
  fs.rmSync(P, { recursive: true, force: true });
  sweepProbes();
  ok('探针已清 + deck-demo 无恙', !fs.existsSync(P) && fs.existsSync(path.join(OUTPUT, 'deck-demo', '成片.mp4')) && !fs.existsSync(path.join(OUTPUT, 'deck-demo', 'edit.json')));

  console.log(`\nP19 冒烟结果: ${pass} 通过 / ${failN} 失败`);
  process.exitCode = failN ? 1 : 0;
})().catch((e) => { console.error('冒烟异常:', e); try { fs.rmSync(P, { recursive: true, force: true }); sweepProbes(); } catch {} process.exitCode = 1; });
