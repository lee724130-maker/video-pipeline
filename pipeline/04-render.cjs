// 04 · 场景渲染：hypit capture run（本地浏览器录制，零费用）→ segments/*.mp4
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { ROOT, FFMPEG, run, durationOf, ensureDir, readJson, writeJson, log, warn, fail, loadConfig } = require('./lib/common.cjs');

const cfg = loadConfig();
const HYPIT = path.join(process.env.APPDATA, 'npm', 'hypit.cmd');
const CAPTURE = path.join(ROOT, 'pipeline', 'tools', 'capture.mjs');

function main() {
  const task = path.resolve(process.argv[2] || fail('用法: node pipeline/04-render.cjs <任务目录>'));
  const timeline = readJson(path.join(task, 'timeline.json'));
  if (!timeline) fail('缺 timeline.json');
  const segDir = ensureDir(path.join(task, 'segments'));
  const buf = cfg.render.bufferSec;

  for (const [ord, shot] of timeline.shots.entries()) {
    const out = path.join(segDir, `${shot.id}.mp4`);

    // 素材镜头：直接裁切/缩放用户素材成片段（cover 铺满竖屏，不够长就循环），不走浏览器录制
    if (shot.asset) {
      const assetPath = path.join(task, 'assets', shot.asset);
      if (!fs.existsSync(assetPath)) fail(`缺素材 ${assetPath}`);
      fs.existsSync(out) && fs.unlinkSync(out);
      const isImg = /\.(png|jpe?g|webp|bmp)$/i.test(shot.asset);
      const W = timeline.width, H = timeline.height, fps = timeline.fps;
      // 图片素材接 Ken Burns 缓推（P5-2）：2x 超采样防抖 + zoompan 居中缓推/缓拉，
      // 奇偶交替方向与素材背景层同规则（03 的 kb-in/kb-out）；config.background.kenBurns:false 关闭
      // （退回静态铺满）；zoom 级别与背景层共用 config.background.zoom。视频素材本身有运动，不加。
      const bgCfg = cfg.background || {};
      const kb = isImg && bgCfg.kenBurns !== false;
      let vf;
      let kbNote = '';
      if (kb) {
        const zoom = Number(bgCfg.zoom ?? 1.06);
        const frames = Math.ceil(shot.dur * fps) + 2;          // 帧供给只多不少，-t 兜底裁齐
        const step = (zoom - 1).toFixed(4);
        const zExpr = ord % 2
          ? `${zoom}-${step}*on/${frames - 1}`                  // 拉远：zoom → 1
          : `1+${step}*on/${frames - 1}`;                       // 缓推：1 → zoom
        vf = [
          `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase`,
          `crop=${W * 2}:${H * 2}`,
          `zoompan=z='${zExpr}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${fps}`,
          'setsar=1',
        ].join(',');
        kbNote = ` · ${ord % 2 ? '缓拉' : '缓推'} ${zoom}×`;
      } else {
        vf = [
          `scale=${W}:${H}:force_original_aspect_ratio=increase`,
          `crop=${W}:${H}`,
          'setsar=1',
          `fps=${fps}`,
        ].join(',');
      }
      const src = isImg
        ? ['-loop', '1', '-i', assetPath]
        : ['-stream_loop', '-1', '-i', assetPath];
      const r = run(FFMPEG, [
        '-y', ...src, '-vf', vf, '-t', String(shot.dur),
        '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
        out,
      ]);
      if (!r.ok || !fs.existsSync(out)) {
        fail(`素材片段失败 ${shot.id}\n${r.out.split('\n').slice(-8).join('\n')}`);
      }
      const d = durationOf(out);
      writeJson(path.join(task, 'segments', `${shot.id}.json`),
        { offsetSec: 0, shotDur: shot.dur, recorded: Number(d.toFixed(3)), asset: shot.asset });
      log('04', `${shot.id} 素材 ${shot.asset} → ${d.toFixed(2)}s（设计 ${shot.dur}s${isImg ? (kb ? kbNote : ' · 图片铺满') : ''}）`);
      continue;
    }

    const html = path.join(task, 'scenes', `${shot.id}.html`);
    if (!fs.existsSync(html)) fail(`缺场景 ${html}，先跑 03`);
    fs.existsSync(out) && fs.unlinkSync(out);

    const seconds = (shot.dur + buf).toFixed(2);
    const r = run(HYPIT, [
      'capture', 'run', CAPTURE,
      '--viewport', `${timeline.width}x${timeline.height}`,
      '--channel', 'chrome',
      '--',
      '--url', pathToFileURL(html).href,
      '--out', out,
      '--seconds', seconds,
      '--fps', String(timeline.fps),
    ]);

    if (!fs.existsSync(out)) {
      log('04', r.out.split('\n').filter(Boolean).slice(-6).join('\n'));
      fail(`镜头 ${shot.id} 渲染失败`);
    }
    const d = durationOf(out);
    if (d < shot.dur + 0.2) warn('04', `${shot.id} 录得 ${d.toFixed(2)}s < 设计 ${shot.dur}s（会由 05 补齐/截断，留意末帧）`);
    const side = readJson(out.replace(/\.mp4$/, '.json'), {});
    writeJson(path.join(task, 'segments', `${shot.id}.json`), { ...side, shotDur: shot.dur, recorded: Number(d.toFixed(3)) });
    log('04', `${shot.id} 录制 ${d.toFixed(2)}s（设计 ${shot.dur}s + 缓冲 ${buf}s）`);
  }
  log('04', `全部 ${timeline.shots.length} 镜渲染完成 → segments/`);

  const vp = `${timeline.width}x${timeline.height}`;

  // 片尾关注卡（03 生成 scenes/outro.html 时）→ segments/outro.mp4（05 拼到成片尾部）
  const outroHtml = path.join(task, 'scenes', 'outro.html');
  if (fs.existsSync(outroHtml)) {
    const dur = Number((timeline.outro && timeline.outro.durSec) || 2.6);
    const out = path.join(segDir, 'outro.mp4');
    fs.existsSync(out) && fs.unlinkSync(out);
    run(HYPIT, [
      'capture', 'run', CAPTURE,
      '--viewport', vp, '--channel', 'chrome',
      '--', '--url', pathToFileURL(outroHtml).href, '--out', out,
      '--seconds', (dur + buf).toFixed(2), '--fps', String(timeline.fps),
    ]);
    if (!fs.existsSync(out)) fail('片尾卡渲染失败（scenes/outro.html）');
    const d = durationOf(out);
    writeJson(path.join(segDir, 'outro.json'), { offsetSec: 0, shotDur: dur, recorded: Number(d.toFixed(3)) });
    log('04', `片尾卡录制 ${d.toFixed(2)}s（设计 ${dur}s）`);
  }

  // 封面图（03 生成 scenes/cover.html 时）：录制 1.8s → 抽 1.2s 稳定帧 → 封面.png
  const coverHtml = path.join(task, 'scenes', 'cover.html');
  if (fs.existsSync(coverHtml)) {
    const tmp = path.join(segDir, 'cover.tmp.mp4');
    const tmpJson = tmp.replace(/\.mp4$/, '.json');
    fs.existsSync(tmp) && fs.unlinkSync(tmp);
    run(HYPIT, [
      'capture', 'run', CAPTURE,
      '--viewport', vp, '--channel', 'chrome',
      '--', '--url', pathToFileURL(coverHtml).href, '--out', tmp,
      '--seconds', '1.8', '--fps', String(timeline.fps),
    ]);
    if (!fs.existsSync(tmp)) fail('封面渲染失败（scenes/cover.html）');
    const png = path.join(task, '封面.png');
    fs.existsSync(png) && fs.unlinkSync(png);
    const rc = run(FFMPEG, ['-y', '-ss', '1.2', '-i', tmp, '-frames:v', '1', png]);
    fs.existsSync(tmp) && fs.unlinkSync(tmp);
    fs.existsSync(tmpJson) && fs.unlinkSync(tmpJson);
    if (!rc.ok || !fs.existsSync(png)) fail(`封面抽帧失败\n${rc.out.split('\n').slice(-8).join('\n')}`);
    log('04', `封面.png 生成（${(fs.statSync(png).size / 1024).toFixed(0)} KB）`);
  }
}

main();
