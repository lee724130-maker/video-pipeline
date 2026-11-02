// pipeline/lib/srt.cjs —— SRT 字幕生成（P18 改道：剪映工程接力 = 无字幕成片 + 可编辑 SRT 轨）
// 数据源=effective-timeline 的 captions（text/start/end/idx 字下标表），与烧录 ASS 同源不同格式。
'use strict';

const stamp = (sec) => {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = Math.floor(s % 60);
  const ms = Math.round((s - Math.floor(s)) * 1000);
  const mm = ms === 1000 ? 0 : ms, add = ms === 1000 ? 1 : 0;
  const ss2 = ss + add, m2 = m + (ss2 >= 60 ? 1 : 0), s2 = ss2 % 60, h2 = h + (m2 >= 60 ? 1 : 0);
  return `${String(h2).padStart(2, '0')}:${String(m2 % 60).padStart(2, '0')}:${String(s2).padStart(2, '0')},${String(mm).padStart(3, '0')}`;
};

/** captions → SRT 文本（CRLF，剪映/PR/达芬奇通吃） */
function buildSrt(captions) {
  const lines = [];
  (captions || []).forEach((c, i) => {
    const text = String(c.text || '').replace(/\r?\n/g, ' ').trim();
    if (!text) return;
    lines.push(String(lines.length / 4 + 1)); // 序号连续（跳过空条目后重新编号）
    lines.push(`${stamp(c.start)} --> ${stamp(Math.max(c.end, c.start + 0.2))}`);
    lines.push(text);
    lines.push('');
  });
  return lines.join('\r\n');
}

module.exports = { buildSrt, stamp };
