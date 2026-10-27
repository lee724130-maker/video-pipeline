// smoke/p13-timeline-smoke.cjs —— P13 时间轴排序页冒烟
// A 静态（页面/路由/入口链接）· B GET durations 契约 · C n 型拖拽换序契约（保存后 n 连续、seg 漂移抓）
// D 无键升级（补发 id 落盘 → 升级后可换序）· E editor 回归 · F 清场
// 说明：页面真实指针拖拽无法在本冒烟覆盖（无浏览器驱动），按「拖拽产出的请求形态」直测 API 契约；UI 由用户实测。
// 计费：D 升级 POST 带 rerun=页面行为 → 会跑 01（免费额度 TTS）一次；其余全部 rerun:false。
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { ROOT, OUTPUT, probeDir, sweepProbes } = require('./lib.cjs');
const BASE = 'http://127.0.0.1:8787';
const SRC = path.join(OUTPUT, 'deck-demo');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};
async function get(u) { const r = await fetch(u); return { status: r.status, j: await r.json().catch(() => ({})) }; }
async function post(u, b) {
  const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) });
  return { status: r.status, j: await r.json().catch(() => ({})) };
}
function copyDir(src, dst) { fs.mkdirSync(dst, { recursive: true }); for (const e of fs.readdirSync(src, { withFileTypes: true })) { const a = path.join(src, e.name), b = path.join(dst, e.name); e.isDirectory() ? copyDir(a, b) : fs.copyFileSync(a, b); } }
const norm = (x) => String(x || '').trim().replace(/\s+/g, ' ');
const keyOf = (s) => ('id' in s ? String(s.id) : ('n' in s ? 'n' + s.n : ''));
async function waitIdle(maxSec) {
  const t0 = Date.now();
  for (;;) {
    const s = await get(BASE + '/api/status');
    if (!s.j.running && !(s.j.queue && s.j.queue.length) && Date.now() - t0 > 5000) return true;
    if (Date.now() - t0 > maxSec * 1000) return false;
    await new Promise((r) => setTimeout(r, 2000));
  }
}
async function postClear(name, shots, extra) { // 等队列空闲再 POST（防 409），默认不重跑
  await waitIdle(600);
  return post(BASE + '/api/editor/shots', { name, shots, rerun: false, ...(extra || {}) });
}

(async () => {
  console.log('A 静态');
  {
    const html = fs.readFileSync(path.join(ROOT, 'web/public/timeline.html'), 'utf8');
    const m = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    const tmp = path.join(os.tmpdir(), 'smoke'); fs.mkdirSync(tmp, { recursive: true });
    let jsOk = true;
    m.forEach((x, i) => { const f = path.join(tmp, '_p13_inline' + i + '.js'); fs.writeFileSync(f, x[1]); try { execSync(`node --check "${f}"`); } catch { jsOk = false; } });
    ok('timeline.html 内联 JS 语法', jsOk && m.length === 1);
    ok('timeline.html 要件（三轨/拖拽/撤销栈/升级/保存）', html.includes('tracklab">口播') && html.includes('tracklab">画面') && html.includes('tracklab">字幕')
      && html.includes('pointerdown') && html.includes('function undo()') && html.includes('upgradeKeys') && html.includes('/api/editor/shots'));
    const r = await fetch(BASE + '/timeline');
    ok('GET /timeline 200', r.status === 200, String(r.status));
    const idx = fs.readFileSync(path.join(ROOT, 'web/public/index.html'), 'utf8');
    const ed = fs.readFileSync(path.join(ROOT, 'web/public/editor.html'), 'utf8');
    ok('首页 + 精修页都有时间轴入口', idx.includes('href="/timeline"') && ed.includes('href="/timeline"'));
  }

  console.log('B GET durations 契约');
  const PA = probeDir('_p13_nstyle');   // deck-demo 副本（n 型 + 有 timeline.json）
  const PB = probeDir('_p13_nokey');    // 副本剥键（无键升级流）
  copyDir(SRC, PA); copyDir(SRC, PB);
  {
    const g = await get(BASE + '/api/editor/shots?name=_probe_p13_nstyle');
    const dursOk = g.status === 200 && Array.isArray(g.j.durations) && g.j.durations.length === g.j.shots.shots.length
      && g.j.durations.every((d) => d > 0) && g.j.total > 0 && g.j.tailOnlyDel === false;
    ok('GET 返回 durations[]+total 且与镜数一致', dursOk, JSON.stringify({ d: g.j.durations, t: g.j.total }));
    const g2 = await get(BASE + '/api/editor/shots?name=deck-demo');
    ok('现役任务契约同样成立（只读无副作用）', Array.isArray(g2.j.durations) && g2.j.durations.length === 5);
  }

  console.log('C n 型拖拽换序契约');
  {
    const doc0 = JSON.parse(fs.readFileSync(path.join(PA, 'shots.json'), 'utf8'));
    const l = doc0.shots.map((s) => ({ ...s }));
    [l[1], l[2]] = [l[2], l[1]]; // 模拟拖拽：n 跟着镜走（页面语义）
    const r = await postClear('_probe_p13_nstyle', l);
    const saved = JSON.parse(fs.readFileSync(path.join(PA, 'shots.json'), 'utf8')).shots;
    ok('换序保存 200 + structural + from 1', r.status === 200 && r.j.structural === true && r.j.from === 1, JSON.stringify({ s: r.status, e: r.j.error }));
    ok('落盘 n 重排为连续 1..N', saved.every((s, i) => s.n === i + 1), JSON.stringify(saved.map((s) => s.n)));
    ok('换序内容确实调换（第2镜=原第3镜口播）', norm(saved[1].narration) === norm(doc0.shots[2].narration));
    // 整串失明：全同镜像（文本两两相同，拼接逐字符不变）→ drift 必须 false、structural 独立抓
    const PC = probeDir('_p13_mirror');
    const mk = (n) => ({ n, type: n === 1 ? 'title' : 'bullet', title: n === 1 ? '标题' : undefined, heading: n === 1 ? undefined : '卡' + n, items: n === 1 ? undefined : ['要点'], narration: '同样的话' });
    fs.writeFileSync(path.join(PC, 'shots.json'), JSON.stringify({ title: '镜像', shots: [mk(1), mk(2), mk(3), mk(4)] }, null, 2));
    fs.writeFileSync(path.join(PC, 'narration.txt'), '同样的话同样的话同样的话同样的话', 'utf8');
    const mirror = [mk(1), mk(4), mk(3), mk(2)];
    const rm = await postClear('_probe_p13_mirror', mirror);
    ok('全同镜像 drift=false + structural=true（钳 1 不靠整串）', rm.status === 200 && rm.j.narrationDrift === false && rm.j.structural === true && rm.j.from === 1, JSON.stringify({ d: rm.j.narrationDrift, st: rm.j.structural }));
  }

  console.log('D 无键升级流');
  {
    const doc = JSON.parse(fs.readFileSync(path.join(PB, 'shots.json'), 'utf8'));
    doc.shots = doc.shots.map(({ id, n, ...r }) => r);
    fs.writeFileSync(path.join(PB, 'shots.json'), JSON.stringify(doc, null, 2));
    let g = await get(BASE + '/api/editor/shots?name=_probe_p13_nokey');
    ok('剥键后 tailOnlyDel=true 且 durations 降级 null 容忍', g.j.tailOnlyDel === true, JSON.stringify({ t: g.j.tailOnlyDel, d: g.j.durations === null ? 'null' : 'array' }));
    // 无键直接换序应被拦（页面拖拽前的服务端防线）
    let l = doc.shots.map((s) => ({ ...s }));
    [l[1], l[2]] = [l[2], l[1]];
    let r = await postClear('_probe_p13_nokey', l);
    ok('无键换序 400（宁拦不猜）', r.status === 400 && r.j.error?.includes('不允许换序'), r.j.error);
    // 页面 upgradeKeys 形态：补发 s91.. + rerun:true（升级免重配音，重编译 from 2 把 id 烘进 timeline）
    const up = doc.shots.map((s, i) => ({ id: 's' + (91 + i), ...s }));
    const t0 = Date.now();
    r = await post(BASE + '/api/editor/shots', { name: '_probe_p13_nokey', shots: up, rerun: true });
    ok('升级 POST 排上重跑 from 2（补 id 免重配音）+ upgraded 标', r.status === 200 && r.j.upgraded === true && r.j.rerun && r.j.rerun.from === 2, JSON.stringify({ s: r.status, up: r.j.upgraded, rr: r.j.rerun, e: r.j.error }));
    ok('等升级重跑完成', await waitIdle(600), `耗时超 ${(Date.now() - t0) / 1000}s`);
    const saved = JSON.parse(fs.readFileSync(path.join(PB, 'shots.json'), 'utf8')).shots;
    ok('落盘带 id s91.. 且无 _new 泄漏', saved.every((s, i) => s.id === 's' + (91 + i)) && !saved.some((s) => '_new' in s));
    const gk = await get(BASE + '/api/editor/shots?name=_probe_p13_nokey');
    ok('升级后 tailOnlyDel=false（已是可自由排序的有键文档）', gk.j.tailOnlyDel === false, JSON.stringify(gk.j.tailOnlyDel));
    // 升级后再拖拽换序 → 放行
    let l2 = saved.map((s) => ({ ...s }));
    [l2[1], l2[2]] = [l2[2], l2[1]];
    r = await postClear('_probe_p13_nokey', l2);
    ok('升级后换序 200 + structural', r.status === 200 && r.j.structural === true, JSON.stringify({ s: r.status, e: r.j.error }));
  }

  console.log('E editor 回归');
  {
    const g = await get(BASE + '/api/editor/shots?name=deck-demo');
    ok('deck-demo 原样（5 镜 n 型、drift=false、无 .bak 残留）', g.j.shots.shots.length === 5 && g.j.narrationDrift === false && !fs.existsSync(path.join(SRC, 'shots.json.bak')));
  }

  console.log('F 清场');
  sweepProbes();
  ok('探针全清', !fs.existsSync(PA) && !fs.existsSync(PB));

  console.log(`\nP13 冒烟结果: ${pass} 通过 / ${fail} 失败`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('冒烟异常:', e); try { sweepProbes(); } catch {} process.exitCode = 1; });
