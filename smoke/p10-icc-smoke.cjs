'use strict';
// P10 冒烟：itemColorCode 枚举条目色标
// A 静态（8）| B 负例坏色值宁 fail（2）| C 插入重跑 QC 闭环（11+回归 2）| D deck 上色不叠轨（2）| E 清场
// 跑法: node <TEMP>/opencode/p10-icc-smoke.cjs（cwd = 项目根）；零计费：全程不触发 01 配音
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = process.cwd();
const OUTPUT = path.join(ROOT, 'output');
const BASE = 'http://127.0.0.1:8787';

let pass = 0; const bad = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  OK ${name}`); }
  else { bad.push(name); console.log(`  XX ${name}${extra ? ' -- ' + extra : ''}`); }
}
const sec = (t) => console.log(`\n== ${t} ==`);
const rd = (p) => fs.readFileSync(p, 'utf8');
const jj = (p) => JSON.parse(rd(p));

function copyDirSync(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDirSync(s, d); else fs.copyFileSync(s, d);
  }
}

function runStep(file, dir, ovJson) {
  let ovPath = null;
  if (ovJson) { ovPath = path.join(dir, 'config.overrides.json'); fs.writeFileSync(ovPath, JSON.stringify(ovJson)); }
  const env = { ...process.env, ...(ovPath ? { PIPELINE_CONFIG_OVERRIDES: ovPath } : {}) };
  const r = spawnSync(process.execPath, [path.join(ROOT, 'pipeline', file), dir],
    { cwd: ROOT, env, encoding: 'utf8', timeout: 180000 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

function driftOf(dir) {
  try {
    const sj = jj(path.join(dir, 'shots.json'));
    const want = sj.shots.map((s) => String(s.narration || '').trim().replace(/\s+/g, ' ')).join('');
    const nt = rd(path.join(dir, 'narration.txt')).replace(/\s+/g, ' ').trim();
    return want !== nt;
  } catch { return true; }
}

async function main() {
  sec('A 静态检查');
  const cfg = jj(path.join(ROOT, 'pipeline', 'config.json'));
  ok('A1 config.itemColorCode 缺省关+6色+轨开',
    cfg.itemColorCode && cfg.itemColorCode.enabled === false
    && Array.isArray(cfg.itemColorCode.colors) && cfg.itemColorCode.colors.length === 6
    && cfg.itemColorCode.colors.every((c) => /^#[0-9a-fA-F]{6}$/.test(c)) && cfg.itemColorCode.track === true);
  const s02 = rd(path.join(ROOT, 'pipeline', '02-compile.cjs'));
  ok('A2 02 accent 单一出处+色值 fail', s02.includes('icc.enabled') && s02.includes('s.accent =') && s02.includes('非法色值'));
  ok('A3 02 关键词随镜带 accent', s02.includes('shotList[si].accent'));
  const s03 = rd(path.join(ROOT, 'pipeline', '03-scenes.cjs'));
  ok('A4 03 ccInject+进度轨+deck 不叠轨+仅镜头循环注入',
    s03.includes('CC_TRACK_CSS') && s03.includes('function ccInject')
    && (s03.match(/ccInject\(/g) || []).length === 2 && s03.includes("sceneStyle !== 'deck'"));
  const s05 = rd(path.join(ROOT, 'pipeline', '05-compose.cjs'));
  ok('A5 05 assColour+关键词行内换色', s05.includes('function assColour') && s05.includes('assColour(k.accent)'));
  const card = jj(path.join(ROOT, 'techniques', 'item-color-code.json'));
  ok('A6 卡转 implemented+from2+insert+source 留痕',
    card.tier === 'implemented' && card.insert && card.insert.from === 2
    && card.insert.config && card.insert.config.itemColorCode && card.insert.config.itemColorCode.enabled === true
    && card.source && card.source.by);
  ok('A7 能力清单登记', rd(path.join(ROOT, 'skills', 'techniques.md')).includes('itemColorCode'));
  const { parseNeed } = require(path.join(ROOT, 'web', 'chat-rules.cjs'));
  const techs = fs.readdirSync(path.join(ROOT, 'techniques')).filter((f) => f.endsWith('.json'))
    .map((f) => { try { return jj(path.join(ROOT, 'techniques', f)); } catch { return null; } }).filter(Boolean);
  const pr = parseNeed('把这条视频用枚举条目色标', techs);
  ok('A8 聊天点名命中同一份 insert',
    pr && pr.from === 2 && pr.config && pr.config.itemColorCode && pr.config.itemColorCode.enabled === true
    && (pr.desc || []).some((d) => d.includes('枚举条目色标')));

  sec('探针选取（bullet + 非 deck + 无口播漂移）');
  const tasks = fs.readdirSync(OUTPUT).filter((n) => !n.startsWith('_') && fs.existsSync(path.join(OUTPUT, n, 'timeline.json')));
  const cands = [];
  for (const n of tasks) {
    const tl = jj(path.join(OUTPUT, n, 'timeline.json'));
    const types = new Set((tl.shots || []).map((s) => s.type));
    if (types.has('bullet') && tl.sceneStyle !== 'deck' && !driftOf(path.join(OUTPUT, n))) {
      cands.push({ n, dur: Number(tl.duration) || 999 });
    }
  }
  cands.sort((a, b) => a.dur - b.dur);
  ok('B0 有合格探针任务', cands.length > 0, '无候选');
  if (!cands.length) { console.log('中止：无探针'); return; }
  const probeA = cands[0].n;
  console.log(`  探针 A = ${probeA}（${cands[0].dur}s）`);
  const dirA = path.join(OUTPUT, '_probe_icc_e2e');
  const dirB = path.join(OUTPUT, '_probe_icc_deck');
  fs.rmSync(dirA, { recursive: true, force: true });
  fs.rmSync(dirB, { recursive: true, force: true });
  copyDirSync(path.join(OUTPUT, probeA), dirA);
  const ovA = path.join(dirA, 'config.overrides.json');
  if (fs.existsSync(ovA)) fs.unlinkSync(ovA);
  // 关键词正例补丁（探针副本可弃）：清掉历史 keyword 字段，给第一个 bullet 镜挂其口播前 4 字——
  // 保证 02 必产出关键词对齐且落在参与镜上（实测存量任务的关键词多挂非参与镜/对不上口播，测不到正例）
  const sjP = path.join(dirA, 'shots.json');
  const sjJ = jj(sjP);
  for (const s of sjJ.shots) delete s.keyword;
  const b1 = sjJ.shots.find((s) => s.type === 'bullet');
  b1.keyword = String(b1.narration || '').trim().replace(/\s+/g, '').slice(0, 4);
  fs.writeFileSync(sjP, JSON.stringify(sjJ, null, 2));
  console.log(`  关键词补丁：${JSON.stringify(b1.keyword)} → ${b1.id || b1.type}`);

  sec('B 负例：坏色值宁 fail（02 直跑，零计费）');
  let r = runStep('02-compile.cjs', dirA, { itemColorCode: { enabled: true, colors: ['red'] } });
  ok('B1 非法色值 fail', r.code !== 0 && r.out.includes('非法色值'), `code=${r.code}`);
  r = runStep('02-compile.cjs', dirA, { itemColorCode: { enabled: true, colors: [] } });
  ok('B2 空色表 fail', r.code !== 0 && r.out.includes('1~12'), `code=${r.code}`);
  if (fs.existsSync(ovA)) fs.unlinkSync(ovA);

  sec('C 插入重跑 QC 闭环（货架 insert → /api/rerun → 全链 → 产物断言）');
  const j = async (u, opt) => { const res = await fetch(BASE + u, opt); return res.json(); };
  let list;
  try { list = await j('/api/techniques'); } catch (e) { ok('C1 8787 在线', false, String(e)); return; }
  const arr = Array.isArray(list) ? list : (list.techniques || list.cards || []);
  const tc = arr.find((x) => x.id === 'item-color-code');
  ok('C1 货架新卡 implemented 无损坏', !!tc && tc.tier === 'implemented' && !tc.error);
  if (!tc) return;
  const t0 = Date.now();
  const rr = await j('/api/rerun', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '_probe_icc_e2e', from: tc.insert.from, config: tc.insert.config }) });
  ok('C2 排入重跑队列 from=2', rr.ok === true && rr.from === 2, JSON.stringify(rr));
  let st = null;
  while (Date.now() - t0 < 12 * 60 * 1000) {
    await new Promise((res) => setTimeout(res, 3000));
    try { st = await j('/api/status'); } catch { continue; }
    if (!st.running && st.done && st.done.length) break;
  }
  const done0 = st && st.done && st.done[0];
  ok('C3 全链完成', !!(done0 && done0.ok), done0 ? JSON.stringify(done0) : '超时');
  if (!done0 || !done0.ok) { console.log('--- 日志尾 ---\n' + (st && st.lines ? st.lines.slice(-25).join('\n') : '')); return; }
  console.log(`  用时 ${((Date.now() - t0) / 60000).toFixed(1)} 分钟`);
  const tlA = jj(path.join(dirA, 'timeline.json'));
  const parts = tlA.shots.filter((s) => s.type === 'bullet' || s.type === 'keyword');
  const nonParts = tlA.shots.filter((s) => s.type !== 'bullet' && s.type !== 'keyword');
  const pal = cfg.itemColorCode.colors;
  ok('C4 参与镜循环上色+ccNo/ccTotal', parts.length > 0
    && parts.every((s, i) => s.accent === pal[i % pal.length] && s.ccNo === i + 1 && s.ccTotal === parts.length));
  ok('C5 非参与镜零字段', nonParts.length > 0 && nonParts.every((s) => s.accent === undefined && s.ccNo === undefined));
  const kwArr = tlA.keywords || [];
  ok('C6 关键词随镜色', kwArr.length > 0 && kwArr.every((k) => {
    const own = tlA.shots.find((s) => k.at >= s.charStart && k.at < s.charEnd);
    return own && typeof k.accent === 'string' && k.accent === own.accent;
  }), `keywords=${kwArr.length}`);
  let chipOk = true, trackOk = true;
  for (const s of parts) {
    const h = rd(path.join(dirA, 'scenes', `${s.id}.html`));
    if (!h.includes(`--accent:${s.accent}`) || !h.includes('.cc-track')) chipOk = false;
    const m = h.match(/<div class="cc-track">([\s\S]*?)<\/div>/);
    if (!m) trackOk = false;
    else {
      const seg = m[1];
      if ((seg.match(/<i /g) || []).length !== s.ccTotal || (seg.match(/<i class="on"/g) || []).length !== 1 || !seg.includes('--cc-dur')) trackOk = false;
    }
  }
  ok('C7 参与镜场景：chip+圆点轨+唯一激活位', chipOk && trackOk);
  let npOk = true;
  for (const s of nonParts) {
    const p = path.join(dirA, 'scenes', `${s.id}.html`);
    if (fs.existsSync(p) && rd(p).includes('--acc:')) npOk = false;
  }
  ok('C8 非参与镜场景零注入', npOk);
  const k0 = kwArr[0];
  const exp = k0 && k0.accent ? `&H00${k0.accent.slice(5, 7)}${k0.accent.slice(3, 5)}${k0.accent.slice(1, 3)}`.toUpperCase() : '(无)';
  ok('C9 subs.ass 关键词行内换色 BGR 正确', k0 && k0.accent && rd(path.join(dirA, 'subs.ass')).includes(`\\1c${exp}&`), `期望 ${exp}`);
  const mp4 = path.join(dirA, '成片.mp4');
  ok('C10 成片重建', fs.existsSync(mp4) && fs.statSync(mp4).mtimeMs > t0);
  ok('C11 QC 过基线（无 FAIL）', !/FAIL/.test(rd(path.join(dirA, 'qc-report.txt'))));

  sec('C-回归 清空补丁后零残留（02+03 直跑）');
  if (fs.existsSync(ovA)) fs.unlinkSync(ovA);
  r = runStep('02-compile.cjs', dirA, null);
  ok('R1 02 复跑无 accent 字段', r.code === 0 && !r.out.includes('枚举条目色标'), `code=${r.code}`);
  r = runStep('03-scenes.cjs', dirA, null);
  ok('R2 03 复跑场景无 --acc', r.code === 0 && !rd(path.join(dirA, 'scenes', `${parts[0].id}.html`)).includes('--acc:'), `code=${r.code}`);

  sec('D deck 风：上色但不叠轨（02+03 直跑）');
  copyDirSync(path.join(OUTPUT, 'deck-demo'), dirB);
  if (fs.existsSync(path.join(dirB, 'config.overrides.json'))) fs.unlinkSync(path.join(dirB, 'config.overrides.json'));
  const dOv = { itemColorCode: { enabled: true } };
  r = runStep('02-compile.cjs', dirB, dOv);
  const tlB = jj(path.join(dirB, 'timeline.json'));
  const bParts = tlB.shots.filter((s) => s.type === 'bullet' || s.type === 'keyword');
  ok('D1 deck 参与镜上色', r.code === 0 && bParts.length > 0 && bParts.every((s, i) => s.accent === pal[i % pal.length]), `code=${r.code}`);
  r = runStep('03-scenes.cjs', dirB, dOv);
  let dOk = r.code === 0;
  for (const s of bParts) {
    const h = rd(path.join(dirB, 'scenes', `${s.id}.html`));
    if (!h.includes(`--accent:${s.accent}`) || h.includes('cc-track')) dOk = false;
  }
  ok('D2 chip 换色但无进度轨', dOk);

  sec('E 清场');
  fs.rmSync(dirA, { recursive: true, force: true });
  fs.rmSync(dirB, { recursive: true, force: true });
  ok('E1 探针目录已清', !fs.existsSync(dirA) && !fs.existsSync(dirB));
}

main().then(() => {
  console.log(`\n${bad.length ? 'FAIL' : 'PASS'} ${pass}/${pass + bad.length}${bad.length ? '，挂: ' + bad.join(' | ') : ''}`);
  process.exit(bad.length ? 1 : 0);
}).catch((e) => { console.log('EXCEPTION: ' + (e && e.stack || e)); process.exit(1); });
