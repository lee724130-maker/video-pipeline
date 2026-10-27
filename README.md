# 剪辑应用 · 零成本视频生产流水线

一句话需求 → 口播成片（720/1080 竖屏），**全链路本地免费**，不调用任何付费模型。

> 🖥️ **换新电脑使用？** 完整安装清单（缺什么跑不通、按什么顺序装、怎么验证）见 **[INSTALL.md](INSTALL.md)**——Node/ffmpeg/Chrome/hypit/DashScope key/whisper 环境全覆盖，5~10 分钟可跑通。

## 用法（对你来说只有一件事）

把需求丢给我，例如：

> 做一条 60 秒口播，讲「新手做 AI 短剧最容易踩的 3 个坑」，风格干练，结尾引导关注。

我会：写文案 → 出分镜表 `shots.json` → 跑流水线 → 交付 `成片.mp4`。

## 链路（8 环节，全部本地）

| 环节 | 工具 | 产物 |
|---|---|---|
| 环境自检 | `pipeline/00-checkenv.cjs` | 工具链就绪报告 |
| 配音 | DashScope qwen TTS（免费额度，多种音色）+ **声音复刻**（克隆自己的声音，复刻按次计费）；四级兜底 edge→gTTS→SAPI 离线（断网也出片；克隆音色不走兜底，失败明说） | `audio/voice.mp3` + meta |
| 编排 | 我按 `skills/script.md` 写分镜表 | `shots.json`（含镜头时长，由真实配音时间反推）；whisper 逐词对齐出 `audio/words.json`（字幕逐字精确，缓存复用） |
| 画面方案 | 我按 `skills/visuals.md` 定每镜画面 | 场景 HTML |
| 场景生成 | `pipeline/03-scenes.cjs` | `scenes/s01.html …`（要点随配音逐条出现）+ 片尾卡/封面版式 |
| 场景渲染 | hypit `capture run`（本地浏览器录屏） | `segments/s01.mp4 …` + 片尾卡片段 + `封面.png` |
| 合成 | ffmpeg | 拼接（转场/BGM 卡点）+ 字幕（卡拉OK/砸字）+ BGM 闪避混音 + **响度标准化 -14 LUFS** + 片尾关注卡 → `成片.mp4` |
| 质检 | `pipeline/06-qc.cjs` | `qc-report.txt`（时长/黑屏/响度 -14±3/音画对齐/片尾卡/封面/分镜结构，19 项机械检查） |

## 手动跑一条任务

```powershell
node pipeline/run.cjs output/<任务名>
```

任务文件夹里必须有 `shots.json`（分镜表）。流水线会自己完成配音→渲染→合成→质检。

## 网页界面（不想碰命令行就用这个）

```powershell
node web/server.cjs        # 然后浏览器开 http://127.0.0.1:8787
```

填口播文案 → （可选）传背景图/BGM 或从底部「素材库」选用 → 选音色（可「🎙 克隆音色」用自己的声音）、拖语速滑条 → 点「一键出片」，六步进度条 + 实时日志，完成后在线预览成片（可拖进度条）、下载、看 QC 报告。镜头由 `web/splitter.cjs` 按句自动拆分（首句标题卡、含逗号句要点卡、末句收尾卡）；要精细分镜仍建议按 `skills/script.md` 手写 `shots.json` 跑命令行。只监听 127.0.0.1，不对外网开放。

## 改片三件套（P3：出完片还能一直改）

- **局部重跑**：预览区「局部重跑」面板选起始步骤（1配音~6质检）+ 改风格/字幕/封面，或直接贴 config 补丁 JSON——复用上游产物，只重跑受影响步骤。
- **技术库货架**：左下货架每张卡=一个剪辑手法配方（`techniques/*.json`），点「插入」自动填好重跑表单。抖音教学视频按 `skills/techniques.md` 的工作流入库，货架实时上架不用重启。现共 12 张卡（按画面/封面/字幕/声音/转场分组展示），收尾音频具备两种可叠加染色：**降调**（`compose.bgm.outroPitchSemitones/Sec`）与**延迟回声甩尾**（`compose.bgm.outroEcho/Sec/Wet`，教学入库 001：尾段 0.4s 干声淡出 + 250/500/750ms 三抽头 aecho，强度 50 = 教学值）。
- **需求聊天框**：预览区用人话续加需求（「换演示风，收尾降调 3 个半音，字幕大一点」），解析成补丁累积叠加后局部重跑；多线程持久化在任务目录 `chat.json`，聊天记录即改动审计。语义解析走 DashScope qwen（`config.llm`，key 复用 TTS 的）；**额度用尽/接口故障自动降级纯规则模式并在界面明示原因**，断供不断片。

## 目录约定

```
剪辑应用/
├─ skills/            # 环节规则书（我写分镜/画面时遵守）
├─ techniques/        # 技术库配方卡（入库工作流见 skills/techniques.md）
├─ library/           # 素材库：本地 BGM/图片/视频片段缓存（不入 git，见 library/README.md）
├─ pipeline/          # 流水线脚本
│   └─ tools/tts.py    # edge-tts 封装（唯一 Python 依赖）
├─ templates/         # 场景模板（base.css 设计令牌 + scenes/*.html）
├─ smoke/             # 冒烟脚本归档 + 探针围栏（规矩见 smoke/README.md）
├─ output/<任务名>/    # 一任务一文件夹，成品在最后
│   ├─ shots.json  audio/  scenes/  segments/  成片.mp4  封面.png  qc-report.txt
└─ cache/             # 可删缓存
```

## 发布件（P0 三件套，已支持）

- **逐词字幕**：02 自动用 whisper（本地免费模型）对配音逐词对齐 → 卡拉OK高亮逐字跟语音（`audio/words.json` 缓存复用，重跑 05 秒级）。精度要求高可 `config.ktv.alignModel` 一键切 medium（更准、约 2~3 倍耗时）。字幕样式 `config.compose.captionStyle` 二选一：`outline` 缺省白字深描边 / `bar` 黑底实底条（抖音教学片风，浅色底上更稳）。
- **响度标准化**：05 出片时两遍 loudnorm 归一到 **-14 LUFS**（抖音/视频号发布标准，真峰值 ≤ -1.5 dBTP），口播/BGM/KTV 三类成片统一处理；`config.compose.loudness` 可关。
- **封面图**：自动生成 `封面.png`（标题默认取任务标题、副标题取文案首句，`config.cover` 可覆盖文案）。**3 套风格**（`shots.coverStyle` 任务级 / `config.cover.style` 全局，网页端也有下拉）：`tech` 暗色科技（默认）/ `bold` 高对比大字（黑底暖黄）/ `magazine` 杂志留白（纸白衬线），随画幅自适应。
- **片尾关注卡**：成片末尾自动拼 2.6s「点关注 不迷路」卡片，`config.outro` 可改文案/时长/关闭。
- **主题切换**：`shots.sceneStyle`（网页端也有下拉）三选一——`classic` 缺省暗底网格 / `deck` 演示风（暗蓝渐变底 + 青色点缀、左对齐章节页、底部章节导航条 `shots.nav` 每镜一格标签、硬切转场，复刻幻灯讲解类样片）/ `paper` 纸感浅色（奶油底墨字 + 深红点缀、素材背景铺纸罩而非暗罩，横屏教学/知识卡片风）。`shots.captions: false` 关掉烧录字幕（纯画面+旁白）。缺省 classic 完全不受影响。
- **品牌角标**：`config.cornerMark`（`src` 指任务 `assets/` 下的 logo 图 + `pos` tl/tr/bl/br + `width`/`opacity`）→ **场景镜（HTML 注入）+ 素材镜（ffmpeg overlay，与 CSS 同一几何：48×k 边距、width×k、透明度）+ 片尾卡**全片常驻角标，缺图/非法位置直接报错；未配置零影响（封面为独立发布图不带）。deck 风底部有导航条建议 `tr`，其余缺省 `br`。
- **左文右图分栏**：分镜 `type:"split"`——左栏标题+要点（或一行 `note`），右栏 `media` 引 `assets/` 样机图/截图（圆角+投影），要点随配音逐条出现；UI/产品教学类内容的主力版式，横屏最佳、竖屏自动改上下分栏。见 `skills/script.md` schema。
- **平台发布规格**：网页建任务「发布规格」下拉两组——**平台组**（抖音 / 视频号 / 小红书 3:4 / B站横屏 → `shots.platform` 查 `pipeline/config.json` 的 `platforms` 表出画幅 + 时长档 `durHint`，表可加平台零改码，可选 `safeTop/safeBottom/captionSize/captionMarginV` 覆盖键）与**自定义组**（竖/横/方三画幅，旧路径不变）。聊天说「发抖音」「横屏发B站」同样命中（「别发抖音」类否定句不认）；`platform` 与 `width/height` 同时写且值不一致直接 fail。

## 素材模式 + BGM（B 档，已支持）

- **素材混排**：把图片/视频丢进任务的 `assets/`，`shots.json` 里给某镜头加 `"asset": "文件名"`，该镜就用素材画面（自动 cover 铺满竖屏、不够长循环、超出截断），与生成场景混排在同一条时间线。图片素材自动接 Ken Burns 缓推/缓拉（镜序奇偶交替方向，2x 超采样防抖，`config.background.kenBurns:false` 关回静态，`zoom` 同背景层可调）。
- **素材背景**：`assets/` 里放 `bg-01.jpg ~ bg-09.jpg`（png/webp 也行）即可全局换背景——口播按镜头序号轮播做底图 + Ken Burns 缓推动画（原网格光晕设计叠加其上，自动压暗保字幕可读），KTV 全曲轮播 + 1s 交叉淡化，封面用第一张。不放就用内置风格，`config.background`（scrim/kenBurns/zoom）可调。
- **素材库（P7）**：根目录 `library/{bgm,images,clips}` 放可复用素材（白名单扩展名，git 不入库），网页底部「素材库」区选目标任务一键选用——复制进任务 `assets/`（BGM 自动清旧换 `bgm.<ext>`、图片可自动编 `bg-NN`），再重跑对应步骤生效；建任务表单的 BGM 也能直接下拉选用（与自带上传二选一，自带优先）。
- **AI 生图（P7-2）**：素材库区直接用文字出图——写画面描述 →「✦ AI 生图」→ 出图自动落 `library/images/ai-*.png`，可勾选顺手作背景图加入所选任务。**有 DashScope key 才启用**（`pipeline/config.local.json` 的 `voice.dashscope.key` 复用 / `imagegen.key` 单独密钥 / 环境变量 `DASHSCOPE_API_KEY`；`imagegen.enabled=false` 可关死），模型 `qwen-image-2.1-turbo`、按张计费（当前在免费额度内，额度尽会明确提示充值或关「仅用免费额度」）；没配 key 只显示启用说明——**出片六步永不自动调用它，零成本默认不变**。
- **语音克隆（P8）**：表单音色下拉旁「🎙 克隆音色」折叠面板——选一段 **10~20 秒干净人声**（无 BGM、少混响，mp3/wav/m4a ≤15MB）→「✦ 复刻」→ 服务端等审核通过（通常十几秒）→ 音色下拉出现「克隆音色」组，选中即用自己的声音出片。**有 DashScope key 才启用**（`voice.dashscope.key` 复用 / `voice.clone.key` 单独 / 环境变量 `DASHSCOPE_API_KEY`）；复刻 Qwen 系列按官方口径 ¥0.01/次（创建失败不计费），合成分开按所选模型计费。**克隆音色出片不走四级兜底**——状态未就绪、清单里没有该 id 都明确报错并指引「↻ 同步」，绝不静默换成别的声音；同步按钮拉账号音色列表，删除不可恢复。清单在 `pipeline/voice-clone.json`（账号私有，不进 git）。
- **Editor 精修（P9 轻改 → P11 结构版）**：首页头部「✂ Editor 精修」进独立页 `/editor`——选任务 → 逐镜卡片改口播 / 换类型（6 型互切）/ 选素材（asset、分栏 media 从任务 `assets/` 下拉）/ 增删要点（单行与双行卡原样往返）；**P11 起可增删镜头、↑↓ 排序**（新镜卡片页内插，n 自动重排/缺 id 服务端补发；至少留一张标题卡）+ **「任务参数」区直改发布规格/画幅/场景风格/封面风格/字幕开关**（音色/语速仍走控制台重跑面板）。判定规则升级为**逐镜比对**（01 落 `audio/narrationSeg.json`）：任一镜文本变了、镜头增删换序，都硬钳第 1 步重配音；只动画面字段 → 第 2 步免配音。旧任务无 seg 清单时回退整串口径，但结构变更（增删/排序）独立判定照样钳 1——「换序不换字」这种整串拼接看不见的改动不会再骗过流水线。保存前自动备份 `shots.json.bak`，全部服务端校验（身份键/白名单/类型必填/素材存在），运行中保存 409。秒级拖动裁剪时间轴属「重剪」段（P12 提案，见 ROADMAP）。
- **时间轴排序页（P13）**：`/timeline`（首页头部 / 精修页顶入口）——把镜头按 `timeline.json` **真实配音时长**等比铺成三轨（口播/画面/字幕）+ 秒刻度尺，**拖动夹片换序**（指针落点竖线）、单击选中开右侧检查器改高频字段（口播/类型/nav/标题/关键词/素材），Ctrl+Z 撤销、缩放滑条，保存走与精修页同一套 `/api/editor/shots` 契约（换序/改口播照样硬钳第 1 步重配音）。网页按钮建的**无身份键**老任务不能排序——页面给「一键补发 id」向导，服务端 upgrading 通道核验「镜序/口播逐位不动」后放行补键、只重编译免重配音，一次升级为可自由排序的有键文档。字段级精修（要点/双行卡/分栏配图）仍去精修页；秒级 in/out 裁剪属「重剪」段（P12）。
- **BGM 卡点**：任务根目录放 `bgm.mp3`（或 wav/m4a 等，也认 `assets/bgm.*`），合成时自动：循环铺满全片 + 说话时侧链闪避 + 淡入淡出 + 镜头边界吸附到检测出的节拍网格（无明显节奏的曲子自动跳过卡点，只混音）。

## KTV 歌词视频（07 步，独立模式）

任务文件夹里放歌曲（`bgm.mp3` 或 `--song 指定文件名`），一条命令出整首 KTV 跟唱视频：

```powershell
node pipeline/07-ktv.cjs output/<任务名>
```

faster-whisper（本地免费模型）自动对齐歌词 → 卡拉OK逐词点亮字幕 + 背景（`assets/bg-NN` 素材图轮播，无则动态渐变）+ 原声 → `KTV成片.mp4`。

**歌词输入（按优先级，放任务目录）**：
1. `lyrics.lrc` —— 带时间戳歌词（音乐 App 复制歌词选「含时间戳」），直接套用，最准
2. `lyrics.txt` —— 纯文本歌词（一行一句，行数与已有 `lyrics.json` 时间段数一致），文字零识别误差，行内按字均匀点亮
3. 都没有才走识别兜底（同音字可能有误差）

歌词对齐结果缓存为 `lyrics.json`；模型跑在项目内独立 Python（`.py312/`），与主流水线互不影响。

## 免费边界（诚实说明）

- ✅ 免费：配音、字幕、排版、渲染、合成、质检、素材混排、BGM 卡点 —— 本流水线全部环节
- 💰 付费（默认关）：AI 生图已接入（P7-2）——仅网页手动触发、有 key 才启用，出片六步零调用零花费；生视频底片、声音克隆未接。素材和 BGM 由你提供，丢进任务文件夹即可自动编入时间线。
