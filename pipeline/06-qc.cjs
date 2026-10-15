// 06 · 质检：机械项脚本化；语义项（文案/画面）另由人工抽帧查看 qc/*.png
const fs = require('fs');
const path = require('path');
const { FFMPEG, run, ffprobe, durationOf, ensureDir, readJson, log, warn, fail, findBgm, loadConfig } = require('./lib/common.cjs');

const cfg = loadConfig();
let pass = 0, failN = 0;

function check(name, ok, detail = '') {
  ok ? pass++ : failN++;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

function luminance(file) {
  const r = run(FFMPEG, ['-i', file, '-vf', 'signalstats,metadata=print:file=-', '-f', 'null', '-']);
  const m = r.out.match(/lavfi\.signalstats\.YAVG=([\d.]+)/);
  return m ? parseFloat(m[1]) : null;
}

function main() {
  const task = path.resolve(process.argv[2] || fail('用法: node pipeline/06-qc.cjs <任务目录>'));
  const timeline = readJson(path.join(task, 'timeline.json'));
  const final = path.join(task, '成片.mp4');
  if (!timeline) fail('缺 timeline.json');
  console.log('[06] 质检');

  check('成片存在', fs.existsSync(final), fs.existsSync(final) ? `${(fs.statSync(final).size / 1024 / 1024).toFixed(1)} MB` : '缺 成片.mp4');
  if (!fs.existsSync(final)) { console.log(`  ——— 0/${pass + failN}`); process.exit(1); }

  const p = ffprobe(final);
  const v = p.streams.find((s) => s.codec_type === 'video') || {};
  const a = p.streams.find((s) => s.codec_type === 'audio') || {};
  const dur = parseFloat(p.format.duration);

  // 时长：设计时长 + 片尾关注卡（03 写入 timeline.outro）
  const expected = timeline.duration + (timeline.outro ? Number(timeline.outro.durSec || 0) : 0);
  check('时长', Math.abs(dur - expected) <= 0.3, `${dur.toFixed(2)}s / 设计 ${expected}s`);
  check('分辨率', `${v.width}x${v.height}` === `${timeline.width}x${timeline.height}`, `${v.width}x${v.height}`);
  check('帧率', v.r_frame_rate === `${timeline.fps}/1`, v.r_frame_rate);
  check('编码', v.codec_name === 'h264', v.codec_name);
  check('音轨', a.codec_name === 'aac', a.codec_name || '无音轨');
  check('faststart', fs.readFileSync(final).indexOf(Buffer.from('moov')) < fs.statSync(final).size, 'moov 前置');
  check('字幕条数', timeline.captions.length > 0, `${timeline.captions.length} 条`);
  check('镜头数', timeline.shots.length > 0, `${timeline.shots.length} 镜`);

  // 关键词砸字：shots.json 声明了 keyword 时，subs.ass 必须含对应砸字事件
  const kws = timeline.keywords || [];
  if (kws.length) {
    const assPath = path.join(task, 'subs.ass');
    const ass = fs.existsSync(assPath) ? fs.readFileSync(assPath, 'utf8') : '';
    const missing = kws.filter((k) => !ass.includes('\\pos(') || !ass.includes(k.text));
    check('关键词砸字', missing.length === 0,
      missing.length ? `缺 ${missing.map((k) => k.text).join('、')}` : `${kws.length} 个 → subs.ass`);
  }

  // 抽帧：首/中/尾帧亮度（防黑屏）+ 3 张语义核验用图
  const qcDir = ensureDir(path.join(task, 'qc'));
  const samples = [
    { name: 'f_first', t: 0.4 },
    { name: 'f_mid', t: timeline.duration * 0.5 },
    { name: 'f_last', t: timeline.duration - 0.5 },
  ];
  // 取一条字幕中点做「字幕是否烧上」的核验帧
  if (timeline.captions.length) {
    const cap = timeline.captions[Math.floor(timeline.captions.length / 2)];
    samples.push({ name: 'f_caption', t: (cap.start + cap.end) / 2 });
  }
  for (const s of samples) {
    const out = path.join(qcDir, `${s.name}.png`);
    fs.existsSync(out) && fs.unlinkSync(out);
    const r = run(FFMPEG, ['-y', '-i', final, '-ss', String(s.t), '-frames:v', '1', '-update', '1', out]);
    const ok = r.ok && fs.existsSync(out);
    const lum = ok ? luminance(out) : null;
    check(`抽帧 ${s.name} @${s.t.toFixed(1)}s`, ok && lum !== null && lum > 12, ok ? `YAVG=${lum === null ? '?' : lum.toFixed(1)}（<12 疑似黑屏）` : '抽帧失败');
  }

  // 语音段落覆盖：成片应有持续音轨（抽首中尾三段响度）
  const raf = run(FFMPEG, ['-i', final, '-af', 'volumedetect', '-f', 'null', '-']);
  const vm = raf.out.match(/mean_volume:\s*(-?[\d.]+) dB/);
  check('有音频信号', vm ? parseFloat(vm[1]) > -40 : false, vm ? `mean ${vm[1]} dB` : '无法测量');

  // BGM：任务带 bgm.* 时，成片必须混入（音轨存在且非静音），并报告卡点状态
  const bgmFile = findBgm(task);
  if (bgmFile) {
    const bgmOk = a.codec_name === 'aac' && vm && parseFloat(vm[1]) > -40;
    const b = timeline.bgm;
    check('BGM 混音', bgmOk,
      `${path.basename(bgmFile)}${b ? ` · 卡点 ${b.bpm} BPM` : ' · 无节奏或未跑 02，不卡点'}`);
  }

  // 响度：ebur128 整体响度应在 -14 ±3 LUFS（平台发布标准；05 出片时已两遍 loudnorm）
  const rel = run(FFMPEG, ['-i', final, '-map', '0:a:0', '-af', 'ebur128', '-f', 'null', '-']);
  const summary = rel.out.split(/Summary:/).pop() || ''; // 逐帧行也有 I: 字段（起始 -70），只认 Summary
  const im = summary.match(/I:\s*(-?[\d.]+)\s*LUFS/);
  const loudI = im ? parseFloat(im[1]) : null;
  check('响度 -14 LUFS', loudI !== null && loudI >= -17 && loudI <= -11,
    loudI !== null ? `${loudI.toFixed(1)} LUFS（-14 ±3）` : '无法测量（重跑 05 会自动标准化）');

  // 片尾关注卡 / 封面（03+04 的可选产物）
  if (timeline.outro) {
    check('片尾关注卡', fs.existsSync(path.join(task, 'segments', 'outro.mp4')), `${timeline.outro.durSec}s`);
  }
  if (timeline.cover) {
    const cp = path.join(task, '封面.png');
    check('封面图', fs.existsSync(cp) && fs.statSync(cp).size > 10240,
      fs.existsSync(cp) ? `${(fs.statSync(cp).size / 1024).toFixed(0)} KB` : '缺 封面.png（重跑 03+04）');
  }

  console.log(`  ——— ${pass}/${pass + failN} 机械项通过`);
  log('06', `语义项请看 qc/f_first.png · f_mid.png · f_last.png · f_caption.png（f_caption 应能看到字幕）`);
  if (failN) fail(`质检 ${failN} 项不通过`);
}

main();
