// 05 · 合成：片段归一化(30fps CFR) → 拼接 → 烧录 ASS 字幕 → 混入配音 → 成片.mp4
const fs = require('fs');
const path = require('path');
const { FFMPEG, run, durationOf, ensureDir, readJson, log, warn, fail, findBgm, loudnormFile, loadConfig } = require('./lib/common.cjs');
// ASS 引擎 P12-A 拆件至 lib/ass-builder.cjs（05/08 共用单一出处；行为逐字节不变，p12 冒烟有等值断言）
const { assTime, buildAss } = require('./lib/ass-builder.cjs');

const cfg = loadConfig();

function main() {
  const task = path.resolve(process.argv[2] || fail('用法: node pipeline/05-compose.cjs <任务目录>'));
  const timeline = readJson(path.join(task, 'timeline.json'));
  if (!timeline) fail('缺 timeline.json');
  const audio = path.join(task, 'audio', 'voice.mp3');
  if (!fs.existsSync(audio)) fail('缺 audio/voice.mp3');
  if (!timeline.shots.length) fail('timeline 无镜头');

  // 转场：xfade 交叉溶解。非末段归一化时各延长 T，交叉消耗掉 T，总时长与镜头边界不变。
  // deck 演示风 = 样片的硬切（T=0，cfg.compose.deckTransitionSec 可覆盖）；classic 走 transitionSec。
  // 钳制：镜头数 <2 或时长 ≥ 最短镜头的 0.8 倍时退回硬切。
  let T = timeline.sceneStyle === 'deck'
    ? Number(cfg.compose.deckTransitionSec ?? 0)
    : Number(cfg.compose.transitionSec || 0);
  const xType = String(cfg.compose.transitionType || 'fade');
  if (!Number.isFinite(T) || T < 0) T = 0;
  if (timeline.shots.length < 2 && T > 0) T = 0;
  if (T > 0) {
    const minDur = Math.min(...timeline.shots.map((s) => s.dur));
    if (T >= minDur * 0.8) {
      warn('05', `转场 ${T}s 过长（最短镜头 ${minDur.toFixed(2)}s），钳制为 ${(minDur * 0.5).toFixed(2)}s`);
      T = minDur * 0.5;
    }
  }
  const n = timeline.shots.length;

  const cwd = { cwd: task };
  const normDir = ensureDir(path.join(task, 'norm'));

  // ① 归一化：按 sidecar 记录的起播偏移裁掉开头黑帧，统一 30fps 无音轨
  const normDur = [];
  timeline.shots.forEach((shot, si) => {
    const seg = path.join(task, 'segments', `${shot.id}.mp4`);
    if (!fs.existsSync(seg)) fail(`缺片段 ${seg}，先跑 04`);
    const side = readJson(path.join(task, 'segments', `${shot.id}.json`), {}) || {};
    let offset = Number(side.offsetSec || 0);
    const recorded = durationOf(seg);
    if (!Number.isFinite(offset) || offset < 0) offset = 0;
    // 录到的时长不够时，收缩偏移保证能取到设计时长
    if (offset + shot.dur > recorded) offset = Math.max(0, recorded - shot.dur);
    const dur = Math.min(shot.dur, recorded - offset);
    // 非末段延长 T：给 xfade 交叉供片（素材不足由 tpad 克隆尾帧补）
    const isLast = si === n - 1;
    const keep = dur + (isLast ? 0 : T);

    // 录制为稀疏帧（Chrome 仅在画面变化时出帧）：fps 补帧后仍可能在最后一帧处提前收口，
    // 先 tpad 克隆尾帧垫足余量，再按设计时长精确截断，保证每段时长严丝合缝
    const vf = [
      `trim=start=${offset.toFixed(3)}`,
      'setpts=PTS-STARTPTS',
      `fps=${timeline.fps}`,
      'tpad=stop_mode=clone:stop_duration=3',
      `trim=duration=${keep.toFixed(3)}`,
      'setpts=PTS-STARTPTS',
      'format=yuv420p',
    ].join(',');
    const out = path.join(normDir, `${shot.id}.mp4`);
    fs.existsSync(out) && fs.unlinkSync(out);
    const r = run(FFMPEG, [
      '-y', '-i', seg,
      '-vf', vf,
      '-an', '-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast',
      '-r', String(timeline.fps), '-video_track_timescale', '15360',
      '-frames:v', String(Math.round(keep * timeline.fps)),
      out,
    ], cwd);
    if (!r.ok || !fs.existsSync(out)) fail(`归一化失败 ${shot.id}\n${r.out.split('\n').slice(-8).join('\n')}`);
    const nd = durationOf(out);
    normDur.push(nd);
    if (Math.abs(nd - keep) > 0.15) warn('05', `${shot.id} 归一化后 ${nd.toFixed(2)}s ≠ 设计 ${keep.toFixed(2)}s`);
    log('05', `${shot.id} 归一化 ${nd.toFixed(2)}s（offset ${offset.toFixed(2)}s${isLast || !T ? '' : `，+${T}s 转场`}）`);
  });

  // ② 拼接：T>0 走 xfade 交叉转场链，否则原样 concat 硬切
  const merged = path.join(task, 'merged.mp4');
  fs.existsSync(merged) && fs.unlinkSync(merged);
  if (T > 0 && n >= 2) {
    // base = 各镜头真实内容时长（非末段归一化时被延长了 T）
    const base = normDur.map((d, i) => (i < n - 1 ? d - T : d));
    const fc = [];
    let prev = '0:v';
    let cum = base[0]; // offset = 交叉点左侧的真实累计时长
    for (let i = 1; i < n; i++) {
      const lab = `x${i}`;
      fc.push(`[${prev}][${i}:v]xfade=transition=${xType}:duration=${T}:offset=${cum.toFixed(3)}[${lab}]`);
      prev = lab;
      cum += base[i];
    }
    const rf = run(FFMPEG, [
      '-y',
      ...timeline.shots.flatMap((s) => ['-i', `norm/${s.id}.mp4`]),
      '-filter_complex', fc.join(';'),
      '-map', `[${prev}]`,
      '-an', '-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast',
      '-r', String(timeline.fps), '-pix_fmt', 'yuv420p',
      merged,
    ], cwd);
    if (!rf.ok || !fs.existsSync(merged)) fail(`转场拼接失败\n${rf.out.split('\n').slice(-8).join('\n')}`);
    log('05', `拼接 ${durationOf(merged).toFixed(2)}s（${n} 镜 · xfade ${xType} ${T}s）`);
  } else {
    const listFile = path.join(task, 'concat.txt');
    fs.writeFileSync(listFile, timeline.shots.map((s) => `file 'norm/${s.id}.mp4'`).join('\n'), 'utf8');
    const rc = run(FFMPEG, [
      '-y', '-f', 'concat', '-safe', '0', '-i', 'concat.txt',
      '-c', 'copy', merged,
    ], cwd);
    if (!rc.ok || !fs.existsSync(merged)) fail(`拼接失败\n${rc.out.split('\n').slice(-8).join('\n')}`);
    log('05', `拼接 ${durationOf(merged).toFixed(2)}s（设计 ${timeline.duration}s · 硬切）`);
  }
  // ②′ 片尾关注卡：segments/outro.mp4（03/04 产物）归一化后硬拼到尾部（无转场）
  let total = timeline.duration;
  const outroSeg = path.join(task, 'segments', 'outro.mp4');
  if (fs.existsSync(outroSeg)) {
    const dur = Number((timeline.outro && timeline.outro.durSec) || durationOf(outroSeg));
    const normOutro = path.join(normDir, 'outro.mp4');
    fs.existsSync(normOutro) && fs.unlinkSync(normOutro);
    const vf = [
      `fps=${timeline.fps}`,
      'tpad=stop_mode=clone:stop_duration=2',
      `trim=duration=${dur.toFixed(3)}`,
      'setpts=PTS-STARTPTS',
      'format=yuv420p',
    ].join(',');
    const ro = run(FFMPEG, [
      '-y', '-i', 'segments/outro.mp4', '-vf', vf, '-an',
      '-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast',
      '-r', String(timeline.fps), '-video_track_timescale', '15360',
      '-frames:v', String(Math.round(dur * timeline.fps)),
      normOutro,
    ], cwd);
    if (!ro.ok || !fs.existsSync(normOutro)) fail(`片尾卡归一化失败\n${ro.out.split('\n').slice(-8).join('\n')}`);
    const list2 = path.join(task, 'concat2.txt');
    fs.writeFileSync(list2, "file 'merged.mp4'\nfile 'norm/outro.mp4'\n", 'utf8');
    const merged2 = path.join(task, 'merged2.mp4');
    fs.existsSync(merged2) && fs.unlinkSync(merged2);
    const rc2 = run(FFMPEG, ['-y', '-f', 'concat', '-safe', '0', '-i', 'concat2.txt', '-c', 'copy', merged2], cwd);
    if (!rc2.ok || !fs.existsSync(merged2)) fail(`片尾卡拼接失败\n${rc2.out.split('\n').slice(-8).join('\n')}`);
    fs.unlinkSync(merged);
    fs.renameSync(merged2, merged);
    total = timeline.duration + dur;
    log('05', `片尾关注卡拼接 +${dur.toFixed(2)}s`);
  }

  const md = durationOf(merged);
  if (Math.abs(md - total) > 0.3) warn('05', '拼接时长与设计偏差 >0.3s，字幕可能轻微错位');

  // ③ 字幕（captionsOff=P2-9 复刻模式：不生成 subs.ass、不叠字幕层，成片=纯画面+旁白）
  const capOff = timeline.captionsOff === true;
  const assPath = path.join(task, 'subs.ass');
  if (capOff) {
    fs.existsSync(assPath) && fs.unlinkSync(assPath);
    log('05', '字幕烧录关闭（captions:false）：跳过 subs.ass');
  } else {
    fs.writeFileSync(assPath, buildAss(timeline, cfg.compose), 'utf8');
    log('05', `字幕 ${timeline.captions.length} 条 → subs.ass`);
  }

  // ④ 混流：烧字幕 + 配音 + 尾部淡出 + 精确总时长；有 BGM 再叠循环 BGM + 侧链闪避
  const final = path.join(task, '成片.mp4');
  fs.existsSync(final) && fs.unlinkSync(final);
  const fadeStart = Math.max(0, total - cfg.compose.fadeOutSec);
  const bgmFile = findBgm(task);

  let rf;
  if (bgmFile) {
    const b = cfg.compose.bgm || {};
    const vol = Number(b.volume ?? 0.16);
    const fi = Number(b.fadeInSec ?? 0.8);
    const fo = Number(b.fadeOutSec ?? 1.5);
    const th = Number(b.duckThreshold ?? 0.02);
    const ratio = Number(b.duckRatio ?? 8);
    const bgFadeOut = Math.max(0, total - fo);
    // 收尾降调（技术库试点）：末尾 N 秒 BGM 降 K 个半音（K 为负，如 -2），情绪收束感。
    // 纯内置滤镜实现：尾段 asetrate 降调 + atempo 还原时长（变调不变速），0.15s acrossfade 接回主体。
    const pitchS = Number(b.outroPitchSemitones ?? 0);
    const pitchP = Number(b.outroPitchSec ?? 2);
    if (!Number.isFinite(pitchS) || pitchS < -12 || pitchS > 0) fail(`compose.bgm.outroPitchSemitones 须是 [-12,0] 的数（负数=降调，0=关）：${b.outroPitchSemitones}`);
    if (pitchS !== 0 && (pitchP < 0.2 || pitchP > 8)) fail(`compose.bgm.outroPitchSec 须在 0.2~8s：${b.outroPitchSec}`);
    let applyPitch = pitchS < 0;
    if (applyPitch && pitchP >= total * 0.5) { warn('05', `收尾降调 ${pitchP}s ≥ 成片一半，已忽略`); applyPitch = false; }
    // 收尾延迟回声（外部教学入库 · 抖音 modal_id=7697617115544603939）：剪映教学里
    // 「主轨 0.4s 淡出 + 复合片段挂『延迟回声』强度 50 把余音甩出画外」的等效实现：
    // 尾段干声先 0.4s 快淡出，aecho 三抽头（250/500/750ms 几何衰减）只让回声荡过切点。
    const echoOn = b.outroEcho === true;
    if (b.outroEcho !== undefined && typeof b.outroEcho !== 'boolean') fail(`compose.bgm.outroEcho 须是布尔：${JSON.stringify(b.outroEcho)}`);
    const echoE = Number(b.outroEchoSec ?? 1.5);
    const echoW = Number(b.outroEchoWet ?? 50);
    if (echoOn) {
      if (!Number.isFinite(echoE) || echoE < 0.2 || echoE > 8) fail(`compose.bgm.outroEchoSec 须在 0.2~8s：${b.outroEchoSec}`);
      if (!Number.isFinite(echoW) || echoW < 1 || echoW > 100) fail(`compose.bgm.outroEchoWet 须在 1~100（教学=50）：${b.outroEchoWet}`);
    }
    let applyEcho = echoOn;
    if (applyEcho && echoE >= total * 0.5) { warn('05', `收尾回声 ${echoE}s ≥ 成片一半，已忽略`); applyEcho = false; }
    // BGM 段滤镜链（降调段 → 回声段串联，均 0.15s acrossfade 接回主体）→ [bg0]，之后闪避/混音照旧
    const tailSegs = [];
    let tailIn = '[2:a]';
    if (applyPitch) {
      const rate = Math.round(44100 * Math.pow(2, pitchS / 12)); // 降 |S| 个半音后的采样率
      const tempo = Math.pow(2, -pitchS / 12).toFixed(6);        // 还原时长的变速（>1，上限 2.0 对应 -12 半音）
      const pStart = (total - pitchP).toFixed(3);
      const mEnd = (total - pitchP + 0.15).toFixed(3);
      tailSegs.push(
        '[2:a]asplit=2[bgb][bgt]',
        `[bgb]atrim=end=${mEnd},asetpts=PTS-STARTPTS[bgm0]`,
        `[bgt]atrim=start=${pStart},asetpts=PTS-STARTPTS,aresample=44100,asetrate=${rate},aresample=44100,atempo=${tempo}[bgm1]`,
        '[bgm0][bgm1]acrossfade=d=0.15[bgp]',
      );
      tailIn = '[bgp]';
    }
    if (applyEcho) {
      const eStart = (total - echoE).toFixed(3);
      const eMEnd = (total - echoE + 0.15).toFixed(3);
      const wetGain = (echoW / 100).toFixed(2);                       // 教学「强度」→ aecho out_gain
      const echoFade = Math.min(0.4, echoE).toFixed(2);               // 教学「上面音频拉一下淡出」的 0.4s
      tailSegs.push(
        `${tailIn}asplit=2[egb][egt]`,
        `[egb]atrim=end=${eMEnd},asetpts=PTS-STARTPTS[egm0]`,
        `[egt]atrim=start=${eStart},asetpts=PTS-STARTPTS,afade=t=out:st=0:d=${echoFade},aecho=0.8:${wetGain}:250|500|750:0.5|0.25|0.125[egm1]`,
        '[egm0][egm1]acrossfade=d=0.15[bgq]',
      );
      tailIn = '[bgq]';
    }
    tailSegs.push(`${tailIn}volume=${vol},afade=t=in:d=${fi.toFixed(2)},afade=t=out:st=${bgFadeOut.toFixed(3)}:d=${fo.toFixed(2)}[bg0]`);
    const bgChain = tailSegs.join(';');
    // 配音为侧链键：说话时 BGM 自动压低（闪避），停顿处回弹
    const fc = [
      capOff ? '[0:v]copy[vout]' : '[0:v]ass=subs.ass[vout]',
      `[1:a]afade=t=out:st=${fadeStart.toFixed(3)}:d=${cfg.compose.fadeOutSec}[vo]`,
      '[vo]asplit=2[voa][vok]',
      bgChain,
      `[bg0][vok]sidechaincompress=threshold=${th}:ratio=${ratio}:attack=15:release=450[bg]`,
      '[voa][bg]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,apad[aout]',
    ].join(';');
    if (process.env.PIPELINE_DEBUG_FC) console.log('FC>>', fc);
    rf = run(FFMPEG, [
      '-y', '-i', 'merged.mp4', '-i', audio, '-stream_loop', '-1', '-i', bgmFile,
      '-filter_complex', fc,
      '-map', '[vout]', '-map', '[aout]',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '19',
      '-r', String(timeline.fps), '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '44100',
      '-t', String(total),
      '-movflags', '+faststart',
      final,
    ], cwd);
    if (!rf.ok || !fs.existsSync(final)) fail(`成片合成失败（BGM 混音）\n${rf.out.split('\n').slice(-12).join('\n')}`);
    log('05', `BGM 混入 ${path.basename(bgmFile)}（音量 ×${vol} · 闪避 ×${ratio} · 淡入 ${fi}s / 淡出 ${fo}s${applyPitch ? ` · 收尾降调 ${pitchS} 半音/${pitchP}s` : ''}${applyEcho ? ` · 收尾延迟回声 ${echoW}%/${echoE}s` : ''}）`);
  } else {
    rf = run(FFMPEG, [
      '-y', '-i', 'merged.mp4', '-i', audio,
      ...(capOff ? [] : ['-vf', 'ass=subs.ass']),
      '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '19',
      '-r', String(timeline.fps), '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '44100',
      '-af', `afade=t=out:st=${fadeStart.toFixed(3)}:d=${cfg.compose.fadeOutSec},apad`,
      '-t', String(total),
      '-movflags', '+faststart',
      final,
    ], cwd);
    if (!rf.ok || !fs.existsSync(final)) fail(`成片合成失败\n${rf.out.split('\n').slice(-10).join('\n')}`);
  }
  // ⑤ 响度标准化：-14 LUFS 平台发布标准（两遍 loudnorm，视频流 copy 只重编音频）
  const lnCfg = cfg.compose.loudness || {};
  if (lnCfg.enabled !== false) {
    const ln = loudnormFile(final, lnCfg);
    if (ln) log('05', `响度标准化 ${ln.from.toFixed(1)} → ${ln.to} LUFS（真峰值 ≤ ${Number(lnCfg.tp ?? -1.5)} dBTP）`);
    else warn('05', '响度标准化跳过（测量失败或静音轨）');
  }
  const fd = durationOf(final);
  if (Math.abs(fd - total) > 0.3) warn('05', `成片 ${fd.toFixed(2)}s ≠ 设计 ${total}s`);
  fs.existsSync(merged) && fs.unlinkSync(merged);
  log('05', `成片.mp4 完成：${fd.toFixed(2)}s`);
}

main();
