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
