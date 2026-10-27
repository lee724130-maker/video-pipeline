// P6 fail 测试准备（步骤级诊断）
const fs = require('fs');
const path = require('path');
const OUT = require('./lib.cjs').OUTPUT;
const stage = (s) => console.log('[stage] ' + s);
process.on('uncaughtException', (e) => { console.log('UNCAUGHT: ' + (e && e.stack || e)); process.exit(1); });
process.on('unhandledRejection', (e) => { console.log('UNHANDLED: ' + (e && e.stack || e)); process.exit(1); });
try {
  stage('start');
  const from = path.join(OUT, '_probe_p6_d_noplat');
  const to = path.join(OUT, '_probe_p6_f1_badplat');
  stage('rmSync'); fs.rmSync(to, { recursive: true, force: true });
  stage('mkdirSync'); fs.mkdirSync(to, { recursive: true });
  stage('copy audio (manual loop)');
  const srcAudio = path.join(from, 'audio'), dstAudio = path.join(to, 'audio');
  fs.mkdirSync(dstAudio, { recursive: true });
  for (const f of fs.readdirSync(srcAudio)) {
    stage('  copy ' + f);
    fs.copyFileSync(path.join(srcAudio, f), path.join(dstAudio, f));
    stage('  copied ' + f);
  }
  stage('read shots'); const sj = path.join(from, 'shots.json');
  const raw = fs.readFileSync(sj, 'utf8');
  stage('shots bytes=' + raw.length);
  const s = JSON.parse(raw);
  s.platform = 'hack';
  stage('write shots'); fs.writeFileSync(path.join(to, 'shots.json'), JSON.stringify(s, null, 2));
  stage('f1 done');

  const to2 = path.join(OUT, '_probe_p6_f2_conflict');
  stage('f2 rmSync'); fs.rmSync(to2, { recursive: true, force: true });
  stage('f2 mkdirSync'); fs.mkdirSync(to2, { recursive: true });
  stage('f2 copy audio');
  const dstAudio2 = path.join(to2, 'audio');
  fs.mkdirSync(dstAudio2, { recursive: true });
  for (const f of fs.readdirSync(srcAudio)) fs.copyFileSync(path.join(srcAudio, f), path.join(dstAudio2, f));
  stage('f2 audio copied');
  const s2 = JSON.parse(fs.readFileSync(sj, 'utf8'));
  s2.platform = 'douyin'; s2.width = 1920; s2.height = 1080;
  fs.writeFileSync(path.join(to2, 'shots.json'), JSON.stringify(s2, null, 2));
  stage('f2 done');

  const tp = path.join(from, 'timeline.json');
  const t = JSON.parse(fs.readFileSync(tp, 'utf8'));
  t.platform = 'douyin'; t.durHint = 2;
  fs.writeFileSync(tp, JSON.stringify(t, null, 2));
  stage('D timeline patched');
  console.log('SETUP OK');
} catch (e) {
  console.log('CAUGHT: ' + (e && e.stack ? e.stack : String(e)));
  process.exit(1);
}
