# smoke/ · 冒烟脚本归档与探针围栏规矩

> 立档缘由：本机两次「中文路径被 PowerShell/子进程按 GBK 误读 → 桌面建出乱码假根」事故
> （10-23 事故，追记 commit 076d5d4；10-26 P9 冒烟后 `Desktop\鍓緫搴旂敤\output\_probe_editor_e2e` 空壳）。
> 加上 P8/P9/P10 冒烟脚本原先只存在于会话临时目录（`%TEMP%\opencode\`，重启即丢），
> 本目录把两者一并收口：脚本入库 + 规矩进代码。

## 三条规矩（对后续所有冒烟/探针脚本强制）

1. **路径只从 `lib.cjs` 派生**：项目根 = `require('./lib.cjs').ROOT`（`__dirname` 派生），
   禁止任何硬编码绝对路径进脚本——中文路径不出现在命令行参数里，GBK 误读就没有施展机会。
2. **探针目录只准走 `probeDir(name)`**：名字必须 `_probe_[A-Za-z0-9_-]+`，只允许落在
   `output/` 或系统临时目录下；越界 `assertAllowedBase` 直接 throw。临时产物一律
   `path.join(process.env.TEMP, 'smoke', ...)`，不落 `opencode` 杂物堆。
3. **清扫靠枚举不靠记忆**：收尾用 `sweepProbes()` 扫 `_probe_*` 前缀删，不依赖当初传入的
   路径字符串——即使某次路径被误读，也不会在项目外留下孤儿目录；崩溃残留下次跑照样被扫掉。

## 哨兵（每次冒烟收尾/收工前跑一次）

```powershell
node smoke/guard-sentinel.cjs                # 只报告（桌面发现疑似乱码目录退出码 2）
node smoke/guard-sentinel.cjs --trash-empty  # 疑似且确为零文件空树 → 自动送回收站
```

判定签名：目录名含 GBK 未定义字节产物（Unicode 私有区 U+E000-F8FF / 替换符）或命中已知
乱码词表（`鍓緫` 等）。回收走 Windows 回收站 API（`recycleAbsPath`，PowerShell 传参纯 ASCII、
中文拆 `[char]0xXXXX`），**永不永久删除**；非空目录一律只报告不动手。

## lib.cjs API 速览

| 函数 | 用途 |
|---|---|
| `ROOT` / `OUTPUT` | 项目根 / output 目录（唯一出处） |
| `probeDir(name)` | 领取 `_probe_*` 探针目录（命名+越界双守卫） |
| `sweepProbes({dry})` | 枚举清扫（dry 只报告） |
| `assertAllowedBase(p, what)` | 目录类越界断言（ROOT 内或 tmpdir 内） |
| `isGarbledName` / `scanGarbled` | 乱码名判定 / 桌面哨兵扫描（只读） |
| `recycleAbsPath(p)` / `psAsciiLiteral(s)` | 安全回收站删除 / ASCII 安全 PS 传参 |

## 归档脚本清单与重放说明

| 脚本 | 对应里程碑 | 重放前置 |
|---|---|---|
| `p6-check.cjs` + `p6-*.cjs` 辅助组 | P6 平台发布规格 | 8787 服务在跑（部分纯静态检查项无前置） |
| `p7-library-smoke.cjs` | P7-1 素材库（24 项） | 8787 在跑；现场自备份自还原 |
| `p7-2-imagegen-smoke.cjs` + `p7-2-probe.cjs` | P7-2 AI 生图（47 项） | 8787 在跑；**D 组真实生图 1 张会计费**，重放注意 |
| `p8-clone-smoke.cjs` | P8 语音克隆（29 项） | 8787 在跑；**D 组真实复刻计费**；样本夹具在 `fixtures/p8-clone-sample.mp3` |
| `p9-static.cjs` / `p9-editor-smoke.cjs` | P9 Editor 轻改（静态 8 / 冒烟 34 项） | 8787 在跑 |
| `p10-icc-smoke.cjs` | P10 枚举条目色标（27 项） | 8787 在跑，cwd=项目根；零计费 |
| `cpsync-diag.cjs` / `desktop-scan.cjs` | 环境雷诊断 / 桌面事故侦察 | 只读或只写 tmp，随手可跑 |

各脚本计费/清理行为以文件头注释为准；跑完以退出码 0 与「FAIL 计数 0」为准。
