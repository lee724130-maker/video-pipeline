# 断点记录（2026-10-13 建档 · 2026-10-14 更新）

> 用途：下次开工按本文件从断点继续。**当前可安全中断**——无编译中文件、无部署中任务、无后台长任务在跑。

## 一、主线进度（零成本视频流水线）

- **P0 已端到端跑通并经用户验收通过**（「效果已经很完善了」）。
  - 产物：`output/零成本流水线-demo/成片.mp4`（11 镜 / 89.70s / 1080×1920 / 30fps / QC 14/14）。
- **语速已改回原速 ✅（2026-10-14 用户拍板）**：`nativeRate:0, tempo:1.0`，DashScope 原始输出不做任何变速（0.62 舒缓档 + C 方案已废弃，过程结论仍留档 §二·五 备查）。
- **A 档三项全部完成 ✅（2026-10-14）**：字幕卡拉OK、镜头转场、关键词砸字；e2e 复跑 QC **15/15**（新增「关键词砸字」机械项）。
- **声线升级 ✅（2026-10-14）**：模型切 `qwen-audio-3.1-tts-flash`，多音色真正生效；5 支对比视频已产出待用户挑选（§二·七）。
- 下一步顺序（原会话定的）：**B 档（BGM 卡点 / 素材混排）** → P1 faster-whisper。
- 流水线 00→06 + 编排器 `run.cjs` 全部落盘，环境 13/13 就绪。
- **TTS 现状**：provider=`auto` = **阿里云 dashscope 优先 → edge(403 必败) → gTTS 兜底**。

## 二、本轮：阿里云 TTS 接通 ✅ 已完成（2026-10-14 收尾）

### 结论一览
- **已接入**：`qwen-audio-3.1-tts-next`（非实时 HTTP 端点），provider=`dashscope`，链 `dashscope → gTTS` 兜底。
- **判定不接**：`qwen-audio-3.1-tts-flash` 是 **Realtime/WebSocket 模型**——非实时端点任何参数结构都报 `[cosyvoice:]Engine error [411]`，异步任务 `403 does not support asynchronous calls`。
- **词级时间戳判定不可用**（非流式/`word_timestamp_enabled` 各种位置均不返回 words）→ 字幕对齐维持 silencedetect 静音断句方案；**A 档卡拉OK 已用逐字时间（silencedetect+字数权重）直接落地**，不依赖词级时间戳（见 §二·六）。

### ✅ 已打通的调用配方（权威，勿再重试其他路径）
```
POST https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer
Header: Content-Type: application/json  Authorization: Bearer <key>
Body: { "model": "qwen-audio-3.1-tts-next",
        "input": { "text_prompt": "<文本>",   // ⚠️ 是 text_prompt 不是 text
                    "voice": "Cherry",         // 非必填，乱填音色名也出音频（服务端兜底）
                    "format": "mp3", "sample_rate": 24000 } }
→ output.audio.{url, duration, id}   // ⚠️ 是 audio.url 不是 audio_url；oss 直链（http，国内直连不走代理）
```
SSE 变体：同端点加头 `X-DashScope-SSE: enable`（返回 base64 音频，仍无词时间戳）。
SDK 权威格式来源：dashscope 1.27.7 包内 `audio/http_tts/http_speech_synthesizer.py`（实际是自己拼 HTTP 调的，没用 SDK）。

### 🚫 TTS 死路清单（10 轮探测全部定性，**别重复踩**）
| 路径/模型 | 结果 |
|---|---|
| `compatible-mode/v1/audio/speech` | 404 |
| `multimodal-generation/generation`、`services/aigc/audio/speech-synthesis` | `InvalidParameter url error` |
| `services/audio/tts`、`services/audio/speech-synthesis` | `task can not be null` |
| `qwen-tts` | 模型不存在 |
| `qwen3-tts-flash` | `AllocationQuota.FreeTierOnly` 免费额度尽 |
| `paraformer-v2`、`qwen-audio-3.0-asr-flash-streaming` | **ASR 不是 TTS**；且不在 176 模型列表内（用户最初点名的两个） |
| `rate/speed/speech_rate` 原生参数 | 200 但时长变化与预期不符（噪声）→ **不用** |
| `text_prompt` 内嵌语速指令 | 有效但不可控 + 破坏逐字对齐 → **不用** |
| 词级时间戳（非流式 / word_timestamp_enabled 各位置） | 均不返回 words → **放弃** |

### ✅ 接入与验证（全绿）
- 新文件 `pipeline/tools/tts_dashscope.cjs`（端点/字段/下载校验 >1000B/网络重试 2 次）；`01-tts.cjs` attempts 链：`provider='dashscope'→['dashscope','gtts']`、`'auto'→['dashscope','edge','gtts']`；key 取 `config.voice.dashscope.key` 或 env `DASHSCOPE_API_KEY`；meta.json `voice` 按 provider 分支。
- `pipeline/config.json` 新增 `voice.dashscope = {model, voice:'Cherry', tempo:0.62, key}`；`provider` 仍 `auto`（现 = dashscope 优先）。
- **端到端**（`output/dashscope-e2e`，3 镜短任务 `cache/mk-e2e-task.cjs` 生成）：QC **14/14**（dashscope · 12.5~16.5s，视 tempo）。
- **降级链**（`cache/test-fallback.cjs`，try/finally 保底还原 config）：**5/5 PASS**——有效 key→dashscope / 无效 key→`HTTP 401 Invalid API-key` 自动落 gTTS 且 voice.mp3 有效 / config 逐字还原。
- 试听样本（378 字 demo 稿，`cache/`）：`ds_t100.mp3`(49.5s 原速) / `ds_t075.mp3`(66.0s) / `ds_t062.mp3`(79.9s) —— **已拍板 0.62 舒缓档**（2026-10-14，落地见 §二·五）。
- 实测语速：dashscope 原速 ≈8.0 字/秒（378 字 47.3s），gTTS 原速 ≈3.1 字/秒 → **所以按 provider 分别配 tempo**（`voiceCfg[used].tempo ?? voiceCfg.tempo`），共用一个会差一倍。

### 其他探测产物（都在 cache/，无害）
- probe-voice1~10.cjs、probe-rate/prompt-rate.cjs、models.txt、ds_t*.mp3、asr_sample.mp3、test-fallback.cjs、mk-e2e-task.cjs。

## 二·五、语速 C 方案 ✅ 已拍板落地（2026-10-14）
- **结论：`nativeRate=0.5` + 残差 atempo 校正到 4.73 字/秒**（378 字 demo 实测 79.9s / 偏差 0.0%）；`tempo=0.62` 仅作兜底。配置 `voice.dashscope.{nativeRate:0.5, targetCharsPerSec:4.73, tempo:0.62}`。
- **rate 参数真相**：非线性且下限失效——0.62→66s(1.33×)、0.75→51s(1.03×)、**0.5→77.6~84.7s 可用**、0.45→崩坏(41.5s)。原生 rate 后仍需残差校正钉节奏。
- **安全带**：残差 >1.3 或 <0.7 判为短稿结构差异，跳过校正（46 字短稿偏差 57% 实测正确跳过）。
- 🚫 **DashScope mp3 文件头 duration 不可信**，必须解码实测——`lib/common.cjs` 新增 `durationDecoded()`，01 已改用。
- 样本：`cache/ds_t062.mp3`(tempo0.62) / `ds_n05_raw.mp3`(rate0.5 原始) / `ds_n05_trim.mp3`(C 方案成品)。

## 二·六、A 档三项 ✅ 已完成（2026-10-14，全部抽帧目视验证 + QC 15/15）
1. **字幕卡拉OK**（`02` 字幕行带 `idx` → `05.buildAss` 生成 `{\k厘秒}`）：
   - 🚫 **勿再交换颜色**：libass 实测 **Secondary=起始色（暗灰）、Primary=随进度填充色（白）**——当前 style `Primary=&H00FFFFFF, Secondary=karaokeDimColour(&H00606060)` 就是**对的**（中途试过反向，已改回）。
   - 验证法：同一行抽 3 帧（行首/行中/行尾）看白区是否从左往右长大；`-ss` 放 `-i` 后精确 seek。
2. **镜头转场**（`05` xfade 链，`config.compose.transitionSec:0.4 / transitionType:fade`）：
   - 机制：**非末段归一化各延长 T（尾帧 tpad 克隆供片）→ xfade 消耗 T → 总时长与镜头边界不变**；offset=真实累计时长（用实际 normDur 推导，抗录制时长偏差）。
   - 钳制：镜头数 <2 或 T ≥ 最短镜头 0.8× → 退回硬切；T=0 走原 concat copy 路径。
3. **关键词砸字**（`shots.json` 每镜可选 `keyword` → `02` 按口播稿原始下标定位说话时刻 → `05` ASS layer1 事件）：
   - 动画 `{\an5\pos(cx,0.34h)\fad(60,250)\fscx175\fscy175\t(0,170,\fscx100\fscy100)}`，Kw 样式粗体 130 号金字 `&H0000D7FF`，hold `keywordHoldSec:2.2`。
   - QC 新增机械项：timeline 有 keywords 时查 subs.ass 含 `\pos(`+词面。
- 验证产物：`output/dashscope-e2e/qc/`（k2_* 卡拉OK三帧、t_* 转场三帧、kw_* 砸字三帧）。
- ⚠️ `run.cjs` 用法：`node run.cjs <任务目录> --steps 2,5,6`（逗号分隔；**漏任务目录会报「缺 shots.json」**；直接 `node 05-compose.cjs <dir>` 更稳）。

## 二·七、语速回调原速 + 声线升级 ✅（2026-10-14 傍晚）
### 语速改原速（用户验收 A 档后拍板「太慢，调回正常语速」→ 选原速 ≈7.6 字/秒）
- config `voice.dashscope`：`tempo:1.0, nativeRate:0`（targetCharsPerSec 7.6 仅留档，nativeRate 关着不生效）→ 无 atempo、无 rate，DashScope 原始输出直出。
- 🚫 **`02-compile` 的音频时长必须用 `durationDecoded()`**：原速直出 = 未经 atempo 重编码 = mp3 头时长又不可信（实测头 7.47s vs 解码 8.90s，差 1.4s 会裁掉尾句）——已修，头/解码偏差 >0.3s 会告警。
- 短稿实际字/秒会低于标称（46 字 8.9s ≈5.2 字/秒，停顿占比大）；378 字长稿才接近 7.6。

### 声线升级核心结论（**音色验证实录，勿重复探测**）
- 🚫 **`qwen-audio-3.1-tts-next` 忽略 voice 参数**：乱填 `zzz-not-a-real-voice` 也出音；F0 对照（Cherry/Dylan/乱填 各 3 份）三组全部 133~195Hz 重叠 → 该模型没有音色能力。
- ✅ **改用 `qwen-audio-3.1-tts-flash`（当前默认）**：合法音色出音、乱填报 `HTTP 400 [cosyvoice:]Engine error [411]`（严格校验，符合官方文档「音色不匹配返回 InvalidParameter」）；女声 yuxiaoyun F0 266.7Hz vs 男声 anmingyuan 163.3Hz 分离清晰。
- 🚫 `qwen-audio-3.0-tts-plus` 403 Free quota exhausted（付费模型）；`qwen3-tts-flash` 403（更早就死）。
- 音色表：`qwen-audio-3.1-tts-flash` 有 ~50 个 v3.1 音色（yuxiaoyun/xuyanchu/wenhuaiqing/longjielidou/loongstella…），见 aliyun 文档「Qwen-Audio-TTS音色列表」；**voice 值区分大小写、不可跨模型混用**。
- **按任务指定音色**：`shots.json` 顶层加 `"voice": "<voice参数>"` → 01 优先于 config；meta.json 记录实际音色。config 默认音色 `yuxiaoyun_v3.1`（于小云·元气亲切女）。
- **5 支对比视频已产出（全部 QC 15/15）**，等用户试听挑默认音色：
  | 目录 | 音色 | 说明 |
  |---|---|---|
  | `output/vc-xiaoyun/成片.mp4` | yuxiaoyun_v3.1 | 于小云·元气亲切女（默认候选，11.23s） |
  | `output/vc-yanchu/成片.mp4` | xuyanchu_v3.1 | 许言初·沉稳磁性男（10.43s） |
  | `output/vc-huaiqing/成片.mp4` | wenhuaiqing_v3.1 | 温怀清·清亮柔和女（10.50s） |
  | `output/vc-lidou/成片.mp4` | longjielidou_v3.1 | 龙杰力豆·天真童声（10.50s） |
  | `output/vc-stella/成片.mp4` | loongstella_v3.1 | 飒爽利落·新闻女（9.57s） |
- 探测脚本留档：`cache/probe-voices.cjs`（多音色 MD5/时长）、`cache/f0test.cjs`+`f0probe.py`（F0 基频对照）、`cache/probe-voice-model.cjs`（模型×音色校验）、`cache/mk-voice-tasks.cjs`（批量任务生成）。

### 二·八 B 档（2026-10-15）：BGM 卡点 + 素材混排，QC 16/16

- **素材混排**：`shots.json` 镜头加 `"asset": "文件名"` → 02 校验 `assets/` 存在并写入 timeline；03 跳过该镜场景生成；04 不走浏览器，直接 ffmpeg 出片段（图片 `-loop 1`、视频 `-stream_loop -1` 循环补长，`scale cover + crop` 铺满 1080×1920，fps 对齐）；05 归一化照常 → 与生成场景无缝混排。实测：素材镜 2.49s 源循环到 4.37s，抽帧三层同框（素材画面+砸字+卡拉OK字幕）✓。
- **BGM 卡点**：任务根（或 assets/）有 `bgm.*` 才启用。`tools/beats.py`：10ms 能量包络 → 对数能量正通量 onset → 自相关估 BPM（折到 70~180）→ 相位搜索定网格 → 逐拍寻峰；相关度 <0.15 判无节奏（语音文件正确返回 bpm 0 不硬凑）。02 把镜头边界在 0.3s 窗内吸附到最近节拍（先静音后节拍两道吸附，守卫 ≥0.6s 镜间距）；05 终混：BGM 循环 + `sidechaincompress`（配音做侧链键，说话自动压低）+ 淡入淡出 + amix normalize=0。单测：96BPM 点声轨 → 96.8 BPM、拍点间隔 0.625s 精准。
- **验证任务** `output/bgm-asset-test/`：96BPM 点声轨当 BGM（点声能听出切点是否压拍）+ s01 片段当素材 → 16/16（新增「BGM 混音」机械项）。卡点实测：第 3 镜边界 6.75 → 6.87s（=0.625×11 拍点）✓。
- 默认音色落定 loongstella_v3.1（config 已改）；04 新增 FFMPEG 导入；README 更新素材模式/BGM 用法与配音行。

## 三、环境与安全备注
- **密钥管理（已完成）**：DashScope key 只放 `pipeline/config.local.json`（gitignore 不入库），仓库内 `config.json` 的 key 字段为空、模板见 `config.local.example.json`；所有脚本经 `common.loadConfig()` 深合并加载。
- **ffmpeg 路径（已完成）**：不再写死盘符，按 `config.ffmpeg` → PATH → `D:/ffmpeg/bin`、`C:/ffmpeg/bin` 顺序自动探测（Node 与 Python 侧同策略）。
- chrome 进程为浏览器/残留，不影响。
- edge-tts 403（微软封出口 IP）不可修；gTTS 走 127.0.0.1:7890 代理正常——这是当前 P0 的现行 TTS。
- 无未保存的编译产物、无部署中状态、无临时数据库改动。

## 四、其余待办（非本轮）
- [x] 用户拍板增强项（A/B 档视觉与音频增强）→ 定 A 档先行
- [x] A 档落地：字幕卡拉OK、镜头转场、关键词砸字（2026-10-14 完成，QC 15/15）
- [x] 下一步：**声线升级** → 已完成，5 支音色对比视频待试听挑默认（2026-10-14）
- [x] 用户拍板默认音色：**loongstella_v3.1 · 飒爽新闻女**（已写入 config）
- [x] B 档：BGM 卡点 + 素材混排（2026-10-15 完成，QC 16/16，`output/bgm-asset-test/`）
- [x] 用户提供真 BGM：《王唯旖-无情画》《李佳薇-甲乙丙丁》（m4a，放在 `output/bgm-asset-test/`）
- [x] 真曲 BGM 测试：`output/bgm-song-test/`（甲乙丙丁 210s → 130.4 BPM，两边界均吸拍，QC 16/16，新默认音色 loongstella）
- [ ] **KTV 歌词视频（用户新需求）**：`tools/lyrics.py`（faster-whisper 逐词对齐）+ `07-ktv.cjs`（卡拉OK点亮+渐变背景）已写好
  - [x] whisper 环境排坑完成（.py312 = 独立 Python 3.12.9，华为镜像装），**四个坑全踩过**：
    1. ctranslate2 **4.8.3 本机加载模型必段错误**（0xC0000005，与 CPU 无关，i7-8750H 有 AVX2）→ 钉 **4.5.0**（需要 setuptools<81 提供 pkg_resources）
    2. huggingface_hub 的 **xet 传输会写截断模型文件还报成功**（model.bin 2.1MB/应 75MB）→ 不走 hub，**curl 从 hf-mirror 直接下**到 `cache/whisper/<model>/`
    3. hf-mirror 偶发返回 **200 + 限流文本页**冒充模型文件（vocabulary.txt 是一段提示文字）→ 下载后必须校验内容不含 "rate limit"
    4. **av 19 移除了 `metadata_errors` 参数**而 fw1.2.1 还在传 → lyrics.py 里 monkeypatch `av.open` 丢弃该参数
  - [x] 跑《甲乙丙丁》small 模型全曲对齐（40 段，lang=zh p=1.0）→ **KTV 样片出片** `output/bgm-song-test/KTV成片.mp4`（210s，39 行唱词，抽帧验证逐词点亮正常；标题卡「李佳薇 · 甲乙丙丁」）
  - [x] 用户拍板：**识别只作兜底，主路=文本+音频**。07 重构歌词输入三级：`lyrics.lrc`（带时间戳直套）> `lyrics.txt`（纯文本套已有时间轴）> 识别兜底；①②行内按字均匀点亮
  - [x] 《甲乙丙丁》LRC 落盘 `output/bgm-song-test/lyrics.lrc`（网搜 LRC + 桌面歌词视频抽帧互验，时间轴完全吻合；39 行）→ LRC 路径重出片，文字零误差（“墙上的合照/你晾的衣服”等修正识别错字）
  - [x] 抽帧通读视频歌词的方法留档：`ffmpeg -vf "fps=1,scale=324:576,tile=4x4"` 拼图墙，每张=16 秒，底部卡拉OK字可直读（cache/lyrics-sheets/）
  - [ ] KTV 背景现为动态渐变，后续可换素材轮播
  - 用法：`node pipeline/07-ktv.cjs <任务目录> [--song 文件名] [--model small|medium]`，歌词优先读 lyrics.lrc/lyrics.txt，识别结果缓存 lyrics.json，改样式只需重跑本步
- [x] **P0 打磨三件套（全部完成，dashscope-e2e 18/18 验证）**：
  1. **口播逐词对齐**：`tools/align.py`（faster-whisper small → `audio/words.json`）；02 缺 words.json 自动对齐+缓存，`charTimesByWords` 数字归一（3↔三）+ 拉丁小写容错。**坑**：whisper 喂 initial_prompt 会吞首句（勿用）；whisper 词内带标点，须在 align.py 剥掉。验证：6.0s 帧「剩下的**交**给流水线」点亮与词时间帧级吻合
  2. **响度标准化 -14 LUFS**：`common.loudnormFile()` 两遍 loudnorm（视频流 copy 只重编音频）；05/07 出片自动跑，06 新增 ebur128 机械项。**坑**：临时文件必须带 .mp4 后缀否则 ffmpeg 推不出封装；ebur128 逐帧行也有 `I:` 字段（起始 -70），只认 Summary 段。三分支验证：无BGM -14.5 / BGM -14.4 / KTV -11.5→-14
  3. **封面 + 片尾关注卡**：`templates/cover.html` 静态版式（runtime duration=999 防淡出）→ 04 录 1.8s 抽 1.2s 帧出 `封面.png`；end 模板生成 outro.html → 04 录 2.6s → 05 归一化硬拼尾部（total 贯通 fade/apad/-t）；03 持久化 timeline.outro/cover 供 06 对账
  - 新 config：`cover{enabled,kicker,title,subtitle,foot}` / `outro{enabled,durSec,kicker,title,subtitle}` / `compose.loudness{i,tp,lra,enabled}`
- [ ] P1/P2/P3 后续计划全表：**`ROADMAP.md`**（SAPI 备选 TTS、读音修正、素材背景、网页界面、批量变体、横屏、封面多风格……）

---

# 2026-10-16 增补（P1-1 SAPI 兜底 + 响度迭代增强）

- [x] **P1-1 SAPI 离线 TTS 兜底（完成，sapi-test 18/18）**：
  - `tools/tts_sapi.ps1`：PowerShell `System.Speech` → wav → ffmpeg 转 mp3；音色优先级 指定 voice > zh-CN > 任意；`-List` 模式给 00 自检枚举
  - 01 四级兜底 `dashscope→edge→gtts→sapi`，新增 `--provider <名字>` 强制参数；**语速实测校准：rate 6 + atempo 1.15 = 7.6 字/秒**（rate 表：2→4.3 / 4→5.3 / 6→6.6 / 8→8.2 字/秒），sapi 同样走 targetCharsPerSec 残差校正（安全带复用）
  - **坑**：whisper 对 Huihui 老式合成音会吞字（「字幕」识别不出）→ 02 逐字不匹配判定正确降级「静音断句+字数比例」，链路不受阻——兜底语义符合预期，勿试图用 prompt 修
  - 00-checkenv 新增可选项 `SAPI 离线语音`（-List 查得到 zh-* 才 ✓）
- [x] **loudnormFile 升级迭代式（三分支回归全过）**：**坑——线性增益撞 TP 上限被截断**：SAPI 音频瞬态峰值高（原始 I=-24.5 / TP≈-8.4），linear 模式 +10.5dB 会把 TP 推爆 → ffmpeg 截增益，输出 TP 顶死 -1.5 但 I 只到 -17.6（QC ±3 外）。修法：测量时预测 `input_tp + (target - input_i) > TP - 0.3` → 自动改 `linear=false`（dynamic 压动态）→ **复测验证贴 ±1.5 才收工，最多 3 轮处理**；返回 `to` 从 target 改为**最终实测**。回归：主路 -17.0→-14.6（linear 一步）/ SAPI -24.5→-15.5（dynamic 撞 TP 极限）/ KTV -11.5→-14.1
- [x] **坑——02 重跑会抹掉 03 的 timeline.outro/cover**：06 对账依赖这两字段，02 重算主体重写 timeline 时若不保留 → 片尾/封面两项消失 + 时长项缺 outro（16 项≠18 项），且 05 在无 outro 字段时 fallback 拼了 outro 素材全长（3.28s ≠ 设计 2.6s）→ 时长对账挂。**已修**：02 写 timeline 前读旧文件保留 `outro`/`cover`。症状识别：06 项数 18→16 + 时长差 ≈outro 素材冗余量
- [x] **P1-2 读音/对齐归一增强（完成）**：
  - **读音实测结论（重要，别再怀疑 qwen）**：10 组经典易错句（3个坑/重庆重新/行长/快乐音乐/长处/得地的/日期/百分比/排名第1/归还）→ DashScope 合成 + whisper 当耳朵回听，**qwen TTS 语境读音全对**，无需任何读音改写词典；兜底 gTTS/SAPI 未测（兜底不求质量）
  - **whisper 转写偏好（勿当错音）**：会把「二零二六」写成「2026」、随机输出繁体（樂/長/個）、同音错写（成→呈）——是转写行为不是 TTS 读错
  - **02 归一三件套**：① 数字归一（原）② 繁简归一 `lib/t2s.js`（OpenCC TSCharacters 生成 3029 字，单字首候选，`gen-t2s.js` 一次性脚本在 TEMP）③ **有界重同步**：失配字在 LOOK=4 窗口重咬、咬不住丢弃该 whisper 字、咬合率 <60% 才整体退回静音兜底
  - **实测提升**：sapi-test（Huihui 吞字 3 字）从「退回字数比例」→「丢弃 3 失配字，逐词对齐成功」；繁体合成 words（15 繁化字）零失配；dashscope 干净路径行为零变化（timeline 逐字节对比一致）
  - **坑**：生成 t2s.js 时对象字面量值忘加引号（`㑯:㑔` 被当标识符）→ 必须 `'k':'v'` 形式
- [x] **P1-4 whisper medium 档位一键切（完成）**：
  - 三个改动点：`align.py` 加第 3 参模型名（缺省 small）+ engine 记录 `whisper-zh/<模型>`（**缓存来源可见**）；02 读 `cfg.ktv.alignModel` 传参并打进日志（超时 15→30 分钟）；`config.json` 加 `ktv.alignModel`（KTV 侧原本就有 `ktv.model` + `--model`）
  - **坑**：换档**不会自动重对齐**——words.json/lyrics.json 有缓存，改 config 后要删对应缓存文件才走新模型
  - 实测：medium 从 hf-mirror 4 文件下齐（约 1.5GB）；sapi-test 对齐 38/38 词 p=1.00、6s 音频 50s（small 约 20s）；**全链 02→04→05→06 = 18/18**（`output/sapi-test-medium` 留档）；small 默认路径回归 18/18 不变
  - **坑**：PowerShell `Select-String` 中文模式匹配 node 的 UTF-8 输出会因控制台编码失配搜不到（表现为「跑完没输出」）→ 用 `*> file` 落盘 + `Get-Content -Encoding utf8`，或直接查产物字段
- [x] **P1-3 素材背景 A+C（完成）**：
  - **方案 A 约定**：`assets/bg-NN.(jpg|jpeg|png|webp)`，NN 任意数字按序排序；`bgImages()` 在 `lib/common.cjs`（03/07 共用）。**约定即配置**：不放文件 = 旧行为，零迁移成本
  - **口播侧**（03 注入，04/05/06 零改动）：`.bg-user` 层插在 `.stage` 后、原 `.bg`（光晕+网格）之下（z-index -2/-1）→ 素材做底、设计语言叠加；`bgLayer()` 注入 `kb-in/kb-out`（镜头序号奇偶交替推近/拉远）+ `--kb-dur`（镜头实长）；封面取第一张静态（duration=null 不带动画）；**outro 片尾卡刻意不加**（CTA 保持纯净暗色）
  - **Ken Burns 原理**：`inset:-6%` 给 6% 过扫余量 → `scale 1→1.06` 不露边；上限锁 1.06（config.background.zoom）
  - **scrim 压暗**：`.bg-user::after` 铺 `#0B0E14` 纯色 + `opacity:var(--scrim-a)`（默认 .5，config.background.scrim）——亮图也能保住白字可读性
  - **KTV 侧**（07）：图数均分全曲时长（slice=(dur+(N-1))/N 保总长），zoompan 每帧推拉（rate 按 slice×fps 均摊，2160×3840 超采再 zoom 减抖动），xfade 链 1s 交叉淡化（offset=k×(slice−1)）；无 bg 文件 → 原 `lavfi gradients` 分支原样保留
  - **实测**：口播 sapi-test（2 图轮播）全链 18/18，帧视觉验证（素材底+网格叠加+砸字+字幕全正常，YAVG 28→46/57）；KTV 6s 测试任务 3 帧抽查（0.8s bg-01 / 2.8s bg-01 推近中 / 5.2s bg-02）轮播与推拉正确；bgm-song-test 无背景回退回归通过
  - **坑**：07 的 `parseLrc` 要求 ≥4 行才认 lrc（防误解析），测试任务歌词要写够行数
