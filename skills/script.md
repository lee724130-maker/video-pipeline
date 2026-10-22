# Skill · 分镜编排（文案 → shots.json）

目标：把一段口播文案拆成镜头，每个镜头的时长**由真实配音时间反推**，不靠估算。

## 一、文案规则（口播稿）

1. **先写钩子**：第 1 句必须在 3 秒内给出「谁会得到什么」或「反常识结论」。
2. 每句 ≤ 22 字；一段配音（= 一个镜头）1~2 句，时长 3~8 秒。
3. 全片 60~90 秒；结尾必须有明确动作指令（关注/评论/去试一次）。
4. 口语化、短句、少形容词堆叠；不用书面语「综上所述」。
5. 数字写成阿拉伯数字（TTS 读得稳）。

## 二、分镜表 schema（`shots.json`）

```jsonc
{
  "title": "任务名（也是文件夹名）",
  "width": 1080, "height": 1920, "fps": 30,
  "sceneStyle": "classic",        // 可选：classic（缺省）| deck（演示风：幻灯版式+底部章节导航条+硬切）| paper（纸感浅色：奶油底深字，横屏教学风）
  "captions": true,               // 可选：false = 不烧录字幕（复刻样片纯画面+旁白；此时勿配 keyword 砸字）
  "voice": { "name": "zh-CN-YunxiNeural", "rate": "+8%" },
  "shots": [
    { "id": "s01", "type": "title",      "narration": "这段镜头的口播原文",
      "title": "主标题", "subtitle": "副标题",
      "kicker": "徽标小字", "tags": ["标签一", "标签二"], "nav": "开场" },
    { "id": "s02", "type": "bullet",     "narration": "...",
      "heading": "小标题", "items": ["要点一", "要点二", "要点三"],
      "quote": "青色引用行（可选）", "nav": "章节导航条标签（可选）" },
    { "id": "s03", "type": "keyword",    "narration": "...",
      "keyword": "大字关键词", "note": "一行小字注解" },
    { "id": "s04", "type": "transition", "narration": "...",
      "index": "02", "heading": "章节名" },
    { "id": "s05", "type": "end",        "narration": "...",
      "title": "收尾金句", "subtitle": "CTA", "tags": ["CTA 按钮一", "按钮二"] }
  ]
}
```

- `narration` 按顺序拼起来 = 整条配音文本（**不写标点分镜符号**，正常断句即可）。
- 镜头时长不填，由 `02-compile` 用逐词时间戳自动切分。
- `items` 每条 ≤ 10 字；超过 10 字会被质检警告（竖屏一行放不下）。
  也可以写成 `{ "t": "标题", "d": "一行描述" }` 双行卡片（演示风常用）；
  对不上口播词的条目按「开场 0.5s 后均匀铺开」出现。
- `type` 白名单：`title | bullet | keyword | transition | end`（新增类型必须同时在
  `templates/scenes/` 加同名模板，并在 `03-scenes.cjs` 的 `TYPES` 注册）。
- deck 演示风可选字段：`nav`（底部章节导航条该格标签，缺省按类型推导：开场/收尾/heading）、
  `quote`（章节页青色引用行）、`tags`（title/end 的标签行/CTA 按钮）；建议 deck 配 `width:1920 height:1080`。

## 三、镜头分配原则

1. **一镜一信息**：一个镜头只讲一个点，画面只放一个视觉主体。
2. **要点镜头**（bullet）是主力：3~5 条要点，逐条出现的时间点由该条文字在配音里
   的**首个词时间戳**决定（`02-compile` 自动对齐）——所以写 items 时尽量让口播里
   出现同样的词，对不齐时以配音为准、画面对不上就删条目。
3. keyword 镜头用于「结论/数字/转折」，全片 1~3 次，多了就廉价。
4. transition 只在 ≥3 章节时使用。
5. 开场必须 `title`，收尾必须 `end`。

## 四、交付前自查

- [ ] 首句 3 秒内有钩子
- [ ] 每个 bullet 的 items 数 ≤ 5 且与口播词序一致
- [ ] 无镜头 narration 超过 25 字（会顶到 8 秒以上）
- [ ] 结尾有动作指令
