// smoke/p12-edit-contract-smoke.cjs —— P12-A 重剪契约+渲染管线冒烟
// A 契约单测（edit-doc：恒等导入/拆分缝合/负例全家桶）· B /api/edit（GET 建议/POST 校验保存/.bak/import 幂等/运行守卫面）
// C 端到端：探针上 08 恒等导出 → 时长对齐主链 → 06 精修模式全过（--timeline/--video/--report/--qcdir）
// 计费：C 段纯本地 ffmpeg 重编码，零 TTS 零渲染录制；探针自建自清。
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { ROOT, OUTPUT, probeDir, sweepProbes } = require('./lib.cjs');
const BASE = 'http://127.0.0.1:8787';
const { validateEdit, importFromTimeline, deriveEditTimeline } = require('../pipeline/lib/edit-doc.cjs');
let pass = 0, failCount = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✓ ' + n); } else { failCount++; console.log('  ✗ FAIL ' + n + (e ? ' — ' + e : '')); } };
async function get(u) { const r = await fetch(u); return { status: r.status, j: await r.json().catch(() => ({})) }; }
async function post(u, b) { const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }); return { status: r.status, j: await r.json().catch(() => ({})) }; }
const dur = (f) => Number(cp.execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${f}"`).toString().trim());
function copyDir(s, d) { fs.mkdirSync(d, { recursive: true }); for (const e of fs.readdirSync(s, { withFileTypes: true })) { const a = path.join(s, e.name), b = path.join(d, e.name); e.isDirectory() ? copyDir(a, b) : fs.copyFileSync(a, b); } }
const neg = (n, fn) => { try { fn(); ok(n, false, '没拦住'); } catch { ok(n, true); } };

(async () => {
  console.log('A 契约单测（edit-doc）');
  {
    const tl = JSON.parse(fs.readFileSync(path.join(OUTPUT, 'deck-demo', 'timeline.json'), 'utf8'));
    const doc = importFromTimeline(tl);
    validateEdit(tl, doc);
    const eff = deriveEditTimeline(tl, doc, tl.outro || null);
    ok('恒等导入：镜数/字幕文本零变化', eff.shots.length === tl.shots.length && tl.captions.map((c) => c.text).join('|') === eff.captions.map((c) => c.text).join('|'));
    ok('恒等导入：时长=源+outro（±0.02）', Math.abs(eff.duration - (tl.duration + (tl.outro ? tl.outro.durSec : 0))) <= 0.02, `${eff.duration} vs ${tl.duration}`);
    // 拆分+跨 clip 缝合 + fade 使总时长 -0.3
    const mid = 2, s = tl.shots[mid], sN = tl.shots[mid + 1];
    const cut = JSON.parse(JSON.stringify(doc));
    const cs = cut.clips[mid].charStart, ce = cut.clips[mid].charEnd;
    const half = Math.floor((cs + ce) / 2) + 1;
    const t = Number((s.start + (ce + 1 - half) * ((s.end - s.start) / (ce + 1 - cs))).toFixed(2));
    cut.clips.splice(mid, 1,
      { id: 'camid', seg: mid, src: 'segment', in: s.start, out: t, charStart: cs, charEnd: half - 1, transition: { type: 'cut', dur: 0 } },
      { id: 'cbid', seg: mid, src: 'segment', in: t, out: sN.start, charStart: half, charEnd: ce, transition: { type: 'fade', dur: 0.3 } });
    validateEdit(tl, cut);
    const e2 = deriveEditTimeline(tl, cut, tl.outro || null);
    ok('拆分缝合：clip+1 且字幕合回原样', e2.shots.length === tl.shots.length + 1 && tl.captions.map((c) => c.text).join('|') === e2.captions.map((c) => c.text).join('|'));
    ok('fade 使目标时长恰 -0.3s', Math.abs((eff.duration - e2.duration) - 0.3) < 0.011, `${eff.duration}→${e2.duration}`);
    ok('字幕行时间轴自洽（start 递增且不越总长）', e2.captions.every((c, i, a) => c.start <= c.end && c.end <= e2.duration + 0.01 && (i === 0 || c.start >= a[i - 1].start)));
    neg('窗口越界', () => { const d = importFromTimeline(tl); d.clips[1].out += 99; validateEdit(tl, d); });
    neg('seg 越界', () => { const d = importFromTimeline(tl); d.clips[0].seg = 99; validateEdit(tl, d); });
    neg('char 闭区间越界', () => { const d = importFromTimeline(tl); d.clips[0].charEnd = 999999; validateEdit(tl, d); });
    neg('转场 >2s', () => { const d = importFromTimeline(tl); d.clips[1].transition = { type: 'fade', dur: 9 }; validateEdit(tl, d); });
    neg('id 重复', () => { const d = importFromTimeline(tl); d.clips[1].id = d.clips[0].id; validateEdit(tl, d); });
    neg('version 非法', () => { const d = importFromTimeline(tl); d.version = 2; validateEdit(tl, d); });
  }

  console.log('B /api/edit 面');
  const P = probeDir('_p12_api');
  copyDir(path.join(OUTPUT, 'deck-demo'), P);
  fs.rmSync(path.join(P, 'edit.json'), { force: true });
  fs.rmSync(path.join(P, '精修'), { recursive: true, force: true });
  {
    let r = await get(BASE + '/api/edit?name=_probe_p12_api');
    ok('GET：timeline 摘要 + suggest + edit=null', r.status === 200 && r.j.edit === null && r.j.suggest && r.j.suggest.clips.length === 5 && r.j.timeline.shots.length === 5, JSON.stringify(r.j).slice(0, 90));
    r = await post(BASE + '/api/edit', { name: '_probe_p12_api', import: true });
    ok('POST import：200 且落盘', r.status === 200 && r.j.edit && fs.existsSync(path.join(P, 'edit.json')));
    const before = fs.readFileSync(path.join(P, 'edit.json'), 'utf8');
    r = await post(BASE + '/api/edit', { name: '_probe_p12_api', import: true });
    const again = fs.readFileSync(path.join(P, 'edit.json'), 'utf8');
    ok('import 幂等（除时间戳字段）', r.status === 200 && again.replace(/"fromTimelineAt":[^,]+,?/, '') === before.replace(/"fromTimelineAt":[^,]+,?/, ''));
    ok('.bak 已建立', fs.existsSync(path.join(P, 'edit.json.bak')));
    r = await post(BASE + '/api/edit', { name: '_probe_p12_api', edit: { version: 1, fps: 30, width: 1920, height: 1080, clips: [{ id: 'bad', seg: 99, src: 'segment', in: 0, out: 5, charStart: 0, charEnd: 5 }] } });
    ok('坏编辑单 400 且磁盘未脏', r.status === 400 && r.j.error.includes('seg') && fs.readFileSync(path.join(P, 'edit.json'), 'utf8') === again, r.j.error);
    r = await post(BASE + '/api/edit', { name: '_probe_p12_api', edit: { version: 9, fps: 30, width: 1920, height: 1080, clips: [] } });
    ok('version/clips 非法 400', r.status === 400);
    r = await get(BASE + '/api/edit?name=' + encodeURIComponent('../etc'));
    ok('坏任务名 400', r.status === 400);
  }

  console.log('C 端到端：08 恒等导出 + 06 精修模式（约 2~4 分钟，纯本地重编码）');
  {
    fs.writeFileSync(path.join(P, 'edit.json'), JSON.stringify(importFromTimeline(JSON.parse(fs.readFileSync(path.join(P, 'timeline.json'), 'utf8'))), null, 2));
    try {
      cp.execSync(`node pipeline/08-edit.cjs "${P}"`, { cwd: ROOT, timeout: 600000, stdio: 'pipe' });
      ok('08 恒等导出跑通', true);
    } catch (e) {
      ok('08 恒等导出跑通', false, String(e.stdout || e.message).split('\n').slice(-10).join('\n').slice(0, 400));
      throw new Error('08 失败，后续断言无意义');
    }
    const fin = path.join(P, '精修', '成片.mp4');
    const main = path.join(OUTPUT, 'deck-demo', '成片.mp4');
    const d1 = dur(fin), d0 = dur(main);
    ok('精修时长≈主链（±0.5s）', Math.abs(d1 - d0) < 0.5, `${d1.toFixed(2)} vs ${d0.toFixed(2)}`);
    ok('effective-timeline / report / 封面 落盘', fs.existsSync(path.join(P, '精修', 'effective-timeline.json')) && fs.existsSync(path.join(P, '精修', 'edit.report.json')) && fs.existsSync(path.join(P, '精修', '封面.png')));
    let qcr = '';
    try { qcr = cp.execSync(`node pipeline/06-qc.cjs "${P}" --video "${fin}" --timeline "${path.join(P, '精修', 'effective-timeline.json')}" --report "${path.join(P, '精修', 'qc-report.txt')}" --qcdir "${path.join(P, '精修', 'qc')}"`, { cwd: ROOT, timeout: 300000 }).toString(); }
    catch (e) { qcr = String(e.stdout || '') + String(e.stderr || '') + String(e.message || ''); }
    const m = qcr.match(/(\d+)\/(\d+) 机械项通过/);
    const qcFails = qcr.split('\n').filter((l) => l.includes('✗')).join(' ｜ ');
    if (!m || m[1] !== m[2]) console.log('     QC 输出尾:', qcr.split('\n').slice(-14).join('\n').slice(0, 700));
    ok('06 精修模式全过（failCount=0）', m && m[1] === m[2], qcFails.slice(0, 200) || (m || []).join('/'));
    ok('精修 qc-report.txt 生成', fs.existsSync(path.join(P, '精修', 'qc-report.txt')));
  }

  console.log('D 清场');
  sweepProbes();
  ok('探针已清', !fs.existsSync(P));
  ok('deck-demo 未受影响', fs.existsSync(path.join(OUTPUT, 'deck-demo', '成片.mp4')) && !fs.existsSync(path.join(OUTPUT, 'deck-demo', 'edit.json')));

  console.log(`\nP12-A 冒烟结果: ${pass} 通过 / ${failCount} 失败`);
  process.exitCode = failCount ? 1 : 0;
})().catch((e) => { console.error('冒烟异常:', e.message || e); try { sweepProbes(); } catch {} process.exitCode = 1; });
