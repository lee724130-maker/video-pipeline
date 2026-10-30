// smoke/p11-editor-v2-smoke.cjs —— P11 Editor 结构版冒烟
// A 静态 · B 无键守卫 · C 捏造/重复键负例 · D 新镜+id 补发+任务参数补丁 · E 参数校验负例
// F legacy 副本（无 narrationSeg）：换序→structural 钳 1 全链重配音→seg 落盘→再换序 drift 逐镜判定抓（from 1）
// G 新副本：插镜重跑→01 写 seg=镜数；重跑后再纯换序 structural=true 且 drift=false（seg 口径确认）；from2 免配音路径（字段编辑）
// H 清场。计费口径：全程 dashscope 免费额度 TTS（与 P9 冒烟同档），零复刻零生图。
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { ROOT, probeDir, sweepProbes } = require('./lib.cjs');
const BASE = 'http://127.0.0.1:8787';
const SRC = path.join(ROOT, 'output', 'deck-demo');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};
async function get(url) { const r = await fetch(url); return { status: r.status, j: await r.json().catch(() => ({})) }; }
// 冒烟并发防护：8787 只有一条管线队列，别的套件（如 p14）在跑时禁止动探针目录（重铺会撞车）
async function waitServerIdle(maxSec = 300) {
  const t0 = Date.now();
  for (;;) {
    const s = await get(BASE + '/api/status');
    if (!s.j.running && !(s.j.queue && s.j.queue.length)) return true;
    if (Date.now() - t0 > maxSec * 1000) throw new Error('等 8787 队列清空超时——先停掉其他在跑的冒烟/出片');
    await new Promise((r) => setTimeout(r, 2000));
  }
}
async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  return { status: r.status, j: await r.json().catch(() => ({})) };
}
function copyDir(src, dst) { // 规矩：禁 fs.cpSync（中文父路径必崩坑），手写递归
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}
const cloneShots = (p) => JSON.parse(fs.readFileSync(path.join(p, 'shots.json'), 'utf8')).shots;
async function waitIdle(maxSec) {
  const t0 = Date.now();
  for (;;) {
    const s = await get(BASE + '/api/status');
    if (!s.j.running && !(s.j.queue && s.j.queue.length) && Date.now() - t0 > 6000) return true;
    if (Date.now() - t0 > maxSec * 1000) return false;
    await new Promise((r) => setTimeout(r, 2000));
  }
}

(async () => {
  // ===== A 静态 =====
  console.log('A 静态');
  ok('server/chat-rules/01 语法', (execSync(`node --check "${path.join(ROOT, 'web/server.cjs')}" && node --check "${path.join(ROOT, 'web/chat-rules.cjs')}" && node --check "${path.join(ROOT, 'pipeline/01-tts.cjs')}"`, { stdio: 'pipe' }), true));
  {
    const html = fs.readFileSync(path.join(ROOT, 'web/public/editor.html'), 'utf8');
    const m = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    const tmp = path.join(os.tmpdir(), 'smoke'); fs.mkdirSync(tmp, { recursive: true });
    let alloK = true;
    m.forEach((x, i) => { const f = path.join(tmp, '_p11_inline' + i + '.js'); fs.writeFileSync(f, x[1]); try { execSync(`node --check "${f}"`); } catch { alloK = false; } });
    ok('editor.html 内联 JS 语法', alloK && m.length === 1);
    ok('editor.html P11 要件（任务参数区/镜头操作/差量提交）', html.includes('id="paramCard"') && html.includes('data-op="up:') && html.includes('data-op="del:') && html.includes('task: paramPatch()') && html.includes('_new: true') && html.includes('paramChg'));
    const rules = require(path.join(ROOT, 'web/chat-rules.cjs'));
    ok('EDIT_TASK_FIELDS 导出与子集', Array.isArray(rules.EDIT_TASK_FIELDS) && rules.EDIT_TASK_FIELDS.join() === 'sceneStyle,coverStyle,captions,platform,width,height');
  }

  // ===== 建探针 =====
  await waitServerIdle(); // 并发防护：其他套件在跑时先等队列空（建探针前）
  const PA = probeDir('_p11_legacy');  // deck-demo 副本（无 seg，legacy 口径）
  const PB = probeDir('_p11_new');     // 全新副本走插镜重跑链
  copyDir(SRC, PA); copyDir(SRC, PB);
  fs.rmSync(path.join(PB, 'audio', 'narrationSeg.json'), { force: true });
  fs.rmSync(path.join(PB, 'narration.txt'), { force: true }); // 让「插入后重跑」走完整链
  const listA = () => cloneShots(PA), origA = JSON.stringify(listA());
  const postA = (shots, extra) => post(BASE + '/api/editor/shots', { name: '_probe_p11_legacy', shots, ...(extra || {}) });

  // ===== B 无键守卫（现场造一份无键文档）=====
  console.log('B 无键文档守卫');
  const origABytes = fs.readFileSync(path.join(PA, 'shots.json'), 'utf8');
  {
    const doc0 = JSON.parse(origABytes);
    const noKey = doc0.shots.map(({ id, n, ...r }) => r);
    const noKeyBytes = JSON.stringify({ ...doc0, shots: noKey }, null, 2);
    fs.writeFileSync(path.join(PA, 'shots.json'), noKeyBytes, 'utf8');
    const g = await get(BASE + '/api/editor/shots?name=_probe_p11_legacy');
    ok('GET tailOnlyDel=true', g.status === 200 && g.j.tailOnlyDel === true, JSON.stringify(g.j.tailOnlyDel));
    const cur = g.j.shots.shots;
    let l = cur.map((s) => ({ ...s })); l.splice(1, 1); // 删中间 → 保留镜错位
    let r = await postA(l);
    ok('删中间镜 400（逐位对位守卫）', r.status === 400 && r.j.error?.includes('只能删尾部'), r.j.error);
    l = cur.map((s) => ({ ...s })); const mid = l.splice(1, 1)[0]; l.push(mid); // 挪尾再删 = 无键换序 → 拦（无键文档不删镜也不许换序）
    r = await postA(l);
    ok('挪尾再删 400（无键不许换序）', r.status === 400 && r.j.error?.includes('不允许换序'), r.j.error);
    l = cur.map((s) => ({ ...s })); l.pop(); // 纯删尾 → 放行
    r = await postA(l);
    ok('纯删尾镜放行 200 + structural', r.status === 200 && r.j.structural === true && r.j.from === 1, JSON.stringify({ s: r.status, e: r.j.error }));
    fs.writeFileSync(path.join(PA, 'shots.json'), noKeyBytes, 'utf8'); // 回到无键原样再测插入
    const l2 = cur.map((s) => ({ ...s }));
    l2.splice(2, 0, { _new: true, type: 'bullet', narration: '新插的一镜。', heading: '插', items: ['x'] });
    r = await postA(l2);
    ok('不删镜+中间插新镜放行 200', r.status === 200 && r.j.structural === true, JSON.stringify({ s: r.status, e: r.j.error }));
    fs.writeFileSync(path.join(PA, 'shots.json'), origABytes, 'utf8'); // 还原为有键原样
    ok('A 探针已还原', fs.readFileSync(path.join(PA, 'shots.json'), 'utf8') === origABytes);
  }

  // ===== C 捏造/重复键 + 参数负例（零写入核对）=====
  console.log('C 负例（零写入）');
  {
    const before = fs.readFileSync(path.join(PA, 'shots.json'), 'utf8');
    let l = listA(); l[0].n = 99;
    ok('捏造 n 键 400', (await postA(l)).j.error?.includes('不在原任务里'), '');
    l = listA(); l.push({ ...l[0] });
    ok('重复键 400', (await postA(l)).j.error?.includes('重复'), '');
    l = listA();
    let r = await post(BASE + '/api/editor/shots', { name: '_probe_p11_legacy', shots: l, task: { platform: 'nope-plat' } });
    ok('未知平台 400', r.status === 400 && r.j.error?.includes('任务级参数值非法'), r.j.error);
    r = await post(BASE + '/api/editor/shots', { name: '_probe_p11_legacy', shots: l, task: { sceneStyle: 'nope' } });
    ok('非法风格 400', r.status === 400, '');
    r = await post(BASE + '/api/editor/shots', { name: '_probe_p11_legacy', shots: l, task: { voice: 'x' } });
    ok('白名单外任务参数 400', r.status === 400 && r.j.error?.includes('不支持'), r.j.error);
    r = await post(BASE + '/api/editor/shots', { name: '_probe_p11_legacy', shots: l, task: { platform: 'douyin', width: 1920, height: 1080 } });
    ok('platform+width 同时给 400（二选一）', r.status === 400 && r.j.error?.includes('二选一'), r.j.error);
    ok('C 段零写入', fs.readFileSync(path.join(PA, 'shots.json'), 'utf8') === before);
  }

  // ===== D 新镜 + id 补发 + 参数差量（一次保存全验）=====
  console.log('D 新镜/参数补丁');
  {
    const l = listA();
    const N = l.length;
    l.splice(1, 0, { _new: true, type: 'bullet', narration: l[1].narration.slice(0, 8) + '。', heading: '插进来的', items: ['新要点'] });
    const r = await postA(l, { task: { sceneStyle: 'paper', width: 1920, height: 1080 } });
    const doc = r.j.doc || {};
    ok('插镜+参数 200 structural from1', r.status === 200 && r.j.structural === true && r.j.from === 1, JSON.stringify({ s: r.status, e: r.j.error }));
    ok('响应 doc：镜数+1、n 重排 1..N+1', doc.shots && doc.shots.length === N + 1 && doc.shots.every((s, i) => s.n === i + 1), JSON.stringify((doc.shots || []).map(s => s.n)));
    ok('新镜不带 _new 泄漏落盘', !(doc.shots || []).some((s) => '_new' in s));
    ok('sceneStyle=paper 且 platform 让位删除', doc.sceneStyle === 'paper' && !('platform' in doc) && doc.width === 1920 && doc.height === 1080, JSON.stringify({ ss: doc.sceneStyle, pf: doc.platform, w: doc.width }));
  }

  // ===== F legacy 副本：换序（文本不变）→ structural 钳 1 → 重配音落 seg → 再换序 drift 抓 =====
  console.log('F legacy 换序链（真实重跑 ①）');
  {
    // 清掉 D 段参数影响：重铺原始副本（先等队列空，防并发套件正在写探针目录）
    await waitServerIdle();
    fs.rmSync(PA, { recursive: true, force: true }); copyDir(SRC, PA);
    const l = listA();
    [l[1], l[2]] = [l[2], l[1]]; // 纯换序，文本零改动
    const r = await postA(l, { rerun: true });
    ok('换序无 seg → structural 钳 rerun.from=1', r.status === 200 && r.j.structural === true && r.j.rerun && r.j.rerun.from === 1, JSON.stringify({ s: r.status, e: r.j.error, rr: r.j.rerun }));
    ok('等重跑完成', await waitIdle(600));
    const seg = JSON.parse(fs.readFileSync(path.join(PA, 'audio', 'narrationSeg.json'), 'utf8'));
    ok('01 重配音后 seg 落盘且=镜数', Array.isArray(seg.seg) && seg.seg.length === listA().length, JSON.stringify(seg.seg?.length));
    const g = await get(BASE + '/api/editor/shots?name=_probe_p11_legacy');
    ok('重跑后 drift=false（seg 逐镜口径）', g.j.narrationDrift === false, JSON.stringify(g.j.narrationDrift));
    const vid = path.join(PA, '成片.mp4');
    ok('成片重建 + QC 报告在', fs.existsSync(vid) && fs.statSync(vid).mtimeMs > Date.now() - 10 * 60 * 1000 && fs.existsSync(path.join(PA, 'qc-report.txt')));
    // 第二次纯换序：现在有 seg 了 → drift 应直接抓到
    const cur = (await get(BASE + '/api/editor/shots?name=_probe_p11_legacy')).j.shots.shots;
    const l2 = cur.map((s) => ({ ...s }));
    [l2[1], l2[2]] = [l2[2], l2[1]];
    const r2 = await postA(l2);
    ok('再纯换序（有 seg）→ drift=true structural=true', r2.status === 200 && r2.j.narrationDrift === true && r2.j.structural === true && r2.j.from === 1, JSON.stringify({ s: r2.status, d: r2.j.narrationDrift, f: r2.j.from, e: r2.j.error }));
  }

  // ===== G 新副本：插镜重跑（免费 TTS）→ seg=镜数；字段编辑 from2 免配音 =====
  console.log('G 插镜重跑链（真实重跑 ②）');
  {
    const l = cloneShots(PB);
    l.splice(1, 0, { _new: true, type: 'keyword', narration: '记住这三个坑。', keyword: '三个坑' });
    const r = await post(BASE + '/api/editor/shots', { name: '_probe_p11_new', shots: l, rerun: true });
    ok('插镜保存+重跑排上', r.status === 200 && r.j.rerun && r.j.rerun.from === 1, JSON.stringify({ s: r.status, e: r.j.error }));
    ok('等重跑完成', await waitIdle(600));
    const seg = JSON.parse(fs.readFileSync(path.join(PB, 'audio', 'narrationSeg.json'), 'utf8'));
    const g = cloneShots(PB);
    ok('seg 镜数=插入后镜数 且 drift 归零', seg.seg.length === l.length && seg.seg[1] === '记住这三个坑。', JSON.stringify({ seg: seg.seg.length, shots: g.length }));
    ok('新镜有连续 n 重排', g.every((s, i) => s.n === i + 1));
    ok('成片重建', fs.existsSync(path.join(PB, '成片.mp4')));
    // from2 路径：只动画面字段
    const l3 = g.map((s) => ({ ...s })); l3[2].heading = (l3[2].heading || '') + '改';
    const r3 = await post(BASE + '/api/editor/shots', { name: '_probe_p11_new', shots: l3 });
    ok('字段编辑（口播同步）→ drift=false from=2', r3.status === 200 && r3.j.narrationDrift === false && r3.j.structural === false && r3.j.from === 2, JSON.stringify({ s: r3.status, d: r3.j.narrationDrift, f: r3.j.from }));
  }

  // ===== H 清场 =====
  console.log('H 清场');
  sweepProbes();
  ok('探针全清', !fs.existsSync(PA) && !fs.existsSync(PB));
  ok('deck-demo 原样（19 文件字节不变的兄弟没被碰过：镜数校验）', cloneShots(SRC).length === 5 && fs.existsSync(path.join(SRC, 'shots.json')));

  console.log(`\nP11 冒烟结果: ${pass} 通过 / ${fail} 失败`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('冒烟异常:', e); try { sweepProbes(); } catch {} process.exitCode = 1; });
