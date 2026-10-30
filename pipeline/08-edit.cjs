// 08 · 重剪渲染：edit.json（clip 窗口表）→ 精修/成片.mp4 —— P12-A（拍板：脱钩导出，shots.json/主链产物零触碰）
// 用法: node pipeline/08-edit.cjs <任务目录> [--no-outro]
// 与 05 同构（归一化→拼接→字幕→BGM→响度），差异只在：段落来源=edit clips 窗口、配音逐 clip 窗口 atrim+adelay 回贴；
// 时间轴/字幕/砸词推导全部走 lib/edit-doc 单一出处，ASS 引擎与 05 共用 lib/ass-builder——两处行为永远一致。
// 路径纪律：ffmpeg cwd=任务根、一切滤镜与输入输出用任务根相对路径（ass= 滤镜不吃盘符冒号，05 同法）。
const fs = require('fs');
const path = require('path');
const { FFMPEG, run, durationOf, ensureDir, readJson, writeJson, log, warn, fail, findBgm, loudnormFile, loadConfig } = require('./lib/common.cjs');
const { buildAss } = require('./lib/ass-builder.cjs');
const { validateEdit, deriveEditTimeline } = require('./lib/edit-doc.cjs');

const cfg = loadConfig();

function main() {
  const task = path.resolve(process.argv[2] || fail('用法: node pipeline/08-edit.cjs <任务目录>'));
  const timeline = readJson(path.join(task, 'timeline.json'));
  if (!timeline) fail('缺 timeline.json（先出片到 02+）');
  const doc = readJson(path.join(task, 'edit.json'));
  if (!doc) fail('缺 edit.json（先从时间轴导入编辑单）');
  try { validateEdit(timeline, doc); } catch (e) { fail('edit.json 校验失败：' + e.message); }
  if (!fs.existsSync(path.join(task, 'audio', 'voice.mp3'))) fail('缺 audio/voice.mp3');

  const noOutro = process.argv.includes('--no-outro');
  const outroSeg = path.join(task, 'segments', 'outro.mp4');
  const withOutro = !noOutro && fs.existsSync(outroSeg)
    ? ((timeline.outro && timeline.outro.durSec) ? timeline.outro : { durSec: (cfg.outro || {}).durSec || 2.6 })
    : null;
  const eff = deriveEditTimeline(timeline, doc, withOutro);
  if (eff.captionsOff === undefined) delete eff.captionsOff;
  const capOff = eff.captionsOff === true;
  const total = eff.duration;
  log('08', `编辑单 ${doc.clips.length} clip（源 ${timeline.shots.length} 镜）· 目标 ${total.toFixed(2)}s${withOutro ? '（含片尾卡）' : ''}`);

  const outDir = ensureDir(path.join(task, '精修'));
  const work = ensureDir(path.join(outDir, 'work'));
  const norm = path.join(work, 'norm');
  fs.rmSync(norm, { recursive: true, force: true });
  fs.mkdirSync(norm, { recursive: true });
  const cwd = { cwd: task };

  // ① 归一化：clip 窗口 = [sidecar offset + in, +out)；非末段多留「下一 clip 进入转场」的尾料供交叉
  const normDur = [];
  const fadeDegrade = []; // 归一化阶段判定的「交叉料不足→降级硬切」位（② 拼接与告警都尊重它）
  const trOf = (i) => { if (i === 0) return 0; const t = doc.clips[i].transition || { type: 'cut', dur: 0 }; return t.type === 'fade' ? Number(t.dur || 0) : 0; };
  const trEff = (i) => (fadeDegrade[i] ? 0 : trOf(i));
  doc.clips.forEach((c, si) => {
    const srcShot = timeline.shots[c.seg];
    const segRel = `segments/${srcShot.id}.mp4`;
    if (!fs.existsSync(path.join(task, 'segments', `${srcShot.id}.mp4`))) fail(`缺片段 ${segRel}（clip ${c.id} 的源镜；主链没跑完 04？）`);
    const side = readJson(path.join(task, 'segments', `${srcShot.id}.json`), {}) || {};
    // clip.in/out 是源时间轴绝对秒；片段文件从 srcShot.start 起算 → 片段内坐标 = 绝对值 − 镜起点（+sidecar 起播偏移）
    const inLocal = Math.max(0, c.in - srcShot.start);
    const outLocal = Math.min(srcShot.dur + 0.05, c.out - srcShot.start);
    let offset = Number(side.offsetSec || 0) + inLocal;
    if (!Number.isFinite(offset) || offset < 0) offset = 0;
    const recorded = durationOf(path.join(task, 'segments', `${srcShot.id}.mp4`));
    const keep = Math.max(0.1, outLocal - inLocal);
    if (recorded - offset < 0.1) fail(`clip ${c.id} 窗口起点越出片段实际时长（${segRel} 实测 ${recorded.toFixed(2)}s，偏移 ${offset.toFixed(2)}s）`);
    // 尾料策略：窗口已到底且不够下一 clip 的交叉料 → 该转场降级硬切（并同步推导？推导未知渲染细节——交给 ② 按实际 normDur 计算，恒不等式自动落回无交叉）
    let td = si < doc.clips.length - 1 ? trEff(si + 1) : 0;
    if (td > 0 && offset + keep + td > recorded) { warn('08', `clip ${c.id} 无交叉尾料（片段底），clip ${doc.clips[si + 1].id} 的进入转场降级硬切`); td = 0; fadeDegrade[si + 1] = true; }
    const rel = `精修/work/norm/${c.id}.mp4`;
    const totalKeep = keep + td; // 体部 + 交叉尾料（② 的恒等式按「norm=body+本级fade」计）
    const r = run(FFMPEG, ['-y', '-i', segRel, '-vf', [
      `trim=start=${offset.toFixed(3)}`, 'setpts=PTS-STARTPTS', `fps=${eff.fps}`,
      'tpad=stop_mode=clone:stop_duration=3', `trim=duration=${totalKeep.toFixed(3)}`, 'setpts=PTS-STARTPTS', 'format=yuv420p',
    ].join(','), '-an', '-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast',
      '-r', String(eff.fps), '-video_track_timescale', '15360', '-frames:v', String(Math.round((totalKeep + 0.2) * eff.fps)), rel], cwd);
    if (!r.ok || !fs.existsSync(path.join(task, rel))) fail(`clip ${c.id} 归一化失败\n${r.out.split('\n').slice(-8).join('\n')}`);
    normDur.push(durationOf(path.join(task, rel)));
  });
  log('08', `归一化 ${normDur.length} clip`);

  // ② 拼接：全硬切 concat copy（与 05 同）；有 fade 走 xfade/concat 混合链。
  //    恒等式：clip i 体部落位 = eff.positions[i].start（xfade 交叉吃的是 i−1 多留的尾料与本 clip 头部区，
  //    derive 已把 start 前移 tr.dur）；链尾长 = Σnorm − Σfade = bodyDuration（推导口径），配音按 positions adelay 对齐
  const n = doc.clips.length;
  const mergedRel = '精修/work/merged.mp4';
  const merged = path.join(task, mergedRel);
  fs.existsSync(merged) && fs.unlinkSync(merged);
  const hasFade = doc.clips.some((c, i) => i > 0 && trEff(i) > 0);
  if (hasFade) {
    const fc = [];
    let prev = '0:v';
    let cum = normDur[0];
    for (let i = 1; i < n; i++) {
      const td = trEff(i);
      const lab = `x${i}`;
      if (td > 0) fc.push(`[${prev}][${i}:v]xfade=transition=fade:duration=${td.toFixed(3)}:offset=${(cum - td).toFixed(3)}[${lab}]`);
      else fc.push(`[${prev}][${i}:v]concat=n=2:v=1:a=0[${lab}]`);
      cum += normDur[i] - td;
      prev = lab;
    }
    const rf = run(FFMPEG, ['-y', ...doc.clips.map((c) => ['-i', `精修/work/norm/${c.id}.mp4`]).flat(),
      '-filter_complex', fc.join(';'), '-map', `[${prev}]`,
      '-an', '-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast', '-r', String(eff.fps), '-pix_fmt', 'yuv420p', mergedRel], cwd);
    if (!rf.ok || !fs.existsSync(merged)) fail(`拼接失败\n${rf.out.split('\n').slice(-8).join('\n')}`);
  } else {
    fs.writeFileSync(path.join(work, 'concat.txt'), doc.clips.map((c) => `file 'norm/${c.id}.mp4'`).join('\n'), 'utf8');
    const rc = run(FFMPEG, ['-y', '-f', 'concat', '-safe', '0', '-i', '精修/work/concat.txt', '-c', 'copy', mergedRel], cwd);
    if (!rc.ok || !fs.existsSync(merged)) fail(`拼接失败\n${rc.out.split('\n').slice(-8).join('\n')}`);
  }

  // ②′ 片尾卡：segments/outro.mp4 归一化硬拼尾部（与 05 同法）
  if (withOutro) {
    const dur = Number(withOutro.durSec || 2.6);
    const relOutro = '精修/work/norm/outro.mp4';
    const ro = run(FFMPEG, ['-y', '-i', 'segments/outro.mp4',
      '-vf', [`fps=${eff.fps}`, 'tpad=stop_mode=clone:stop_duration=2', `trim=duration=${dur.toFixed(3)}`, 'setpts=PTS-STARTPTS', 'format=yuv420p'].join(','),
      '-an', '-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast', relOutro], cwd);
    if (!ro.ok || !fs.existsSync(path.join(task, relOutro))) fail(`片尾卡归一化失败\n${ro.out.split('\n').slice(-8).join('\n')}`);
    fs.writeFileSync(path.join(work, 'concat2.txt'), "file 'merged.mp4'\nfile 'norm/outro.mp4'\n", 'utf8');
    const merged2 = path.join(task, '精修/work/merged2.mp4');
    const rc2 = run(FFMPEG, ['-y', '-f', 'concat', '-safe', '0', '-i', '精修/work/concat2.txt', '-c', 'copy', '精修/work/merged2.mp4'], cwd);
    if (!rc2.ok || !fs.existsSync(merged2)) fail(`片尾卡拼接失败\n${rc2.out.split('\n').slice(-8).join('\n')}`);
    fs.rmSync(merged); fs.renameSync(merged2, merged);
  }
  const md = durationOf(merged);
  if (Math.abs(md - total) > 0.35) warn('08', `拼接 ${md.toFixed(2)}s ≠ 设计 ${total.toFixed(2)}s（差 >0.35s，字幕可能微偏；查上面尾料告警）`);

  // ③ 字幕：derive 的目标时间轴喂共用 ASS 引擎；任务根相对路径（ass= 无冒号问题）
  const assRel = '精修/work/subs.ass';
  if (capOff) {
    log('08', '源任务字幕关闭（captions:false）：不烧录');
  } else {
    fs.writeFileSync(path.join(task, assRel), buildAss(eff, cfg.compose), 'utf8');
    log('08', `字幕 ${eff.captions.length} 条 + 砸字 ${eff.keywords.length} 个 → ${assRel}`);
  }

  // ④ 混流：配音按 clip 目标起点逐段 atrim+adelay 回贴（音频跟着窗口走，画面/语音同源不漂）
  const finalRel = '精修/成片.mp4';
  const finalPath = path.join(outDir, '成片.mp4');
  fs.existsSync(finalPath) && fs.unlinkSync(finalPath);
  const fadeStart = Math.max(0, total - cfg.compose.fadeOutSec);
  const bgmFile = findBgm(task);
  const b = cfg.compose.bgm || {};
  const vol = Number(b.volume ?? 0.16), fi = Number(b.fadeInSec ?? 0.8), fo = Number(b.fadeOutSec ?? 1.5);
  const th = Number(b.duckThreshold ?? 0.02), ratio = Number(b.duckRatio ?? 8);
  // 音频链全确定拓扑（两次卡死教训：adelay→amix 与 -t 兜底在这台 ffmpeg 上 EOF 不可靠）——
  // 每 clip = anullsrc 静音垫到 p.start（atrim 后自带 EOF）+ 配音窗口 atrim+asetpts 归零；全部按序 concat，
  // 交叉 fade 只混合帧不改时基 → concat 顺贴与画面窗口严格对齐；每条流都有限，concat 收尾即 EOF
  const chain = [];
  const parts = [];
  eff.positions.forEach((p, i) => {
    const c = doc.clips[i];
    if (p.start > 0.001) {
      chain.push(`anullsrc=r=44100:cl=stereo:d=${p.start.toFixed(3)}[pad${i}]`);
      parts.push(`[pad${i}]`);
    }
    chain.push(`[1:a]atrim=start=${c.in.toFixed(3)}:end=${c.out.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`);
    parts.push(`[a${i}]`);
  });
  const totalBody = eff.bodyDuration;
  const voiceChain = [...chain, `${parts.join('')}concat=n=${parts.length}:v=0:a=1,atrim=0:${totalBody.toFixed(3)},afade=t=out:st=${fadeStart.toFixed(3)}:d=${cfg.compose.fadeOutSec}[vo]`];
  const vmap = capOff ? null : `[0:v]ass=${assRel}[vout];`;
  let fc, mapV;
  if (bgmFile) {
    fc = (vmap || '') + voiceChain.join(';') + ';[vo]asplit=2[voa][vok];'
      + `[2:a]volume=${vol},afade=t=in:d=${fi},afade=t=out:st=${(total - fo).toFixed(3)}:d=${fo},atrim=0:${total.toFixed(3)}[bg0];`
      + `[bg0][vok]sidechaincompress=threshold=${th}:ratio=${ratio}:attack=15:release=450,atrim=0:${total.toFixed(3)}[bg];`
      + '[voa][bg]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,atrim=0:' + total.toFixed(3) + '[aout]';
    mapV = vmap ? '[vout]' : '0:v';
  } else {
    fc = (vmap || '') + voiceChain.join(';') + ';[vo]atrim=0:' + total.toFixed(3) + '[aout]';
    mapV = vmap ? '[vout]' : '0:v';
  }
  const args = ['-y', '-i', mergedRel, '-i', 'audio/voice.mp3'];
  if (bgmFile) args.push('-stream_loop', '-1', '-i', path.relative(task, bgmFile).replace(/\\/g, '/'));
  const rf = run(FFMPEG, [...args, '-filter_complex', fc, '-map', mapV, '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-r', String(eff.fps), '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-t', String(total), '-movflags', '+faststart', finalRel], cwd);
  if (process.env.PIPELINE_DEBUG_FC) console.log('FC>>', fc);
  if (!rf.ok || !fs.existsSync(finalPath)) fail(`精修成片合成失败\n${rf.out.split('\n').slice(-12).join('\n')}`);
  if (bgmFile) log('08', `BGM 混入 ${path.basename(bgmFile)}`);

  // ⑤ 响度 -14 LUFS + 封面复制 + 有效时间轴留档（06 精修模式 / B 段页面都吃这份）
  const lnCfg = cfg.compose.loudness || {};
  if (lnCfg.enabled !== false) {
    const ln = loudnormFile(finalPath, lnCfg);
    if (ln) log('08', `响度标准化 ${ln.from.toFixed(1)} → ${ln.to} LUFS`);
  }
  if (fs.existsSync(path.join(task, '封面.png'))) fs.copyFileSync(path.join(task, '封面.png'), path.join(outDir, '封面.png'));
  writeJson(path.join(outDir, 'effective-timeline.json'), eff);
  writeJson(path.join(outDir, 'edit.report.json'), { at: new Date().toISOString(), clips: doc.clips.length, duration: eff.duration, segs: doc.clips.map((c) => timeline.shots[c.seg].id) });
  log('08', `精修/成片.mp4 完成：${durationOf(finalPath).toFixed(2)}s（${doc.clips.length} clip）`);
}

main();
