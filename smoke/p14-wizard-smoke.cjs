// smoke/p14-wizard-smoke.cjs —— P14 流程向导冒烟
// 核心验证「分步门控」：草稿只拆镜不跑；有界 run 只跑指定步、不越界产下游；stepstatus 正确反映进度。
// 计费：走一段真实 01→06（免费额度 TTS + 本地渲染），用极短文案压缩耗时；零复刻零生图。
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { ROOT, OUTPUT, probeDir, sweepProbes } = require('./lib.cjs');
const BASE = 'http://127.0.0.1:8787';
const NAME = '_probe_wizard_e2e';
const DIR = path.join(OUTPUT, NAME);
let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ FAIL ' + n + (e ? ' — ' + e : '')); } };
async function get(u) { const r = await fetch(u); return { status: r.status, j: await r.json().catch(() => ({})) }; }
async function post(u, b) { const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }); return { status: r.status, j: await r.json().catch(() => ({})) }; }
async function idle(maxSec = 600) {
  const t0 = Date.now();
  for (;;) { const s = await get(BASE + '/api/status'); if (!s.j.running && !(s.j.queue && s.j.queue.length) && Date.now() - t0 > 5000) return true; if (Date.now() - t0 > maxSec * 1000) return false; await new Promise((r) => setTimeout(r, 1500)); }
}

(async () => {
  console.log('A 静态（页面 + 服务端原语）');
  {
    const html = fs.readFileSync(path.join(ROOT, 'web/public/wizard.html'), 'utf8');
    const m = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    const tmp = path.join(os.tmpdir(), 'smoke'); fs.mkdirSync(tmp, { recursive: true });
    let jsOk = true;
    m.forEach((x, i) => { const f = path.join(tmp, '_p14_inline' + i + '.js'); fs.writeFileSync(f, x[1]); try { execSync(`node --check "${f}"`); } catch { jsOk = false; } });
    ok('wizard.html 内联 JS 语法', jsOk && m.length === 1);
    ok('wizard 六关口 + 门控按钮 + 有界 run + stepstatus',
      html.includes('data-stage="1"') && html.includes('data-stage="6"')
      && html.includes('/api/create') && html.includes('draft: true')
      && html.includes('from, to') && html.includes('/api/stepstatus') && html.includes('/api/rerun'));
    const idx = fs.readFileSync(path.join(ROOT, 'web/public/index.html'), 'utf8');
    ok('首页有向导入口', idx.includes('href="/wizard"'));
    const rv = await fetch(BASE + '/wizard'); ok('GET /wizard 200', rv.status === 200, String(rv.status));
    const meta = await get(BASE + '/api/meta');
    ok('meta 带 platforms[] + sizes[]', Array.isArray(meta.j.platforms) && meta.j.platforms.length >= 1 && typeof meta.j.platforms[0].label === 'string' && Array.isArray(meta.j.sizes));
    const srv = fs.readFileSync(path.join(ROOT, 'web/server.cjs'), 'utf8');
    ok('runPipeline 有界签名 + queue 透传 to + draft 分支', srv.includes('runPipeline(taskDir, from = 1, to = 6)') && srv.includes('item.to || 6') && srv.includes('if (body.draft)'));
  }

  // 清理任何残留，建一个干净目录名（草稿接口会自建，不用 probeDir 预建）
  fs.rmSync(DIR, { recursive: true, force: true });
  console.log('B 草稿：只拆镜、零运行');
  {
    const r = await post(BASE + '/api/create', { name: NAME, draft: true, text: '第一条坑就是别贪长。先把最短的一条跑通，再谈放大。关注不迷路。', platform: 'douyin', sceneStyle: 'deck', voice: 'loongstella_v3.1', rate: 7.2, captions: true });
    ok('草稿 200 + draft:true + 回传 shots', r.status === 200 && r.j.draft === true && Array.isArray(r.j.shots) && r.j.shots.length >= 2, JSON.stringify({ s: r.status, e: r.j.error, n: r.j.shots && r.j.shots.length }));
    ok('草稿落 shots.json 但无 audio/voice（没配音）', fs.existsSync(path.join(DIR, 'shots.json')) && !fs.existsSync(path.join(DIR, 'audio', 'voice.mp3')));
    const st = await get(BASE + '/api/stepstatus?name=' + NAME);
    ok('stepstatus: voice.ok=false 全链路未跑', st.j.voice.ok === false && st.j.video.ok === false && st.j.segments.ok === false);
    ok('stepstatus: drift=true（从未配音）', st.j.drift === true, JSON.stringify(st.j.drift));
  }

  console.log('C 有界配音 run(1→1)：只出音频，不产下游');
  {
    const r = await post(BASE + '/api/rerun', { name: NAME, from: 1, to: 1 });
    ok('rerun 1→1 排上（钳 from=1）', r.status === 200 && r.j.from === 1, JSON.stringify({ s: r.status, f: r.j.from, e: r.j.error }));
    ok('等配音完成', await idle());
    const st = await get(BASE + '/api/stepstatus?name=' + NAME);
    ok('voice.ok=true + 有真实时长', st.j.voice.ok === true && st.j.voice.duration > 0, JSON.stringify(st.j.voice));
    ok('未越界：timeline/segments/video 仍 false（to=1 生效）', st.j.timeline.ok === false && st.j.segments.ok === false && st.j.video.ok === false);
    ok('配音后 drift 归零（seg 落盘）', st.j.drift === false && fs.existsSync(path.join(DIR, 'audio', 'narrationSeg.json')));
  }

  console.log('D 有界画面 run(2→4)：出时间轴+场景+片段，不合成');
  {
    const r = await post(BASE + '/api/rerun', { name: NAME, from: 2, to: 4 });
    ok('rerun 2→4 排上（免重配音 from=2）', r.status === 200 && r.j.from === 2, JSON.stringify({ s: r.status, f: r.j.from, e: r.j.error }));
    ok('等画面渲染完成', await idle());
    const st = await get(BASE + '/api/stepstatus?name=' + NAME);
    ok('timeline.ok + segments.ok + 封面在', st.j.timeline.ok === true && st.j.segments.ok === true && st.j.segments.cover === true);
    ok('未越界：video 仍 false（to=4 生效）', st.j.video.ok === false);
    ok('qc 未跑（qc=null）', st.j.qc === null);
  }

  console.log('E 有界出片 run(5→6)：合成 + 质检');
  {
    const r = await post(BASE + '/api/rerun', { name: NAME, from: 5, to: 6 });
    ok('rerun 5→6 排上 from=5', r.status === 200 && r.j.from === 5, JSON.stringify({ s: r.status, f: r.j.from, e: r.j.error }));
    ok('等合成+质检完成', await idle());
    const st = await get(BASE + '/api/stepstatus?name=' + NAME);
    ok('video.ok=true + qc.done', st.j.video.ok === true && st.j.qc && st.j.qc.done === true, JSON.stringify(st.j.qc));
    ok('qc 解析出 pass/total 且无 ✗ 行（ok 判定）', st.j.qc.total > 0 && st.j.qc.pass === st.j.qc.total && st.j.qc.failCount === 0, JSON.stringify(st.j.qc));
    ok('成片非空', fs.statSync(path.join(DIR, '成片.mp4')).size > 100000);
  }

  console.log('F 清场');
  {
    fs.rmSync(DIR, { recursive: true, force: true });
    const swept = sweepProbes();
    ok('探针目录已清', !fs.existsSync(DIR) && !swept.some((p) => p.includes('wizard')));
    ok('deck-demo 未受影响', fs.existsSync(path.join(OUTPUT, 'deck-demo', 'shots.json')) && fs.existsSync(path.join(OUTPUT, 'deck-demo', '成片.mp4')));
  }

  console.log('\nP14 向导冒烟结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('冒烟异常:', e); try { fs.rmSync(DIR, { recursive: true, force: true }); } catch {} process.exitCode = 1; });
