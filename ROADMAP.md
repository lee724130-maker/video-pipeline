# ROADMAP · 零成本视频流水线

> 更新：2026-10-27。状态：✅ 已完成 / 🔄 进行中 / ⬜ 未开始。

## ✅ 已完成

| 档位 | 内容 |
|---|---|
| A 档 | 口播成片全链路：文案→TTS（50+ 音色）→场景动画→合成→QC；卡拉OK字幕、关键词砸字、转场 |
| B 档 | 素材混排（assets/ 指定镜头）+ BGM 卡点（节拍检测吸切镜、说话侧链闪避、循环淡入淡出） |
| KTV | 07 独立步：歌名网搜 LRC / 丢 LRC / 丢纯文本 → 整首卡拉OK跟唱视频（歌词三级输入，识别只兜底） |
| P0 打磨 | ① 口播字幕逐词对齐（whisper 本地对齐，帧级准）② 响度标准化 -14 LUFS（口播/BGM/KTV 三分支，QC 复核）③ 封面.png 自动生成 + 片尾「点关注」卡 |
| P1-1 ✅ | **SAPI 离线 TTS 兜底**：断网/无额度时 Windows 自带语音顶上（rate 6 + atempo 1.15 精准 7.6 字/秒），01 供应商链 `dashscope→edge→gtts→sapi` 四级，`--provider sapi` 可强制；全链 18/18 验证 |
| P1-2 ✅ | **读音/对齐归一增强**：实测 10 组经典易错句（多音字/数字/日期/百分比），qwen TTS 读音全对、**无需读音改写**；真痛点在对齐侧——02 归一升级三件套：数字归一 + 繁简归一（OpenCC 3029 字表）+ **有界重同步**（单字失配不再全盘作废，LOOK=4 重咬、咬合率 <60% 才兜底）。Huihui 吞字、繁体输出、同音错写场景全部从「退回字数比例」升级为逐词对齐 |
| 响度增强 | `loudnormFile` 升级迭代式：线性增益预测撞 TP 上限（瞬态高的素材如 SAPI 配音）自动改走 dynamic 压动态，复测贴住 ±1.5 才收工（最多 3 轮）；返回 `to` 改为最终实测值 |
| P1-4 ✅ | **whisper medium 档位一键切**：`config.ktv.alignModel`（口播对齐，02 传给 align.py）+ `config.ktv.model`（KTV 识别，07 或 `--model` 覆盖），默认 small；medium 已实测全链 18/18（6s 音频对齐 50s、约 2.5 倍耗时），words.json 的 engine 记录 `whisper-zh/<模型>` 可见缓存来源（换档后删 `audio/words.json` 重对齐） |
| P1-3 ✅ | **素材背景 A+C**：`assets/bg-NN.jpg|png|webp` 即开即用——口播场景按镜头序号轮播做底图（Ken Burns 奇偶交替推近/拉远，原光晕/网格设计语言叠加其上，scrim 压暗保字幕可读），封面取第一张静态版；KTV 全曲按图数均分轮播（1s 交叉淡化）。无 bg-NN 文件 → 行为与旧版完全一致（纯代码渐变/动态渐变）。`config.background` 可调 scrim/kenBurns/zoom；口播全链 18/18 + KTV 轮播/回退双路径实测 |
| P2-1 ✅ | **本地网页界面**：`node web/server.cjs` → 浏览器开 `http://127.0.0.1:8787`——填文案/传背景图/BGM（base64 直传，≤60MB）/选音色（5 个实测 qwen 音色）/拖语速滑条（任务级 `targetCharsPerSec`，不改全局 config）→ 一键出 01→06 全链 → 六步进度条 + 实时日志 + 在线预览成片（Range 可拖进度条）/封面/质检抽帧/下载 + 历史任务列表。机械分镜器 `web/splitter.cjs`：首句 title、含逗号句 bullet（分句拆要点）、末句 end、单句稿 title+outro 兜底，type 全在白名单内；只监听 127.0.0.1，任务名/文件名白名单防路径穿越，同一时刻只跑一条管线。零新增依赖（Node 内置 http + 现有 pipeline）。API 实测：web-smoke 任务 3 镜、loongstella、6.5 字/秒实测 6.51、18/18 |
| P2-6 ✅ | **批量变体**：网页端「批量变体」框每行一个开头钩子（2~5 行）→ 服务端队列逐条跑全链，每条 = 完整独立任务 `<名>-v1..vN`（钩子替换首镜口播+大字标题，素材/语速/音色共享；单条失败不中断队列）；完成后各版本成片并排展示方便 A/B 对比。API 实测 bv-test 2 变体全链 ok、18/18、loongstella |
| P2-7 ✅ | **横屏/方形尺寸**：`shots.json` 写 `width/height` 即切画幅（网页端画幅下拉：竖屏 1080×1920 / 横屏 1920×1080 / 方形 1080×1080）。三处适配：① `templates/base.css` 全部 px 改 `calc(Npx * var(--k))`（`--k`=短边/1080）；② 03 注入 `<style>:root{--k;--safe-top/bottom}`（安全区按 高/1920 缩放：竖屏 180/180 不变，横屏/方形 101px），场景/片尾卡/封面三处都注入，cover.html 内联 px 同步改 calc；③ 05 ASS 字号/边距按比例缩放（字幕 56×k、marginV 320×高/1920、砸字 130×k，均设下限防爆）。回归：竖屏 sapi-test 19/19 无回归（注入 k=1/180px 与设计稿一致）、横屏 bv-test-v1 18/18、方形 sq-test 18/18，三方画幅字幕带位置核验正确（第 7 段 y≈810~945）。KTV（07）仍固定竖屏，不在本次范围 |
| P2-8 ✅ | **封面多套风格**：封面模板 3 套视觉风格——`tech` 暗色科技（默认，青色点缀）、`bold` 高对比大字（纯黑底+暖黄/朱红渐变条，标题 152px 超大）、`magazine` 杂志留白（纸白 #F5F1E8 底+墨字+衬线大标题+赭石点缀）。实现：`templates/cover.html` 按 `cover-{style}` class 挂风格 CSS（同模板，改 style 块）；03 读 `shots.coverStyle`（任务级）> `config.cover.style`（全局）> 默认 tech，白名单校验非法 fail-fast；网页端封面风格下拉 + server 白名单 400。核验：三风格抽帧色相分布区分明显（tech 青 0.18%/黄 0%、bold 黄 0.30%/青 0%、magazine 96.5% 纸白亮底）；非法风格 03 fail ✓ + API 400 ✓；web 建任务全链 18/18 |
| P2-9 ✅ | **演示风 deck 主题**（复刻抖音参考样片《给WorkBuddy装套技能，它就成了短剧工作台》）：`shots.sceneStyle`（classic 缺省 / deck，白名单 fail-fast，网页下拉 + server 400）——`templates/deck.css` 覆盖层随 03 注入（暗蓝渐变底 #0c2032→#070c17、青 #00edce、左对齐章节页、章节卡片网格带编号圆标、底部章节导航条 `.chapnav` 按 `shots.nav` 逐镜注入 + 当前章高亮）；模板新增 `tags`/`quote`/`{t,d}` 双行卡片 token（classic 下隐藏/中性样式零回归）；05 deck 硬切转场（`cfg.compose.deckTransitionSec` 缺省 0）；`shots.captions:false` → 05 不烧 ASS、06 字幕核验项相应跳过（与 keyword 砸字冲突显式 fail）。demo `output/deck-demo`（1920×1080 · 5 镜 · 无字幕）抽帧与参考样片版式对齐，QC 17/17。附带两修：① itemTime fallback 把相对时间当绝对时间（要点全挤 0.08s 一次弹出）；② capture.mjs 改先起播再开录 + runtime.js 注入 1px 保活微动画（hypit screencast 附带 0~1.6s 启动竞态会吃掉成片开头、Chrome 对静止页把 rAF 压到 ~1.5s/次致 data-at 揭示迟拍——两个都是系统性坑，classic 一并受益）。验证补齐（10-20）：classic 回归 18/18 零回归（开场首帧全亮/卡拉OK字幕正常）+ `/api/create` 白名单 4 分支 400 实测 + API 建 deck 任务全链 17/17（deck-api-test） |

## ✅ P1 · 近期（已全部完成，见上表 P1-1 ~ P1-4）

## ✅ P2 · 体验（已全部完成，见上表 P2-1 / P2-6 / P2-7 / P2-8 / P2-9）

> P2 五项全部完工：网页界面 ✅ · 批量变体 ✅ · 尺寸自适应 ✅ · 封面多风格 ✅ · 演示风 deck 主题 ✅

## ✅ P3~P6 · 打磨冲刺（2026-10-20 ~ 10-23，全部完成，施工记录见 `CHECKPOINT-2026-10-20.md`）

| 冲刺 | 内容 |
|---|---|
| P3 改片三件套 ✅ | ① 局部重跑 `/api/rerun`（from 1~6 + shots 白名单补丁 + 任务级 `config.overrides.json` 三层深合并）② BGM 收尾降调 `outroPitchSemitones/Sec`（asetrate+atempo 零依赖）③ 技术库货架 `techniques/*.json` + `/api/techniques` + 网页一键插入；附带任务持久聊天框 `chat.json`（规则 17 用例 + qwen 语义解析，quota 命中自动降级规则模式并界面明示）+ 技术入库工作流规则书 `skills/techniques.md` |
| P4 外部配方入库 ✅ | 入库工作流跑通两例：001「BGM 收尾延迟回声」`outroEcho*` 三键（echo-compose-test 24/24；**声学定案**——成片上看不见抽头是 20 倍人声掩蔽，验证必须在对应总线直量，方法论已沉淀）；002「形似叠化」tier=manual 首例（素材契约型技法只入库判据卡不实现，manual 档基建：loadTechniques 放行无 insert 卡 + 货架 badge）。货架 9 卡 |
| P5 打磨五件套 ✅ | ① `sceneStyle:"paper"` 纸感浅色主题（奶油底墨字深红，横屏教学风）② 图片素材镜头 Ken Burns 缓推/缓拉（2x 超采样 zoompan，奇偶交替，`background.kenBurns:false` 关）③ `captionStyle:"bar"` 字幕黑底实底条（ASS BorderStyle 3，白名单 outline\|bar）④ `cornerMark` 品牌角标（场景镜 HTML 注入 + 素材镜 ffmpeg overlay 同几何 + 片尾卡，未配置零影响）⑤ 分镜 type `split` 左文右图分栏（media 引 assets 样机图，竖屏自动上下分栏）。附带实战出片《8种手机顶部标题栏》71.8s QC 18/18、页面三区布局优化、output 大扫除（17 测试目录 95.6MB）；演示片 `output/P5三件套演示` QC 19/19 |
| P6 平台发布规格 ✅ | 远期 11 转正（用户点名启动）：`config.platforms` 四平台 profile（抖音/视频号 1080×1920、小红书 1080×1440 3:4、B站 1920×1080 + `durHint` 时长档 + 可选 `safeTop/safeBottom/captionSize/captionMarginV` 覆盖键，加平台零改码）+ `shots.platform` 白名单（02 查表写 timeline；与 width/height **值**冲突 fail）+ 网页「发布规格」平台/自定义两组下拉（默认抖音组）+ 聊天平台词（否定守卫「别发抖音」不认，qwen prompt 同步枚举）+ `SHOTS_PATCH.platform`（动态查 config 表）+ **画幅类补丁 from 钳到 2**（`--from 3` 会跳过 02 留旧画幅时间轴——顺手收口的存量坑）。实测：B 探针小红书 3:4 全链 18/18（**新画幅首测**，safeTop 150→113px 注入、字号 72 进 ASS）、D 无平台旧路径 18/18 零漂移、A 网页建任务 douyin 全链 18/18、E rerun douyin→bilibili from 3→2 钳制、3×400 负例（未知平台/二选一）、双 02 fail（白名单/冲突精确报错）、durHint 超档 warn 不拦、规则单测 27/27 |

## ✅ P7 · 素材库与 AI 生图（2026-10-23）

| 冲刺 | 内容 |
|---|---|
| P7-1 素材库接入 ✅ | 远期 9 转正：根目录 `library/{bgm,images,clips}` 本地素材缓存（`library/README.md` 契约 + git 只入说明；白名单扩展名与 `findBgm`/bg-NN 同表，隐藏文件与表外扩展静默忽略）；`GET /api/library` 列表 + `POST /api/library/add` 选用=**复制**进任务 `assets/`（BGM 自动清旧换 `bgm.<ext>` 防 findBgm 歧义、图片 mode=bg 自动编 bg-NN、原名同存 409、路径穿越/错扩展/未知文件/未知任务 400/404 全拦）；建任务 `bgmFromLibrary` 与自带上传**二选一**（同传 400，排队前早校验不落任务目录）；网页底部「素材库」区（任务下拉 + 三分组列表 + 选用按钮 + 生效步骤提示）+ 表单 BGM 下拉共用数据；`common.cjs` 导出 `BGM_EXTS` 单一出处。冒烟 24/24（含管线 `findBgm` 真实契约命中 + 测试现场备份还原零残留）；README 同步（流程句 / 技术库卡数 7→12 改错 / 目录树 / 素材模式段） |
| P7-2 AI 生图 ✅ | 远期 10 转正：网页素材库卡内「✦ AI 生图」区（prompt + 尺寸下拉 auto/竖9:16/横16:9/方1:1/3:4 + 生成 + 预览 + 可选作 bg-NN 附加入所选任务）；`POST /api/txt2img` → 千问AI平台 `maas.qianwenaiapi.com/compatible-mode/v1/images/generations`（**零成本探针定案**：dashscope 老域名无 images 路径=空 body 404；OpenAI 兼容文档枚举没写 `qwen-image-2.1-turbo` 但实测可用且有额度、`qwen-image-3.0` 免费额度尽=403 带中文提示；尺寸以线上实测为准 512²~2560²、字母 `x`、`auto` 可选；结果 URL 仅 24h → 服务端立即下载、PNG 魔数校验落 `library/images/ai-<本地时间戳>.png`）；**零成本硬保证 = 管线六步永不自动调用**、`config.imagegen.key` 恒空（key 只进 config.local / 环境变量 `DASHSCOPE_API_KEY`，meta 与响应永只回 key 来源）；附加入任务在**花钱前** 404 拦截、并发 409、prompt≤2000、非 JSON 错误体原文入错；无 key 页面只显示启用说明（meta 两态驱动）。冒烟 **47/47**（无 key 用 `PIPELINE_CONFIG_OVERRIDES` 空 key 补丁起 8799 副本实例全负例 + 主实例 4 负例零花费 + 真实 1 张 E2E：落库/附加入 deck-demo/还原零残留、留样 1 张在素材库）；README / `config.local.example.json` 同步 |

## ✅ P8 · 语音克隆（2026-10-26）

| 冲刺 | 内容 |
|---|---|
| P8 语音克隆 ✅ | 远期 12 转正：DashScope 声音复刻（`voice-enrollment` 同端点换 `input.action`：create/query/list/delete；**老域名 dashscope.aliyuncs.com 直通、不用 WorkspaceId**，探针实测 2026-10-26；`target_model` 必须 = 后续合成模型 → 直接用现役 `qwen-audio-3.1-tts-flash` **零换模型**，voice_id 官方格式 `{target_model}-{prefix}-{唯一标识}` 直接当合成 `voice` 参数）+ `config.voice.clone` 段（key 恒空，复用 voice.dashscope.key 链）+ `pipeline/voice-clone.json` 账号私有清单（common 三助手 `readCloneVoices/writeCloneVoices/deriveCloneTarget` 单一出处，gitignore 不进库）；`POST /api/voice/clone`（样本 Base64 Data URI 10~20s ≤15MB 本地校验、cloneBusy 串行、服务端轮询审核态 DEPLOYING→OK ≤90s 超时存 DEPLOYING 交「同步」）+ `/clone/sync`（远端为准合并、derive 从 id 前缀反推 targetModel）+ `/clone/delete`（本地清单 404 拦截）；网页音色下拉「克隆音色」optgroup（非 OK disabled）+ 折叠面板（选样本→✦复刻/↻同步/删除 + 计费口径说明，无 key 只显示启用说明）；**01 禁兜底**：命中克隆音色 → attempts 只剩 dashscope（不许 edge/gtts/sapi 静默顶替），状态非 OK / 缺 targetModel / **清单外克隆形状 id**（deriveCloneTarget 命中即拦）全 fail 带「点同步」指引；meta 记 `voice.clone:true + 实际 model`。计费实测：复刻创建 200 无 403（Qwen 系列官方口径 ¥0.01/次、创建失败不计费；探针「坏样本 400 Audio.DecoderError」证明参数先于计费校验）。冒烟 **29/29**（A 静态 7 + B 无 key 8799 副本实例 2 + C 主实例 4 零花费负例 + D 真实 E2E：15s 样本复刻 **11.4s 到 OK** → 直连合成 mp3 → 01 全链 provider=dashscope/voice.clone=true/不降级 → 禁兜底双负例 → 清理零残留）；留样音色 `qwen-audio-3.1-tts-flash-myvoice-55290a5e…`（status=OK，下拉可选，不用可面板删除）。README / `config.local.example.json` 同步 |

## ✅ P9 · Editor 精修页 · 轻改（2026-10-26）

| 冲刺 | 内容 |
|---|---|
| P9 Editor 轻改 ✅ | 远期 13 立项拍板（用户 10-26 选**两段式**：先轻改后重剪）→ 第一段完工：独立页 `/editor`（单文件 `web/public/editor.html`，与控制台同设计语言；首页头部 ✂ 链接、任务深链 `#任务名`、载入守未保存 confirm）。**单镜字段编辑**：口播/类型（6 型白名单下拉互切）/素材 asset 与分栏 media（任务 assets/ 下拉选用）/items 逐行可增删（string 与 `{t,d}` 双行卡**原形态往返**）/title/subtitle/kicker/heading/quote/keyword/note/index/nav/tags；`SHOT_EDIT` 白名单进 `chat-rules.cjs`（与 SHOTS_PATCH 同表打法，字段全集扫自现存 5 任务+script.md schema）。**边界服务端硬守**：镜数不增删、`id/n` 按位锁死、未知字段 400、keyword/split/title/end 类型必填早拦、素材文件名穿越/不存在早拦（02/03 的错提前到保存前）；**每次保存前 `shots.json.bak` 覆盖备份**（= 上次保存前状态）。**口播漂移双向判定**（`narrationDrift`，对 01 写的任务根 `narration.txt`，与 02/03 同处）：保存响应给建议 from（动口播=1 / 未动=2），`startRerun` 里**硬钳制**——口播 ≠ 已配音文本一律钳到第 1 步（P6 画幅钳制同款，堵死「改口播不重配音拿旧音频对新词」的沟）。保存与重跑全走共享引擎（运行中 409，与 rerun/聊天同源）；页面带 diff 计数、字数计、重跑轮询（`/api/status`）。冒烟 **34/34**：页面读取 5 + 负例 15（零写入字节级核验）+ 正例 14（口播改动建议 from1 / 重跑漂移钳到 1 / 同步后建议 from2 / 运行中 409 / 真实全链重跑成片重建漂移归零 / 三连编辑落盘 / .bak 两代语义 / 清理零残留）。**施工中修两 bug**：① narrationDrift 路径写错 `audio/` 下（01 实写任务根）② 保存响应拿改动前 `orig` 判漂移（永远同步，应比改后 `list`）。**排一颗环境雷**：本机 Node 22.23.2 `fs.cpSync` 撞**中文父路径**必崩 0xC0000409（ASCII 路径对照 OK、手写 copyDir 全过；库内全用 `copyFileSync` 不受影响，探针复制改手写）——见 CHECKPOINT 坑档 |

## ✅ P10 · 枚举条目色标（2026-10-26，技术库 new 档转正）

| 冲刺 | 内容 |
|---|---|
| P10 枚举条目色标 ✅ | 技术库 `item-color-code` 转正（出处 抖音@Ludi modal_id=7698358547440094502）：`config.itemColorCode`（`enabled` 缺省 false / `colors` 1~12 个 #RRGGBB / `track` 缺省 true）——bullet/keyword 镜按出场序循环身份色，**accent 单一出处在 02**（写进 timeline.shots、keywords 随镜带 accent，03/05 只渲染不各自推导；title/transition/end/split 零字段）；03 纯 CSS 零模板改动：整场重绑 `--accent`（bar/hi/关键词渐变端点全跟色）+ 标题色 chip 伪元素 + 底部圆点进度轨（唯一激活位 + `--cc-dur` 按镜时长填充，**deck 自带章节导航条上色不叠轨**，outro/封面不注入）；05 关键词大字行内 `\1c` BGR 覆盖（无 accent 输出与旧版逐字节一致）；色表空/超量/非法 hex 02 白名单 fail。配方卡 implemented（insert from=2 + config 开关），货架按钮解禁、聊天点名同一份补丁。冒烟 **27/27**：静态 8 + 坏色值/空表宁 fail 2 + **插入重跑 QC 闭环** 11（货架 insert → `/api/rerun` 全链 → 循环上色/关键词随镜色/chip+圆点轨/subs.ass 行内 BGR/成片重建/QC 无 FAIL）+ 清补丁回归 2 + deck 不叠轨 2；探针备忘：存量任务 keywords 多空（keyword 带空格对不上口播即跳过，历史行为非回归），冒烟副本挂确定性关键词补丁 |

## ✅ P11 · Editor 结构版（2026-10-27，轻改边界补齐，冒烟 35/35 全绿）

| 冲刺 | 内容 |
|---|---|
| P11 Editor 结构版 ✅ | 远期 13 第一段补齐（P9 三处「有意未做」转合法）：① **镜头增删/排序**——身份键三分守卫（id 型新镜服务端补发 `s9X+`/n 型按位重排/无键 splitter 文档只准删尾+插新、不许换序，报错指引补 id 升级；新镜 `_new` 运输标记服务端剥离）；structural 判定用**重排前**身份序列（n 重排会抹掉换序信息——冒烟 F1 抓的）② **任务级参数直改**——`EDIT_TASK_FIELDS`（SHOTS_PATCH 子集：风格/封面/字幕/平台/画幅，null=清除，platform↔width 二选一 P6 同口径；音色/语速仍走控制台），GET 回传 platforms/tailOnlyDel、POST 回传终稿 doc 回显 ③ **漂移判定升级**——01 落 `audio/narrationSeg.json` 逐镜比对（整串拼接对「换序不换字/增删拼回同文」免疫的盲区就此堵死；旧任务回退整串口径），钳 1 双条件 `drift||structural`。前端镜头卡 ↑↓/＋插/✕删 + ② 任务参数卡差量提交。冒烟 35/35（含 2 条真实重跑全链：legacy 换序钳 1→seg 落盘→归零→再换序逐镜抓；插镜重跑 seg=镜数/from2 免配音）+ P9 回归 36/36 + P10 27/27 + P6 全 PASS；施工记录见 CHECKPOINT 2026-10-27 |

## ✅ P13 · 时间轴排序页（2026-10-27，用户「按流程布局」诉求的第一刀，冒烟 19/19）

| 冲刺 | 内容 |
|---|---|
| P13 时间轴排序 ✅ | 用户反馈 P11 卡片流「不顺手」，要求按流程排列 → 先交付**独立排序页 `/timeline`**（`web/public/timeline.html` 单文件，同设计语言；三轨「口播/画面/字幕」按 `timeline.json` 真实时长等比铺镜 + 秒刻度尺 + 拖动换序指针落点竖线 + 单击选中开检查器改口播/类型/nav/heading/kicker/title/keyword/asset + Ctrl+Z/重做快照栈 + 缩放滑条 + 保存即走 P11 同源 `/api/editor/shots`）。**无键文档排序引导升级**：拖拽前若 `tailOnlyDel` 明示拦下并给「一键补发 id」向导——server 新增 **upgrading 通道**（原无键 + 每镜全新唯一 id + 镜序/口播逐位不动才放行自造 id，from 钳 2 免重配音只重编译把 id 烘进 timeline.json，响应带 `upgraded`）。GET `/api/editor/shots` 加 `durations[]/total`（timeline.json 按 id 对齐、失配按位序兜、无/坏降级 null 等宽渲染）。入口：首页头部 + 精修页顶双链接。冒烟 **19/19**：A 静态 4 + B durations 契约 2 + C n 型换序（含**全同镜像**证 drift 失明仍靠 structural 钳 1）4 + D 无键升级流 7（含一次真实 02→06 重跑）+ E deck-demo 无副作用 1 + F 清场；拖拽真指针行为无浏览器驱动，按「拖拽产出的请求形态」直测 API 契约，UI 待用户实测。**边界**：本页只做排序 + 高频字段，字段级精修（items/双行卡/分栏 media）仍去精修页，秒级 in/out 裁剪属 P12 重剪段。 |

## ✅ P14 · 流程向导（2026-10-27，用户「按流程分步确认 + 总结页再出片」整站改造，冒烟 27/27）

| 冲刺 | 内容 |
|---|---|
| P14 流程向导 ✅ | 用户反馈 P11 卡片流「挺多不顺手」，明确要「每步做完点确认再进下一步、最后总结页确认无误才出片」→ 交付独立向导页 **`/wizard`**（`web/public/wizard.html` 单文件，同设计语言）。首轮为同页切面板，用户再反馈「要一步步走的页面设计」→ **改版为一页一关**：01 需求 → 02 审分镜 → 03 配音试听 → 04 画面预览 → 05 出片前总结 → 06 合成 → ✓ 完成页；**底部常驻「下一步」翻页栏 + 页门控 `gate(n)`**（读 `/api/stepstatus` 真实状态判前置完成，未完成拦在原地提示缺什么；第 1 页未建草稿时按钮=「生成分镜草稿」）、地址 `#/N` 深链回跳、载入已有任务自动跳对应关、每页大字号「0N」页头 + 本页职责一句话。**配套 server 三原语**：**有界运行** `runPipeline(from,to)` + queue 透传 `to` + `/api/rerun body.to`（`1→1` 只配音、`2→4` 只画面、`5→6` 只合成，绝不越界产下游）；**草稿创建** `/api/create {draft:true}` 只落 shots.json+素材、不进队列零花费、回传分镜供确认；**步骤状态** `/api/stepstatus?name=` 回 voice/timeline/scenes/segments/video/qc 六段产物存在性 + meta 时长/字秒 + drift 待办；`/api/meta` 补 platforms[]/sizes[]（单一出处，向导动态建发布规格下拉；顺带修 qc 汇总正则吃「机械项通过」）。**边界**：这是**编排向导**非时间轴剪辑，秒级 in/out 裁剪仍归 P12 重剪段（未动本决定）。入口三页互链。冒烟 **27/27**（p14-wizard-smoke.cjs，改版后静态断言同步、复跑全绿）：A 静态 6 + B 草稿零运行 4 + C 有界配音 5（含「to=1 不产下游」「seg 落盘 drift 归零」）+ D 有界画面 4（「to=4 不合成」）+ E 有界出片 4（video+qc 解析 18/18 无 ✗）+ F 清场 2；全程真实免费额度 TTS + 本地渲染一轮。 |

## ✅ P15 · 入口改版：首页分流，控制台迁 /console（2026-10-27，用户拍板）

| 冲刺 | 内容 |
|---|---|
| P15 入口改版 ✅ | 用户问「有向导为什么留旧页」→ 澄清控制台=功能全集非旧版，拍板**升格向导、降权控制台**：`git mv index.html→console.html`（内容零改动，头部加「← 入口」、tag 改「专家控制台」）；新 `index.html` 为**入口选择页**（🧭 流程向导 / ⚡ 专家控制台 双卡 + 精修/时间轴次级链接，无脚本纯静态）；server 路由 `/`+`/index.html`→入口、新增 `/console`（`/index.html` 直达控制台的老书签不失效——旧控制台 UI 现由 /console 承接）；editor/timeline/wizard 三页「回控制台」语义链接全部指 `/console`、`backConsole()` 同步。冒烟同步：p9-static 改按新页面结构断言（入口双卡/console 内联 JS//console 路由哨兵）、p14 A 段 +2 断言（29/29），P13 19/19、P11 回归复跑。**后续方向（未动）**：批量变体/货架/克隆等能力逐块向导化后，控制台再瘦身。 |

## ✅ P16 · 控制台重排：双栏工作台 + 素材库灯箱网格（2026-10-30，用户拍板方案 A，冒烟 23/23）

| 冲刺 | 内容 |
|---|---|
| P16 控制台重排 ✅ | 用户嫌旧控制台「单列长滚动、底部素材库像后厨杂物架」→ 三案（双栏工作台/任务为中心/仪表盘启动台）拍板 **A + 灯箱网格 + 先纯布局后增强**。`console.html` 整页重排：**顶栏**（向导/精修/时间轴/入口四链）+ **左栏常驻**（当前任务卡：名字+直达精修/时间轴；任务列表可滚，点行=载入预览并自动切任务台）+ **右栏五标签**：新建（表单按 规格/批量变体/素材 分组，字段与提交体零改动）、任务台（进度+成片+局部重跑+聊天+历史表）、**素材库（灯箱网格：图片/片段真缩略图、BGM 卡内试听、点图放大灯箱（Esc/遮罩关）、分组 chips 筛选 + 名称搜索纯前端重绘、AI 生图区同页）**、技术库（货架原样+刷新钮，插入改「先选任务→自动跳任务台填面板」）、声音（四级兜底说明+克隆面板独立成页，新增 cloneOff 未配 key 说明）。**铁律核验**：旧 34 个功能 id 全量对账零缺失、所有既有 JS 函数原样搬运（新增仅 showTab/灯箱/libRender 拆绘/当前任务三件套）——API 与后端行为零改动。**唯一后端增量**：`/lib/<kind>/<file>` 只读预览路由（三类目录白名单+文件名白名单+限死 library/<kind>，复用 serveFile 带 Range；穿越/伪 kind/隐藏文件/不存在四类负例全拦）。冒烟 **p16 共 23/23**（安全 7 + 骨架 5 + id 对账 1 + 灯箱 4 + **二轮视觉协调 6**：用户反馈素材库/技术库内部按钮样式不协调 → 统一设计件：`.mini` 按钮家族（accent/danger 变体）+ `.itemcard` 两网格共用卡基类（含 hover 反馈）+ `.badge` ok/warn/danger 语义色 + 一套 cathead/网格间距/工具条按钮口径，渲染函数零裸按钮、克隆删除钮 danger 化；改后 id 对账与内联 JS 语法复查照旧零缺失）；p9-static/P13/P14/P11 回归复跑全绿。~~**待用户实测后做的功能增强（已列清单未动）**：素材批量选用、AI 生图历史、素材元信息（时长/分辨率）、BGM 波形~~ ✅ 2026-10-30 用户实测布局后全量落地（见 P17）。 |

## ✅ P17 · 素材库功能增强：元信息 / 波形 / 批量选用 / 生图历史（2026-10-30，P16 布局实测通过后的第二批，冒烟 24/24）

| 冲刺 | 内容 |
|---|---|
| P17 素材库增强 ✅ | P16 登记的增强清单四项全落地。**① 元信息**：`/api/library` 每项带 `meta`（图片 w×h、音视频/BGM 时长，ffprobe 真测），按 `大小:mtime` 签名缓存 `library\.cache\meta.json`（文件变了自动重探；探针失败=meta null 不拖垮列表；`.cache` 点前缀天然不出现在列举）。**② BGM 波形**：ffmpeg 解 8kHz 单声道 PCM → 48 格 RMS（0~1，~1KB/首）缓存 `library\.cache\wave\`，前端 canvas 画波形条（看结构）+ 播放器（试听）并存；`GET /api/library/wave?name=`（白名单同表）。**③ 批量选用**：`/api/library/add` 兼容升级——`names[]`（1~30）数组走 `libraryAddBatch`（逐个过原校验，bg 模式连号编号、部分失败 `failed[]` 明列；**BGM 批量只取第一个并明示"一任务一首"**），单 `name` 旧口子原样（p7 契约回归 24/24）。前端多选模式：☑ 开关 → 卡片左上复选框 + 选中蓝环、全选可见、批量作背景图/批量复制两按钮，跨 kind 勾选自动分桶各发。**④ AI 生图历史**：素材库页底部 `ai-*` 区（时间戳解析、新→旧、灯箱放大、一键再作背景图加入任务），生图落库自动刷新。**前端纯增量**：console 旧 34 id 对账照旧零缺失。冒烟 **p17 24/24**（A 元信息 3 + B 波形 5 + C 批量 6 + D 缓存卫生 2 + E 前端挂点 5 + F 自建自清 2 + 假件 1，ffmpeg 现生成 PNG/MP3 假件跑完零残留）；p7 24/24、p16 23/23、p9-static、自测 5/5、哨兵全绿。零计费。 |

## ⬜ 远期（可选方向，看需求再启动）

9. ~~**素材库接入**——免版权 BGM/图片/视频片段的本地缓存库（用户仍可自带文件优先）~~ ✅ 2026-10-23 实现（见 P7 行）
10. ~~**AI 生成画面**——可选接入生图 API 出场景图（有 key 才启用，保持零成本默认不变）~~ ✅ 2026-10-23 实现（见 P7-2 行）
11. ~~**平台发布规格预设**——抖音/视频号/B站/小红书各自的安全区、字幕字号、时长偏好做成 profile~~ ✅ 2026-10-23 实现（见 P6 行）
12. ~~**语音克隆音色**——DashScope 支持声音复刻，用自己的声音出片（需要 API 支持与额度）~~ ✅ 2026-10-26 实现（见 P8 行）
13. **手动剪辑页面（Editor 精修）**——🔄 **两段式拍板（用户 2026-10-26）**：第一段**轻改 ✅ 2026-10-26（P9）→ 结构版 ✅ 2026-10-27（P11，镜头增删/排序/任务参数直改 + 逐镜漂移判定）**；第二段「重剪」= **P12 提案已就绪，见上节，等拍板**（参考源与三大待定项的推荐案都在 P12 节，交互五件套口径取自 `D:\AI-Anime-main` `/editor` 与 Canva UX）。

## 🔄 P12 · 重剪段立项（远期 13 第二段 · 提案待拍板 2026-10-27）

> 前置已就位：**P11 Editor 结构版**（同日完工）——镜头增删/排序/任务级参数直改 + 口播漂移升级**逐镜比对**
> （01 落 `audio/narrationSeg.json`，换序/增删不再被整串拼接盲区放过；结构变更硬钳 from=1）。
> 本节即 ROADMAP 远期 13 第二段「重剪」的正式立项提案，三个待定项各给推荐案，**拍板后开工**。

### 待定项一 · 与轻改段的分工边界（字段级 vs 秒级）——推荐「语义/时间轴二分」

- **P11 管语义**：文本、字段、镜头顺序/增删、风格平台字幕开关——真相源永远是 `shots.json`。
- **重剪管时间轴**：秒级的 in/out、拆分、转场时刻、对齐——真相源是新建的**编辑单** `edit.json`。
- 编辑单以「从当前 `timeline.json` 一键导入」诞生（一镜一 clip）；此后改口播回 P11 重出片，编辑单给「重新导入 / 尽力 resync」两个选项，**不做双向同步**（复杂度悬崖，收益存疑）。

### 待定项二 · 成片与 shots.json 对账——推荐「脱钩导出 + 编辑单持久化」

- `edit.json` 落任务目录：`{version, fromShotsAt, fps, clips:[{id, seg, src, in, out, transition, captionShift}], trackLocks}`。
- 派生产物：`精修/成片.mp4` + `精修/qc-report.txt`（06 判据参数化进 08）；`shots.json` **只单向导入不回写**，删镜不动编辑单。
- 参考源现成范式：`D:\AI-Anime-main` 后端 `editor_projects` 表（name/ratio/timeline-json/status 四件套）。

### 待定项三 · 素材/字幕与 assets、caption 体系对齐——推荐「clip 引用镜级产物，05 拆件复用」

- clip 的 `seg` 引用镜 id：场景镜 → `segments/<id>.mp4`；素材镜 → `assets/*`（cover 铺满/循环/截断沿用 05 现有滤镜）；音频 → 01 成片 `voice.mp3` 按镜窗口 trim（音画同裁天然不漂）。
- 字幕：**推荐一期就出词级表**——02 升级顺手把逐词时间落 `audio/wordTimings.json`（whisper 与静音兜底两条路都在 02，拆件到 common 一次到位），08 从词级表按 clip in/out 裁窗生成 ASS，卡拉OK/bar/砸字零复刻；方案 B（句级窗口裁 ASS 事件）只作工期妥协备选。
- 渲染 = 05 的泛化：把段落序列从 `timeline.shots` 换成 `edit.json.clips`，ASS 生成/BGM 闪避/loudnorm/片尾卡/封面全部抽件复用；`-c copy` 快路**不做**（帧精度优先，全重编码）。

### 交互与技术栈

参考源①（`D:\AI-Anime-main` `/editor`，`EditorPage.tsx` 1115 行）五件套照单：DragState 拖拽状态机、0.1s 网格吸附、`commitTimeline` 统一写入 + 400ms 防抖撤销栈、右缘 10px resize 手柄、滚轮劫持横滚；参考源② Canva 编辑器视觉。零新增依赖延续（Node 内置 http + 原生 JS 单文件页 `/cut`）。

### MVP 范围

做：四轨时间轴（口播/画面/字幕/BGM 联动锁定）、裁剪拖拽、拆分、删除、撤销重做、右属性面板、转场时长、导出合成、精修 QC、预览可拖。
不做（另立项）：变速变调、文字动画、多轨素材叠层、关键帧、滤镜调色。

### 工程量预估

A 数据契约 + 08 渲染管线（含 02 词级表拆件）≈ 2 天 · B 时间轴页交互 ≈ 2 天 · C 导出/QC/收尾卡打通 + 冒烟 ≈ 1~2 天。

### 拍板项（等用户）

① 分工边界按语义/时间轴二分？ ② 对账按脱钩导出？ ③ 字幕按方案 A（词级表一次到位）还是 B（句级裁窗省事）？ ④ MVP 范围与「不做」清单增减？

## 维护备忘

- 依赖环境固化：`.py312/`（whisper）+ `D:/ffmpeg` + Chrome + hypit，换机器按 00-checkenv 提示装（安装全清单见 `INSTALL.md`）
- 已知口径：语速目标 7.2 字/秒（2026-10-16 用户调，原 7.6 微降）；默认音色 loongstella 飒爽新闻女；BGM 只认用户自带文件
- 配音四级兜底：dashscope → edge → gtts → sapi（SAPI 为离线最后防线，Windows 必带中文语音 Huihui）
- 坑位留档：见 `CHECKPOINT-2026-10-13.md`（whisper 四坑、loudnorm 两坑、DashScope mp3 头时长等，均已固化进脚本注释）
- 施工记录：`CHECKPOINT-2026-10-20.md`（P3 改片三件套 → P4 入库+声学定案 → P5 打磨五件套，含全部验证数据与遗留项）
