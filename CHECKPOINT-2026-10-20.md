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

---

# 2026-10-21 下午 —— 页面布局优化 + 外部配方入库 002（形似叠化·manual 档首例）

## 布局优化（刷新即生效，静态文件每请求现读）

- 修 grid 自动排位错位：原三卡落位= 表单左上/**技术库右上**/进度预览左下（被长表单压住），
  与 HTML 注释意图相反。改为：**表单列 440px 固定宽置左 | 右列（②进度成片 + ③历史独立卡）|
  技术库底部全宽横排卡片网格**（`repeat(auto-fill,minmax(250px,1fr))`，7+ 卡两行排完）。
  预览视频 max-height 420→520；wrap 1080→1240；断点 880→960。

## 入库 002：形似叠化揭晓（shape-match-dissolve，tier=manual 首例）

- 片源：《“她掉落的发夹是你心中的埃菲尔铁塔”》modal_id=7698932888762447562（7s/1920×1080，
  douyin-archive 已归档，规则.md 已记档）。
- 30fps 逐帧解码：手掰两根发夹成铁塔剪影（A 形道具）→ ~2.45s 同机位换**铜制铁塔模型**→
  ~2.6s 同轮廓叠化换**真实铁塔** → 拉开揭晓求婚场景。**三级形似叠化 match cut**，全程缓推 +
  背景重度虚化掩护 + 短叠化 2~4 帧 + 卡黄金三秒揭晓点。
- 判据（卡内全记）：适合=共同轮廓/同屏位(<15%)/推镜连续/语义关联；不适合=并列信息镜头/
  主体差异大/纯大字卡之间（无主体可匹配，短叠化像渲染失误）。
- **判断结论：素材契约型技法**——工艺层（短叠化+推镜对齐）ffmpeg 零依赖可复刻，但素材层
  （实物轮廓递进）需实拍/AI 生图/用户成对相似素材；用户拍板「只入库配方卡」，不实现接缝模式。

## manual 档位基建（新分类，后续素材契约型技法复用）

- `loadTechniques` 放行：`(!t.insert && t.tier !== 'manual')` 才算损坏——manual 卡无 insert 合法。
- 货架 badge：implemented=可直接用 / **manual=手动配方·看判据**（插入按钮禁用）/ 其余=待实现。
- 规则链路天然安全：chat-rules 第 38 行本就跳过无 insert 的卡；qwen 侧 insert undefined 自动省略。
- `skills/techniques.md` tier 定义补 manual 行；能力清单「节奏」行标注短叠化出处。
- 验证：/api/techniques = 8 卡零损坏；页面冒烟 rightcol/techgrid/shelf 全中。

---

# 2026-10-21 晚 —— 全流程实战出片《8种手机顶部标题栏》（71.8s，QC 18/18）+ 5 项待办（明日从①②开工）

## 实战出片（复刻抖音教学片源风格）

- 片源：《8种好看的手机顶部标题栏怎么跟AI说》modal_id=7689318611546236650，1分56秒横屏，已 douyin-archive 归档。
- 目标：用户要求「用当前功能复刻该片风格出成品，BGM 用桌面周杰伦《我落泪情绪零碎》，≤90 秒，用上技术库」。
- 成品：`output/手机标题栏八式/成片.mp4` · 71.80s · 1920×1080 横屏 · 5.3MB · QC 18/18 全绿 · 11 镜。
- 风格还原路径：源片是「奶油米底 + 深红编号 + 左文右样机 + 黑底白字字幕」。场景引擎只有暗色主题且强制 50% scrim（`bg-user::after`）出不来奶油纸底 → **改走素材镜头**：手写 11 页奶油风 HTML（CSS 手绘手机样机）→ Chrome 无头截图 PNG → `shot.asset` 铺满当镜头画面。文案全原创（8 种标题栏：透明叠图/主副标题/可切换/搜索主导/标题+标签/左对齐/居中/折叠大标题）。
- 用上的技术库能力：关闭逐词高亮（caption-plain）+ magazine 封面 + 收尾降调 −2半音/2s + 收尾延迟回声 40%/1.5s（两者串联叠加）+ 硬切（transitionSec:0，源片是硬切；未硬套形似叠化卡）。
- BGM：周杰伦 45~140s 高能段（RMS 能量画像选出）。

## 关键经验（沿用）

- **音色语速陷阱**：yuxiaoyun_v3.1 实测仅 4.0 字/秒（知性偏慢），400 字读 101 秒、超 30% 安全带校正被跳过 → 成片会破 90 秒上限。换回默认 **loongstella_v3.1**（6-8 字/秒）+ 口播稿从 400 精简到 360 字 → 71.8 秒达标。出片前必须按音色实测语速估时，别只看 targetCharsPerSec。
- **后台 shell 有 300s 上限**：全链 0-6 会被杀在第 5 步中途（merged.mp4 停 0 字节）。对策：前 4 步后台跑、第 5/6 步（合成+质检）前台单独续跑 `run.cjs --steps 5,6`。或整链前台 + 600s。
- **EBUSY 坑**：前台续跑若与后台残留进程并发，会在 unlink 成片.mp4 时报 EBUSY——续跑前确认无残留 node/ffmpeg 锁文件。
- **素材镜头 = 静态**：`shot.asset` 铺满无缓推，长时间看略平（见待办②）。

## 明日待办（按优先级；①②是本次实战暴露的最大缺口）

1. **场景引擎加浅色/纸质感主题**（`sceneStyle:"paper"`：浅底深字、无 scrim）。奶油底知识卡片风（本次源片这类教学片）目前得手动做图绕开引擎，落地后可引擎直出。
2. **素材镜头接 Ken Burns 缓推**：`background.kenBurns` 目前只作用于背景图、不作用于 `shot.asset` 铺满镜头 → 11 镜全静止略平。
3. **字幕条样式可选**（`captionStyle:"bar"` 黑底圆角条）：源片是黑底白字条，我们只有白字+深描边，浅色底上不够稳。
4. **品牌角标位**：场景引擎加常驻 corner-mark 配置（logo 图 + 位置），不用每页手动画。
5. **「左文右图/样机」分栏版式**：UI/产品教学最高频排版，右侧支持引用 assets 样机图。

## 相关文件

- `output/手机标题栏八式/`：成片 + 封面 + 11 张奶油风幻灯片 PNG + shots.json + config.overrides.json（karaoke:false / outroEcho+outroPitch / transitionSec:0）。
- 幻灯片生成器（临时，可复用为 paper 主题参考）：`$env:TEMP\gen-slides.cjs`；任务装配：`$env:TEMP\build-task.cjs`。
- 待清理：`$env:TEMP` 下 `slides_src\`、探针脚本（随系统 Temp 自清，非项目产物）。

---

# 2026-10-22 —— P5 施工①②：paper 纸感主题 + 素材镜头 Ken Burns（均验证闭环）

## P5-1 `sceneStyle:"paper"` 纸感浅色主题（昨日待办①）

- **实现**：`templates/paper.css` 覆盖层——base.css 是令牌驱动，只换 `:root` 令牌（奶油底 `#F2E8D6` / 墨字 `#211E1A` / 深红 `#A5322A` / 赭 `#7A5A2E`）+ 4 处硬编码装饰 override（素材背景暗罩→**纸罩**、青紫光晕→暖赭深红、网格→暖褐纸纹、要点方标辉光→深红低透）。动画全 transform/opacity 无硬编码色，砸字/卡拉OK 自动跟令牌。
- **03-scenes**：`applyDeck` 泛化为 `applyTheme(html, sceneStyle)` + `THEME_CSS={deck,paper}`（classic 查表不中→不注入，零回归）；白名单 `['classic','deck','paper']` fail-fast；paper 日志行。
- **触点同步**：server.cjs SCENE_STYLES 400 / chat-rules（`纸感|奶油|米色|浅色|paper` 规则 + validator）/ chat-qwen 枚举 / 网页两处下拉（新建 + 重跑面板）/ script.md schema 注释 / techniques.md 能力清单 / README 主题切换段。
- **新配方卡**：`techniques/scene-paper.json`（tier=implemented，insert 只用 `shots:{sceneStyle:'paper'}` 与 scene-deck 同构；曾误加 config 键，03 读 `shots.sceneStyle` 优先已去掉）。
- **验证**：paper 探针全链 1-4 → 奶油底墨字深红点缀帧 ✓；classic 回归探针（同任务切 classic 重跑 3,4）→ 暗底白字青点缀 + 暗罩压素材，与改前一致 ✓ 零回归。

## P5-2 图片素材镜头 Ken Burns 缓推（昨日待办②）

- **实现**：04-render 素材分支——图片 asset → `scale 2x cover + crop + zoompan` 居中缓推/缓拉，镜序奇偶交替方向（与 03 背景层 `kb-in/kb-out` 同规则）；`config.background.kenBurns:false` 退回静态原路径（原 vf 分支原样保留）；zoom 级别共用 `config.background.zoom`（1.06）；视频素材本身有运动不加。
- **验证 A/B**（复制真实任务《手机标题栏八式》前 2 镜）：开 → 首尾帧差 YAVG **15.4**（缓推）/**10.6**（缓拉），最大缩放帧满幅无黑边、居中正确、清晰无伪影；关 → **0.015/0.019** 静止 ✓；日志三态分明（`缓推 1.06× / 缓拉 1.06× / 图片铺满`）；渲染 7s/2 镜可忽略。
- **经验**：zoompan `d=ceil(dur*fps)+2` 供帧只多不少、`-t` 兜底裁齐；成片 4.23 vs 设计 4.22 是末帧 pts 取整，05 规整无碍。

## 状态

- 待办③④⑤未动：`captionStyle:"bar"` 字幕黑底圆角条 / corner-mark 品牌角标位 / 左文右图样机分栏版式。
- 昨日成片《手机标题栏八式》未重渲：素材镜头现已支持缓推，可 `--steps 4,5,6` 升级（用户拍板再动）。
- 探针目录 `output/_probe_paper`、`output/_kb_probe` 已验完清理。

---

# 2026-10-22 下午 —— output 大扫除 + P5 三件套 ③④⑤（全链 QC 19/19）

## output/ 测试视频清理（用户拍板方案 A）

- 盘点 21 目录 112MB → **删 17 个纯测试目录、释放 95.6 MB**（bgm-song/asset-test、c-verify、sapi×2、deck-api、dashscope-e2e、bv×2、sq/web-smoke、ktv-bg-test、vc-×5 音色试听）。
- 保留 4：`手机标题栏八式`（用户明确=测试看效果用，不重渲）、`AI短剧变现`、`deck-demo`（P2-9 验收样片）、`零成本流水线-demo`。
- 白名单精确匹配 + 必含 shots.json 双重校验脚本删除；output/ 在 gitignore 内与仓库无关；桌面抖音/B站片源与 BGM 源是现役素材不动。
- 途中 web 服务静默退出（8787 无监听、后台 out 文件缺失）→ 重启恢复；后为拾取聊天新规又重启一次（杀 PID 方式）。

## P5-3 字幕黑底条 `compose.captionStyle`（outline 缺省 | bar）

- 05-buildAss：白名单 fail-fast；`bar` = ASS BorderStyle **3** 实黑盒（BackColour 实黑保任意底可读）+ Outline 转盒内边距（0.3×字号）+ Shadow 0；outline 分支字符串与旧版逐字一致零回归。卡拉OK 扫色在黑底条上正常（探针帧实见已读白/待读灰）。
- config.json `compose.captionStyle:"outline"`；聊天话术「黑底条/底条/字幕条」→ bar、「描边/换回/去掉（双向语序）」→ outline；qwen 枚举+校验器同步。
- **坑**：否定句含关键词——「去掉黑底条」「黑底条去掉」两种语序必须**先判还原意图再判 bar**，否则否定句被反着改（初版 bug，用例抓出后修，8/8 过）。

## P5-4 品牌角标 `config.cornerMark`

- 03 `cornerMarkHtml()`：`src`（任务 assets/ 相对或绝对路径，**缺图 fail**）/ `pos` tl|tr|bl|br 白名单（缺省 br——tr 与 bullet 序号装饰同区、底部中间是字幕）/ `width` 16-1080 / `opacity` 0-1，非法全 fail；相对 scenes/ 引用 `../assets/…`（与 bgLayer 同规则）。
- 注入：每镜（bg 层后）+ outro 片尾卡；**封面不带**（独立发布图）；未配置返回空串零影响。base.css `.corner-mark` + `.cm-*` 四角定位，尺寸走内联 `--cm-w/--cm-op` 随 `--k` 缩放。
- 已知边界：素材镜头（shot.asset，ffmpeg 合成）不带角标；deck 风底部导航条与 bl/br 冲突建议 tr（写进 README）。

## P5-5 分镜 type `split` 左文右图分栏

- 三处 TYPES 注册（02-compile / 03-scenes / 06-qc）+ `templates/scenes/split.html` + `tokensFor` 加 case；bullet 的 items 构建拆成 `itemsList()` 两类型共用。
- schema：`media` 必填（assets/ 文件名，**文件不存在 03 fail**）+ `items`/`note` 至少一项；要点出现时刻沿用 itemTime 按口播词对齐；右图无 data-at 常驻（圆角+投影），`@media (orientation:portrait)` 自动改上文下图。
- base.css `.split/.split-text/.split-media` 挂在 `.s-split` 下 + `.s-split .note/.items:empty` 收空位——其余页型零影响。

## 验证与交付

- **合并探针全链 1-6：QC 19/19**（分镜 type 白名单含 split · 字幕 4 条 · 砸字 1 个）；抽帧目检：split 分栏 + 黑底条字幕 + 右下角标 + paper 主题同帧成立；bullet 帧黑底条卡拉OK扫色可见。
- 聊天解析 8/8 用例（bar/outline 判定 + captionSize/转场/paper 回归不误触）。
- 文档齐：script.md（schema split 示例+白名单+字段说明）、techniques.md 能力清单、visuals.md 类型表+「新增模板步骤」纠偏（TEMPLATES 已不存在，实为 TYPES×3+tokensFor）、README 新增角标/分栏两条+字幕样式一句。
- 演示片：`output/P5三件套演示/成片.mp4`（12s · paper+split+bar+角标 三件套合体，供网页预览）。

