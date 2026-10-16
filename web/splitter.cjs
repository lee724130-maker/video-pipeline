// web/splitter.cjs · 文案 → shots.json（机械分镜，网页一键出片用；复杂稿仍建议按 skills/script.md 手写）
// 规则（确定性，无 AI）：
//   ① 按 句号/问号/叹号/换行 拆句（保留标点，trim 后非空才算）
//   ② 首句 → title（大字=前 12 字，副标=剩余）；末句 → end（title=末句，副标=CTA）；单句稿 = title + end
//   ③ 中间句：含逗号/顿号/分号 → bullet（heading=首分句，items=其余分句，每条 ≤10 字）；否则 → title 型镜
//   ④ keyword 砸字：每镜取 items/title 里最长的词组太牵强——机械分镜不做砸字（keywords 留空）
// 产出 shots.json 结构符合 skills/script.md 二·schema（type 白名单 title/bullet/keyword/transition/end）

const MAX_ITEMS = 5;     // bullet 要点条数上限（竖屏一屏放得下）
const ITEM_MAX = 12;     // 单条要点字数上限（超了截断加省略号）
const TITLE_MAX = 14;    // 大字标题字数上限

function splitSentences(text) {
  return String(text || '')
    .split(/\r?\n/)
    .flatMap((line) => line.split(/(?<=[。！？!?])/))
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
}

function trunc(s, n) {
  const chars = [...s];
  return chars.length > n ? chars.slice(0, n).join('') + '…' : s;
}

function splitter(text, opts = {}) {
  const cta = opts.cta || '点关注 不迷路';
  const sents = splitSentences(text);
  if (!sents.length) return { error: '文案为空（按句号/换行至少拆出 1 句）' };

  const shots = [];
  const last = sents.length - 1;
  sents.forEach((s, i) => {
    const n = i + 1;
    if (sents.length === 1) {
      // 单句：整句当 title 镜（片尾 CTA 由 03 的 outro 关注卡负责，不再补空 end 镜——空 narration 会切出 0s 镜头）
      if (i === 0) shots.push({ n, narration: s, type: 'title', title: trunc(s, TITLE_MAX), subtitle: '' });
      return;
    }
    if (i === 0) {
      const t = trunc(s, TITLE_MAX);
      shots.push({ n, narration: s, type: 'title', title: t, subtitle: [...s].length > TITLE_MAX ? s : '' });
    } else if (i === last) {
      shots.push({ n, narration: s, type: 'end', title: s, subtitle: cta });
    } else if (/[，、；,;]/.test(s)) {
      const parts = s.split(/[，、；,;]/).map((x) => x.trim()).filter(Boolean);
      const heading = trunc(parts[0], 10);
      const items = parts.slice(1, MAX_ITEMS + 1).map((x) => trunc(x, ITEM_MAX));
      if (items.length) shots.push({ n, narration: s, type: 'bullet', heading, items });
      else shots.push({ n, narration: s, type: 'title', title: trunc(s, TITLE_MAX), subtitle: '' });
    } else {
      shots.push({ n, narration: s, type: 'title', title: trunc(s, TITLE_MAX), subtitle: '' });
    }
  });
  return { shots };
}

module.exports = { splitter };
