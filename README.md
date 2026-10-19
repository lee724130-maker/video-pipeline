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
| 配音 | DashScope qwen TTS（免费额度，多种音色）；四级兜底 edge→gTTS→SAPI 离线（断网也出片） | `audio/voice.mp3` + meta |
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

填口播文案 → （可选）传背景图/BGM → 选音色、拖语速滑条 → 点「一键出片」，六步进度条 + 实时日志，完成后在线预览成片（可拖进度条）、下载、看 QC 报告。镜头由 `web/splitter.cjs` 按句自动拆分（首句标题卡、含逗号句要点卡、末句收尾卡）；要精细分镜仍建议按 `skills/script.md` 手写 `shots.json` 跑命令行。只监听 127.0.0.1，不对外网开放。

## 目录约定

```
剪辑应用/
├─ skills/            # 环节规则书（我写分镜/画面时遵守）
├─ pipeline/          # 流水线脚本
│   └─ tools/tts.py    # edge-tts 封装（唯一 Python 依赖）
├─ templates/         # 场景模板（base.css 设计令牌 + scenes/*.html）
├─ output/<任务名>/    # 一任务一文件夹，成品在最后
│   ├─ shots.json  audio/  scenes/  segments/  成片.mp4  封面.png  qc-report.txt
└─ cache/             # 可删缓存
```

## 发布件（P0 三件套，已支持）

- **逐词字幕**：02 自动用 whisper（本地免费模型）对配音逐词对齐 → 卡拉OK高亮逐字跟语音（`audio/words.json` 缓存复用，重跑 05 秒级）。精度要求高可 `config.ktv.alignModel` 一键切 medium（更准、约 2~3 倍耗时）。
- **响度标准化**：05 出片时两遍 loudnorm 归一到 **-14 LUFS**（抖音/视频号发布标准，真峰值 ≤ -1.5 dBTP），口播/BGM/KTV 三类成片统一处理；`config.compose.loudness` 可关。
- **封面图**：自动生成 `封面.png`（标题默认取任务标题、副标题取文案首句，`config.cover` 可覆盖文案）。**3 套风格**（`shots.coverStyle` 任务级 / `config.cover.style` 全局，网页端也有下拉）：`tech` 暗色科技（默认）/ `bold` 高对比大字（黑底暖黄）/ `magazine` 杂志留白（纸白衬线），随画幅自适应。
- **片尾关注卡**：成片末尾自动拼 2.6s「点关注 不迷路」卡片，`config.outro` 可改文案/时长/关闭。
- **演示风 deck 主题**：`shots.sceneStyle`（网页端也有下拉）切「演示风」——暗蓝渐变底 + 青色点缀、左对齐章节页、底部章节导航条（`shots.nav` 每镜一格标签）、硬切转场，复刻幻灯讲解类样片；`shots.captions: false` 关掉烧录字幕（纯画面+旁白）。缺省 classic 完全不受影响。

## 素材模式 + BGM（B 档，已支持）

- **素材混排**：把图片/视频丢进任务的 `assets/`，`shots.json` 里给某镜头加 `"asset": "文件名"`，该镜就用素材画面（自动 cover 铺满竖屏、不够长循环、超出截断），与生成场景混排在同一条时间线。
- **素材背景**：`assets/` 里放 `bg-01.jpg ~ bg-09.jpg`（png/webp 也行）即可全局换背景——口播按镜头序号轮播做底图 + Ken Burns 缓推动画（原网格光晕设计叠加其上，自动压暗保字幕可读），KTV 全曲轮播 + 1s 交叉淡化，封面用第一张。不放就用内置风格，`config.background`（scrim/kenBurns/zoom）可调。
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
- 💰 付费（默认不做）：AI 生图/生视频底片、声音克隆。素材和 BGM 由你提供，丢进任务文件夹即可自动编入时间线。
