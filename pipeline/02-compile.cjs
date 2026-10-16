// 02 · 编排：把口播稿切成镜头时间轴 + 字幕行
//   输入: shots.json + audio/voice.mp3 (+ 可选 audio/words.json 逐词时间戳)
//   输出: timeline.json（每镜 start/end/dur、字幕行、逐字时间）
//   时间来源优先级: ① edge-tts 逐词时间戳 → ② 静音断句 + 字数比例分配（gTTS 兜底）
const fs = require('fs');
const path = require('path');
const { FFMPEG, run, durationOf, durationDecoded, readJson, writeJson, log, warn, fail, findBgm, loadConfig } = require('./lib/common.cjs');
const { T2S } = require('./lib/t2s.js');

const cfg = loadConfig();

const TERMINAL = '。！？…';
const PAUSE = '，、：；,.!?;:—';
const DIGITS = /[0-9]/;
const LATIN = /[a-zA-Z]/;
const HAN = /[一-鿿㐀-䶿]/;
const WEIGHT_ANY = /[一-鿿㐀-䶿0-9a-zA-Z]/;

function weightOf(ch) {
  if (HAN.test(ch)) return 1.0;
  if (DIGITS.test(ch)) return 0.55;
  if (LATIN.test(ch)) return 0.32;
  return 0; // 空格与标点不吃时长（它们对应静音/停顿）
}

function detectSilences(mp3) {
  const r = run(FFMPEG, ['-i', mp3, '-af',
    `silencedetect=noise=${cfg.silence.noiseDb}dB:d=${cfg.silence.minDurSec}`, '-f', 'null', '-']);
  const lines = r.out.split('\n');
  const sil = [];
  let start = null;
  for (const line of lines) {
    let m = line.match(/silence_start:\s*([\d.]+)/);
    if (m) start = parseFloat(m[1]);
    m = line.match(/silence_end:\s*([\d.]+)/);
    if (m && start !== null) { sil.push([start, parseFloat(m[1])]); start = null; }
  }
  return sil;
}

// —— 字数比例分配：把字符按权重铺进语音段（剔除静音后的连续段）
// 段容量 = 段时长占比 × 总权重；段内各字按自身权重瓜分段时长。
function charTimesByText(narration, silences, total) {
  const segs = [];
  let cursor = 0;
  for (const [s, e] of silences) {
    if (s > cursor) segs.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (cursor < total) segs.push([cursor, total]);
  if (!segs.length) segs.push([0, total]);

  const chars = [...narration];
  const weights = chars.map(weightOf);
  const totalW = weights.reduce((a, b) => a + b, 0);
  if (totalW <= 0) fail('口播稿里没有任何可读文字');

  const speechDur = segs.reduce((a, [s, e]) => a + (e - s), 0);
  const starts = new Array(chars.length);
  const ends = new Array(chars.length);

  let ci = 0;
  for (let si = 0; si < segs.length && ci < chars.length; si++) {
    const [s, e] = segs[si];
    const segDur = e - s;
    const cap = (segDur / speechDur) * totalW;
    const from = ci;
    let w = 0;
    while (ci < chars.length && (w < cap || ci === from)) w += weights[ci++];
    const segW = weights.slice(from, ci).reduce((a, b) => a + b, 0) || 1;
    let t = s;
    for (let i = from; i < ci; i++) {
      const d = segDur * (weights[i] / segW);
      starts[i] = t; t += d; ends[i] = t;
    }
    if (ci < chars.length) ends[ci - 1] = e; // 段内最后一字贴齐段尾
  }

  // 兜底：剩余（全为 0 权重的标点、或末段溢出）补在邻近
  const lastSegEnd = segs[segs.length - 1][1];
  for (let i = 0; i < chars.length; i++) {
    if (starts[i] === undefined) {
      const prev = i > 0 && ends[i - 1] !== undefined ? ends[i - 1] : 0;
      const next = findNextStart(starts, i);
      starts[i] = prev;
      ends[i] = next !== null && next > prev ? Math.min(prev + 0.25, next) : prev + 0.15;
    }
  }
  void lastSegEnd;
  return { starts, ends, chars };
}

function findNextStart(starts, i) {
  for (let j = i + 1; j < starts.length; j++) if (starts[j] !== undefined) return starts[j];
  return null;
}

// —— 逐词时间戳 → 逐字时间（edge-tts 直出 或 whisper 对齐，见 tools/align.py）
// 归一三件套（2026-10-16 P1-2）：
//  ① 数字归一：阿拉伯 ↔ 中文数字（whisper 常把「3」写成「三」，反之亦然）
//  ② 繁简归一：whisper 会随机输出繁体（樂/長/個…），经 OpenCC t2s 归一再比对
//  ③ 有界重同步：单字失配（同音错写如剧→句、多位数字结构差异如「二十三」vs「23」）
//     不再放弃整段逐词法——向前 LOOK=4 字窗口重咬，咬不住就丢弃该 whisper 字，
//     末了按咬合率决定去留（<60% 才退回静音兜底）。错 1 个字不再全盘作废。
const CN_NUM = { '零': '0', '〇': '0', '一': '1', '二': '2', '两': '2', '三': '3', '四': '4', '五': '5', '六': '6', '七': '7', '八': '8', '九': '9' };
const normChar = (c) => { const s = T2S[c] || c; return CN_NUM[s] || s.toLowerCase(); };
const LOOK = 4;

function charTimesByWords(narration, wordsData) {
  const chars = [...narration];
  const words = wordsData.words || [];
  if (!words.length) return null;
  const isW = (c) => HAN.test(c) || DIGITS.test(c) || LATIN.test(c); // 标点/空格不参与比对
  const starts = new Array(chars.length);
  const ends = new Array(chars.length);
  let ci = 0, matched = 0, drop = 0;
  for (const w of words) {
    const wt = [...String(w.text)].filter(isW);       // edge-tts 词内可能带标点
    if (!wt.length) continue;
    const hits = [];
    for (const wc of wt) {
      while (ci < chars.length && !isW(chars[ci])) ci++;   // 跳过 narration 标点
      let hit = -1;
      for (let k = 0; k <= LOOK && ci + k < chars.length; k++) {
        if (normChar(chars[ci + k]) === normChar(wc)) { hit = ci + k; break; }
      }
      if (hit < 0) { drop++; continue; }               // 窗口内咬不住 → 丢弃该字
      ci = hit + 1;
      hits.push(hit);
      matched++;
    }
    if (!hits.length) continue;
    // 时间摊分：本词咬住的首尾字之间均分词时长（中间被跳过的字一并摊到，保持时间连续）
    const a = hits[0], b = hits[hits.length - 1];
    const d = (w.end - w.start) / (b - a + 1);
    for (let x = a; x <= b; x++) {
      starts[x] = w.start + (x - a) * d;
      ends[x] = starts[x] + d;
    }
  }
  const total = chars.filter(isW).length;
  if (!total || matched < total * 0.6) return null;    // 咬合率过低 → 整体退回静音兜底
  if (drop) log('02', `逐词重同步：丢弃 ${drop} 个失配字（同音错写/识别偏差），不影响其余对齐`);
  for (let i = 0; i < chars.length; i++) {             // 未被任何词覆盖的字（含标点）：邻接插值
    if (starts[i] === undefined) {
      const prev = i > 0 && ends[i - 1] !== undefined ? ends[i - 1] : 0;
      const next = findNextStart(starts, i);
      starts[i] = prev;
      ends[i] = next !== null && next > prev ? Math.min(prev + 0.2, next) : prev + 0.12;
    }
  }
  return { starts, ends, chars };
}

function buildCaptions(chars, starts, ends, maxChars) {
  // ① 先按句末标点切句（自然停顿处）
  const sentences = [];
  let buf = [], bufIdx = [];
  const pushSentence = () => {
    if (buf.length) { sentences.push({ chars: buf, idx: bufIdx }); buf = []; bufIdx = []; }
  };
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (/\s/.test(ch)) continue;
    buf.push(ch); bufIdx.push(i);
    if (TERMINAL.includes(ch)) pushSentence();
  }
  pushSentence();

  // ② 超长句再切行：优先断在句内停顿标点，否则硬切 maxChars
  const lines = [];
  for (const s of sentences) {
    if (s.chars.length <= maxChars) { lines.push(s); continue; }
    let cur = { chars: [], idx: [] };
    for (let k = 0; k < s.chars.length; k++) {
      cur.chars.push(s.chars[k]); cur.idx.push(s.idx[k]);
      if (cur.chars.length >= maxChars) {
        let cut = -1;
        for (let j = cur.chars.length - 1; j >= Math.max(3, Math.ceil(maxChars / 3)); j--) {
          if (PAUSE.includes(cur.chars[j])) { cut = j; break; }
        }
        const at = cut > 0 ? cut : cur.chars.length - 1;
        lines.push({ chars: cur.chars.slice(0, at + 1), idx: cur.idx.slice(0, at + 1) });
        cur = { chars: cur.chars.slice(at + 1), idx: cur.idx.slice(at + 1) };
      }
    }
    if (cur.chars.length) lines.push(cur);
  }

  // ③ 计时：句首到句尾；下一条出现前保持显示（视觉连续）
  //    idx = 该行每个字在 narration 中的下标 → 05 用它取逐字时间做卡拉OK高亮
  const caps = lines.map((l) => ({
    text: l.chars.join(''),
    start: starts[l.idx[0]],
    end: ends[l.idx[l.idx.length - 1]],
    idx: l.idx,
  }));
  // ④ 纯标点残行并入上一条（防孤行「。」）
  for (let i = caps.length - 1; i > 0; i--) {
    if (!WEIGHT_ANY.test(caps[i].text)) {
      caps[i - 1].text += caps[i].text;
      caps[i - 1].end = caps[i].end;
      caps[i - 1].idx = caps[i - 1].idx.concat(caps[i].idx);
      caps.splice(i, 1);
    }
  }
  for (let i = 0; i < caps.length; i++) {
    const next = caps[i + 1];
    if (next && next.start - caps[i].end < 1.5) caps[i].end = Math.max(caps[i].end, next.start - 0.04);
    else if (!next) caps[i].end = Math.max(caps[i].end, caps[i].end + 0.6);
  }
  return caps;
}

function main() {
  const task = path.resolve(process.argv[2] || fail('用法: node pipeline/02-compile.cjs <任务目录>'));
  const shots = readJson(path.join(task, 'shots.json'));
  if (!shots) fail('缺 shots.json');
  const narration = fs.readFileSync(path.join(task, 'narration.txt'), 'utf8');
  const mp3 = path.join(task, 'audio', 'voice.mp3');
  if (!fs.existsSync(mp3)) fail('缺 audio/voice.mp3，先跑 01');

  // DashScope 原始 mp3 头时长不可信（实测 7.47s vs 解码 8.9s），统一解码实测；
  // atempo 重编码后头是准的，两者偏差 >0.3s 时告警留痕。
  const audioHdr = durationOf(mp3);
  const audioDur = durationDecoded(mp3);
  if (Math.abs(audioHdr - audioDur) > 0.3) {
    warn('02', `mp3 头时长 ${audioHdr.toFixed(2)}s ≠ 解码实测 ${audioDur.toFixed(2)}s，以解码为准`);
  }
  const tailPad = cfg.compose.tailPadSec;
  const silences = detectSilences(mp3);
  log('02', `音频 ${audioDur.toFixed(2)}s · 静音段 ${silences.length} 个`);

  let timing = null;
  let wordsData = readJson(path.join(task, 'audio', 'words.json'));
  if (!wordsData) {
    // DashScope TTS 无逐词时间戳 → whisper 对齐（一次性生成，缓存复用）
    const outW = path.join(task, 'audio', 'words.json');
    const alignModel = (cfg.ktv && cfg.ktv.alignModel) || 'small';
    log('02', `无 words.json → whisper 逐词对齐中（模型 ${alignModel}，结果缓存到 audio/words.json）…`);
    const ra = run((cfg.ktv && cfg.ktv.python) || 'py', [
      path.join(__dirname, 'tools', 'align.py'), mp3, outW, alignModel,
    ], { timeout: 30 * 60 * 1000 });
    wordsData = readJson(outW);
    if (!ra.ok || !wordsData) {
      warn('02', `逐词对齐失败，退回静音断句+字数比例\n${ra.out.split('\n').slice(-5).join('\n')}`);
    }
  }
  if (wordsData) timing = charTimesByWords(narration, wordsData);
  if (timing) log('02', `时间轴来源：逐词时间戳（${wordsData.engine || 'edge-tts'}）`);
  else if (wordsData) warn('02', 'words.json 与文案咬合率 <60%，退回字数比例（可删 audio/words.json 重对齐）');
  if (!timing) {
    timing = charTimesByText(narration, silences, audioDur);
    log('02', '时间轴来源：静音断句 + 字数比例（gTTS 路径）');
  }

  const { starts, ends, chars } = timing;

  // 每镜起始字索引
  const idx = [];
  let acc = 0;
  for (const s of shots.shots) {
    idx.push(acc);
    acc += [...(s.narration || '').trim().replace(/\s+/g, ' ')].length;
  }

  // 镜头边界（首镜 0，其余取该镜首字时间），并吸附到就近静音中点
  const mids = silences.map(([s, e]) => (s + e) / 2);
  let bounds = idx.map((c, i) => {
    if (i === 0) return 0;
    if (c >= starts.length) return audioDur;
    let b = starts[c];
    const near = mids.filter((m) => Math.abs(m - b) <= 0.5).sort((a, x) => Math.abs(a - b) - Math.abs(x - b))[0];
    if (near !== undefined) b = near;
    return Math.max(0, Math.min(audioDur, b));
  });

  // 卡点：任务里有 BGM 时，把镜头边界再吸附到节拍网格（先静音后节拍，两道吸附）
  const bgmFile = findBgm(task);
  const bgmCfg = cfg.compose.bgm || {};
  let bgmMeta = null;
  if (bgmFile && bgmCfg.beatSnap !== false) {
    const rb = run('py', [path.join(__dirname, 'tools', 'beats.py'), bgmFile]);
    const m = rb.out.match(/JSON:(\{.*\})/);
    const det = m ? JSON.parse(m[1]) : null;
    if (det && det.bpm > 0 && det.beats.length > 1) {
      bgmMeta = { file: path.basename(bgmFile), bpm: det.bpm, beats: det.beats.length };
      const win = Number(bgmCfg.snapWindowSec ?? 0.3);
      const used = new Set();
      const snapped = [bounds[0]];
      for (let i = 1; i < bounds.length; i++) {
        const prev = snapped[i - 1];
        let bi = -1, bd = Infinity;
        for (let k = 0; k < det.beats.length; k++) {
          if (used.has(k)) continue;
          const d = Math.abs(det.beats[k] - bounds[i]);
          if (d < bd) { bd = d; bi = k; }
        }
        const cand = bi >= 0 ? det.beats[bi] : null;
        // 窗内 + 不与上一镜边界挤在一起（≥0.6s）才吸
        if (cand !== null && bd <= win && cand > prev + 0.6) {
          used.add(bi);
          if (Math.abs(cand - bounds[i]) > 0.02) {
            log('02', `卡点：第 ${i + 1} 镜边界 ${bounds[i].toFixed(2)} → ${cand.toFixed(2)}s（${det.bpm} BPM）`);
          }
          snapped.push(cand);
        } else {
          snapped.push(bounds[i]);
        }
      }
      bounds = snapped;
      log('02', `BGM 卡点 ${bgmMeta.file} · ${det.bpm} BPM · ${det.beats.length} 拍（窗 ${win}s）`);
    } else if (rb.ok) {
      warn('02', `BGM 无明显节奏（corr 不足），跳过卡点：${path.basename(bgmFile)}`);
    } else {
      warn('02', 'beats.py 检测失败，跳过卡点：' + rb.out.split('\n').filter(Boolean).slice(-1)[0].slice(0, 120));
    }
  }

  const totalDur = audioDur + tailPad;
  // 镜头类型白名单（skills/script.md）：历史 shots.json 有写 scene 字段的，作为别名接受；
  // 缺失/非法直接报错——旧版静默兜底 title 会把全片渲染成同一张标题卡（大坑）
  const TYPES = ['title', 'bullet', 'keyword', 'transition', 'end'];
  const SCENE_ALIAS = { list: 'bullet' }; // 历史叫法 → 规范类型
  const shotList = shots.shots.map((s, i) => {
    const start = bounds[i];
    const end = i === shots.shots.length - 1 ? totalDur : bounds[i + 1];
    let type = s.type || s.scene || '';
    if (SCENE_ALIAS[type]) type = SCENE_ALIAS[type];
    if (!TYPES.includes(type)) {
      fail(`镜头 ${s.id || i + 1} 缺 type 或类型非法：「${s.type || s.scene || '(空)'}」\n` +
        `  白名单: ${TYPES.join(' / ')}（skills/script.md 二·schema）`);
    }
    const rec = {
      id: s.id || `s${String(i + 1).padStart(2, '0')}`,
      type,
      index: i,
      start: Number(start.toFixed(3)),
      end: Number(end.toFixed(3)),
      dur: Number((end - start).toFixed(3)),
      charStart: idx[i],
      charEnd: i === shots.shots.length - 1 ? chars.length : idx[i + 1],
    };
    // 素材模式：shots.json 里声明 asset 的镜头，用 assets/ 里的用户素材替代场景渲染
    if (s.asset) {
      const ap = path.join(task, 'assets', String(s.asset));
      if (!fs.existsSync(ap)) fail(`镜头 ${rec.id} 素材不存在：assets/${s.asset}（没有就删掉 asset 字段）`);
      rec.asset = String(s.asset);
    }
    return rec;
  });

  shotList.forEach((s) => { if (s.dur < 1.2) warn('02', `镜头 ${s.id} 只有 ${s.dur}s，偏短`); });

  const captions = buildCaptions(chars, starts, ends, cfg.compose.captionMaxChars);

  // 关键词砸字：shots.json 每镜可选 keyword，在口播稿里定位原始下标 → 首字说话时刻
  const keywords = [];
  {
    let cursor = 0;
    for (const s of shots.shots) {
      const text = String(s.narration || '').trim();
      const np = text ? narration.indexOf(text, cursor) : -1;
      const from = np >= 0 ? np : cursor;
      const to = np >= 0 ? np + text.length : narration.length;
      if (s.keyword) {
        const kw = String(s.keyword);
        const p = narration.indexOf(kw, from);
        if (p >= from && p + [...kw].length <= to) {
          const at = p;
          const last = Math.min(at + [...kw].length - 1, starts.length - 1);
          keywords.push({
            text: kw,
            at,
            start: Number(starts[at].toFixed(3)),
            spokenEnd: Number(ends[last].toFixed(3)),
          });
        } else warn('02', `keyword「${kw}」不在镜头 ${s.n || ''} 的口播稿内，跳过砸字`);
      }
      if (np >= 0) cursor = to;
    }
    if (keywords.length) log('02', `关键词砸字 ${keywords.length} 个：${keywords.map((k) => k.text).join('、')}`);
  }

  // outro/cover 是 03 的产物（06 对账用）：02 只重算主体，旧值保留不抹
  const tlPrev = fs.existsSync(path.join(task, 'timeline.json'))
    ? (readJson(path.join(task, 'timeline.json')) || {}) : {};
  const timeline = {
    title: shots.title || path.basename(task),
    width: shots.width || 1080,
    height: shots.height || 1920,
    fps: shots.fps || 30,
    audioDuration: Number(audioDur.toFixed(3)),
    duration: Number(totalDur.toFixed(3)),
    tailPad,
    shotCount: shotList.length,
    shots: shotList,
    captions,
    keywords,
    bgm: bgmMeta,
    charStart: starts.map((v) => Number(v.toFixed(3))),
    charEnd: ends.map((v) => Number(v.toFixed(3))),
    ...(tlPrev.outro ? { outro: tlPrev.outro } : {}),
    ...(tlPrev.cover ? { cover: tlPrev.cover } : {}),
  };
  writeJson(path.join(task, 'timeline.json'), timeline);

  log('02', `${shotList.length} 镜 / ${captions.length} 条字幕 / 总时长 ${timeline.duration}s`);
  shotList.forEach((s) => log('02', `   ${s.id} ${s.type.padEnd(10)} ${s.start.toFixed(2)} → ${s.end.toFixed(2)}  (${s.dur}s)`));
}

main();
