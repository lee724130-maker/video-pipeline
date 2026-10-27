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

---

# 2026-10-23 —— 已知缺口收口：素材镜头角标 + ROADMAP 补记（用户拍板「先补已知缺口+收口文档」）

## P5-4 收口：素材镜头也带品牌角标（此前只有场景镜有，品牌不齐）

- **单点解析**：`common.cjs` 新增 `resolveCornerMark(task)`（校验 src 存在/pos 白名单/width 16-1080/opacity 0-1，非法全 fail），
  03 与 04 共用——03 的 cornerMarkHtml 只剩 HTML 转换，校验逻辑不再两处重复。
- **04 素材分支**：`-vf` 单链改条件 `filter_complex`——`[0:v]<原链>[base]; [1:v]scale=width×k,format=rgba,
  colorchannelmixer=aa=opacity[cmk]; [base][cmk]overlay=x:y[vout]`。几何与 base.css `.cm-*` 严格同源：
  边距 `round(48×k)`、宽 `round(width×k)`、四角用 overlay 表达式（`main_w-w-边距`，免探测 logo 像素）。
  **未配置时仍走原 `-vf` 单链，参数逐字与旧版一致（零回归）**；KB 缓推链与叠加链可同时生效（角标叠在缩放后画面，位置稳定不随推镜漂移）。
- **验证（探针 output/_probe_cm，横屏 1920×1080，场景镜+素材镜各一条，pos=br/width=150/opacity=0.9）**：
  - 全链 1-6 QC **18/18**；日志两态齐：`品牌角标注入每镜`（03）+ `素材 mockup.png · 角标 br`（04）。
  - **逐像素对位**：两镜中点帧右下红 logo bbox 完全一致 `x[1722-1871] y[882-1031]`（=右边距 48、下边距 48、150×150），
    redPx 20416 vs 20426（差 10/22500 = Chrome 抗锯齿 vs ffmpeg alpha 合成的边缘差）——HTML 与 ffmpeg 两条渲染路径同位同尺寸。
  - **无配置回归**：04 无 overrides 重渲 → 素材镜 redPx=0、日志无角标后缀；03 无 overrides → 场景 HTML 无 `cm-br` 元素、无 `--cm-w` 内联。
  - 踩坑留档：CSS 注释里有字面量 `<img class="corner-mark">`，直接在 HTML 全文上跑正则会**误报有元素**——
    验「有没有元素」必须剥掉 `<style>` 段（或查 `cm-<pos>` 类/`--cm-w` 内联特征）。
- 已知边界不变：KTV（07）不带角标；封面不带（独立发布图）；deck 风 bl/br 与底部导航条冲突建议 tr。

## ROADMAP 收口（停在 10-16 → 更新至 10-23）

- 新增「✅ P3~P5 · 打磨冲刺」段：P3 改片三件套 / P4 外部配方入库+声学定案 / P5 打磨五件套 各一行（内容+验证数据）。
- **编号撞车处理**：ROADMAP 原「⬜ P3 · 远期」改名「⬜ 远期」——CHECKPOINT 的 P3/P4/P5 是冲刺号（现已全网沿用），
  阶段号 P3 与之同名不同义，弃阶段号保留冲刺号；远期四条候选（素材库/AI 生图/平台 profile/语音克隆）不动。
- 维护备忘补一行施工记录指针 → `CHECKPOINT-2026-10-20.md`；README 品牌角标行改「场景镜+素材镜（ffmpeg 同几何）+片尾卡」。
- 收口后状态：**显性 backlog 清空**（P3~P5 全完工、远期为按需启动项）；下一批工作等新片源（techniques.md 六步入库）或用户新目标。

---

# 2026-10-23 ② —— P6 平台发布规格（远期 11 转正，用户点名启动）：按发布平台选规格出片

## 用户需求
> 视频按发布平台出不同规格：发抖音选抖音规格（竖屏短视频）；发 B 站等平台用横屏长视频规格。

## 实现（7 文件）
- **数据层** `pipeline/config.json` 新增 `platforms` 表：`douyin`/`shipinhao` 1080×1920、`xiaohongshu` 1080×1440（3:4）、`bilibili` 1920×1080；字段 `label/width/height/durHint` + 可选覆盖键 `safeTop/safeBottom/captionSize/captionMarginV`——**缺省不写 = 沿用按画幅缩放的现行公式（零视觉回归），写了才覆盖**；加平台零改码。
- **schema** `shots.platform`（白名单=config.platforms 键）→ **02 查表**写 timeline（画幅 + 覆盖键 + durHint>0 才写）；与显式 width/height **值**不一致 fail、表缺整数宽高 fail、未知键 fail（报错全带可选项清单）。
- **03** sizeVars：`timeline.safeTop/safeBottom` 存在时按 `h/1920` 缩放后覆盖公式；**05** buildAss：`timeline.captionSize/captionMarginV` 覆盖 config（缺省走 config 不变）；**06**：`durHint` 超档只 warn 不拦（QC 项数不变）。
- **web**：create 校验 platform 白名单 400 + platform/width 同传 400 + 选平台只写 `shots.platform`（画幅单一出处）；`startRerun` platform 补丁**让位删除**旧 width/height、platform+width 同补丁 400、**画幅类补丁 from 钳到 2**；网页「发布规格」下拉两组（平台组在前默认抖音 / 自定义组三尺寸原样，`plat:*`/`size:*` 分派）；聊天平台词 + 否定守卫（「别发抖音」不认，正反语序都挡）；`SHOTS_PATCH.platform` 动态查 config 表（大小写/注入串/未知键全拒）；qwen prompt 枚举 platform + from 档改 2。
- **存量坑顺手收口**：`--from 3` 跳过 02 → 画幅补丁从 3 起跑会留**旧画幅时间轴**（width/height 旧规则就有这毛病）。三处收口：parseNeed 返回钳 2、startRerun 入口钳 2（兜住 qwen/手动 API）、qwen prompt 改档。

## 验证（11 组全过）
- **单测 27/27**（p6-check：语法×7 + config 表 + 规则×14 + SHOTS_PATCH×6）。
- **A 网页建任务 douyin**：shots 只有 platform、`[02] 平台规格 douyin（抖音）→ 1080×1920 · 时长档 180s`、QC 18/18。
- **B 小红书 3:4 新画幅首测 + 覆盖键全链**（`PIPELINE_CONFIG_OVERRIDES` 注 safeTop 150/safeBottom 300/captionSize 72）：timeline 六键齐、场景注入 `--safe-top:113px;--safe-bottom:225px`（150×0.75 取整）、ASS `Fontsize: 72`、帧检 3:4 版面正常字号肉眼变大、18/18。
- **D 无 platform 旧路径**：timeline 只有 width/height、18/18 零漂移。
- **E `/api/rerun {from:3, platform:bilibili}`**：响应 **from=2（钳制生效）**、1920×1080、18/18、durHint 不写（=0 关档）。
- **E2 聊天「改成发小红书」**：**qwen 语义直出 platform/from=2**（二选一指令生效，回复「改成小红书平台规格 · 由 qwen 语义解析」）、1080×1440、18/18。
- **C 网页自定义方形**（非平台组）：shots 无 platform、1080×1080、18/18 旧路径零回归。
- **负例 3×400**：未知平台（报白名单四键）/ platform+width 同传 ×2（**值相同也拦**——单一出处不容两处并存）。
- **02 fail×2**：`shots.platform 非法: hack（白名单: douyin / shipinhao / xiaohongshu / bilibili）`、`width=1920 与平台 douyin（1080×1920）冲突——platform/width 二选一或对齐值`，exit=1。
- **durHint warn**：`⚠ 平台「douyin」时长档 2s：当前 13.6s 超档（参考值…）` + 18/18 照过不拦。
- **UI 冒烟 12/12**（下拉两组结构 + spec 分派 + 内联 JS `--check`；本会话无桌面浏览器，脚本抽取校验替代）。

## 坑与决策（后续沿用）
- **改 web 代码必先重启 8787**：首轮 A 白跑——服务是旧会话起的进程，内存旧代码把 platform 静默丢弃（建任务不报错、照常出片，极隐蔽）。杀进程重起后重做才对。判别法：看任务 shots.json 有没有 platform 键。
- **`fs.cpSync(src, dst, {recursive:true})` 本机静默崩**：exit 1、无异常、无 stderr（疑似杀软钩子拦拷贝）；测试脚本改 `readdirSync+copyFileSync` 循环绕开。项目代码未用 cpSync，不受影响。
- **默认下拉 = 抖音组**（有意变更）：产品定位即抖音短视频工具（用户原话「选抖音」）；默认建任务 shots 带 platform 而非 width/height，像素与旧默认 1080×1920 完全一致，只多一行时长档日志。
- **小红书取 3:4**（区别于抖音竖屏的特色画幅，也是拿到 3:4 的唯一入口）；「竖屏发小红书」类两词同写 → 02 冲突 fail 报错自明，重发「发小红书」即可。
- **聊天否定守卫宁缺勿错**：命中否定词整块不判平台（「别发抖音」零改动落空），复杂语义交给 qwen；画幅词照写 width/height——与平台值一致 02 放行、矛盾 02 精确报错，规则层不重复造冲突逻辑。
- 探针全清：`_probe_p6_*`×4 + `P6探针A抖音` + `P6回归C方形`（output 只留 5 白名单目录）。

## 状态
**P6 完工**（远期 11 → ✅，ROADMAP 冲刺段扩为 P3~P6）。显性 backlog 再次清空；远期剩素材库 / AI 生图 / 语音克隆，等需求启动。

## 入库实跑首例（技术视频 → 配方卡，追记）
- **片源**：抖音@Ludi `modal_id=7698358547440094502`《Vibe知识大赏丨别再管所有弹出来的东西都叫"弹窗"了》2026-10-19，1分56秒 1080×1620；douyin-archive 六步走通：原片+原声+抽帧23+总览2+页面截图，落 `桌面\douyin_video\`。
- **拆解定档（三档各取一张，正好演示货架对成熟度的分层处理）**：`item-color-code` 枚举条目色标 = **new**（`keywordColour` 现为 config 级全局单色，逐条换色+底部进度轨待施工，按钮禁用「待实现」不藏短板）；`right-wrong-split` 正误对照双栏、`recap-map-outro` 收尾一图收点 = **manual**（素材契约：成对同构图两态/左右绿红素材，split 装载，无 insert 只给判据做法）。source 全部留痕 modal_id。
- **顺手修 bug**：server.cjs 配方加载器只给 manual 开「省 insert」的口子，techniques.md L16 承诺的 new 档货架待遇（待实现徽章+禁按钮）没兑现——前端 396/400 行早已支持，server L150 补 `t.tier !== 'new'`，重启 8787 生效。
- **验收**：12 卡 0 broken（HTTP API + node 直读 techniques/ 双口径一致）；聊天点名回归：「把纸感教学风用上」→ `sceneStyle=paper` from=3 照常命中；manual/new 卡名不产补丁 = 设计行为（parseNeed L38 无 insert 跳过，点名即应用补丁，无补丁可应用）。演示不烧渲染额度，「插入重跑 QC」闭环待 implemented 新卡立项后再走。
- **用户反馈追加：货架按 category 分组**（12 卡平铺难分辨）——refreshTech 改为按 `t.category` 分组 + 组头（`.cathead` 全宽横线 + N 张计数），组序固定 画面→封面→字幕→声音→转场、未知类排后；卡内重复的 category 徽章移除。内联 JS 编译检查过、真实 12 卡分组仿真 5/1/2/2/2 全对账；index.html 磁盘直读（server 425 行）改静态页免重启。

## P7 素材库接入（2026-10-23 追记）
- **动线**：用户指示「Editor 手动剪辑页的想法记清单不开发，按 ROADMAP 顺序继续」→ 远期 9 转正为 P7-1；Editor 手动剪辑页入远期 13（参考源已摸底：`D:\AI-Anime-main` `/editor` 三轨时间轴 + PropsPanel + 后端 ffmpeg 转 workflow 渲染，可抄 DragState/0.1s 网格/400ms 防抖撤销/预览区文字拖拽；Canva 链接在案）。
- **数据面**：`library/{bgm,images,clips}` 三类白名单——bgm 用 `BGM_EXTS`（common.cjs 导出，与 findBgm 同表单一出处）、images jpg·jpeg·png·webp、clips mp4·mov·webm·mkv；隐藏文件与表外扩展静默忽略不报错。选用=复制制（任务自包含，与库文件脱钩）：BGM 走 `libBgmInto` 清旧 `bgm.*` 再落 `bgm.<ext>`（findBgm 按扩展名表首命中，留旧必歧义）、图片 `mode=bg` 自动编下一号 `bg-NN`、原名复制撞名 409。
- **create 分支**：`bgmFromLibrary` 与自带 base64 **二选一**（同传 400；验证插在平台校验后、variants 循环前——排队前返回不落任务目录），正例复制与 /api/library/add 共用 `libBgmInto` 同一实现。
- **网页**：底部素材库全宽区（目标任务下拉默认最新任务 + 三分组 `.cathead` + 每行选用按钮 + `libMsg` 回执带生效步骤提示）；表单 BGM 下拉 `#bgmLib` 与面板共用 `/api/library` 数据，与自带上传双向互斥（前端清值、服务端 400 双保险）。
- **验证（冒烟 24/24）**：列表过滤×5、负例×5（kind 白名单/穿越文件名/错扩展/库无此文件/任务不存在）、正例×8（BGM mp3→wav 换装且旧文件清理、`findBgm(TDIR)` 真实契约命中 `bgm.wav`、bg-NN 自动编到 01、原名复制+同名 409、clips 复制）、create 早校验×3（同传 400/无文件 404/错扩展 400 + 未落任务目录）、现场还原（deck-demo assets 备份比对原状 + 种子文件自清）。服务重启后服务端页面三要素（素材库区/refreshLib/bgmLib）在线核验通过。
- **README 同步**：流程句挂素材库选用、技术库「7 张卡」过期数字改 12（P6 漏改）、目录树加 `library/`、素材模式+BGM 段加 P7 条目。


## P7-2 AI 生成画面（远期 10 转正，2026-10-23 追记）

- **动线**：上一环节收尾后用户「继续吧」→ 按 ROADMAP 顺序远期 10 转正。设计底线两条：**有 key 才启用、零成本默认一分不动**——
  落法是**网页手动触发**，管线六步永远不会自动调它（零成本的硬保证）；没配 key 时界面只显示启用说明（`GET /api/meta` 新增 `imagegen` 状态驱动），出片流程零调用零影响。
- **端点定案（零成本探针钉死，辨路全程 0 元，唯一一次真实调用留给验收）**：
  - 正确域名是千问AI平台 `https://maas.qianwenaiapi.com/compatible-mode/v1/images/generations`（官方 curl 示例直接 `$DASHSCOPE_API_KEY`——同一把 key 通吃）；
    `dashscope.aliyuncs.com` 老域名**没有** images 路径（空 body 404 = 首轮真实调用踩的坑，已留档进 server 注释）。
  - OpenAI 兼容文档枚举只写 `3.0-pro/3.0/2.1-pro`，**实测 `qwen-image-2.1-turbo` 可用**（模型是否可用以服务端报错为准，不照文档白名单自我阉割）；
    `qwen-image-3.0` 免费额度已尽且「仅用免费额度」开着 → 403 `insufficient_quota`，错误处理转中文提示（充值或关免费额度模式）。
  - 尺寸契约以**线上实测**为准：面积 512²~**2560²**（6553600，与文档 2048² 不符）、字母 `x` 分隔、`auto` 可选；`checkImgSize()` 一处同时过请求值与 config 默认值。
  - 探针方法论：**非法模型/非法尺寸必 400 且不生成**——先用坏模型辨路径（404 model_not_found=路径在、空 body=路径不在），再用真模型+坏尺寸辨额度（尺寸错误=模型与额度闸全过），一分钱没花把域名/模型/额度三件事全部钉死。
- **实现**：`pipeline/config.json` 新增 `imagegen` 段（endpoint/model=`qwen-image-2.1-turbo`/size=`1024x1920`/timeoutMs=180000/**key 恒空**——key 只进 `config.local.json` 的 `imagegen.key` 或 `voice.dashscope.key`、或环境变量 `DASHSCOPE_API_KEY`；meta 与响应永只回 key **来源**不回本体）；`config.local.example.json` 补 `imagegen.key` 空位（留空即回落复用 TTS key）。
- **server**：`POST /api/txt2img` {prompt, size, attachTask, attachMode}，顺序：未启用 400（报 key 来源+三个启用路径）→ 并发 409 → prompt 空/超 2000 字 400 → 尺寸契约 400 → **附加入选任务 404（花钱前拦截，不许生成成功后才发现任务不对）** → 同步生成（AbortController 超时）→ 服务端立即下载（结果 URL 只有 24h）→ PNG 魔数校验 → 落 `library/images/ai-<本地时间戳>.png`（撞名追加 `-2`）→ 附加入任务**复用 `libraryAdd`**（与素材库选用同一实现）→ 回传 dataUrl 供即时预览；502=上游失败（错误体非 JSON 时原文入错）；`imgBusy` 串行防重复扣费。
- **网页**：素材库卡内 `✦ AI 生图` 区（prompt + 尺寸下拉 auto/9:16/16:9/1:1/3:4 + 生成按钮 + 结果预览 + 「作 bg-NN 加入上方所选任务」勾选复用 `#libTask`）；`initAI()` 按 meta 两态切换（操作区 vs 灰字启用说明，含启用三路径与 `imagegen.enabled=false` 关死开关）；素材库 h2 提示同步挂一句。
- **验证（冒烟 47/47，`$env:TEMP\opencode\p7-2-imagegen-smoke.cjs`）**：
  - A 静态 20：内联 JS `--check` + 页面 8 个 id / initAI / genImage + server 路由/状态/尺寸契约 + config 段且 key 恒空；
  - B 无 key 负例 7：`PIPELINE_CONFIG_OVERRIDES` 空 key 补丁起 **8799 副本实例**（剥离 `DASHSCOPE_API_KEY` 环境变量）→ `enabled=false`+`where=未配置`、400 带启用方法、**响应无任何 key 字段**；
  - C 主实例不花钱负例 8：enabled/来源/模型白名单 + 空 prompt / 面积超界 / 超长 prompt 400 + 附加入不存在任务 404（花钱前拦截）；
  - D 真实生图 12：200 → 落库 PNG 魔数 ≥50KB、dataUrl 预览、附加入 deck-demo `bg-NN`、**deck-demo assets 前后比对还原零残留**；留样 `library/images/ai-20261023183337.png` 交用户过目（「仅用免费额度」模式开着，付费通道本来就是关的 → 这张走的免费额度）。
- **坑与决策（后续沿用）**：
  - **文件名时间戳首版用 `toISOString()`=UTC 差 8 小时**（`ai-20261023103337` 实为本地 18:33）→ 改本地时间拼串，留样同步改名；用户看文件名对不上墙钟必当 bug 报。
  - **改 config.json / server.cjs 必重启 8787**（meta 与路由都挂在 require 时加载的 cfg 上——本轮重启 3 次：P7 代码 / 端点修正 / 时间戳修正）。
  - 模型可用性**不照文档白名单**：文档枚举没有 turbo，但 config 默认 turbo 是唯一在当前账户状态下真能出图的档（3.0 额度尽）——白名单照收四档，实际能不能用由上游 400/403 说了算，错误信息翻译成人话。

## 今日收尾（2026-10-23，收工 · 8787 保持运行待用户实测）

- **本轮四发全部已推 `main`**：入库实跑首例三卡（`5e262ea`）→ 货架按 category 分组（`98e305d`）→ P7-1 素材库（`0a95858`）→ P7-2 AI 生图（`23f117f`）。
- **服务不关**：8787 后台进程加载的是 P7-2 最终代码（含端点修正与本地时间戳），用户实测中；页面 `http://127.0.0.1:8787`，改静态页 F5 即取新，动 `server.cjs`/`config.json` 才需重启。
- **留给用户实测的点**：① 素材库刷新 / 选用 / 生效步骤提示手感；② 货架分组观感（组序、计数）；③ ✦ AI 生图：出图→预览→勾选附加入任务→从第 3 步重跑看背景轮播（留样 `library/images/ai-20261023183337.png` 可删可留）；④ 换无 key 环境看「未启用」提示文案。
- **剩余工作（下次按序继续，均已在 ROADMAP 在案）**：
  1. 远期 12 **语音克隆音色**——DashScope 声音复刻，需 API 支持与额度，等用户拍板；
  2. 远期 13 **Editor 精修页**——立项先定：编辑结果回写 `shots.json` 走局部重跑 vs 独立成片精修器；参考源（`D:\AI-Anime-main` / Canva 链接）已摸底在案；
  3. 技术侧 `item-color-code`（new 档）立项施工——逐条换色 + 底部进度轨，完工后跑「插入重跑 QC」完整闭环演示（技术库链路的最后一环）；
  4. 用户实测反馈收集（素材库 / 货架分组 / AI 生图）→ 按反馈再修。

## 桌面乱码目录事故追记（2026-10-23 用户报障，已查清并清除）

- 桌面出现过 `鍓粫搴旂敤`（实为 `剪辑应用` 的 UTF-8 字节被按 GBK 误读后建成的目录，GBK 编码还原与真名 UTF-8 字节**逐字节一致**）：今天 16:13 P6 负例测试时段，某环节把中文 ROOT 经 936 代码页走了一遭，探针任务 `output/_probe_p6_f1_badplat/audio` 落进了这个假 ROOT；当时「探针全清」只清真 `output/`，漏了它。文件名还含私用区字符 U+E047，各软件显示不一致。
- 同日一并清除项目内同族垃圾 `UsersADMINI~1AppDataLocalTemp\badtest`（10-16 产物：带反斜杠的绝对路径丢了 `\` 被当相对路径创建）。两目录**删除前结构复核、删除后验证**，git status 干净、真身 19 项完好。
- **教训固化**：凡中文路径经 PowerShell 命令行/控制台传递的环节都可能被 GBK 误读——本项目第二次踩（第一次只是显示乱码，这次**建出了实体目录**）。此后规矩：探针/脚本里的中文 ROOT 常量一律用 write 工具落盘（UTF-8 直写），禁止内联进 PS 命令行。

## P8 · 语音克隆重工（2026-10-26，远期 12 转正，冒烟 29/29 全绿）

### 立项与探针（零成本方法论第三次实战）

- 隔三天复工：先核查（git 干净、output/library 无用户新产物、**8787 已因重启挂掉**→ 拉起），再按清单顺序启动远期 12。
- **API 摸底**（websearch + 官方文档）：声音复刻 = `POST /api/v1/services/audio/tts/customization`，`model:"voice-enrollment"` 固定，`input.action` 换操作：`create_voice`（target_model+prefix≤10 字母数字+audio URL 或 **Base64 Data URI**+language_hints+max_prompt_audio_length 3~30s）/ `list_voice` / `query_voice` / `update_voice` / `delete_voice`；返回 `output.voice_id`，**官方口径 voice_id 格式 = `{target_model}-{prefix}-{唯一标识}`，直接当合成的 voice 参数**；审核态 `DEPLOYING→OK/UNDEPLOYED`。计费口径（文档两处矛盾，以实践文档为准）：CosyVoice 系列创建免费、**Qwen 系列 ¥0.01/个**（创建失败不计费）；MiniMax 支线（9.9 元解锁费）不用。
- **探针三发**（`$env:TEMP\opencode\clone-probe.cjs`，全零成本）：① `list_voice` on dashscope 老域名 → **200**（不像 images 那样 404，不用 WorkspaceId！）② qianwenai 域名 → 200（备用）③ `create_voice` 坏样本 → **400 `Audio.DecoderError: detect audio failed`**——参数先于计费校验 = 坏样本辨路径零花费；账号音色数 0。
- **关键集成决策**：现役模型 `qwen-audio-3.1-tts-flash` 恰在 target_model 白名单 → `voice.clone.targetModel` = 现役模型，**零换模型**；config 注释旧坑「next 模型忽略 voice 参数」不适用（config 本来就用 flash 严格校验版）。

### 施工与设计要点

- `config.json` `voice.clone`：endpoint/targetModel/prefix(max 10 字母数字)/maxPromptAudioLength 15/languageHints["zh"]/timeoutMs/deployTimeoutSec 90/**key 恒空**（复用 `voice.dashscope.key` → 环境变量 → `voice.clone.key` 链，meta 只回来源）。
- `pipeline/voice-clone.json` 账号私有清单（gitignore）；common 三助手单一出处：`readCloneVoices / writeCloneVoices / deriveCloneTarget`（从 id 前缀对 9 个白名单 target model 反推，命中返回模型名否则空串）。
- server 三路由：`POST /api/voice/clone`（Data URI MIME 白名单 + ≥5KB ≤15MB 本地校验、cloneBusy 409、创建成功后服务端轮询 `query_voice` ≤90s，查询抖动按 DEPLOYING 继续、超时存 DEPLOYING 交「同步」；响应 note 三态文案）/ `POST /api/voice/clone/sync`（`list_voice` 远端为准全量合并、本地样本名/时间能带就带、未知远端 id derive 反推模型）/ `POST /api/voice/clone/delete`（voiceId 白名单正则 + 本地清单 404 拦截——防打错字打到 API）。enroll 统一助手：非 2xx 带 status 分级（400/403/502）+ 403 附「余额与仅用免费额度」提示。
- **01 禁兜底四连**（宁 fail 勿兜底落到克隆场景）：命中清单 → `attempts=['dashscope']` 只此一条（不许 edge/gtts/sapi 静默顶替）；状态非 OK → fail「点同步刷新，不静默换音色」；缺 targetModel → fail；**清单外但 id 长得像克隆形状**（deriveCloneTarget 命中，如清单丢失/别处创建）→ fail「点同步拉取」。key 缺失对克隆是 fail 不是 warn 跳过。meta 记 `voice.clone:true + 实际 model`。
- 网页：音色下拉 `<optgroup label="克隆音色">`（非 OK disabled 带状态后缀）+ `<details>` 折叠面板（文件选择→✦复刻→服务端等审核→列表展示/↻同步/删除带 confirm；计费口径与样本要求写明；无 key 只显示启用说明，meta.clone.enabled 两态驱动）。

### 冒烟 29/29（p8-clone-smoke.cjs 留存）

- A 静态 7（config 段/gitignore/common 导出+derive/三路由/01 四守卫/网页五件套）；B 无 key 8799 副本实例 2（PIPELINE_CONFIG_OVERRIDES 空 key 补丁 → enabled=false + POST 400 带 config.local 指引）；C 主实例 4 零花费负例（缺 audio/非音频 MIME/太小/删未知名 404）。
- D 真实 E2E：样本 = deck-demo TTS 口播切 15s（**不用真人素材**，克隆 TTS 声测机制合法）→ 复刻 **11.4s 到 OK**（voice_id `qwen-audio-3.1-tts-flash-myvoice-55290a5eac004509855bbc6ebddb13a3`）→ 直连合成 mp3 → 01 全链 provider=dashscope/voice.clone=true/duration 真实 → 清单外形状 id fail ✓ → 状态改 DEPLOYING fail ✓（finally 还原验证）→ 探针目录清理、清单只剩留样。
- **花费**：复刻创建 1 次（官方口径 ¥0.01 或免费档，实测无 403 = 账号接受了）+ 测试合成若干（TTS 免费额度）。留样音色可用可删。
- 服务：8787 已带 P8 代码重启（clone.enabled=true，key 来源 voice.dashscope.key）；01 为子进程逐次拉取，后续 01 改动无需重启。

### 遗留与下一步

- 留样克隆音色是**机械测试音色**（TTS 声切片），用户要「自己的声音」需自录 10~20s 干净人声在面板重複（删除旧的即可）。
- `qwen-audio-3.1-tts-flash` 原生 rate 对克隆音色的效果未单测（01 的 atempo 残差校正链天然兜住语速）。
- 剩余清单：远期 13 Editor 精修页（立项两选项待拍板）→ 技术侧 `item-color-code`（new 档）→ 用户实测反馈（素材库/货架/生图/克隆面板攒一批）。

## P9 · Editor 精修页 · 轻改（2026-10-26，远期 13 两段式第一段，冒烟 34/34 全绿）

### 立项拍板

- 用户 10-26 拍板**两段式**：先轻改（字段编辑回写 shots.json 走局部重跑，与聊天框/重跑面板同源）→ 用一阵子若真需要帧级剪辑再立项重剪（独立成片精修器）。重剪段的参考源与立项待定项已固化进 ROADMAP 远期 13。

### 施工与设计要点

- **页面**：`web/public/editor.html` 单文件（同 index 设计令牌）+ server 路由 `GET /editor`；首页头部 ✂ 链接；任务下拉载入、`#任务名` 深链、载入有未保存改动先 confirm。逐镜卡片：type 下拉 6 型互切（切换重渲该卡，字段值保留）、narration 字数计、asset/media 从任务 `assets/` 下拉选用、items 逐行可增删——**string 与 `{t,d}` 双行卡按原形态往返**（行内双输入格：描述格空=string，填了=对象），tags 一格一行；diff 计数徽标；保存后 `/api/status` 1.5s 轮询进度。
- **白名单单一出处**：`chat-rules.cjs` 新增 `SHOT_EDIT`（字段→校验函数，与 SHOTS_PATCH 同打法）+ `TYPE_WL`（server 回传给页面做下拉，加类型一处生效）；字段全集 = 现存 5 任务 union 扫描 + `skills/script.md` schema 对账（含 `n` 与 `id` 两种身份键——splitter 产 `n`、手写产 `id`，都认）。
- **边界服务端硬守**（`POST /api/editor/shots`）：运行中/排队 409（防写入与流水线读取打架）→ 镜数 1~60 且与原值相等（不增删）→ `id/n` 按位锁死、原无的不许新增 → 未知字段 400 / 值校验 400 → 类型必填早拦（keyword 缺 keyword、split 缺 media 或 items|note、title/end 缺 title——03/06 的雷提前）→ 素材文件名穿越与表外字符 400、**文件不存在 404**（02/03 的错提前到保存前）→ `fs.copyFileSync(shots.json → shots.json.bak)` 覆盖备份（= 上次保存前状态）→ 写盘 → `body.rerun` 时走 `startRerun` 排队。
- **口播漂移双向判定 `narrationDrift(dir, shots)`**：与 01 `buildNarration` 同式拼接，对 **任务根** `narration.txt`（02/03 读的同一处）；① 保存响应用它给建议 from（动口播=1、未动=2，省一次配音）② `startRerun` 内**硬钳制** `from = min(from, 1)`——任何路径（编辑页/聊天/rerun 面板/手改文件）只要口播 ≠ 已配音文本就强制含 01，堵死「旧音频对新词」（P6 画幅钳制同款哲学：宁钳不赌）。

### 冒烟 34/34（p9-editor-smoke.cjs 留存）+ 施工中修两 bug + 排一颗环境雷

- B 页面读取 5：`/editor` 200、现役任务分镜 5 镜/6 类型/无漂移、坏名 400、未知 404。
- C 负例 15（**零写入**——结束字节级核验 `shots.json` 未动、无 `.bak` 残留）：镜数增减、改 n、凭空加 id、未知字段、非法 type、空口播、keyword/split/title 类型必填、素材 404、路径穿越、空数组、非数组、未知任务。
- D 正例 14：口播改动 save-only → `drift:true from:1` + `.bak`=原始；再改 heading 保存并重跑 → **漂移硬钳 `rerun.from=1`**；**运行中再保存 → 409**；重跑完成（真实全链）→ 成片 mtime 更新、漂移归零；同步后 save-only → `from:2`（免配音判定成立）；三连编辑全落盘、`.bak`=上次保存前（含①②无③）；E 清理零残留、deck-demo 原样。
- **bug①**：`narrationDrift` 路径写成 `audio/narration.txt`——01 实写**任务根**（02/03 同），致现役任务恒漂移；**bug②**：保存响应用改动前 `orig` 判漂移（改动前必然同步=判寂寞），须比改后 `list`。两 bug 都是冒烟抓的——E2E 断言的价值。
- **环境雷（坑档）**：本机 Node v22.23.2 `fs.cpSync` 撞**中文父路径**必崩 `0xC0000409`（fail-fast，JS catch 接不住，表现=进程无征兆退出码 -1073740791）——对照实验：ASCII TEMP 路径同结构 OK、中文路径同结构必崩、库内手写 `copyFileSync` 递归全过。**规矩**：本项目内复制目录一律手写 `copyDir`（readdir+mkdir+copyFileSync），禁 `fs.cpSync`/`fs.cp`；排查手法（预打印二分 + ASCII/中文对照）留档。全库 grep 确认生产代码零 `cpSync` 使用（libraryAdd 等均 copyFileSync），只有冒烟脚本用过、已换。
- 服务：8787 已带 P9 代码重启（`/editor` 路由 + 漂移钳制）；`p9-static.cjs` 静态体检 8 项另存可复跑。

### 遗留与下一步（P9 后）

- 轻改边界**未做**（有意）：镜头增删/排序/拖动、任务级参数（画幅/平台/风格在控制台重跑面板改，编辑页只读展示并指路）。
- 下一个按清单：技术侧 `item-color-code`（new 档）立项施工 → 跑「插入重跑 QC」完整闭环；或直接等用户对 P8/P9 上手反馈再调。

## P10 · 枚举条目色标 item-color-code（2026-10-26，技术库 new 档转正，冒烟 27/27 全绿）

### 立项与设计

- 出处：抖音@Ludi modal_id=7698358547440094502《Vibe知识大赏丨别再管所有弹出来的东西都叫"弹窗"了》——No.1~No.5 每条专属色贯穿色 chip + 字幕关键词 + 底部时间轴圆点。P7 拆解时定档 new（keywordColour 当时为 config 级全局单色），本次施工转正。
- **accent 单一出处在 02**：`config.itemColorCode`（`enabled` 缺省 false / `colors` 1~12 个 #RRGGBB / `track` 缺省 true）启用时，bullet/keyword 镜按出场序循环分配身份色——`accent/ccNo/ccTotal` 写进 timeline.shots，关键词 entries 随镜带 accent；03/05 只渲染不各自推导（两处规则漂移 = 同片两套色）。title/transition/end/split 不参与、零字段。
- **03 纯 CSS 零模板改动**：`ccInject` 注入 `:root{--accent;--acc}` 整场重绑（bar/hi/关键词渐变端点全部自动跟色 = 源片「同一颜色贯穿」）+ 标题旁色 chip 伪元素 `.heading::before` + 底部圆点进度轨（n 圆点唯一激活位 + `--cc-dur` 按镜时长填充动画，位置 `safe-bottom*0.5` 不压字幕不进平台 UI 区）；**deck 自带章节导航条 → 上色但不叠轨**；outro/封面不注入。accent 另有正则守卫（手改 timeline 脏值不注入）。
- **05 行内换色**：`assColour` #RRGGBB→`&H00BBGGRR`，关键词 Dialogue 头插 `{\1c&H..&}`——无 accent 字段时输出与旧版逐字节一致（captions 关闭时 HTML 侧渐变端点已跟色，天然兜底）。
- **负例宁 fail**：色表空/超 12/非法 hex（如 `red`）→ 02 停带精确报错（静默吞坏色会渲出色块垃圾）。
- 配方卡转 implemented：`insert { from: 2, config: { itemColorCode: { enabled: true } } }`，货架按钮解禁、聊天点名「枚举条目色标」命中同一份补丁；关效果 = 重跑面板清空配置补丁。

### 冒烟 27/27（p10-icc-smoke.cjs 留存）+ 一条探针备忘

- A 静态 8 + B 负例 2（坏色值/空表 02 直跑零计费 fail）+ C 插入重跑 QC 闭环 11：货架 insert → `/api/rerun from=2` 全链（0.9 分钟）→ 参与镜循环上色+ccNo/ccTotal、非参与镜零字段、关键词随镜色、chip+圆点轨+唯一激活位、非参与镜场景零注入、subs.ass 行内 BGR 正确（`#34D399→&H0099D334`）、成片重建、QC 无 FAIL；C-回归 2：清空补丁后 02+03 复跑零残留；D deck 2：上色但无轨。
- **探针备忘（非回归）**：存量任务 `timeline.keywords` 多为空——shots.json 的 keyword 字段（如「全程 0 元」带空格）在口播里 indexOf 不到即静默跳过，历史行为；冒烟探针改为副本上挂确定性关键词补丁（bullet 镜口播前 4 字）保证正例可测。
- 首轮冒烟 C6/C9 抓出探针选偏（关键词挂非参与镜），修探针选择与守卫后全绿——断言链再次证明价值。
- 服务：8787 带 P10 代码重启（config.json 新段）。

# 2026-10-27 —— P0 工程卫生 + P11 Editor 结构版 + P12 重剪立项提案

## 桌面乱码目录事故二次复盘（用户报障，已清除）

- 桌面再现 `鍓緫搴旂敤\output\_probe_editor_e2e` 空壳（P9 冒烟窗口 16:10:25 出生）。字节级核验：「剪辑应用」UTF-8 按 cp936 解码 = 该目录名逐字节一致（0x87 落 GBK 未定义→私有区 U+E047）；肇事=PS 侧一次内联中文 mkdir，项目代码无责（库内脚本全 UTF-8 硬编码）。零数据，已送回收站。
- **收口为代码**（不再只靠口头规矩）：`smoke/lib.cjs` 三守卫（ROOT `__dirname` 派生 / `probeDir` 命名+越界双拦 / `sweepProbes` 枚举清扫）+ `guard-sentinel.cjs` 哨兵（私有区字符+乱码词表判定，`--trash-empty` 仅零文件空树自动回收站，PS 传参纯 ASCII 拆 `[char]0xXXXX`）。

## P0 · 冒烟脚本归档（提交 e71492e）

- p6~p10 全部冒烟/诊断脚本从 `%TEMP%\opencode`（重启即丢）寻回入库 `smoke/`（25 文件），ROOT 全部改围栏库派生，临时产物挪 `%TEMP%\smoke\`，P8 样本夹具进 `smoke/fixtures/`；`smoke/README.md` 立三条规矩+重放前置+计费提示（P7-2 生图 1 张、P8 复刻按次——重放注意）。

## P11 · Editor 结构版（远期 13 第一段升级：轻改 → 字段+结构+任务参数）

- **动因**：P9 有意边界（不增删/不排序/任务参数只读）是 ROADMAP 明示的补齐候选；且排查发现**整串拼接漂移判定有盲区**——镜头换序不换字、增删后拼回同文，`narrationDrift` 全看不见（`1+2` 连起来 = `2+1` 连起来）。
- **漂移升级逐镜比对**：01 `buildNarration` 同步返回 seg[] 并落 `audio/narrationSeg.json`（写失败不拦主路）；server `narrationDrift` 有 seg 清单按序列逐镜比，无 seg（旧任务）回退整串旧口径。**结构变更（增删/排序）独立判定，钳 1 双条件 `drift||structural`**——即便无键文档新镜口播恰好拼回旧序列也不免配音。
- **结构守卫（身份键三分）**：原文档 id 型/n 型/无键型一查即定。有键：保留镜身份键必须在原池内且不重复，新镜靠 `_new` 运输标记（服务端剥离、不泄漏落盘）；n 型保存时按新位置重排、id 型新镜补发 `s9X+`（避开 02 兜底 `s01..` 撞名）。**structural 必须拿「重排前」身份序列比原序**——n 型重排会把换序信息抹掉（[1,3,2]→[1,2,3] 看似没动），这个坑是冒烟 F1 抓的。无键：不删镜不许换序、删镜只能删尾部（保留镜须与原前缀逐位对位，「删中间+补尾」与「原序」不可分，宁拦不猜，报错指引手补 id 升级为有键）。
- **任务级参数直改**：`EDIT_TASK_FIELDS`（chat-rules 新导出，SHOTS_PATCH 子集：sceneStyle/coverStyle/captions/platform/width/height，值校验同表；音色/语速不放开）；null=清除语义；platform 与 width/height 二选一（P6 口径：platform 在场就清显式画幅）。GET 回传 `platforms`/`taskFields`/`tailOnlyDel`，POST 回传终稿 `doc`（客户端免重载回显补发身份键）。
- **前端**（editor.html）：镜头卡 ↑↓/＋插/✕删（无键文档删中间按钮带提示）、末尾加镜、② 任务参数卡（平台/画幅联动二选一、风格/封面/字幕，差量提交 `paramPatch()`，成功用响应 doc 回显重置快照）；保存/载入 confirm 计入参数差量。
- **冒烟 P11 35/35**（p11-editor-v2-smoke.cjs 入库）：A 静态 4 + B 无键守卫 6 + C 负例 7（零写入字节核验）+ D 新镜/参数 4 + F legacy 换序真实重跑链 6（structural 钳 1 → 01 落 seg → 归零 → 再换序 drift 逐镜抓）+ G 插镜真实重跑链 6（seg=镜数/n 连排/字段编辑 from2 免配音）+ H 清场 2。**P9 回归 36/36**（两条边界断言按 P11 语义更新：捏造键拒「不在原任务里」、删尾镜转合法正例 C2）、P10 27/27、P6 全 PASS、p9-static 过、lib-selftest 5/5、哨兵干净。
- **冒烟抓的自身 bug 三枚**：`probeDir('_x')` 拼出双下划线 `_probe__x`（改前导下划线并入单一前缀）；冒烟 B 段「挪尾再删」期望写错（无键换序本质该拦，改期望+细化两分支文案）；`_new` 泄漏落盘（三分支统一剥离）。E2E 断言链第三轮证明价值。
- **环境操作留档**：8787 换代码必重启（server 常驻模块缓存）；bash 里 `$_` 会被吃（PS 命令写 .ps1 文件跑）；`taskkill /PID` 需 `MSYS_NO_PATHCONV=1`；杀错实例跑了半轮废冒烟——**先 `netstat 端口→PID→CreationDate` 对齐再跑**。
- 计费口径：本轮全部 dashscope 免费额度 TTS（4 条全链重跑），零复刻零生图。
- 服务：8787 带 P11 全量代码运行中（structural 修复后终态）。

## P12 · 重剪段立项提案（ROADMAP 新节，等用户拍板）

- 三待定项推荐案成文：① 分工=语义(P11/shots.json) vs 时间轴(重剪/edit.json)二分，编辑单从 timeline.json 一键导入、不做双向同步；② 对账=脱钩导出+编辑单持久化（参考 AI-Anime `editor_projects` 四件套）；③ 素材字幕对齐=clip 引用镜级产物（segments/<id>.mp4、voice.mp3 按镜窗口 trim），字幕推荐一期出词级表（02 拆件落 wordTimings.json，08 裁窗生成 ASS），渲染=05 泛化抽件。附 MVP 范围与 4~6 天工程量拆分。

## P13 · 时间轴排序页（2026-10-27，用户「按流程布局」诉求的第一刀，冒烟 19/19）

- **动因**：用户实测 P11 卡片流后反馈「挺多不顺手」，要「按流程排列、一步一确认、最后总结页确认出片」。全页面大改造体量大且撞 P12 重剪段（待拍板），先切一刀**最小可用的排序页** `/timeline` 解最痛的「拖一决定先后」，布局大改与出片确认流向 P12 一并设计。
- **页面**（`web/public/timeline.html` 单文件，同 index/editor 设计令牌）：三轨「口播/画面/字幕」按 `timeline.json` 真实时长等比铺镜 + 秒刻度尺（pps≥14 每 5s 一格否则 10s）；拖动换序=指针跟手 + 落点竖线 caret（口播主轨可拖，画面/字幕轨只读预览）；单击选中→检查器改高频字段（narration/type/nav/heading/kicker/title/keyword/asset，items/双行/分栏仍指回精修页）；快照式撤销栈（整表 JSON.stringify 压栈，60 深，Ctrl+Z/Ctrl+Shift+Z）；缩放滑条；保存走 P11 同源 `/api/editor/shots`。入口首页头部 + 精修页顶双链。
- **GET 契约扩展**：`/api/editor/shots` 回 `durations[]`+`total`——timeline.shots 按 `s.id` 建表，n 型经 `s{NN}` 反查，失配按位序兜；镜数不符/无文件/含 0 → 整体降级 `null`（页面等宽渲染，不半截）。
- **无键文档排序 = server upgrading 通道**（本轮最大设计）：网页 splitter 建的任务无 id/n，P11 守卫「不删镜不许换序」直接拦死排序。页面识别 `tailOnlyDel` 给「一键补发 id」向导；server 放行条件收紧到**原无键 ∧ 每镜带全新唯一 string id ∧ 镜数不变 ∧ 逐位口播不变 ∧ 无 _new ∧ list[0] 无 n**，满足才认升级（否则自造 id 仍走 origPool 拒）。升级 `from = min(from,2)`——**只重编译不重配音**（02 把 id 烘进 timeline.json 与场景文件名；voice/words 复用），响应带 `upgraded` 标。升级后 GET `tailOnlyDel=false`，回归正常有键排序。
- **冒烟 19/19**（p13-timeline-smoke.cjs）：A 静态 4 + B durations 契约 2 + C n 型换序 4（含**全同镜像**探针：四镜口播逐字相同，换序后整串完全相等 → 断言 drift=false 但 structural=true 仍钳 1，坐实 P11 structural 独立判定的必要性）+ D 无键升级流 7（剥键 tailOnlyDel 验 → 无键换序 400 → 补 s91 升级 200/from2/upgraded → 真实 02→06 重跑完成 → 落盘带 id 无 _new → 升级后换序放行）+ E deck-demo 零副作用 + F sweepProbes 清场。**P11 回归 35/35、P9 回归复跑**确认 upgrading 未伤及既有换序/参数/漂移路径。
- **踩坑**：① timeline.html 内联 JS 里模板串嵌套（clip 头部 `${...}` 内又写模板串）→ 抽 `keyLabel()` 函数拆平，并把内层降为字符串拼接；② 升级最初被 P11 origPool 拦（`s91 不在原任务里`）——正是升级通道要解决的，测试暴露后补 upgrading 分支；③ 升级最初误期望 from1+seg 落盘——厘清「补 id 不改口播/顺序」应 from2 免配音、02 不写 seg，改测断言与文档口径一致。
- 计费：D 段一次真实 02→06 重跑（免费额度、无 TTS/无生图）。服务：8787 带 upgrading+durations 运行中。
- **下一步**：待用户上手 `/timeline` 反馈交互手感；整站「流程分步 + 确认门 + 总结页」大布局连同 P12 重剪段时间轴一并设计（避免两套时间轴各画各的）。

## P14 · 流程向导（2026-10-27，用户「按流程分步确认 + 总结页再出片」整站改造，冒烟 27/27）

- **动因升级**：用户上手后反馈 P11 卡片流「挺多不顺手」，明确要「每步做完点确认再进下一步、最后总结页确认无误才出片看效果」。这是**编排流**诉求（先审后跑），与 P12 重剪段（秒级时间轴）**正交**——本刀做向导，时间轴级裁剪仍归 P12，不动那个决定。
- **向导页**（`web/public/wizard.html` 单文件）：6 关口 stepper ①说需求→生成分镜草稿 ②确认分镜（跳精修/时间轴微调）③生成配音+试听 ④渲染画面+封面/片段网格预览 ⑤出片前总结核对 ⑥成片+QC+下载。**每关都是确认门**，`runRange(from,to)` 只跑本关对应步、点确认才进下一关，绝不替用户偷跑下游（配音/渲染虽免费但耗时，先审后跑是核心体验）。顶部「载入已有任务」按 stepstatus 跳到对应关续跑。
- **server 三原语**：① **有界运行** `runPipeline(taskDir,from,to=6)` 循环加 `|| step.n>to` 跳过，`pumpQueue` 透传 `item.to||6`，`startRerun(...,to=6)` 且 `to=Math.max(to,from)` 防倒挂，`/api/rerun` 收 `body.to`（钳 1~6）。② **草稿创建** `/api/create {draft:true}`：`written.push({...,shots})` 后若 draft 直接 return（不进 state.queue、不 pumpQueue、零花费），回传 shots 供分镜确认；`if (body.rate>0)` 等既有校验/素材落盘全复用。③ **步骤状态** `/api/stepstatus?name=`：`ex()/count()` 探 voice.mp3/timeline.json/scenes/segments/封面.png/成片.mp4/qc-report.txt 存在性 + meta 时长/字秒/provider/clone + drift（复用 narrationDrift）+ qc 汇总；`/api/meta` 补 platforms[]（label/width/height 取自 config 单一出处）+ sizes[]，向导动态建发布规格下拉。
- **冒烟 27/27**（p14-wizard-smoke.cjs）：A 静态 6（含 runPipeline 有界签名/queue 透传/draft 分支源码断言 + 三页入口）· B 草稿 4（**落 shots.json 但无 voice.mp3**、stepstatus voice.ok=false、drift=true 从未配音）· C 有界配音 5（**run 1→1 后 timeline/segments/video 仍 false——to=1 不越界**；seg 落盘 drift 归零）· D 有界画面 4（run 2→4 后 video 仍 false、qc=null）· E 有界出片 4（run 5→6 后 video.ok + qc 18/18 failCount0 + 成片 >100KB）· F 清场 2。P11 35/35 + P9 36/36 + P13 19/19 回归全绿（`startRerun` 新签名向后兼容，旧调用 `to` 缺省 6 行为不变）。
- **踩坑**：① qc 汇总正则 `\s*(?:项)?通过` 吃不下「18/18 **机械**项通过」的「机械」二字 → 放宽 `[^\n]*通过`（先用既有任务秒验再重跑全链）；② wizard.html 内联 JS 吸取 P13 教训全程字符串拼接无嵌套模板串，一次过语法门；③ 服务重启 curl 撞就绪竞态拿空 body → 改 `for` 探 `/api/status` 200 再发。
- 计费：向导 E2E 一轮真实免费额度 TTS + 本地渲染合成（零复刻零生图）。服务：8787 带三原语运行中。
- **下一步**：待用户上手 `/wizard` 反馈关口划分/文案/交互；P12 重剪段（秒级 in/out 时间轴）四拍板项仍等确认；若向导手感 OK，可考虑把控制台一键流与向导合并成「快/稳」双模式入口。
