// 03 · 场景生成：shots.json + timeline.json → scenes/*.html（要点随配音逐条出现）
const fs = require('fs');
const path = require('path');
const { ROOT, readJson, writeJson, ensureDir, log, warn, fail, loadConfig, bgImages } = require('./lib/common.cjs');

const cfg = loadConfig();

const TYPES = ['title', 'bullet', 'keyword', 'transition', 'end'];
const WEIGHT_OK = /[一-鿿㐀-䶿0-9a-zA-Z]/;

const css = fs.readFileSync(path.join(ROOT, 'templates/base.css'), 'utf8');
const deckCss = fs.readFileSync(path.join(ROOT, 'templates/deck.css'), 'utf8');
const runtime = fs.readFileSync(path.join(ROOT, 'templates/runtime.js'), 'utf8');

function hi(text) {
  // **关键词** → 强调色 span
  return String(text || '').replace(/\*\*(.+?)\*\*/g, '<span class="hi">$1</span>');
}
function esc(text) {
  return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function fill(html, tokens) {
  let out = html.replace('/*__CSS__*/', () => css);
  out = out.replace(/{{(\w+)}}/g, (m, k) => (tokens[k] !== undefined ? tokens[k] : m));
  return out;
}

// —— deck 演示风（P2-9）——
// deck.css 注入到 base.css 之后（同文档后写覆盖先写），classic 任务不注入零回归。
function applyDeck(html) {
  return html.replace('</head>', () => `<style>${deckCss}</style>\n</head>`);
}
// 标签行（title/end 的 tags 数组 → 按钮行）；缺省空串，base.css 里 .tags 隐藏
function tagRow(tags) {
  if (tags === undefined || tags === null || (Array.isArray(tags) && !tags.length)) return '';
  if (!Array.isArray(tags)) fail('tags 必须是字符串数组（skills/script.md 二·schema）');
  return tags.map((t) => {
    if (typeof t !== 'string' || !t.trim()) fail('tags 每项必须是非空字符串');
    return `<span>${hi(esc(t.trim()))}</span>`;
  }).join('');
}
// 引用行（bullet 的 quote → 青色「」引用；缺省空串不占版位）
function quoteText(q) {
  if (!q) return '';
  const s = String(q);
  return s.startsWith('「') ? hi(esc(s)) : `「${hi(esc(s))}」`;
}
// 章节导航条 label：shots.nav 显式指定 > 类型约定（开场/收尾）> bullet 取 heading 去掉「第N部分 ·」前缀
function navLabel(s, src) {
  if (src.nav) return String(src.nav);
  if (s.type === 'title') return '开场';
  if (s.type === 'end') return '收尾';
  const h = String(src.heading || '').replace(/^第[^·]{1,6}[·・]\s*/, '');
  if (h) return h;
  if (src.keyword) return String(src.keyword);
  return String(src.title || '场景');
}

// —— 尺寸自适应（P2-7）——
// --k = 短边/1080：标准三画幅（1080×1920 / 1920×1080 / 1080×1080）k=1，像素值=设计稿；
// 720p 等小画幅按比例缩小。竖向安全区按 高/1920 缩放（竖屏 180/180 不变；横屏/方形 ≈101px，
// 避免 180px 在 1080 高画幅里吃掉 1/3 版面）。
function sizeVars(timeline) {
  const w = Number(timeline.width) || 1080;
  const h = Number(timeline.height) || 1920;
  const k = Math.min(w, h) / 1080;
  const safe = Math.round(180 * (h / 1920));
  return `<style>:root{--k:${Number(k.toFixed(4))};--safe-top:${safe}px;--safe-bottom:${safe}px}</style>`;
}
function applySize(html, timeline) {
  return html.replace('</head>', () => `${sizeVars(timeline)}\n</head>`);
}

// —— 用户素材背景（assets/bg-NN.jpg|png|webp，方案 A 轮播 + 方案 C Ken Burns）——
// bgImages 见 lib/common.cjs；文件不存在 → 无背景层（纯代码渐变，行为同旧版）
function bgLayer(bgs, index, durSec) {
  if (!bgs.length) return '';
  const bgCfg = cfg.background || {};
  const file = bgs[index % bgs.length];
  const kb = bgCfg.kenBurns === false || !durSec ? '' : ` kb-${index % 2 ? 'out' : 'in'}`;
  const vars = `--scrim-a:${bgCfg.scrim ?? 0.5};--kb-zoom:${bgCfg.zoom ?? 1.06};--kb-dur:${Number(durSec).toFixed(2)}s`;
  return `<div class="bg-user${kb}" style="${vars};background-image:url('../assets/${file}')"></div>`;
}

function itemTime(shot, timeline, itemText, i, n) {
  // 用该镜头口播原文建立可检索串（只保留有效字），保留到原文的索引映射
  const narration = shot.narrationRaw || '';
  const nChars = [...narration];
  const map = [];
  let hay = '';
  nChars.forEach((ch, k) => {
    if (WEIGHT_OK.test(ch)) { hay += ch; map.push(k); }
  });
  const needle = [...String(itemText || '')].filter((c) => WEIGHT_OK.test(c)).join('');
  let at = null;
  if (needle && hay.includes(needle)) {
    const pos = hay.indexOf(needle);
    const local = map[pos];
    const abs = shot.charStart + local;
    if (abs < timeline.charStart.length) at = timeline.charStart[abs] - 0.12;
  }
  if (at === null) {
    // 对不上口播词 → 均匀分布（镜头开场 0.5s 后，结束前留 0.5s）；
    // 注意 at 必须换算成【绝对时间轴】——下面 rel = at - shot.start，写成相对值会被减成负数全挤到 0.08s
    const span = Math.max(0.6, shot.dur - 1.0);
    at = shot.start + 0.5 + (n <= 1 ? 0 : (i * span) / (n - 1));
  }
  const rel = at - shot.start;
  return Math.max(0.08, Math.min(rel, shot.dur - 0.35)).toFixed(2);
}

function tokensFor(shot, timeline, all, src) {
  const corner = `${String(shot.index + 1).padStart(2, '0')} / ${String(all.length).padStart(2, '0')}`;
  const subAt = Math.min(1.0, shot.dur * 0.3).toFixed(2);
  switch (shot.type) {
    case 'title':
      return {
        KICKER: esc(src.kicker || 'AI VIDEO'),
        TITLE: hi(esc(src.title || timeline.title)),
        SUBTITLE: esc(src.subtitle || ''),
        SUB_AT: subAt,
        TAGS: tagRow(src.tags),
      };
    case 'bullet': {
      const list = src.items || [];
      const items = list.map((t, i) => {
        if (t && typeof t === 'object' && !String(t.t || '').trim()) {
          fail(`镜头 ${shot.id} items[${i}] 是对象但缺 t（标题字段）`);
        }
        const needle = typeof t === 'object' ? t.t : t; // 双行卡片 {t,d} 按标题行对齐口播
        const at = itemTime(shot, timeline, needle, i, list.length);
        const inner = typeof t === 'object'
          ? `<div class="it-b"><b>${hi(esc(t.t))}</b>${t.d ? `<i>${esc(t.d)}</i>` : ''}</div>`
          : hi(esc(t));
        return `      <li data-at="${at}">${inner}</li>`;
      });
      return {
        CORNER: corner,
        HEADING: hi(esc(src.heading || '')),
        QUOTE: quoteText(src.quote),
        ITEMS_CLS: `items-${list.length}`,
        ITEMS: items.join('\n'),
      };
    }
    case 'keyword':
      return {
        KICKER: esc(src.kicker || 'KEY POINT'),
        KEYWORD: esc(src.keyword || ''),
        NOTE: esc(src.note || ''),
        NOTE_AT: Math.min(1.2, shot.dur * 0.35).toFixed(2),
      };
    case 'transition':
      return {
        INDEX: esc(src.index || String(shot.index + 1).padStart(2, '0')),
        HEADING: hi(esc(src.heading || '')),
      };
    case 'end':
      return {
        KICKER: esc(src.kicker || 'FOLLOW'),
        TITLE: hi(esc(src.title || '')),
        SUBTITLE: esc(src.subtitle || ''),
        SUB_AT: subAt,
        TAGS: tagRow(src.tags),
      };
    default:
      fail(`未知场景类型 ${shot.type}（白名单见 skills/script.md）`);
  }
}

function main() {
  const task = path.resolve(process.argv[2] || fail('用法: node pipeline/03-scenes.cjs <任务目录>'));
  const shots = readJson(path.join(task, 'shots.json'));
  const timeline = readJson(path.join(task, 'timeline.json'));
  if (!shots || !timeline) fail('缺 shots.json / timeline.json');

  // 场景风格（P2-9）：classic（缺省，经典暗底网格风）/ deck（演示风：暗蓝+青、章节卡片、底部导航条）；
  // 白名单 fail——非法值静默回落会让「以为出的是演示风」出成经典风
  const SCENE_STYLES = ['classic', 'deck'];
  const sceneStyle = String(shots.sceneStyle || cfg.sceneStyle || 'classic');
  if (!SCENE_STYLES.includes(sceneStyle)) fail(`场景风格非法: ${sceneStyle}（白名单: ${SCENE_STYLES.join(' / ')}）`);
  const deck = sceneStyle === 'deck';
  // 字幕烧录开关（P2-9 复刻样片无烧录字幕）：shots.captions === false → 05 不烧 ASS、06 相应跳过
  const capOff = shots.captions === false;
  timeline.sceneStyle = sceneStyle;
  timeline.captionsOff = capOff;
  if (deck) log('03', '场景风格 deck（演示风）：暗蓝底青点缀 · 章节卡片网格 · 底部章节导航条');
  if (capOff) log('03', '字幕烧录关闭（shots.captions:false）：成片 = 纯画面 + 旁白');

  // 章节导航条（deck 专用）：每镜一格，label 见 navLabel()，active = 当前镜
  const navLabels = deck ? timeline.shots.map((s) =>
    esc(navLabel(s, shots.shots[s.index] || {}))) : [];
  const navHtml = (activeIdx) => (deck
    ? `<nav class="chapnav">${navLabels.map((t, i) => `<span${i === activeIdx ? ' class="on"' : ''}>${t}</span>`).join('')}</nav>\n  `
    : '');

  const narration = fs.readFileSync(path.join(task, 'narration.txt'), 'utf8');
  const nChars = [...narration];
  timeline.narration = nChars.join('');

  const outDir = ensureDir(path.join(task, 'scenes'));
  const bgs = bgImages(task);
  if (bgs.length) log('03', `素材背景 ${bgs.length} 张（assets/bg-NN）：镜头序号轮播 + Ken Burns 缓推${(cfg.background || {}).kenBurns === false ? '（动画已关）' : ''}`);
  let made = 0, assetSkip = 0;
  timeline.shots.forEach((shot, activeIdx) => {
    if (shot.asset) { assetSkip++; return; } // 素材镜头：画面来自 assets/，不生成场景 HTML
    if (!TYPES.includes(shot.type)) fail(`镜头 ${shot.id} 类型非法: ${shot.type}`);
    const tplPath = path.join(ROOT, 'templates/scenes', `${shot.type}.html`);
    if (!fs.existsSync(tplPath)) fail(`缺模板 templates/scenes/${shot.type}.html`);
    const src = shots.shots[shot.index] || {};
    // 内容校验：类型与必填字段对不上就 fail——空模板渲出来是「怪片」，宁可早报错
    const miss = (
      (shot.type === 'bullet' && !(src.items || []).length) ? 'items（要点列表）' :
      (shot.type === 'keyword' && !src.keyword) ? 'keyword（大字关键词）' :
      (shot.type === 'end' && !src.title) ? 'title（收尾金句）' : null);
    if (miss) fail(`镜头 ${shot.id} 类型 ${shot.type} 缺必填字段 ${miss}（skills/script.md 二·schema）`);
    const tpl = fs.readFileSync(tplPath, 'utf8');
    const tokens = tokensFor({ ...shot, narrationRaw: nChars.slice(shot.charStart, shot.charEnd).join('') }, timeline, timeline.shots, src);

    let html = fill(tpl, tokens);
    html = applySize(html, timeline);
    if (deck) html = applyDeck(html);
    // stage 带类型 class（s-title/s-bullet/…）：deck.css 按页型分版式；classic 下无对应规则零影响
    html = html.replace('<div class="stage">', () => `<div class="stage s-${shot.type}">`);
    const layer = bgLayer(bgs, shot.index, shot.dur);
    if (layer) html = html.replace(/<div class="stage[^"]*">/, (m) => `${m}\n    ${layer}`);
    const sceneData = JSON.stringify({ duration: shot.dur, fps: timeline.fps, id: shot.id });
    const inject = navHtml(activeIdx) + `<script>window.__SCENE__ = ${sceneData};</script>\n  <script>${runtime}</script>`;
    if (!html.includes('<!--__RUNTIME__-->')) fail(`模板 ${shot.type}.html 缺 <!--__RUNTIME__--> 占位`);
    html = html.replace('<!--__RUNTIME__-->', () => inject);

    fs.writeFileSync(path.join(outDir, `${shot.id}.html`), html, 'utf8');
    made++;
  });
  log('03', `生成 ${made} 个场景 HTML → scenes/${assetSkip ? `（素材镜头 ${assetSkip} 个直接用素材）` : ''}`);
  if (timeline.shots.some((s) => s.type === 'bullet')) log('03', '（bullet 要点出现时刻已按口播词对齐）');

  // ② 片尾关注卡（outro）：end 模板独立生成 → 04 录制 segments/outro.mp4 → 05 拼到成片尾部
  const outroCfg = cfg.outro || {};
  if (outroCfg.enabled !== false) {
    const dur = Number(outroCfg.durSec || 2.6);
    const tokens = {
      KICKER: esc(outroCfg.kicker || 'FOLLOW'),
      TITLE: hi(esc(outroCfg.title || '点关注 不迷路')),
      SUBTITLE: esc(outroCfg.subtitle || ''),
      SUB_AT: (dur * 0.22).toFixed(2),
      TAGS: '',
    };
    let html = applySize(fill(fs.readFileSync(path.join(ROOT, 'templates/scenes/end.html'), 'utf8'), tokens), timeline);
    if (deck) html = applyDeck(html);
    html = html.replace('<div class="stage">', () => '<div class="stage s-end">');
    const inject = navHtml(timeline.shots.length - 1) + `<script>window.__SCENE__ = ${JSON.stringify({ duration: dur, fps: timeline.fps, id: 'outro' })};</script>\n  <script>${runtime}</script>`;
    html = html.replace('<!--__RUNTIME__-->', () => inject);
    fs.writeFileSync(path.join(outDir, 'outro.html'), html, 'utf8');
    timeline.outro = { durSec: dur };
    log('03', `片尾关注卡 outro.html（${dur}s，config.outro 可改文案/关闭）`);
  }

  // ③ 封面版式（cover）：静态大字排版 → 04 录制抽帧出 封面.png（发布用独立图，不进成片）
  const coverCfg = cfg.cover || {};
  if (coverCfg.enabled !== false) {
    const firstLine = (narration.split(/[。！？!?\n]/).map((s) => s.trim()).filter(Boolean)[0] || '').slice(0, 26);
    // 风格（P2-8）：任务级 shots.coverStyle 优先 > 全局 config.cover.style > 默认 tech；
    // 白名单校验——非法风格 fail（错风格渲出来只是「不好看」，但静默兜底会掩盖拼写错误）
    const COVER_STYLES = ['tech', 'bold', 'magazine'];
    const style = String(shots.coverStyle || coverCfg.style || 'tech');
    if (!COVER_STYLES.includes(style)) fail(`封面风格非法: ${style}（白名单: ${COVER_STYLES.join(' / ')}）`);
    const tokens = {
      STYLE_CLASS: style === 'tech' ? '' : ` cover-${style}`, // tech 是模板缺省样式，不加 class
      KICKER: esc(coverCfg.kicker || 'AI VIDEO'),
      TITLE: hi(esc(coverCfg.title || timeline.title)),
      SUBTITLE: esc(coverCfg.subtitle || firstLine),
      FOOT: esc(coverCfg.foot || 'AI 剪辑流水线'),
    };
    let html = applySize(fill(fs.readFileSync(path.join(ROOT, 'templates/cover.html'), 'utf8'), tokens), timeline);
    if (!tokens.SUBTITLE) html = html.replace(/\s*<p class="sub"><\/p>/, '');
    const covLayer = bgLayer(bgs, 0, null); // 封面取第一张、静态（抽帧要稳定画面）
    // 风格 class 会改 stage 的 class 值，按前缀匹配插入
    if (covLayer) html = html.replace(/<div class="stage[^"]*">/, (m) => `${m}\n    ${covLayer}`);
    // duration 给超大值：runtime 到 duration-0.15 才淡出，封面录帧窗口内保持常亮
    const inject = `<script>window.__SCENE__ = ${JSON.stringify({ duration: 99999, fps: timeline.fps, id: 'cover' })};</script>\n  <script>${runtime}</script>`;
    html = html.replace('<!--__RUNTIME__-->', () => inject);
    fs.writeFileSync(path.join(outDir, 'cover.html'), html, 'utf8');
    timeline.cover = true;
    log('03', `封面版式 cover.html（风格 ${style}，标题「${tokens.TITLE}」，shots.coverStyle / config.cover.style 可改）`);
  }

  // 持久化：04/05/06 按 timeline.outro/cover 对账产物；
  // sceneStyle/captionsOff 也必须落盘（05 决定转场与字幕烧录、06 决定核验项）
  writeJson(path.join(task, 'timeline.json'), timeline);
}

main();
