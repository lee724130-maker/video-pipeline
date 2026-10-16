// 07 · KTV 歌词视频：歌曲 + 歌词 → 卡拉OK字幕（唱到哪点亮到哪）→ 渐变背景成片
// 用法: node pipeline/07-ktv.cjs <任务目录> [--song 歌曲文件名] [--model small|medium]
//
// 歌词输入（按优先级，全在任务目录里）：
//   ① lyrics.lrc  —— 带时间戳歌词（音乐 App 复制「含时间戳」版本），直接套用，最准
//   ② lyrics.txt  —— 纯文本歌词（每行一句）+ 已有 lyrics.json 时间轴 → 文字套时间，零识别误差
//                    （行数必须与识别段数一致，不一致会报错由我人工对齐）
//   ③ 识别兜底     —— 都没有时才用 faster-whisper 识别（同音字可能有误差）
// 行内点亮：①②按行内字数均匀推进（KTV 观感）；③用识别的逐词时间。
// 产出: <任务目录>/KTV成片.mp4 + ktv.ass + qc/ktv_*.png（不动口播成片.mp4；歌词对齐结果缓存 lyrics.json）
const fs = require('fs');
const path = require('path');
const { FFMPEG, run, durationDecoded, ensureDir, readJson, log, warn, fail, findBgm, bgImages, loudnormFile, loadConfig } = require('./lib/common.cjs');

const cfg = loadConfig();
const KTVPY = (cfg.ktv && cfg.ktv.python) || 'py'; // 识别兜底用的 Python（whisper 需 3.12 venv，见 config.ktv.python）
const LYRICS_PY = path.join(__dirname, 'tools', 'lyrics.py');
const W = 1080, H = 1920;

function argOf(flag, def) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

// 片头/字幕幻觉段过滤：作词作曲署名、纯符号
const CREDIT = /(作词|作曲|编曲|制作人|制作|混音|母带|出品|发行|OP\b|SP\b|℗|©)/;
function cleanSegs(segs) {
  return segs.filter((s) => {
    if (!s.text || !s.words || !s.words.length) return false;
    if (CREDIT.test(s.text)) return false;
    const bare = s.text.replace(/[[\]()（）【】\s…~·\-—,.。，、!！?？:：;；"'“”‘’]/g, '');
    if (!bare) return false;
    return /[一-鿿]/.test(bare);
  });
}

// LRC 解析："[mm:ss.xx]歌词"（一行多时间戳、毫秒 2~3 位都支持）
function parseLrc(s) {
  const out = [];
  for (const raw of s.split(/\r?\n/)) {
    const times = [...raw.matchAll(/\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    if (!times.length || !text) continue;
    if (CREDIT.test(text)) continue;
    for (const m of times) {
      out.push({ start: Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number('0.' + m[3]) : 0), text });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

// 行内均匀点亮：把行文本逐字（标点不占时长）均分 [start, end)
function evenWords(seg) {
  const chars = [...seg.text];
  const idx = chars.map((c, i) => ({ c, i })).filter((x) => /[一-鿿㐀-䶿0-9a-zA-Z]/.test(x.c));
  const words = [];
  const dur = Math.max(0.3, seg.end - seg.start);
  const each = dur / Math.max(1, idx.length);
  idx.forEach((x, k) => {
    words.push({
      start: seg.start + k * each,
      end: seg.start + (k + 1) * each,
      word: x.c,
    });
  });
  return words;
}

function esc(t) {
  return String(t).replace(/\{/g, '(').replace(/\}/g, ')');
}

function buildKtvAss(lines, title, artist) {
  const head = [
    '[Script Info]', 'ScriptType: v4.0+', 'PlayResX: 1080', 'PlayResY: 1920',
    'WrapStyle: 0', 'ScaledBorderAndShadow: true', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // Secondary=未唱部分（暗灰），Primary=已唱点亮（白）——libass 实测语义，勿动
    'Style: Kw,Microsoft YaHei,88,&H00FFFFFF,&H00707070,&H00101010,&HA0000000,-1,0,0,0,100,100,1.5,0,1,5,2,5,80,80,420,1',
    'Style: Title,Microsoft YaHei,120,&H0040D5FF,&H00FFFFFF,&H00101010,&HA0000000,-1,0,0,0,100,100,2,0,1,6,3,5,60,60,760,1',
    '', '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const ev = [];
  const ts = (s) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    const sec = (s % 60).toFixed(2).padStart(5, '0');
    return `${h}:${String(m).padStart(2, '0')}:${sec}`;
  };
  if (title) {
    const sub = artist ? `${artist} · 歌词跟唱` : '歌词跟唱';
    ev.push(`Dialogue: 1,${ts(0)},${ts(4.2)},Title,,0,0,0,,{\\fad(500,800)}${esc(title)}`);
    ev.push(`Dialogue: 1,${ts(0.6)},${ts(4.2)},Kw,,0,0,0,,{\\fad(500,800)\\fs44}${esc(sub)}`);
  }
  lines.forEach((seg, i) => {
    const nextStart = i + 1 < lines.length ? lines[i + 1].start : seg.end + 3;
    const end = Math.min(Math.max(seg.end + 0.4, seg.start + 0.8), Math.max(nextStart, seg.end + 0.4));
    const words = seg.words.filter((w) => w.end > seg.start - 0.01);
    let k = '';
    const lead = words[0].start - seg.start;
    if (lead > 0.08) k += `{\\k${Math.round(lead * 100)}}`; // 起唱前空拍不点亮
    words.forEach((w, j) => {
      const nextT = j + 1 < words.length ? Math.max(words[j + 1].start, w.start + 0.04) : Math.max(seg.end, w.start + 0.04);
      const cs = Math.max(4, Math.round((nextT - w.start) * 100));
      k += `{\\k${cs}}${esc(w.word)}`;
    });
    ev.push(`Dialogue: 0,${ts(seg.start)},${ts(end)},Kw,,0,0,0,,{\\fad(120,200)}${k}`);
  });
  return head.join('\n') + '\n' + ev.join('\n') + '\n';
}

// 组装最终唱词行：lrc > (txt+识别时间) > 识别兜底
function resolveLines(task, songDur) {
  // ① LRC：直接套用
  const lrcPath = path.join(task, 'lyrics.lrc');
  if (fs.existsSync(lrcPath)) {
    const parsed = parseLrc(fs.readFileSync(lrcPath, 'utf8'));
    if (parsed.length < 4) fail('lyrics.lrc 解析出的歌词行太少，检查格式（每行 [mm:ss.xx]歌词）');
    const lines = parsed.map((s, i) => {
      const nextStart = i + 1 < parsed.length ? parsed[i + 1].start : songDur;
      // 行演唱时长：到下一行开始，但最多 start + 字数×0.5s + 1s（间奏时不占满）
      const nChars = [...s.text].filter((c) => /[一-鿿0-9a-zA-Z]/.test(c)).length;
      const end = Math.min(nextStart - 0.15, s.start + nChars * 0.5 + 1);
      return { start: s.start, end: Math.max(s.start + 0.5, end), text: s.text, words: null };
    });
    return { lines, mode: 'lrc' };
  }
  // ② 纯文本歌词 + 识别时间轴
  const txtPath = path.join(task, 'lyrics.txt');
  const jsonPath = path.join(task, 'lyrics.json');
  if (fs.existsSync(txtPath)) {
    if (!fs.existsSync(jsonPath)) fail('有 lyrics.txt 但没有时间轴（lyrics.json）——先不带歌词跑一次让识别出时间轴，或直接给 lyrics.lrc');
    const txtLines = fs.readFileSync(txtPath, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const segs = cleanSegs(readJson(jsonPath).segments || []);
    if (txtLines.length !== segs.length) {
      fail(`歌词行数(${txtLines.length}) ≠ 时间轴段数(${segs.length})，需人工对齐：把 lyrics.txt 按识别段落断行（间奏不断行），行数对齐后重跑`);
    }
    const lines = segs.map((s, i) => {
      const nextStart = i + 1 < segs.length ? segs[i + 1].start : songDur;
      return { start: s.start, end: Math.max(s.start + 0.5, Math.min(nextStart - 0.15, s.end + 0.5)), text: txtLines[i], words: null };
    });
    return { lines, mode: 'txt' };
  }
  return null; // 走③识别兜底
}

function main() {
  const task = path.resolve(process.argv[2] || fail('用法: node pipeline/07-ktv.cjs <任务目录> [--song 文件名] [--model small]'));
  let song = argOf('--song', null);
  song = song ? (path.isAbsolute(song) ? song : path.join(task, song)) : findBgm(task);
  if (!song || !fs.existsSync(song)) fail(`任务里没有歌曲（放 bgm.mp3 或 --song 指定）: ${song}`);
  const dur = durationDecoded(song);
  log('07', `歌曲 ${path.basename(song)} · ${dur.toFixed(1)}s`);

  const base = path.basename(song).replace(/\.[^.]+$/, '');
  const m = base.match(/^(.+?)\s*-\s*(.+)$/);
  const artist = m ? m[1].trim() : '';
  const title = m ? m[2].trim() : base;

  // ① ② 文本路径（无识别）
  let resolved = resolveLines(task, dur);
  let lines;
  if (resolved) {
    lines = resolved.lines.map((s) => ({ ...s, words: evenWords(s) }));
    log('07', `歌词来源：${resolved.mode === 'lrc' ? 'lyrics.lrc（用户时间戳）' : 'lyrics.txt（用户文本+已有时间轴）'} · ${lines.length} 行`);
  } else {
    // ③ 识别兜底
    let lyrics = readJson(path.join(task, 'lyrics.json'));
    if (!lyrics) {
      log('07', `无歌词文件，识别兜底中（faster-whisper ${argOf('--model', (cfg.ktv && cfg.ktv.model) || 'small')}）…`);
      const r = run(KTVPY, [LYRICS_PY, song, path.join(task, 'lyrics.json'), '--model', argOf('--model', (cfg.ktv && cfg.ktv.model) || 'small')], { timeout: 30 * 60 * 1000 });
      lyrics = readJson(path.join(task, 'lyrics.json'));
      if (!r.ok || !lyrics) fail(`歌词识别失败\n${r.out.split('\n').slice(-8).join('\n')}`);
    }
    const segs = cleanSegs(lyrics.segments || []);
    if (!segs.length) fail('没有可用唱词段（检查 lyrics.json）');
    log('07', `歌词来源：识别兜底 · ${segs.length} 行（同音字误差可能存在，给 lyrics.txt/lrc 可校正）`);
    lines = segs;
  }

  const assPath = path.join(task, 'ktv.ass');
  fs.writeFileSync(assPath, buildKtvAss(lines, title, artist), 'utf8');
  log('07', `字幕 ${lines.length} 行 → ktv.ass（${artist || '?'} · ${title}）`);

  const out = path.join(task, 'KTV成片.mp4');
  fs.existsSync(out) && fs.unlinkSync(out);

  // 背景：assets/bg-NN 素材图 → Ken Burns 缓推 + 1s 交叉淡化轮播；无素材图 → 内置动态渐变（零配置旧观感）
  const fps = cfg.output?.fps || 30;
  const bgs = bgImages(task);
  const bgCfg = cfg.background || {};
  const XF = 1; // 轮播交叉淡化秒数
  let vInputs, fcTail, songIdx;
  if (!bgs.length) {
    vInputs = ['-f', 'lavfi', '-i', `gradients=s=${W}x${H}:speed=0.018:nb_colors=3:seed=7`];
    fcTail = '[0:v]ass=ktv.ass[vout]';
    songIdx = 1;
  } else {
    const n = bgs.length;
    const slice = (dur + XF * (n - 1)) / n; // 每张占位（含重叠），保证总长 ≥ 歌曲
    const ken = bgCfg.kenBurns !== false;
    const zmax = Number(bgCfg.zoom ?? 1.06);
    const rate = ((zmax - 1) / (slice * fps)).toFixed(6);
    const vf = (i) => (ken
      ? `scale=2160:3840:force_original_aspect_ratio=increase,crop=2160:3840,` +
        `zoompan=z='${i % 2 ? `max(${zmax}-${rate}*on,1)` : `min(1+${rate}*on,${zmax})`}':d=1:` +
        `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=${fps}`
      : `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${fps}`);
    vInputs = [];
    bgs.forEach((f) => vInputs.push('-loop', '1', '-t', (slice + 0.1).toFixed(2), '-i', path.join(task, 'assets', f)));
    let chain = bgs.map((f, i) => `[${i}:v]${vf(i)}[b${i}]`).join(';');
    if (n === 1) {
      chain += ';[b0]ass=ktv.ass[vout]';
    } else {
      let prev = 'b0';
      for (let k = 1; k < n; k++) {
        chain += `;[${prev}][b${k}]xfade=transition=fade:duration=${XF}:offset=${(k * (slice - XF)).toFixed(2)}[x${k}]`;
        prev = `x${k}`;
      }
      chain += `;[${prev}]ass=ktv.ass[vout]`;
    }
    fcTail = chain;
    songIdx = n;
    log('07', `素材背景 ${n} 张轮播（每张 ${slice.toFixed(1)}s · 1s 交叉淡化${ken ? ' · Ken Burns' : ''}）`);
  }

  const r = run(FFMPEG, [
    '-y', ...vInputs,
    '-i', song,
    '-filter_complex', fcTail,
    '-map', '[vout]', '-map', `${songIdx}:a:0`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-r', String(fps), '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k',
    '-t', String(dur),
    '-movflags', '+faststart',
    out,
  ], { cwd: task, timeout: 30 * 60 * 1000 });
  if (!r.ok || !fs.existsSync(out)) fail(`KTV 成片失败\n${r.out.split('\n').slice(-12).join('\n')}`);
  // 响度标准化：与口播成片同标准 -14 LUFS（config.compose.loudness 可关）
  const lnCfg = (cfg.compose && cfg.compose.loudness) || {};
  if (lnCfg.enabled !== false) {
    const ln = loudnormFile(out, lnCfg);
    if (ln) log('07', `响度标准化 ${ln.from.toFixed(1)} → ${ln.to} LUFS`);
    else warn('07', '响度标准化跳过（测量失败或静音轨）');
  }
  const od = durationDecoded(out);
  log('07', `KTV成片.mp4 完成：${od.toFixed(2)}s（歌曲 ${dur.toFixed(2)}s）`);

  // 抽帧自检：同一行唱词的起唱帧（应暗灰）与唱中帧（应点亮）
  const qcDir = ensureDir(path.join(task, 'qc'));
  const mid = lines[Math.floor(lines.length / 2)];
  const shots = [['ktv_start', mid.start + 0.15], ['ktv_mid', mid.start + Math.max(0.8, (mid.end - mid.start) * 0.6)]];
  for (const [name, at] of shots) {
    run(FFMPEG, ['-y', '-ss', at.toFixed(2), '-i', out, '-frames:v', '1', path.join(qcDir, `${name}.png`)]);
  }
  log('07', `抽帧 qc/ktv_start.png · qc/ktv_mid.png @${mid.start.toFixed(1)}s「${mid.text.trim().slice(0, 14)}…」`);
}

main();
