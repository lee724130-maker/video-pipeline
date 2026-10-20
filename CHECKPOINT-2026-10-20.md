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
