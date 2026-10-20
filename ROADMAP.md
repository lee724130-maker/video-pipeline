# ROADMAP · 零成本视频流水线

> 更新：2026-10-16。状态：✅ 已完成 / 🔄 进行中 / ⬜ 未开始。

## ✅ 已完成

| 档位 | 内容 |
|---|---|
| A 档 | 口播成片全链路：文案→TTS（50+ 音色）→场景动画→合成→QC；卡拉OK字幕、关键词砸字、转场 |
| B 档 | 素材混排（assets/ 指定镜头）+ BGM 卡点（节拍检测吸切镜、说话侧链闪避、循环淡入淡出） |
| KTV | 07 独立步：歌名网搜 LRC / 丢 LRC / 丢纯文本 → 整首卡拉OK跟唱视频（歌词三级输入，识别只兜底） |
| P0 打磨 | ① 口播字幕逐词对齐（whisper 本地对齐，帧级准）② 响度标准化 -14 LUFS（口播/BGM/KTV 三分支，QC 复核）③ 封面.png 自动生成 + 片尾「点关注」卡 |
| P1-1 ✅ | **SAPI 离线 TTS 兜底**：断网/无额度时 Windows 自带语音顶上（rate 6 + atempo 1.15 精准 7.6 字/秒），01 供应商链 `dashscope→edge→gtts→sapi` 四级，`--provider sapi` 可强制；全链 18/18 验证 |
| P1-2 ✅ | **读音/对齐归一增强**：实测 10 组经典易错句（多音字/数字/日期/百分比），qwen TTS 读音全对、**无需读音改写**；真痛点在对齐侧——02 归一升级三件套：数字归一 + 繁简归一（OpenCC 3029 字表）+ **有界重同步**（单字失配不再全盘作废，LOOK=4 重咬、咬合率 <60% 才兜底）。Huihui 吞字、繁体输出、同音错写场景全部从「退回字数比例」升级为逐词对齐 |
| 响度增强 | `loudnormFile` 升级迭代式：线性增益预测撞 TP 上限（瞬态高的素材如 SAPI 配音）自动改走 dynamic 压动态，复测贴住 ±1.5 才收工（最多 3 轮）；返回 `to` 改为最终实测值 |
| P1-4 ✅ | **whisper medium 档位一键切**：`config.ktv.alignModel`（口播对齐，02 传给 align.py）+ `config.ktv.model`（KTV 识别，07 或 `--model` 覆盖），默认 small；medium 已实测全链 18/18（6s 音频对齐 50s、约 2.5 倍耗时），words.json 的 engine 记录 `whisper-zh/<模型>` 可见缓存来源（换档后删 `audio/words.json` 重对齐） |
| P1-3 ✅ | **素材背景 A+C**：`assets/bg-NN.jpg|png|webp` 即开即用——口播场景按镜头序号轮播做底图（Ken Burns 奇偶交替推近/拉远，原光晕/网格设计语言叠加其上，scrim 压暗保字幕可读），封面取第一张静态版；KTV 全曲按图数均分轮播（1s 交叉淡化）。无 bg-NN 文件 → 行为与旧版完全一致（纯代码渐变/动态渐变）。`config.background` 可调 scrim/kenBurns/zoom；口播全链 18/18 + KTV 轮播/回退双路径实测 |
| P2-1 ✅ | **本地网页界面**：`node web/server.cjs` → 浏览器开 `http://127.0.0.1:8787`——填文案/传背景图/BGM（base64 直传，≤60MB）/选音色（5 个实测 qwen 音色）/拖语速滑条（任务级 `targetCharsPerSec`，不改全局 config）→ 一键出 01→06 全链 → 六步进度条 + 实时日志 + 在线预览成片（Range 可拖进度条）/封面/质检抽帧/下载 + 历史任务列表。机械分镜器 `web/splitter.cjs`：首句 title、含逗号句 bullet（分句拆要点）、末句 end、单句稿 title+outro 兜底，type 全在白名单内；只监听 127.0.0.1，任务名/文件名白名单防路径穿越，同一时刻只跑一条管线。零新增依赖（Node 内置 http + 现有 pipeline）。API 实测：web-smoke 任务 3 镜、loongstella、6.5 字/秒实测 6.51、18/18 |
| P2-6 ✅ | **批量变体**：网页端「批量变体」框每行一个开头钩子（2~5 行）→ 服务端队列逐条跑全链，每条 = 完整独立任务 `<名>-v1..vN`（钩子替换首镜口播+大字标题，素材/语速/音色共享；单条失败不中断队列）；完成后各版本成片并排展示方便 A/B 对比。API 实测 bv-test 2 变体全链 ok、18/18、loongstella |
| P2-7 ✅ | **横屏/方形尺寸**：`shots.json` 写 `width/height` 即切画幅（网页端画幅下拉：竖屏 1080×1920 / 横屏 1920×1080 / 方形 1080×1080）。三处适配：① `templates/base.css` 全部 px 改 `calc(Npx * var(--k))`（`--k`=短边/1080）；② 03 注入 `<style>:root{--k;--safe-top/bottom}`（安全区按 高/1920 缩放：竖屏 180/180 不变，横屏/方形 101px），场景/片尾卡/封面三处都注入，cover.html 内联 px 同步改 calc；③ 05 ASS 字号/边距按比例缩放（字幕 56×k、marginV 320×高/1920、砸字 130×k，均设下限防爆）。回归：竖屏 sapi-test 19/19 无回归（注入 k=1/180px 与设计稿一致）、横屏 bv-test-v1 18/18、方形 sq-test 18/18，三方画幅字幕带位置核验正确（第 7 段 y≈810~945）。KTV（07）仍固定竖屏，不在本次范围 |
| P2-8 ✅ | **封面多套风格**：封面模板 3 套视觉风格——`tech` 暗色科技（默认，青色点缀）、`bold` 高对比大字（纯黑底+暖黄/朱红渐变条，标题 152px 超大）、`magazine` 杂志留白（纸白 #F5F1E8 底+墨字+衬线大标题+赭石点缀）。实现：`templates/cover.html` 按 `cover-{style}` class 挂风格 CSS（同模板，改 style 块）；03 读 `shots.coverStyle`（任务级）> `config.cover.style`（全局）> 默认 tech，白名单校验非法 fail-fast；网页端封面风格下拉 + server 白名单 400。核验：三风格抽帧色相分布区分明显（tech 青 0.18%/黄 0%、bold 黄 0.30%/青 0%、magazine 96.5% 纸白亮底）；非法风格 03 fail ✓ + API 400 ✓；web 建任务全链 18/18 |
| P2-9 ✅ | **演示风 deck 主题**（复刻抖音参考样片《给WorkBuddy装套技能，它就成了短剧工作台》）：`shots.sceneStyle`（classic 缺省 / deck，白名单 fail-fast，网页下拉 + server 400）——`templates/deck.css` 覆盖层随 03 注入（暗蓝渐变底 #0c2032→#070c17、青 #00edce、左对齐章节页、章节卡片网格带编号圆标、底部章节导航条 `.chapnav` 按 `shots.nav` 逐镜注入 + 当前章高亮）；模板新增 `tags`/`quote`/`{t,d}` 双行卡片 token（classic 下隐藏/中性样式零回归）；05 deck 硬切转场（`cfg.compose.deckTransitionSec` 缺省 0）；`shots.captions:false` → 05 不烧 ASS、06 字幕核验项相应跳过（与 keyword 砸字冲突显式 fail）。demo `output/deck-demo`（1920×1080 · 5 镜 · 无字幕）抽帧与参考样片版式对齐，QC 17/17。附带两修：① itemTime fallback 把相对时间当绝对时间（要点全挤 0.08s 一次弹出）；② capture.mjs 改先起播再开录 + runtime.js 注入 1px 保活微动画（hypit screencast 附带 0~1.6s 启动竞态会吃掉成片开头、Chrome 对静止页把 rAF 压到 ~1.5s/次致 data-at 揭示迟拍——两个都是系统性坑，classic 一并受益）。验证补齐（10-20）：classic 回归 18/18 零回归（开场首帧全亮/卡拉OK字幕正常）+ `/api/create` 白名单 4 分支 400 实测 + API 建 deck 任务全链 17/17（deck-api-test） |

## ✅ P1 · 近期（已全部完成，见上表 P1-1 ~ P1-4）

## ✅ P2 · 体验（已全部完成，见上表 P2-1 / P2-6 / P2-7 / P2-8 / P2-9）

> P2 五项全部完工：网页界面 ✅ · 批量变体 ✅ · 尺寸自适应 ✅ · 封面多风格 ✅ · 演示风 deck 主题 ✅

## ⬜ P3 · 远期（可选方向，看需求再启动）

9. **素材库接入**——免版权 BGM/图片/视频片段的本地缓存库（用户仍可自带文件优先）
10. **AI 生成画面**——可选接入生图 API 出场景图（有 key 才启用，保持零成本默认不变）
11. **平台发布规格预设**——抖音/视频号/B站/小红书各自的安全区、字幕字号、时长偏好做成 profile
12. **语音克隆音色**——DashScope 支持声音复刻，用自己的声音出片（需要 API 支持与额度）

## 维护备忘

- 依赖环境固化：`.py312/`（whisper）+ `D:/ffmpeg` + Chrome + hypit，换机器按 00-checkenv 提示装（安装全清单见 `INSTALL.md`）
- 已知口径：语速目标 7.2 字/秒（2026-10-16 用户调，原 7.6 微降）；默认音色 loongstella 飒爽新闻女；BGM 只认用户自带文件
- 配音四级兜底：dashscope → edge → gtts → sapi（SAPI 为离线最后防线，Windows 必带中文语音 Huihui）
- 坑位留档：见 `CHECKPOINT-2026-10-13.md`（whisper 四坑、loudnorm 两坑、DashScope mp3 头时长等，均已固化进脚本注释）
