// P8 语音克隆冒烟 —— A 静态 · B 无 key 负例 · C 零花费负例 · D 真实 E2E（复刻 1 次 + 合成若干，Qwen 系列官方口径 ¥0.01/次）
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync, execSync } = require('child_process');
const ROOT = require('./lib.cjs').ROOT;
const BASE = 'http://127.0.0.1:8787';
const TEMP = path.join(process.env.TEMP, 'smoke'); fs.mkdirSync(TEMP, { recursive: true });
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

async function post(url, body, timeoutMs) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs || 15000);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), signal: ctl.signal });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, j };
  } finally { clearTimeout(t); }
}

function runNode(args, timeoutMs) {
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', timeout: timeoutMs || 60000 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

(async () => {
  // ===== A 静态 =====
  console.log('A 静态');
  const cfg = JSON.parse(read('pipeline/config.json'));
  ok('config voice.clone 段', cfg.voice && cfg.voice.clone && cfg.voice.clone.enabled === true
    && /customization$/.test(cfg.voice.clone.endpoint) && cfg.voice.clone.targetModel === 'qwen-audio-3.1-tts-flash'
    && /^[a-z0-9]{1,10}$/.test(cfg.voice.clone.prefix) && cfg.voice.clone.key === '');
  ok('.gitignore 账号私有清单', read('.gitignore').includes('pipeline/voice-clone.json'));
  const common = require(path.join(ROOT, 'pipeline/lib/common.cjs'));
  ok('common 三助手导出', ['readCloneVoices', 'writeCloneVoices', 'deriveCloneTarget'].every((n) => typeof common[n] === 'function'));
  ok('deriveCloneTarget 反推模型', common.deriveCloneTarget('qwen-audio-3.1-tts-flash-myvoice-abc123') === 'qwen-audio-3.1-tts-flash'
    && common.deriveCloneTarget('loongstella_v3.1') === '');
  const srv = read('web/server.cjs');
  ok('server 三路由+enroll+voice-enrollment+cloneBusy',
    srv.includes("p === '/api/voice/clone'") && srv.includes("p === '/api/voice/clone/sync'")
    && srv.includes("p === '/api/voice/clone/delete'") && srv.includes("model: 'voice-enrollment'")
    && srv.includes('let cloneBusy = false') && srv.includes('action: \'create_voice\'')
    && srv.includes('action: \'query_voice\'') && srv.includes('action: \'list_voice\'') && srv.includes('action: \'delete_voice\''));
  const t01 = read('pipeline/01-tts.cjs');
  ok('01 克隆识别+禁兜底+换模型+形状守卫',
    t01.includes('const cloneHit = readCloneVoices()') && t01.includes("attempts = cloneHit ? ['dashscope']")
    && t01.includes('cloneHit ? cloneHit.targetModel') && t01.includes('deriveCloneTarget(voiceName)')
    && t01.includes('clone: true'));
  const html = read('web/public/index.html');
  ok('网页克隆面板五件套+四函数', ['cloneBox', 'cloneFile', 'cloneGo', 'cloneMsg', 'cloneList'].every((id) => html.includes(`id="${id}"`))
    && ['renderVoiceSel', 'renderCloneList', 'cloneGo', 'cloneSync', 'cloneDel'].every((fn) => html.includes(fn)));

  // ===== B 无 key 负例（8799 副本实例）=====
  console.log('B 无 key 负例');
  const ovPath = path.join(TEMP, 'p8-override-nokey.json');
  fs.writeFileSync(ovPath, JSON.stringify({ voice: { dashscope: { key: '' }, clone: { key: '' } } }));
  const child = spawn(process.execPath, [path.join(ROOT, 'web/server.cjs'), '--port', '8799'],
    { cwd: ROOT, env: { ...process.env, PIPELINE_CONFIG_OVERRIDES: ovPath }, stdio: 'ignore', detached: true });
  await new Promise((r) => setTimeout(r, 2500));
  try {
    const m = await (await fetch('http://127.0.0.1:8799/api/meta')).json();
    ok('无 key 副本 clone.enabled=false', m.clone && m.clone.enabled === false && m.clone.where === '未配置', JSON.stringify(m.clone));
    const r = await post('http://127.0.0.1:8799/api/voice/clone', { audio: 'data:audio/mpeg;base64,AAAA' });
    ok('无 key POST 400+启用说明', r.status === 400 && /克隆未启用/.test(r.j.error || '') && /config\.local\.json/.test(r.j.error || ''), JSON.stringify(r));
  } finally { try { process.kill(child.pid); } catch {} }

  // ===== C 主实例零花费负例 =====
  console.log('C 主实例零花费负例');
  {
    const m = await (await fetch(BASE + '/api/meta')).json();
    ok('主实例 clone.enabled=true', m.clone && m.clone.enabled === true && /voice\.dashscope\.key/.test(m.clone.where || ''), JSON.stringify(m.clone && m.clone.where));
    const r1 = await post(BASE + '/api/voice/clone', {});
    ok('缺 audio 400', r1.status === 400 && /Data URI/.test(r1.j.error || ''), JSON.stringify(r1));
    const r2 = await post(BASE + '/api/voice/clone', { audio: 'data:text/plain;base64,aGVsbG8=' });
    ok('非音频 MIME 400', r2.status === 400 && /音频/.test(r2.j.error || ''), JSON.stringify(r2));
    const r3 = await post(BASE + '/api/voice/clone', { audio: 'data:audio/mpeg;base64,AAAA' });
    ok('样本太小 400', r3.status === 400 && /样本太小/.test(r3.j.error || ''), JSON.stringify(r3));
    const r4 = await post(BASE + '/api/voice/clone/delete', { voiceId: 'qwen-audio-3.1-tts-flash-myvoice-ghost99' });
    ok('删未知名单 404', r4.status === 404 && /先点「↻ 同步」/.test(r4.j.error || ''), JSON.stringify(r4));
  }

  // ===== D 真实 E2E =====
  console.log('D 真实 E2E');
  // D1 样本：切 15s 干净人声（deck-demo 的 TTS 口播；不用真人素材）
  const cand = [path.join(ROOT, 'output/deck-demo/audio/voice.mp3')];
  if (!fs.existsSync(cand[0])) {
    for (const d of fs.readdirSync(path.join(ROOT, 'output'))) {
      const p = path.join(ROOT, 'output', d, 'audio', 'voice.mp3');
      if (fs.existsSync(p)) { cand[0] = p; break; }
    }
  }
  ok('找到样本源', fs.existsSync(cand[0]), cand[0]);
  const sample = path.join(TEMP, 'p8-clone-sample.mp3');
  execSync(`"${process.env.FFMPEG || 'ffmpeg'}" -y -ss 3 -t 15 -i "${cand[0]}" -codec:a libmp3lame -q:a 2 "${sample}"`, { stdio: 'ignore' });
  ok('切出 15s 样本', fs.existsSync(sample) && fs.statSync(sample).size > 30000);

  // D2 真实复刻（服务端自轮询审核态；Qwen 系列官方口径 ¥0.01/次）
  const dataUrl = 'data:audio/mpeg;base64,' + fs.readFileSync(sample).toString('base64');
  const t0 = Date.now();
  const rc = await post(BASE + '/api/voice/clone', { audio: dataUrl, sampleName: 'p8-15s-sample.mp3' }, 150000);
  ok('复刻创建 200', rc.status === 200 && /^qwen-audio-3\.1-tts-flash-/.test(rc.j.voiceId || ''), JSON.stringify(rc).slice(0, 300));
  const voiceId = rc.j.voiceId || '';
  let status = rc.j.status || '';
  console.log(`    → ${voiceId} · ${status} · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  for (let i = 0; i < 20 && status !== 'OK'; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const rs = await post(BASE + '/api/voice/clone/sync', {});
    status = ((rs.j.voices || []).find((v) => v.voiceId === voiceId) || {}).status || status;
  }
  ok('审核态到 OK', status === 'OK', status);
  {
    const m = await (await fetch(BASE + '/api/meta')).json();
    const v = (m.clone.voices || []).find((x) => x.voiceId === voiceId);
    ok('meta 带出音色+targetModel', !!v && v.status === 'OK' && v.targetModel === 'qwen-audio-3.1-tts-flash', JSON.stringify(v));
  }

  // D3 直连合成探针（证明 voiceId 上游可用）
  {
    const key = JSON.parse(read('pipeline/config.local.json')).voice.dashscope.key;
    const txt = path.join(TEMP, 'p8-synth.txt'); fs.writeFileSync(txt, '克隆音色直连合成测试。', 'utf8');
    const out = path.join(TEMP, 'p8-synth-out.mp3'); fs.existsSync(out) && fs.unlinkSync(out);
    const r = runNode([path.join(ROOT, 'pipeline/tools/tts_dashscope.cjs'), txt, out, key, 'qwen-audio-3.1-tts-flash', voiceId, '0']);
    ok('直连合成出 mp3', r.code === 0 && fs.existsSync(out) && fs.statSync(out).size > 1000, r.out.slice(-200));
  }

  // D4 01 全链（克隆音色 → 不降级 → meta 记录）
  const taskDir = path.join(ROOT, 'output', '_probe_clone_e2e');
  fs.mkdirSync(path.join(taskDir, 'audio'), { recursive: true });
  fs.writeFileSync(path.join(taskDir, 'shots.json'), JSON.stringify({
    width: 1080, height: 1920, voice: voiceId, targetCharsPerSec: 7.2,
    shots: [{ narration: '克隆音色端到端测试。这是一句口播。' }, { narration: '第二句确认时间戳对齐。' }],
  }, null, 2));
  {
    const r = runNode([path.join(ROOT, 'pipeline/01-tts.cjs'), taskDir], 120000);
    const meta = JSON.parse(fs.readFileSync(path.join(taskDir, 'audio', 'meta.json'), 'utf8'));
    ok('01 全链 OK 且不降级', r.code === 0 && meta.provider === 'dashscope', r.out.slice(-300));
    ok('meta 记录克隆信息', meta.voice.voice === voiceId && meta.voice.clone === true && meta.voice.model === 'qwen-audio-3.1-tts-flash', JSON.stringify(meta.voice));
    ok('音频真实生成', meta.duration > 1, String(meta.duration));
  }

  // D5 形状守卫：克隆 id 形状但清单没有 → fail 提示同步（零成本）
  const ghostDir = path.join(ROOT, 'output', '_probe_clone_ghost');
  fs.mkdirSync(ghostDir, { recursive: true });
  fs.writeFileSync(path.join(ghostDir, 'shots.json'), JSON.stringify({
    voice: 'qwen-audio-3.1-tts-flash-myvoice-ghost99',
    shots: [{ narration: '这句不该出声。' }],
  }, null, 2));
  {
    const r = runNode([path.join(ROOT, 'pipeline/01-tts.cjs'), ghostDir]);
    ok('清单外克隆形状 id fail+同步提示', r.code !== 0 && /本地清单（pipeline\/voice-clone\.json）没有/.test(r.out), r.out.slice(-200));
  }

  // D6 状态非 OK fail（临时改状态→跑→还原，finally 保证）
  const statePath = path.join(ROOT, 'pipeline', 'voice-clone.json');
  const raw = fs.readFileSync(statePath, 'utf8');
  try {
    const st = JSON.parse(raw);
    st.voices = st.voices.map((v) => (v.voiceId === voiceId ? { ...v, status: 'DEPLOYING' } : v));
    fs.writeFileSync(statePath, JSON.stringify(st));
    const r = runNode([path.join(ROOT, 'pipeline/01-tts.cjs'), taskDir]);
    ok('审核中状态 fail 不静默换声', r.code !== 0 && /克隆音色未就绪/.test(r.out) && /不静默换音色/.test(r.out), r.out.slice(-200));
  } finally { fs.writeFileSync(statePath, raw); }
  ok('状态文件已还原', fs.readFileSync(statePath, 'utf8') === raw);

  // ===== E 清理与收尾 =====
  console.log('E 清理');
  for (const d of ['_probe_clone_e2e', '_probe_clone_ghost']) {
    fs.rmSync(path.join(ROOT, 'output', d), { recursive: true, force: true });
    ok(`删探针 ${d}`, !fs.existsSync(path.join(ROOT, 'output', d)));
  }
  const final = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  ok('清单只剩留样音色', final.voices.length === 1 && final.voices[0].voiceId === voiceId, JSON.stringify(final.voices.map((v) => v.voiceId)));

  console.log(`\n冒烟结果: ${pass} 通过 / ${fail} 失败`);
  console.log(`留样克隆音色: ${voiceId}（status=OK，网页音色下拉可选；不用可在面板删除）`);
  console.log(`花费: 复刻创建 1 次（Qwen 系列官方口径 ¥0.01/次，若账号为免费创建档则 ¥0）+ 测试合成若干（TTS 免费额度）`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('冒烟脚本异常:', e); process.exit(1); });
