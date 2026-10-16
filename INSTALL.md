# INSTALL.md · 安装与依赖清单

> 这份清单是「缺了什么就跑不通」的完整对照表。全新 Windows 电脑照第 2 节按顺序装，5~10 分钟可跑通。

## 1. 运行前提

| 项 | 要求 | 为什么 |
|---|---|---|
| 操作系统 | **Windows 10/11**（硬性） | 脚本依赖 Windows 机制：`py` 启动器、`hypit.cmd`、.exe 路径、PowerShell |
| 硬盘 | 约 3 GB 空闲 | ffmpeg ~300MB、whisper 环境+模型 ~1GB、hypit/Chrome 已有则不占 |
| 网络 | 能访问 `dashscope.aliyuncs.com`（国内直连，不需要代理） | 配音合成；其余全部离线 |

## 2. 必装清单（缺了跑不通主链路）

按顺序执行：

### ① Node.js ≥ 18
下载：https://nodejs.org/ （LTS 即可，本项目在 v22 验证）。
流水线全部脚本是 Node 写的，**没有 Node 一步都跑不了**。

### ② ffmpeg + ffprobe（编解码，出片核心）
三选一，任选其一即可：
- **PATH 方式**：`winget install Gyan.FFmpeg` 装完重开终端（ffmpeg 在 PATH 里自动被找到）
- **便携方式**：下载 https://www.gyan.dev/ffmpeg/builds/ 解压到任意目录，把 bin 目录写进 `pipeline/config.local.json` 的 `"ffmpeg": "D:/你的路径/bin"`
- 兼容老位置：放在 `D:/ffmpeg/bin` 或 `C:/ffmpeg/bin` 也会被自动探测到

### ③ Google Chrome
场景动画是本地浏览器录制的，**没 Chrome 录不了画面**。
装 Chrome 即可：https://www.google.com/chrome/ （已装则跳过）

### ④ hypit CLI（浏览器录制工具）
```
npm install -g hypit
```
Node 装好后一条命令。04 步用它把场景 HTML 录成视频片段。

### ⑤ DashScope API key（配音）
1. 阿里云百炼（原 DashScope）注册领免费额度：https://bailian.console.aliyun.com/
2. 复制 `pipeline/config.local.example.json` 为 `pipeline/config.local.json`
3. 把 key 填进 `"voice" → "dashscope" → "key"`（或设环境变量 `DASHSCOPE_API_KEY`）

> ⚠️ **key 永远只写在 `config.local.json`（已被 gitignore），不要写进 `config.json`。**
> 没有 key 也能出片：配音四级兜底 dashscope → edge-tts → gTTS → **SAPI（Windows 自带语音，纯离线）**。
> 但兜底音色是机器音、无逐词时间戳（字幕时间轴走字数比例），正式片建议配 key。

## 3. 可选件（不装也能出片，装了更好）

### ⑥ 系统 Python + gTTS（联网兜底）与 SAPI（纯离线兜底）

配音兜底链：DashScope（无 key 跳过）→ edge-tts → gTTS → **SAPI**，前三级都需要联网。

- **gTTS / edge-tts**：需要系统 Python（Microsoft Store 的 `py` 启动器即可）：
  ```
  py -m pip install gTTS
  ```
- **SAPI（Windows 自带，零安装零联网）**：Windows 出厂带中文语音（Huihui 等），断网/无额度时
  01 会自动顶上，语速目标 7.2 字/秒（与主路同标准）。00 自检显示 `SAPI 离线语音 ✓` 即可用；若显示
  「无中文语音」，去 Windows 设置 → 时间和语言 → 语音 添加中文语音包。
  强制使用：`node pipeline/01-tts.cjs <任务目录> --provider sapi`

### ⑦ whisper 环境（逐词字幕对齐 + KTV 识别兜底，推荐装）
```
powershell -ExecutionPolicy Bypass -File setup.ps1
```
- 自动下载 Python 3.12.9 装进项目内 `.py312\`（与系统 Python 隔离）
- 依赖版本锁死（ctranslate2 4.5.0 等，原因见 `requirements-whisper.txt` 注释，勿手动升级）
- 模型文件首次使用时自动从 hf-mirror 下载到 `cache/whisper/`（small 约 464MB；对齐精度要求高可切 medium 约 1.5GB：`config.json` 改 `ktv.alignModel`/`ktv.model` 为 `"medium"`，并删对应任务的 `audio/words.json`（或 `lyrics.json`）触发重新识别，耗时约为 small 的 2~3 倍）
- **不装的后果**：字幕时间轴退回「字数比例估算」（会有轻微漂移）；KTV 仍可用 lyrics.lrc/lyrics.txt 输入，仅识别兜底不可用

### ⑧ 代理（仅国内访问 gTTS/edge 兜底时需要）
有梯子就写进 `config.local.json` 的 `"proxy"`；DashScope 主路径不需要。

## 4. 验证安装

```
node pipeline/00-checkenv.cjs
```
全部 ✓ 即就绪（⚠ 是可选项）。想连带测配音连通性：
```
$env:CHECKENV_NET="1"; node pipeline/00-checkenv.cjs
```

## 5. 跑第一条视频

```
node pipeline/run.cjs output/demo
```
前提是 `output/demo/shots.json` 存在（分镜表，由 AI 按 `skills/script.md` 生成）+ `output/demo/narration.txt`（口播文案）。
产物：`output/demo/成片.mp4` + `封面.png` + `qc/` 抽帧 + `qc-report.txt`。

也可以用网页界面（零命令行）：
```
node web/server.cjs
```
浏览器开 `http://127.0.0.1:8787`，填文案 → 点「一键出片」即可（分镜自动按句拆分）。

KTV 歌词视频：`node pipeline/07-ktv.cjs output/<任务> --song 歌曲文件名`

## 6. 配置体系

| 文件 | 进 GitHub？ | 用途 |
|---|---|---|
| `pipeline/config.json` | ✅ 进 | 团队共享默认值（音色/字幕/BGM/响度/封面等全部可调参数） |
| `pipeline/config.local.json` | ❌ 不进（gitignore） | 本机私有：**API key**、代理、本机 ffmpeg 路径 |
| `pipeline/config.local.example.json` | ✅ 进 | 模板，复制改名后填 |

加载规则：`config.local.json` 深度覆盖 `config.json`，只写要改的字段即可。

## 7. 常见坑（都踩过，勿再踩）

| 症状 | 原因与解法 |
|---|---|
| 04 步渲染失败「hypit not found」 | 没装 hypit 或没重开终端：`npm i -g hypit` |
| ffmpeg 报错找不到 | 按②三选一配好，再跑 00 自检 |
| DashScope 401 | key 失效/欠费；检查 config.local.json |
| 配音时长不对/字幕错位 | DashScope mp3 头时长不可信，脚本已做解码实测，勿手动改 -t |
| whisper 加载段错误 | ctranslate2 版本不对，必须 4.5.0（见 requirements-whisper.txt） |
| KTV 模型下载失败 | hf-mirror 偶发限流，脚本自动重试；也可手动下模型放 `cache/whisper/<名>/` |
| 代理报错连不上 | `config.local.json` 的 proxy 没梯子就留空串 `""` |
