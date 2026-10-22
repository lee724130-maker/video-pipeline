# 技术库入库工作流（抖音教学视频 → 配方卡）

把刷到的剪辑教学视频变成货架上「一键插入」的配方卡。全流程零成本：
下载不花额度、分析可人工、入库即上架（`/api/techniques` 每次实时读目录，**不用重启**）。

## 流程（6 步）

1. **收链接**：用户发抖音链接 / modal_id，或直接说「把 XX 手法入库」。
2. **下载抽帧**：走 douyin-archive skill，落点 `C:\Users\Administrator\Desktop\douyin_video\<slug>\`
   （原片 + info.json + 抽帧总览/细节图）。图文作品只下图片序列。
3. **看片拆解**：对照总览图 + 细节帧识别可复刻手法，逐条对照下方「管线现有能力清单」定档：
   - **implemented（已实现）**：现有能力直接组合就能复刻 → 直接写配方卡上架。
   - **manual（素材契约型）**：工艺本身可用零依赖 ffmpeg 复刻，但成立依赖管线外的条件（如成对提供轮廓相似、同屏位的素材）→ 配方卡只记判据与做法，不带 insert、不提供一键插入（货架标「手动配方·看判据」）。
   - **new（新能力）**：管线做不到（如当年的「BGM 收尾降调」）→ **先开能力施工**
     （05-compose/03-scene 等 + config 默认值 + 单测，参考 P3-2 提交），能力验收后配方卡才置 implemented。
     施工期间卡片可以先入库但 `tier:"new"`，货架上按钮自动禁用、明示「待实现」——**不藏短板**。
4. **写配方** `techniques/<id>.json`（schema 见下）。
5. **验收**：打开 `http://127.0.0.1:8787` → 货架出现新卡 → 「插入当前任务」→ 检查重跑表单被
   正确填好 → 重跑 → QC 过基线。聊天框里说技术库名字（如「BGM 收尾降调」）也应命中同一配方。
6. **留痕**：`source` 字段记视频来源（链接/modal_id/作者名），审计与版权都在案。

## 配方 schema（`techniques/<id>.json`）

```json
{
  "id": "bgm-outro-pitch",          // 英文短横线，唯一，与文件名一致
  "name": "BGM 收尾降调",            // 中文短名——聊天点名按「整名包含」匹配，起能被自然说出口的名字
  "category": "声音",                // 分类（画面/封面/字幕/声音/转场），≤4 字
  "tier": "implemented",            // implemented=点即用 | new=待管线实现（按钮禁用）
  "desc": "…做什么、什么场景用、注意什么。说人话。",
  "insert": {
    "from": 5,                       // 受影响的最早步骤：1配音/3场景/5合成（宁大勿小，重跑更贵但不错）
    "shots": { "sceneStyle": "deck" },   // 可选；只许 7 个白名单键
    "config": { "compose": { "bgm": { "outroPitchSemitones": -2 } } }, // 可选；深合并
    "note": "一句话调参建议（货架上直接显示）"
  },
  "source": { "by": "抖音@某剪辑课 modal_id=73xxxx" }
}
```

`shots` 白名单（`web/chat-rules.cjs` SHOTS_PATCH 单一出处）：
`sceneStyle / coverStyle / captions / width / height / voice / targetCharsPerSec`。
`config` 只许管线真实读取的键路径，**值域与管线内 fail-fast 校验一致**——写错值整条重跑会在该步报错停下（宁 fail 勿兜底）。

## 质量门（入库前自检）

- [ ] id 唯一且=文件名；JSON 合法（货架对坏文件会直示「配方损坏」，不静默吞）。
- [ ] tier 诚实：管线没有的能力不许标 implemented。
- [ ] insert.from 覆盖所有被改的东西（改 config=5、改 shots 风格=3、改语速=1）。
- [ ] shots/config 键与值域过白名单；desc/note 说人话。
- [ ] 网页「插入」实测填表正确 + 重跑 QC 过基线；聊天点名能命中。
- [ ] source 有来源留痕。

## 管线现有能力清单（对照用）

| 面 | 能力（config/shots 键） |
|---|---|
| 画面 | `sceneStyle` classic/deck/paper 纸感浅色 · `width/height` 画幅 · 分镜 type 含 **split 左文右图分栏**（media 引 assets 样机图）· 背景图轮播+缓推 · **图片素材镜头缓推/缓拉**（奇偶交替，`background.kenBurns:false` 关）· **`cornerMark.*` 品牌角标**（src/pos/width/opacity，每镜+片尾常驻）· deck 锚点动效 |
| 封面 | `coverStyle` tech/bold/magazine |
| 字幕 | `captions` 开关 · `karaoke` 逐词高亮 · `captionSize` 字号 · **`captionStyle` outline 描边白字\|bar 黑底实底条** · `keywordSize/HoldSec` 关键词大字 · `captionMarginV` |
| 声音 | `voice` 音色 · `targetCharsPerSec` 语速 · `bgm.*` 音量/淡入淡出/闪避/卡点 · **`bgm.outroPitchSemitones/Sec` 收尾降调** · **`bgm.outroEcho/outroEchoSec/outroEchoWet` 收尾延迟回声** · `loudness.*` 响度标准化 |
| 节奏 | `transitionSec/Type` 转场（短叠化 0.15 可作形似叠化的换主体瞬间，见 `shape-match-dissolve` 手动卡）· `deckTransitionSec` 硬切 · `tailPadSec` 尾垫 · `silence.*` 剪静音 |
| 复用 | 局部重跑 `/api/rerun`（起始步骤 1~6 + 白名单补丁）——所有配方的底层执行器 |

## 与聊天框的关系

- 聊天框点名技术（「用 BGM 收尾降调」）与货架按钮走**同一份 insert 补丁**，不会两套口径。
- qwen 语义解析（额度恢复后）会把技术名单带进 system prompt；额度尽时规则模式仍按整名匹配。
