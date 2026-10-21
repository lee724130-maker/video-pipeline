# CHECKPOINT 2026-10-20 —— P3 改片三件套全线完工

## 本次会话交付（6/6，全部验证闭环）

| # | 里程碑 | 提交 | 验证 |
|---|---|---|---|
| ① | 局部重跑 `/api/rerun`（from 1~6 + shots 白名单补丁 + 任务级 config 补丁三层深合并） | `c4ba843` | 400 校验 4/4 · from=6 秒级 · E2E 换风格 classic+字幕开 → QC 18/18 |
| ② | BGM 收尾降调 `compose.bgm.outroPitchSemitones/Sec`（asetrate+atempo+acrossfade 零依赖） | `5492b9e` | 正弦 440→220 精确八度+时长保持 · 真实音乐互相关（尾 0.06 改写/中 1.000 不动）· 05 日志可见 |
| ③ | 技术库货架 `techniques/*.json` + `/api/techniques` + 网页一键插入 | `f23fa1d` | 6 好卡+坏卡直示 · 深合并叠加不覆盖 · 页面要素齐 |
| ④ | 任务持久聊天框 `chat.json`（多线程+规则解析→补丁累积→重跑，历史=审计） | `f23fa1d` | 解析器 17/17（含「转场快一点」不误触语速回归）· E2E：废话不动手/真需求累积/审计落盘 |
| ⑤ | qwen 语义解析（DashScope compatible-mode，key 复用 TTS）+ 失败降级规则模式+界面明示 | `d2d9a7d` | **quota 实测命中**（AllocationQuota.FreeTierOnly）→ 回复带⚠+degraded 下发+规则兜底重跑 ok |
| ⑥ | 技术入库工作流 `skills/techniques.md` + README 改片三件套 | `ba1e44c` | — |

## 关键设计（后续开发沿用）

- **任务级 config 补丁**：`<任务目录>/config.overrides.json` ← web 写入；`runStep` spawn 时经
  `PIPELINE_CONFIG_OVERRIDES` 环境变量交给 `common.cjs loadConfig` 第三层深合并。CLI 不设变量=行为不变。
- **共享重跑引擎**：`startRerun()`（server.cjs 模块级）——/api/rerun 与聊天框同一条路，白名单
  SHOTS_PATCH 单一出处在 `web/chat-rules.cjs`（导出给 qwen 校验同用）。
- **解析双模**：`parseNeed`（规则，17 用例）与 `qwenParse`（语义）同构出参
  `{shots, config, rateSet, rateDelta, from, desc}`；qwen 越权/越界整单拒绝（宁 fail 勿兜底）→ 降级规则。
- **llmState**：`{on, ok, error, kind}`，kind=quota/api/network/nokey；quota 与网络分开措辞，
  GET /api/chat 下发、UI 黄条明示。规则模式零依赖兜底，断供不断片。
- **BGM 降调滤镜链**（可复用模式）：`asplit → [bgb]atrim(end=总-P+0.15) / [bgt]atrim(start=总-P)+aresample→asetrate→aresample→atempo → acrossfade(d=0.15)`；测频用互相关（质心对整谱平移不敏感）。

## 环境事实（重要）

- **qwen-plus 免费额度已尽**：`AllocationQuota.FreeTierOnly`（用户控制台「仅用免费额度/用完即停」）。已按用户要求当面通知。恢复=百炼充值或关「仅用免费额度」开关；期间系统自动规则模式，语义能力（如「再大一点」相对推理）受限。
- GitHub 直连时断时续（reset/timeout 交替），`git -c http.proxy= push` 多试几次能成；全部提交已上远端至 `ba1e44c`。
- web 服务 8787 后台运行（含全部 P3 代码）；重启命令 `node web/server.cjs`。

## 遗留 / 下一步候选

- 用户在网页实测：预览区聊天框说人话改片 + 技术库插入（代码路径已全部 API 级验证，UI 手感待用户体验反馈）。
- 抖音教学视频发来后按 `skills/techniques.md` 入库第一批「外部来源」配方（工作流已文档化，等片源）。
- qwen 额度恢复后无需改动——自动切回语义模式（llmState 只记最近一次状态）。
- 可选增强：聊天框流式回复、配方卡编辑 UI（现在直接改 JSON 文件）、from=5 级 shots 补丁（captions 其实不用重渲场景）。

---

# 中断点 2026-10-20 晚 —— P4 外部配方入库 001（进行中，明日从「声学定案」继续）

## 今日下半场已完成

- **抖音教学视频已入库分析**：《新手剪辑跟练音频收尾技巧》modal_id=7697617115544603939（40s 剪映 PC 录屏），
  douyin-archive 归档至 `桌面\douyin_video\新手剪辑跟练音频收尾技巧\`（8 帧+总览+原声，规则.md 已记档）。
  技法完整解码：尾巴提前分割→包复合片段挂美声（第一层染色）→再包一次挂**延迟回声·强度50**（甩尾）→主轨 0.4s 淡出。
- **qwen3.8-27b 已实测可用**（2.1s JSON 模式正常；qwen3.8-flash 也可用作备胎）→ 已写入 `pipeline/config.local.json`
  `llm.model`（不动仓库默认 qwen-plus；额度恢复后改回即可）。8787 服务尚未重启加载。
- **「BGM 结尾延迟回声」全链路代码完工**：
  - `05-compose.cjs`：尾链改「降调段→回声段」串联（各 0.15s acrossfade）；回声段 =
    `atrim(start=总-E) → afade t=out st=0 d=0.4（教学的0.4s干声淡出）→ aecho=0.8:wet:250|500|750:0.5|0.25|0.125`；
    校验：outroEcho 布尔、Sec 0.2~8、Wet 1~100，E≥总一半 warn 忽略；日志带「收尾延迟回声 W%/Es」。
    顺手留了 `PIPELINE_DEBUG_FC=1` 环境变量可打印真实 fc（排查用，零默认成本）。
  - `config.json`：`bgm.outroEcho:false / outroEchoSec:1.5 / outroEchoWet:50`（教学=50）。
  - `chat-rules.cjs`：回声规则带**上下文门槛**（疑问句「背景里怎么有回声」不动；否定词前后置都吃）。
  - `chat-qwen.cjs`：CFG_RANGE+prompt 补 3 键。`techniques/bgm-outro-echo.json` 配方卡（第 7 张）。
  - `skills/techniques.md` 现有能力清单已加行。
- **测试进度**：规则单测 **17/17**；aecho 脉冲语义 **3/3**（抽头@250ms✓ 递减✓ 强度0.5→1.0≈×2✓）；
  渲染行为：基线/回声 rc=0、坏值 wet=150/sec=99 均非零退出且指名范围；diff 本地化结构正确
  （前 8.25s 逐位相同、8.5s 整点起跳）。

## ⚠️ 中断点：声学验证最后一环有矛盾未定案

成片 wav 包络显示 **B（回声版）与 A（基线）几乎逐 50ms 相同直到 9.25s，然后同时静默**——
看不出 0.4s 干声淡出、也测不到抽头；但同款 fc standalone 复刻（`$env:TEMP\fc-repro.cjs`，已写好**未跑**）
在简化输入上却表现出正常的淡出+抽头（末内容 9.599s=抽头死点）。

**已确认的事实链**（明天别重复排查）：
1. 真实 fc 里 afade/aecho 确实存在（PIPELINE_DEBUG_FC 抓到，字符串与 standalone 一致）。
2. `total=9.95`（timeline 派生，非 10.00）→ 各切点偏 0.05，无伤大雅，但分析窗口要按 9.95 算。
3. compose 的 BGM 输入是 `-stream_loop -1` 无限流 → `atrim(start=X)` 产出无限支路是设计内行为
   （降调段当年就如此，靠 afade+`-t total` 收边）；「[bgq] 内容到 9.599s」= 之后是零采样非流结束。
4. 早前的互相关分析有同索引 bug（比较 B[x..] 与 A[x..] 而非错位），结论作废；包络+RMS 表为准。
5. `_echo_base.mp4`/`_echo_on.mp4` 在 `output/`（测试产物，验证完整后删）；`output/bgm-song-test`
   的 config.overrides.json 已恢复演示补丁（-2/2.5s + caption 76 + 转场0.2）。

**明天第一步**：`node $env:TEMP\fc-repro.cjs` 定案——若复现正常 → 矛盾在成片分析法/拷贝时序，
重渲一版直接量成片即可收口；若复现同样异常 → 对比 fc 与渲染进程差异（疑 sidechaincompress/amix
与无限流交互）。定案后：全套测试收绿 → 重启 8787 → E2E（聊天「结尾加个回声」→重跑 ok →
/api/techniques 7 张卡 → qwen3.8-27b 语义解析活体）→ README/CHECKPOINT → commit + push。

---

## ✅ P4 完工 2026-10-21（本 commit）—— 声学定案 + 全链路收口

### 疑案定案：功能正确，昨天的矛盾是分析方法问题

fc-repro 三视角（同一真实 fc）一锤定音：

| 视角 | 8.5→9.6s 行为 | 结论 |
|---|---|---|
| **[bgq] 回声总线**（音量/淡出/闪避/混人声之前，全电平） | 干声淡出 0.103→0.051→0.019（8.45~8.85）；**8.7 抽头到达反弹 0.026**；涟漪衰减至 9.5；**9.60s 整点精确归零**（=起点8.45+淡出0.4+最大抽头0.75） | 淡出+三抽头甩尾分毫不差 |
| 原始 bgm.m4a 同段 | 全程 0.08~0.11 活跃 | 归零是效果不是片源 |
| [aout] 混音 | 人声主导 0.04~0.16，9.3 后塌陷 | 效应（×0.16 音量+闪避后≈0.001~0.008）被 20 倍以上的人声掩蔽，「看不见」是必然 |

**方法论沉淀**：成片 = 人声+BGM 混音，音频改写验证必须在对应总线直量（ffmpeg 标签规则：
被下游消费的标签不能再 `-map`，截中间总线 = 切段 + `anull` 新出口）；混音级只能做 A/B 差分定位。
另：voice.mp3 实长 9.504s（旁白 ~9.25s 尽 + 尾部静音）→ 混音 9.3s 后塌陷是人声结束，与回声无关。

### 测试与验证（全绿）

- **echo-compose-test 24/24**：新增 T4 = 用 `PIPELINE_DEBUG_FC=1` dump 真实 fc → 断言参数/顺序/接法
  → 字符串截取 [bgq] 段单输入复渲 → 直量淡出/抽头反弹/9.60s 死点（**参数取自真实 fc，无抄写漂移**）。
  混音差分阈值 0.01→0.004（人声抵消后 BGM 差分实测 0.0084；本底噪声 <0.001）。
- **规则单测 17/17**（echo-rules-test）不变。
- **E2E（8787 重启后）**：聊天「结尾加个回声」→ **qwen3.8-27b 语义解析**（「由 qwen 语义解析」）
  → 插入技术卡 → 第 5 步重跑 ok、QC 18/18 → 05 日志「收尾降调 -2 半音/2.5s · 收尾延迟回声 50%/1.5s」
  → config.overrides.json 补丁累积（outroEcho:true 与既有键共存）→ /api/techniques 7 卡
  → llm `{on:true, degraded:false}`。
- 顺带事实：compose 坏值 fail 会先 unlink 旧成片（fail 在 merge 构建之后、最终渲染之前）
  → 坏值渲后无成片，ffprobe 扑空；测试改用音轨长度当总长。

### 落盘清单（8 文件）

`05-compose.cjs` 尾链+校验+日志 / `config.json` 三键 / `techniques/bgm-outro-echo.json`（第 7 卡）/
`chat-rules.cjs` ⑤回声块 / `chat-qwen.cjs` CFG_RANGE+prompt / `skills/techniques.md` 清单行 /
README 货架段收尾能力 / 本 CHECKPOINT。`PIPELINE_DEBUG_FC` 埋点保留（E2E 与测试都在用）。
临时产物 `_echo_base/_echo_on.mp4` 已删（测试每次自行再生）；`$env:TEMP` 三个测试脚本随系统清理。

