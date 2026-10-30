// pipeline/lib/ass-builder.cjs —— ASS 字幕引擎（P12-A 从 05 拆件：05 与 08 共用，禁两处各写一份）
// 唯一改动：cfg.compose 由入参 cc 注入（05 传 loadConfig().compose、08 同源）；构建逻辑逐字节未动，
// 冒烟 p12 用真任务 timeline 对拆件前后输出做等值断言
const { warn } = require('./common.cjs');

function assTime(sec) {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const cs = Math.round((s - Math.floor(s)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

// #RRGGBB → ASS 行内覆盖色（枚举条目色标 P10）：ASS 是 BGR 序 → &H00BBGGRR
function assColour(hex) {
  const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(String(hex));
  if (!m) return '';
  return `&H00${m[3]}${m[2]}${m[1]}`.toUpperCase();
}

function buildAss(timeline, cc) {
  const c = cc || {};
  const karaoke = c.karaoke !== false; // 默认开：逐字高亮（实测 libass：Secondary=起始色，Primary=随进度填充色）
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\{/g, '(').replace(/\}/g, ')');
  const subColour = karaoke ? (c.karaokeDimColour || '&H00606060') : '&H00FFFFFF';
  // 尺寸自适应（P2-7）：字号按 短边/1080 缩放（三标准画幅 k=1 不变），竖向边距按 高/1920 缩放
  // （竖屏 1080×1920：56/320/130 原值；横屏/方形 marginV 320→180，避免贴底或顶出画面）
  const k = Math.min(timeline.width, timeline.height) / 1080;
  const kv = (timeline.height || 1920) / 1920;
  // 平台 profile 覆盖（config.platforms.*.captionSize/captionMarginV 经 02 落 timeline）→ 缺省走 config
  const capSizeSrc = timeline.captionSize != null ? Number(timeline.captionSize) : (c.captionSize || 56);
  const capMarginVSrc = timeline.captionMarginV != null ? Number(timeline.captionMarginV) : (c.captionMarginV || 320);
  const capSize = Math.max(24, Math.round(capSizeSrc * k));
  const capMarginV = Math.max(40, Math.round(capMarginVSrc * kv));
  // 字幕样式（P5-3）：outline 缺省 = 白字深描边；bar = 抖音风黑底实底条（BorderStyle=3，
  // libass 盒是直角——ASS 不支持圆角；Outline 转盒内边距、BackColour 实黑保任意底可读）。
  // 白名单 fail——静默兜底会掩盖拼写错误（写 bar2 渲成描边还以为条没生效）
  const CAP_STYLES = ['outline', 'bar'];
  const capStyle = String(c.captionStyle || 'outline');
  if (!CAP_STYLES.includes(capStyle)) fail(`字幕样式非法: ${capStyle}（白名单: ${CAP_STYLES.join(' / ')}）`);
  if (capStyle === 'bar') log('05', '字幕样式 bar：黑底实底条（compose.captionStyle）');
  // 关键词砸字样式：粗体大号金字，居中偏上（避开底部字幕），仅在有 keyword 时挂上
  const kwStyle = (timeline.keywords && timeline.keywords.length)
    ? `\nStyle: Kw,${c.captionFont},${Math.max(48, Math.round(Number(c.keywordSize || 130) * k))},${c.keywordColour || '&H0000D7FF'},&H00FFFFFF,&H00141414,&H96000000,-1,0,0,0,100,100,1,0,1,6,0,5,90,90,0,1`
    : '';
  const subStyle = capStyle === 'bar'
    ? `Style: Sub,${c.captionFont},${capSize},&H00FFFFFF,${subColour},&H00141414,&H00000000,0,0,0,0,100,100,0.5,0,3,${Math.max(8, Math.round(capSize * 0.3))},0,2,90,90,${capMarginV},1`
    : `Style: Sub,${c.captionFont},${capSize},&H00FFFFFF,${subColour},&H00141414,&H96000000,0,0,0,0,100,100,0.5,0,1,3,1,2,90,90,${capMarginV},1`;
  const header = `[Script Info]
Title: ${timeline.title}
ScriptType: v4.00+
PlayResX: ${timeline.width}
PlayResY: ${timeline.height}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${subStyle}${kwStyle}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const events = timeline.captions.map((cap) => {
    let body = esc(cap.text);
    // 卡拉OK：按 02 算出的逐字时间生成 {\k厘秒} 标签，颜色随朗读进度扫过
    if (karaoke && Array.isArray(cap.idx) && Array.isArray(timeline.charStart)) {
      const chars = [...cap.text];
      if (chars.length === cap.idx.length) {
        body = cap.idx.map((ci, k) => {
          const s = timeline.charStart[ci], e = timeline.charEnd[ci];
          const cs = Math.max(1, Math.round(((e ?? s) - s) * 100));
          return `{\\k${cs}}${esc(chars[k])}`;
        }).join('');
      } else {
        warn('05', `字幕「${cap.text.slice(0, 8)}…」idx 与文本不对齐，该条退回普通字幕`);
      }
    }
    return `Dialogue: 0,${assTime(cap.start)},${assTime(cap.end)},Sub,,0,0,0,,${body}`;
  });
  // 关键词砸字：朗读到该词的瞬间从 175% 迅速砸落定格 100%，停留 holdSec 后淡出（layer 1 盖在字幕上）
  if (Array.isArray(timeline.keywords) && timeline.keywords.length) {
    const hold = Number(c.keywordHoldSec || 2.2);
    const cx = Math.round(timeline.width / 2);
    const cy = Math.round(timeline.height * 0.34);
    for (const k of timeline.keywords) {
      const st = k.start;
      const en = Math.min(st + hold, timeline.duration);
      if (en - st < 0.4) continue;
      // 枚举条目色标（P10）：词所属镜的 accent → 行内 \1c 逐条换色；无 accent 字段输出与旧版逐字节一致
      const acc = assColour(k.accent);
      events.push(
        `Dialogue: 1,${assTime(st)},${assTime(en)},Kw,,0,0,0,,` +
        `{${acc ? `\\1c${acc}&` : ''}\\an5\\pos(${cx},${cy})\\fad(60,250)\\fscx175\\fscy175\\t(0,170,\\fscx100\\fscy100)}${esc(k.text)}`,
      );
    }
  }
  return header + events.join('\n') + '\n';
}

module.exports = { assTime, assColour, buildAss };
