// 03 · 场景生成：shots.json + timeline.json → scenes/*.html（要点随配音逐条出现）
const fs = require('fs');
const path = require('path');
const { ROOT, readJson, writeJson, ensureDir, log, warn, fail, loadConfig } = require('./lib/common.cjs');

const cfg = loadConfig();

const TYPES = ['title', 'bullet', 'keyword', 'transition', 'end'];
const WEIGHT_OK = /[一-鿿㐀-䶿0-9a-zA-Z]/;

const css = fs.readFileSync(path.join(ROOT, 'templates/base.css'), 'utf8');
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
    // 对不上口播词 → 均匀分布（开场 0.5s 后，结束前留 0.5s）
    const span = Math.max(0.6, shot.dur - 1.0);
    at = 0.5 + (n <= 1 ? 0 : (i * span) / (n - 1));
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
      };
    case 'bullet': {
      const items = (src.items || []).map((t, i) =>
        `      <li data-at="${itemTime(shot, timeline, t, i, (src.items || []).length)}">${hi(esc(t))}</li>`);
      return {
        CORNER: corner,
        HEADING: hi(esc(src.heading || '')),
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

  const narration = fs.readFileSync(path.join(task, 'narration.txt'), 'utf8');
  const nChars = [...narration];
  timeline.narration = nChars.join('');

  const outDir = ensureDir(path.join(task, 'scenes'));
  let made = 0, assetSkip = 0;
  timeline.shots.forEach((shot) => {
    if (shot.asset) { assetSkip++; return; } // 素材镜头：画面来自 assets/，不生成场景 HTML
    if (!TYPES.includes(shot.type)) fail(`镜头 ${shot.id} 类型非法: ${shot.type}`);
    const tplPath = path.join(ROOT, 'templates/scenes', `${shot.type}.html`);
    if (!fs.existsSync(tplPath)) fail(`缺模板 templates/scenes/${shot.type}.html`);
    const src = shots.shots[shot.index] || {};
    const tpl = fs.readFileSync(tplPath, 'utf8');
    const tokens = tokensFor({ ...shot, narrationRaw: nChars.slice(shot.charStart, shot.charEnd).join('') }, timeline, timeline.shots, src);

    let html = fill(tpl, tokens);
    const sceneData = JSON.stringify({ duration: shot.dur, fps: timeline.fps, id: shot.id });
    const inject = `<script>window.__SCENE__ = ${sceneData};</script>\n  <script>${runtime}</script>`;
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
    };
    let html = fill(fs.readFileSync(path.join(ROOT, 'templates/scenes/end.html'), 'utf8'), tokens);
    const inject = `<script>window.__SCENE__ = ${JSON.stringify({ duration: dur, fps: timeline.fps, id: 'outro' })};</script>\n  <script>${runtime}</script>`;
    html = html.replace('<!--__RUNTIME__-->', () => inject);
    fs.writeFileSync(path.join(outDir, 'outro.html'), html, 'utf8');
    timeline.outro = { durSec: dur };
    log('03', `片尾关注卡 outro.html（${dur}s，config.outro 可改文案/关闭）`);
  }

  // ③ 封面版式（cover）：静态大字排版 → 04 录制抽帧出 封面.png（发布用独立图，不进成片）
  const coverCfg = cfg.cover || {};
  if (coverCfg.enabled !== false) {
    const firstLine = (narration.split(/[。！？!?\n]/).map((s) => s.trim()).filter(Boolean)[0] || '').slice(0, 26);
    const tokens = {
      KICKER: esc(coverCfg.kicker || 'AI VIDEO'),
      TITLE: hi(esc(coverCfg.title || timeline.title)),
      SUBTITLE: esc(coverCfg.subtitle || firstLine),
      FOOT: esc(coverCfg.foot || 'AI 剪辑流水线'),
    };
    let html = fill(fs.readFileSync(path.join(ROOT, 'templates/cover.html'), 'utf8'), tokens);
    if (!tokens.SUBTITLE) html = html.replace(/\s*<p class="sub"><\/p>/, '');
    // duration 给超大值：runtime 到 duration-0.15 才淡出，封面录帧窗口内保持常亮
    const inject = `<script>window.__SCENE__ = ${JSON.stringify({ duration: 99999, fps: timeline.fps, id: 'cover' })};</script>\n  <script>${runtime}</script>`;
    html = html.replace('<!--__RUNTIME__-->', () => inject);
    fs.writeFileSync(path.join(outDir, 'cover.html'), html, 'utf8');
    timeline.cover = true;
    log('03', `封面版式 cover.html（标题「${tokens.TITLE}」，config.cover 可覆盖）`);
  }

  // 持久化：04/05/06 按 timeline.outro/cover 对账产物
  if (timeline.outro || timeline.cover) writeJson(path.join(task, 'timeline.json'), timeline);
}

main();
