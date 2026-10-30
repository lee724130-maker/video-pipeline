'use strict';
// pipeline/lib/edit-doc.cjs —— P12 重剪数据契约（edit.json v1）：校验 + 推导（server 08 与 API 单一出处）
// 设计（ROADMAP P12 已定案）：clip = 源 timeline 上的秒级窗口 {in,out}，音画字幕共用一个窗口（同裁不漂）；
// 目标时间轴由推导算出（xfade 交叉吃掉 transition.dur），shots.json 永不回写（脱钩导出）。
// 字幕 A 案：charStart/charEnd 字下标裁剪 + 跨 clip 同镜相邻行自动合并（切分点无句末标点时重缝一行）。
const fail = (m) => { throw new Error(m); };

const TRANS_TYPES = ['cut', 'fade'];
const r3 = (x) => Number(x.toFixed(3));

/** 校验并规整；抛 Error=校验失败（调用方负责转 400/exit） */
function validateEdit(timeline, doc) {
  if (!doc || typeof doc !== 'object') fail('edit 不是对象');
  if (doc.version !== 1) fail(`edit.version 须为 1（现 ${doc.version}）`);
  if (doc.fps !== timeline.fps) fail(`edit.fps ${doc.fps} 与 timeline ${timeline.fps} 不一致`);
  if (doc.width !== timeline.width || doc.height !== timeline.height) fail('edit 画幅与 timeline 不一致');
  const srcDur = timeline.duration;
  const clips = doc.clips;
  if (!Array.isArray(clips) || clips.length < 1 || clips.length > 80) fail(`clips 须为 1~80 个（现 ${Array.isArray(clips) ? clips.length : '非数组'}）`);
  const seen = new Set();
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i], at = `clip ${i + 1}`;
    if (!c || typeof c !== 'object') fail(`${at} 不是对象`);
    if (typeof c.id !== 'string' || !/^[A-Za-z][\w-]{0,19}$/.test(c.id)) fail(`${at} id 须为字母开头的短串（[A-Za-z] 开头，≤20 字符，可含 _ -）`);
    if (seen.has(c.id)) fail(`${at} id 重复：${c.id}`);
    seen.add(c.id);
    if (!Number.isInteger(c.seg) || c.seg < 0 || c.seg >= timeline.shots.length) fail(`${at} seg 下标越界：${c.seg}（源共 ${timeline.shots.length} 镜）`);
    const s = timeline.shots[c.seg];
    const inSec = Number(c.in), outSec = Number(c.out);
    if (!Number.isFinite(inSec) || !Number.isFinite(outSec)) fail(`${at} in/out 须为数`);
    const lo = s.start;
    const winEnd = s.end + 0.05; // 允许 50ms 舍入余量
    if (inSec < lo - 0.05 || outSec > winEnd + 0.05 || outSec - inSec < 0.1) fail(`${at} 窗口 [${inSec}, ${outSec}] 越出镜头 ${s.id} 的 [${lo}, ${s.end}]（最短线 0.1s）`);
    const cs = c.charStart, ce = c.charEnd;
    // clip 字符窗口为闭区间 [charStart, charEnd]；02 的 shot.charEnd 是开区间（=下镜起点），导入时已 -1 规整
    const srcLast = timeline.shots[timeline.shots.length - 1].charEnd - 1;
    if (!Number.isInteger(cs) || !Number.isInteger(ce) || cs > ce || cs < s.charStart || ce > Math.max(s.charStart, s.charEnd - 1) || ce > srcLast) {
      fail(`${at} charStart/charEnd 闭区间 [${cs}, ${ce}] 越出镜头 ${s.id} 的字符窗 [${s.charStart}, ${s.charEnd - 1}]`);
    }
    const tr = c.transition || { type: 'cut', dur: 0 };
    if (!TRANS_TYPES.includes(tr.type)) fail(`${at} transition.type 非法: ${tr.type}（白名单 ${TRANS_TYPES.join('/')}）`);
    const td = Number(tr.dur || 0);
    if (!Number.isFinite(td) || td < 0 || td > 2) fail(`${at} transition.dur 须在 0~2s：${tr.dur}`);
    if (tr.type === 'fade' && td > 0 && i > 0) {
      const prev = clips[i - 1], prevLast = prev.in + (prev.out - prev.in); // 前段尾片 = in + dur
      const prevDur = prev.out - prev.in, selfDur = outSec - inSec;
      if (td >= prevDur * 0.8 || td >= selfDur * 0.8) fail(`${at} 转场 ${td}s 过长（相邻 clip 最短仅 ${Math.min(prevDur, selfDur).toFixed(2)}s，钳到 0.8 倍以下）`);
    }
    if (c.src === 'asset') { if (typeof c.asset !== 'string' || !c.asset) fail(`${at} src=asset 必须有 asset 文件名`); }
    else if (c.src !== undefined && c.src !== 'segment') fail(`${at} src 非法: ${c.src}（v1 仅 segment）`);
  }
  return doc;
}

/** 从 timeline 生成初始 edit（一镜一 clip，全窗口） */
function importFromTimeline(timeline) {
  return {
    version: 1,
    fromTimelineAt: new Date().toISOString(),
    fps: timeline.fps, width: timeline.width, height: timeline.height,
    clips: timeline.shots.map((s, i) => ({
      id: 'c' + (i + 1), seg: i, src: 'segment',
      in: r3(s.start), out: r3(s.end),
      charStart: s.charStart, charEnd: s.charEnd - 1, // 开区间 → 闭区间
      transition: { type: 'cut', dur: 0 }, // 导入态=硬切（等价原片）
    })),
  };
}

/**
 * 推导渲染所需一切：目标时间轴位置、每 clip 的派生 shot、按窗口切/合并后的字幕行、砸字表、总时长。
 * 纯函数不抛业务错（先过 validateEdit）。withOutro={durSec}|null。
 */
function deriveEditTimeline(timeline, doc, withOutro) {
  const isSplit = (ch) => /[。！？…!?]/.test(ch);
  const srcCaptions = timeline.captions || [];
  const clips = doc.clips;
  // ① 目标时间轴：start[i+1] = start[i] + dur[i] - tr(i+1).dur（xfade 交叉区）
  const D = [];
  let cursor = 0;
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i], dur = c.out - c.in;
    const tr = i === 0 ? { type: 'cut', dur: 0 } : (c.transition || { type: 'cut', dur: 0 });
    const seg = timeline.shots[c.seg];
    D.push({
      clip: c, dur: r3(dur), tr,
      start: r3(cursor - tr.dur), end: r3(cursor + dur),
      shot: { id: c.id, type: seg.type, index: i, start: r3(cursor - tr.dur), end: r3(cursor + dur), dur: r3(dur), charStart: c.charStart, charEnd: c.charEnd, ...(seg.asset ? { asset: seg.asset } : {}) },
    });
    cursor += dur - tr.dur;
  }
  const bodyDur = cursor;
  const outroDur = withOutro ? Number(withOutro.durSec || 2.6) : 0;
  const duration = r3(bodyDur + outroDur);
  // ② 字幕切窗 + 跨 clip 重缝：每 clip 对源字幕行按字下标窗口取子段（绝对时刻平移 shift）；
  // 上一 clip 的尾行与下一 clip 的首行若出自同一源行、字下标恰好衔接（切点在源行内部）、且接缝两侧都不是句末标点
  // → 合并为一条（用户把一行字幕从中间剪开还保持一行显示）。显示顺延规则与 02 同式（下一条 <1.5s 则贴到其前 40ms）。
  const outCaps = [];
  let carry = null; // {line, origin}：上一 clip 的尾行，可能被下一 clip 首行吞并
  for (const d of D) {
    const { clip } = d;
    const shift = d.start - clip.in;
    let lines = [];
    for (const cap of srcCaptions) {
      const idx = cap.idx || [];
      const charsIn = [];
      for (let j = 0; j < idx.length; j++) if (idx[j] >= clip.charStart && idx[j] <= clip.charEnd) charsIn.push({ ci: idx[j], j });
      if (!charsIn.length) continue;
      const j0 = charsIn[0].j, j1 = charsIn[charsIn.length - 1].j;
      const text = [...cap.text].slice(j0, j1 + 1).join('');
      if (!text.trim()) continue;
      const idxs = charsIn.map((x) => x.ci);
      lines.push({
        text, idx: idxs, origin: cap,
        start: r3(Math.max(0, timeline.charStart[idxs[0]] + shift)),
        end: r3(timeline.charEnd[idxs[idxs.length - 1]] + shift),
      });
    }
    // 吞并上一 clip 的尾行（断点只看左片尾字——右片可能恰好带着句号「。」）
    if (carry && lines.length && carry.origin === lines[0].origin
      && carry.line.idx[carry.line.idx.length - 1] + 1 === lines[0].idx[0]
      && !isSplit([...carry.line.text].pop() || '。')) {
      const m = carry.line;
      m.text += lines[0].text;
      m.idx = m.idx.concat(lines[0].idx);
      m.end = Math.max(m.end, lines[0].end);
      lines[0] = m;
      carry = null;
    } else if (carry) {
      outCaps.push(carry.line);
      carry = null;
    }
    if (lines.length) {
      const last = lines.pop();
      // 尾行是否待续：本 clip 的 charEnd 恰好是下一 clip 的 charStart（连续窗口）且尾行未吃到源行末尾
      const nextClip = D[D.indexOf(d) + 1];
      const continues = nextClip && nextClip.clip.charStart === clip.charEnd + 1 && last.idx[last.idx.length - 1] + 1 === last.origin.idx[last.origin.idx.length - 1];
      for (const l of lines) outCaps.push(l);
      if (continues) carry = { line: last, origin: last.origin };
      else outCaps.push(last);
    }
  }
  if (carry) outCaps.push(carry.line);
  for (const cap of outCaps) delete cap.origin;
  outCaps.sort((a, b) => a.start - b.start);
  // 显示顺延（02 同式）：下一条在 1.5s 内出现则贴到其前 40ms；末条尾随 0.6s（outro 前收口即可，05 的 -t 会裁）
  for (let i = 0; i < outCaps.length; i++) {
    const nx = outCaps[i + 1];
    if (nx && nx.start - outCaps[i].end < 1.5) outCaps[i].end = Math.max(outCaps[i].end, nx.start - 0.04);
    else if (!nx) outCaps[i].end = r3(outCaps[i].end + 0.6);
  }
  // ③ 砸字：完全落在 clip 字符窗口内的保留并平移；跨窗口的丢弃
  const outKw = [];
  for (const d of D) {
    const shift = d.start - d.clip.in;
    for (const kw of timeline.keywords || []) {
      const kwEnd = kw.at + [...kw.text].length;
      if (kw.at >= d.clip.charStart && kwEnd <= d.clip.charEnd + 1) {
        outKw.push({ ...kw, start: r3(Math.max(0, kw.start + shift)), spokenEnd: r3(Math.max(0, kw.spokenEnd + shift)) });
      }
    }
  }
  return {
    title: timeline.title + '（精修）', width: timeline.width, height: timeline.height, fps: doc.fps,
    audioDuration: r3(bodyDur), duration, tailPad: timeline.tailPad,
    outro: outroDur ? { durSec: Number(outroDur) } : null,
    outroInDuration: !!outroDur,
    shotCount: D.length, shots: D.map((d) => d.shot),
    captions: outCaps.map(({ text, start, end, idx }) => ({ text, start, end, idx })),
    keywords: outKw, bgm: timeline.bgm || null,
    charStart: timeline.charStart, charEnd: timeline.charEnd,
    captionsOff: timeline.captionsOff === true ? true : undefined,
    bodyDuration: r3(bodyDur),
    positions: D.map((d) => ({ id: d.shot.id, start: d.start, dur: d.dur, tr: d.tr })),
  };
}

module.exports = { validateEdit, importFromTimeline, deriveEditTimeline, TRANS_TYPES };
