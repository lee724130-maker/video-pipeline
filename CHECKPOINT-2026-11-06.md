# CHECKPOINT · 2026-11-06 —— 项目从 C 盘搬到 D 盘

## 一、为什么搬

C 盘 101G 只剩 **13G 可用（88% 满）**，本项目占 **2.6G**（其中 gitignore 的本地资产 `cache/whisper` 2.0G + `.py312` 409M + `cache/hf` 75M + `output` 69M）。D 盘 38G 有 29G 空余。

**新位置：`D:\剪辑应用`**（与 `D:\AI-Anime-main`、`D:\OpenFilm`、`D:\FreeLLMAPI` 同风格）。

**C 盘原件：已改名为 `C:\Users\Administrator\Desktop\剪辑应用-已迁移待删-20261106` 原地保留，未删除任何数据。**
按用户拍板「先改名隔离，暂不删」。**注意：这样 C 盘空间还没释放**，等确认 D 盘用几天没问题后，把该目录拖进回收站并清空即可真正腾出 2.6G。

## 二、搬迁方式

`robocopy SRC DST /E /COPY:DAT /DCOPY:DAT /XJ /R:1 /W:1 /NFL /NDL /NP /MT:8`（退出码 1 = 有文件成功拷贝，属正常）。
脚本与日志：`workspace/.../move-project.ps1`、`D:\move-project.log`；校验 `workspace/.../verify-move.sh`。
中文路径全部走 **ASCII 脚本 + `[char]0xXXXX` 构造**（沿用本项目立下的 GBK 事故规矩，命令行里不出现中文）。

## 三、验证证据（都实跑，不是推断）

| 项 | 结果 |
|---|---|
| 逐文件路径清单 diff | **0 差异**（两边各 9282 条） |
| 体积 | 2604MB = 2604MB |
| git HEAD / 工作树状态 | 一致（11-05 那 10 项未提交改动原样带过来） |
| 10 个关键文件 md5 | 全对，含 `pipeline/config.local.json`、`pipeline/voice-clone.json` |
| **从 D 盘实跑** | 服务起得来、`/comic` 200、**p21 38/38**、**p7 24/24** |
| `.py312` 自带 Python | `--version` 3.12.9、`sys.prefix` 正确指向 `D:\剪辑应用\.py312`、`faster_whisper` 导入 OK |
| 与原件对照 | whisper/opencc 模块**两边都缺**（既有状态，非搬迁造成） |

## 四、踩到的坑（三枚，都值得记）

### ① 「文件数一致」会骗人——robocopy `/XJ` 把重解析点整个跳过了

`cache/hf/hub/models--Systran--faster-whisper-tiny/snapshots/<hash>/` 里的 **4 个文件是 HF hub 的链接**（`config.json` / `model.bin` 75MB / `tokenizer.json` / `vocabulary.txt`，属性带 `ReparsePoint`，指向 `../../blobs/<sha>`）。`/XJ` 不复制重解析点，于是 D 盘那个 snapshots 目录**建出来了但是空的**。

最阴的地方在于**校验差点放过去**：bash `find -type f` **不匹配符号链接**，所以两边都报 9278，看着完全一致；换成 PowerShell `Get-ChildItem -File -Force` 才暴露出隔离区 9282 / D 盘 9278。

处理：从 D 盘自己的 `blobs/` 把 4 个文件**复制成真实文件**放回 snapshots（不再做链接，Windows 上更稳）。补完两边 9282 = 9282、diff 0 行。

**教训：跨盘搬迁的校验要用「逐文件路径清单 diff」而不是「文件数」，并且至少用两种遍历方式各数一遍**（bash find 与 PowerShell -Force 对链接/隐藏项口径不同）。

### ② `smoke/p7-library-smoke.cjs` 硬编码了项目绝对路径

第 5 行 `const root = 'C:\\Users\\...\\剪辑应用'`，直接违反 `smoke/lib.cjs` 规矩①「项目根一律 `__dirname` 派生，禁任何硬编码绝对路径」。**不修的话搬到 D 盘后 p7 套件会去测 C 盘那份（或测不到）**。已改成 `const { ROOT: root } = require('./lib.cjs')`，从 D 盘实跑 24/24 通过。

这枚违例能长期潜伏，是因为它硬编码的路径恰好一直是对的——**规矩①的价值只有搬一次盘才真正兑现**。

### ③ `.py312` 不是 venv，是完整 Python 安装，所以可搬

`setup.ps1` 用 `TargetDir=$root\.py312` 装的 Python 3.12.9，没有 `pyvenv.cfg`。venv 才不可搬迁（shim 和 activate 脚本烧绝对路径）；完整安装 + 代码用 ROOT 相对路径取 `python.exe` → 换盘无损。已实测确认。

## 五、外部影响（需要别人配合的事）

- **`D:\AI-Anime-main\明日开工-2026-11-03.md` 和 `明日开工-2026-11-05.md` 里仍写着旧路径 `C:\Users\Administrator\Desktop\剪辑应用`**。AI-Anime 已交另一个会话负责，本次未替它改文档；那边开工前需要把引用改成 `D:\剪辑应用`，否则会读到隔离区那份过期副本（改名后旧路径已不存在，会直接报错——这反而是好事，不会静默用错数据）。
- 本项目内部**已无任何绝对路径引用**（`grep` 全仓复查为零）——这正是规矩①的收益。
- 本机其他指向旧路径的入口（若有）：桌面快捷方式、用户自己的脚本。改名后旧路径不存在，一旦用到会明确报错。

## 六、今天剩下的工作（引用 11-05 那份）

P21 漫画格排版页的收尾流程照 `CHECKPOINT-2026-11-05.md` 第五节执行：回归串跑（**从 D 盘**，含 p7/p21 共 13 套件 + 哨兵）→ 填回归结果 → `git add` 只加那 9 个相关文件（**不用 `-A`**）→ 提交 → 推送。

其中 `smoke/p7-library-smoke.cjs` 是今天新加入改动清单的第 10 个文件（硬编码路径修复）。

## 七、下午追加：P22 反馈轮 + 四条生图视频归档 + ①③ 改成交接清单

### P22（本项目，已完成并冒烟 63/63）

用户实测 /comic 提两条：椭圆气泡文字四角溢出、要居中与字色。修完第一版复测仍反馈"左对齐与居中没差别"，根因是**形状贴文字时框内无余量可供对齐**，遂改成文本框模型 + 紧凑度参数。另由《万物皆可矢量图》启发补 **SVG 矢量导出 + text-manifest.json**。细节与教训见 `ROADMAP.md` P22 行。**教训**：控件类断言必须证明"它改变了画面几何或文字位置"，只测"能加载能导出/像素哈希变了"会漏掉静默失效——本轮我连着两次栽在这上面（滑块绑定写错对象、左对齐伪生效）。

### 四条抖音视频归档 + 新增 ASR 工具

按 `douyin_video/规则.md` 归档四条：《6000套4合一素材+comfyui节点》13分04秒、《牛麻了》33秒、《一分钟搞定》30秒、《万物皆可矢量图》35秒，均已追加进规则.md 第四节。

**为省成本改走音频转写**（13 分钟视频若逐张读 14 张总览，token 代价远高于转写），只在核对专有名词时裁画面。新增 `pipeline/tools/asr.py`（复用 `lyrics.ensure_model` 的本地 whisper 缓存）。转写产物：`cache/asr-6000-comfyui.txt`、`asr-牛麻了.txt`、`asr-一分钟搞定.txt`、`asr-万物皆可矢量图.txt`。

**踩坑（已写进脚本头注释）**：`vad_filter=True` 会让进程**段错误退出码 139 且不抛 Python 异常**——silero VAD 模型不在本地缓存，按需下载失败即崩，极难归因。必须 `vad_filter=False`（`align.py` 本来就是这么配的，是我改错了）。`initial_prompt` 同样禁用（会跳过首句）。

**四条视频的结论**（详见当日会话）：真正可落地的只有 4 件——① 资产图提示词必须写死构图（因果已被视频一证实：喂全身参考就出全身）；② 人台线稿不是死路，视频一用 **Qwen 2.1 图像编辑**跑通换装换姿势，出路是换引擎不是换素材；③ 角色一致性走 **Character Profile 单卡**而非三视图；④ 文字/版式归排版层并导出可编辑矢量（本项目 P22 已做）。明确**不做**：装那个 ComfyUI 节点（不在我们链路、素材走网盘+付费群、作者自承是再分发）、随机批量（瓶颈是配额不是功能）、位图转矢量本身。

### ①③ 不在 AI-Anime 动手，改为书面交接

**硬证据**：`开工记录-2026-11-06.md` mtime **18:34**、我检查时刻 18:36:57（那个会话两分钟前还在动）；前端 `App.tsx`/`AppHeader`/`AppShell`/`PageTitle` 17:34-17:35 被改且未提交，不是我改的；提交 `eac534a` 标题「统一 Agnes 2.5/2.1 生图、**新增图片生图片**、专用反推与积分刷新」——**i2i 那边已经实现了**。

①③ 要改的正是他们正在做、且已做了一部分的 `prompt_templates` / 资产生成链路。插进去会做出重复或矛盾的东西，还会把我的改动混进他们未提交的前端改动。**所以 ①③ 我以书面改动清单移交**（见下），不动 AI-Anime 仓库。

**给 AI-Anime 会话的改动清单**：
- ① 改 `prompt_templates` id 2「资产生成提示词增强」：要求显式写构图档位（角色默认 **full-body 全身**，可选 head-and-shoulders / half-body），并禁止默认半身。依据：视频一证实"参考图构图决定输出构图"，我们的 B9 资产图出成半身胸像即此病。
- ③ 新增一条「角色设定卡（Character Profile）」模板：单张图内包含脸部特征 + 多表情 + 服饰细节，作为 r2v 的唯一身份参考。**标注为待验证**——一张卡压多信息 vs 多张图分别喂，谁更稳我们没数据。
- ② 已给报价但**推迟到下次**：`qwen-image-3.0` i2i，参考图上限 3 张（正好人物+姿势+服饰），**1K:3:4 = 12 units/张、2K:3:4 = 20 units/张**，余额 905 units；计划 2 次、最坏 4 次（≤80 units，占余额 8.8%），超即停下重批。**已上传三张测试素材拿到 asset_id，未生成任何图、未扣任何费用。**

### 本仓库收尾

- **p21 冒烟 63/63**（A9 + B6 + C8 + D4 + F9 + G13 + H13 + E2），零计费。
- **回归串跑 19:11:05 完成：14 套件 + 哨兵全部通过，0 失败**（日志 `workspace/.../regression-1106.log`）：p6-check ✅、p9-static ✅、p7-library 24/24 ✅、p9-editor 36/36 ✅、p10-icc ✅、p12-edit-contract 25/25 ✅、p13-timeline 19/19 ✅、p14-wizard 29/29 ✅、p16-console-layout 23/23 ✅、p17-library-enhance 24/24 ✅、p19-cut-export 23/23 ✅、p20-jianying-relay 16/16 ✅、p21-comic 63/63 ✅、guard-sentinel 干净（未发现疑似 GBK 误读目录）。
- **AI-Anime 不在本次提交范围**：用户明确由另一个会话接管开发，①③ 改动清单以桌面文件 `给AI-Anime会话-资产图提示词改动清单-20261106.md` 转交，由用户自行放入该项目。本会话未读写 AI-Anime 仓库任何内容（除只读查看其 git 状态以判断并发冲突）。
- 本次提交文件（7 个，逐个指定、不用 `-A`）：`web/public/comic.html`、`smoke/p21-comic-smoke.cjs`、`smoke/README.md`、`README.md`、`ROADMAP.md`、`CHECKPOINT-2026-11-06.md`、`pipeline/tools/asr.py`。
- 仍**未纳入提交**的既有欠账：`AI漫剧分镜与提示词模板.md`（11-02 起 untracked，等用户定夺）。
