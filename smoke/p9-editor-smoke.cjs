// P9 Editor 轻改冒烟 —— B 页面/读取 · C 负例（零写入） · D 真实 E2E（保存+重跑+漂移钳制+运行中409） · E 清理
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const ROOT = require('./lib.cjs').ROOT;
const BASE = 'http://127.0.0.1:8787';
const SRC = path.join(ROOT, 'output', 'deck-demo');
const PROBE = path.join(ROOT, 'output', '_probe_editor_e2e');
const SJ = path.join(PROBE, 'shots.json');
let pass = 0, fail = 0, skipped = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};
const skip = (name, why) => { skipped++; console.log(`  ~ SKIP ${name} — ${why}`); };

async function get(url) {
  const r = await fetch(url);
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
}
async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
}
const shotsOf = () => JSON.parse(fs.readFileSync(SJ, 'utf8'));
// 手写递归复制：本机 Node 22.23.2 的 fs.cpSync 撞中文父路径必崩 0xC0000409（见 CHECKPOINT P9 段），copyFileSync 系稳
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

(async () => {
  // ===== B 页面与读取 =====
  console.log('B 页面与读取');
  {
    const r = await fetch(BASE + '/editor');
    const html = await r.text();
    ok('GET /editor 200 + 页面要点', r.status === 200 && html.includes('Editor 精修') && html.includes('shotList'), String(r.status));
    const t = await get(BASE + '/api/tasks');
    ok('任务列表在', t.status === 200 && Array.isArray(t.j), String(t.status));
    const g = await get(BASE + '/api/editor/shots?name=deck-demo');
    ok('GET 分镜(现役任务)', g.status === 200 && g.j.shots && g.j.shots.shots.length === 5
      && g.j.types.length === 6 && g.j.narrationDrift === false && g.j.busy === false,
      JSON.stringify({ s: g.status, types: g.j.types, drift: g.j.narrationDrift }));
    const bad = await get(BASE + '/api/editor/shots?name=' + encodeURIComponent('../etc'));
    ok('坏任务名 400', bad.status === 400, String(bad.status));
    const nf = await get(BASE + '/api/editor/shots?name=nope-task-x');
    ok('未知任务 404', nf.status === 404, String(nf.status));
  }

  // ===== 建探针副本 =====
  fs.rmSync(PROBE, { recursive: true, force: true });
  copyDir(SRC, PROBE);
  const origBytes = fs.readFileSync(SJ, 'utf8');
  const origList = JSON.parse(origBytes).shots;
  console.log(`探针副本就绪：${origList.length} 镜`);

  // ===== C 负例（全部应在写盘前返回；结束核对 shots.json 字节未动）=====
  console.log('C 负例（零写入）');
  const clone = () => JSON.parse(JSON.stringify(origList));
  const postShots = (shots, rerun) => post(BASE + '/api/editor/shots', { name: '_probe_editor_e2e', shots, rerun: !!rerun });
  {
    let l = clone(); l.pop();
    ok('镜数减少 400', (await postShots(l)).status === 400);
    l = clone(); l.push({ ...origList[0] });
    ok('镜数增加 400', (await postShots(l)).status === 400);
    l = clone(); l[0].n = 99;
    ok('改 n 400', (await postShots(l)).j.error?.includes('不可改'), (await postShots(l)).j.error);
    l = clone(); l[0].id = 's01';
    ok('凭空加 id 400', (await postShots(l)).j.error?.includes('不应新增'), '');
    l = clone(); l[1].foo = 1;
    ok('未知字段 400', (await postShots(l)).j.error?.includes('不支持的字段'), '');
    l = clone(); l[1].type = 'nope';
    ok('非法 type 400', (await postShots(l)).j.error?.includes('字段值非法'), '');
    l = clone(); l[0].narration = '  ';
    ok('空口播 400', (await postShots(l)).j.error?.includes('narration'), '');
    l = clone(); l[1].type = 'keyword'; delete l[1].keyword;
    ok('keyword 型缺 keyword 400', (await postShots(l)).j.error?.includes('keyword 型'), '');
    l = clone(); l[1].type = 'split'; delete l[1].media;
    ok('split 型缺 media 400', (await postShots(l)).j.error?.includes('必须选 media'), '');
    l = clone(); l[1].media = 'nope-not-here.png';
    ok('素材不存在 404', (await postShots(l)).status === 404, '');
    l = clone(); l[1].asset = '../config.local.json';
    ok('路径穿越文件名 400', (await postShots(l)).j.error?.includes('文件名非法'), '');
    ok('空数组 400', (await postShots([])).status === 400, '');
    const badBody = await post(BASE + '/api/editor/shots', { name: '_probe_editor_e2e', shots: 'nope' });
    ok('shots 非数组 400', badBody.status === 400, String(badBody.status));
    const unknown = await post(BASE + '/api/editor/shots', { name: 'definitely-no-such-task', shots: clone() });
    ok('未知任务 404', unknown.status === 404, String(unknown.status));
    ok('负例后 shots.json 字节未动', fs.readFileSync(SJ, 'utf8') === origBytes);
    ok('负例后无 .bak 残留', !fs.existsSync(SJ + '.bak'));
  }

  // ===== D 正例 E2E =====
  console.log('D 正例 E2E');
  // D1 口播改动 · 只保存 → drift=true, from=1, 备份=原始
  const edit1 = clone();
  edit1[0].narration = edit1[0].narration + '这条尾巴是 Editor 轻改加的。';
  {
    const r = await postShots(edit1, false);
    ok('保存① 200 且建议 from 1', r.status === 200 && r.j.narrationDrift === true && r.j.from === 1 && r.j.rerun === null, JSON.stringify(r.j));
    ok('落盘含口播改动', shotsOf().shots[0].narration.includes('Editor 轻改加的'));
    ok('.bak = 保存前原始态', fs.readFileSync(SJ + '.bak', 'utf8') === origBytes);
  }
  // D2 再改 heading · 保存并重跑 → 口播仍未配音 → 漂移硬钳 from 1（哪怕建议逻辑同样给1——关键断言 rerun.from===1）
  const edit2 = JSON.parse(JSON.stringify(edit1));
  edit2[1].heading = (edit2[1].heading || '') + '（精修）';
  const t0 = Date.now();
  {
    const r = await postShots(edit2, true);
    ok('保存② 200 且重跑被钳到第 1 步', r.status === 200 && r.j.rerun && r.j.rerun.from === 1, JSON.stringify(r.j));
  }
  // D3 运行中再保存 → 409（竞态窗口，跑完就算 SKIP）
  {
    let saw409 = false, tried = false;
    for (let i = 0; i < 40 && !saw409; i++) {
      const s = await get(BASE + '/api/status');
      if (s.j.running || (s.j.queue && s.j.queue.length)) {
        tried = true;
        const r = await postShots(edit2, false);
        if (r.status === 409) saw409 = true;
      }
      if (saw409) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
    if (tried && saw409) ok('运行中保存 409', true);
    else if (tried) ok('运行中保存 409', false, '试了但没拿到 409');
    else skip('运行中保存 409', '重跑太快没截到运行窗口');
  }
  // D4 等重跑完成 → 成片更新 + 漂移归零
  let done = false;
  for (let i = 0; i < 300; i++) {
    const s = await get(BASE + '/api/status');
    if (!s.j.running && !(s.j.queue && s.j.queue.length) && (Date.now() - t0 > 8000)) { done = true; break; }
    await new Promise((r) => setTimeout(r, 2000));
  }
  ok('重跑完成', done, `超 600s · 耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  {
    const vid = path.join(PROBE, '成片.mp4');
    ok('成片已重建', fs.existsSync(vid) && fs.statSync(vid).mtimeMs > t0, fs.existsSync(vid) ? new Date(fs.statSync(vid).mtimeMs).toISOString() : 'missing');
    const g = await get(BASE + '/api/editor/shots?name=_probe_editor_e2e');
    ok('重跑后漂移归零', g.status === 200 && g.j.narrationDrift === false, JSON.stringify(g.j.narrationDrift));
  }
  // D5 漂移已归零后的建议 = from 2（口播不动免配音）
  const edit3 = JSON.parse(JSON.stringify(edit2));
  edit3[2].quote = (edit3[2].quote || '') + ' 精修引用';
  {
    const r = await postShots(edit3, false);
    ok('保存③ 建议 from 2（口播已同步）', r.status === 200 && r.j.narrationDrift === false && r.j.from === 2, JSON.stringify(r.j));
    const final = shotsOf();
    ok('三次编辑全部落盘', final.shots[0].narration.includes('Editor 轻改加的')
      && final.shots[1].heading.includes('（精修）')
      && (final.shots[2].quote || '').includes('精修引用'));
    const bak = JSON.parse(fs.readFileSync(SJ + '.bak', 'utf8'));
    ok('.bak = 上次保存前（含①②无③）', bak.shots[0].narration.includes('Editor 轻改加的')
      && !(bak.shots[2].quote || '').includes('精修引用'));
  }

  // ===== E 清理 =====
  console.log('E 清理');
  fs.rmSync(PROBE, { recursive: true, force: true });
  ok('探针副本已删', !fs.existsSync(PROBE));
  ok('deck-demo 原样', JSON.parse(fs.readFileSync(path.join(SRC, 'shots.json'), 'utf8')).shots.length === origList.length);

  console.log(`\nP9 冒烟结果: ${pass} 通过 / ${fail} 失败${skipped ? ` / ${skipped} 跳过` : ''}`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('冒烟异常:', e); try { fs.rmSync(PROBE, { recursive: true, force: true }); } catch {} process.exitCode = 1; });
