# CHECKPOINT · 2026-11-09 —— /comic SVG 供 WPS 的兼容修复 + 转投原生可编辑 pptx

> 承接 `Desktop\断点交接-2026-11-06.md` 第 3 节 **A 项**（P22 交付物的用户实测）。本会话只做 `D:\剪辑应用`；AI-Anime / 海报那条线归并行会话。

## 一、今天做了什么

用户实测 P22 的 `/comic` SVG 导出，反馈三点：① WPS 演示「打开」SVG 报**文件损坏**；② 要看全图得手动缩放网页；③ 文字「居中对齐但没正确居中」。围绕这三点做了诊断、修复，并把「面向 WPS 的可编辑交付物」从 SVG 路线**改判到原生 pptx 路线**。

## 二、SVG → WPS 兼容：诊断与修复（实测）

解剖用户上传的 `漫画格_1794210055341.svg`，定位到 `buildSvg` 里三处 **SVG 1.1 呈现属性硬伤**（浏览器宽容、WPS/Office 受限子集解析器判损坏）：

| 问题 | 出处 | 修复 |
|---|---|---|
| `rgba()` 直接写进 `fill`/`stroke`（SVG1.1 不接受） | `THEME.stroke`、选择卡 `overlay` | 新增 `svgPaint/svgFillAttr/svgStrokeAttr`，统一转 `#hex + fill/stroke-opacity` |
| 缺 XML 声明 | `buildSvg` 根标签 | 前置 `<?xml version="1.0" encoding="UTF-8"?>` |
| `<image>` 只用 SVG2 的 `href` | 底图层 | 改 `xlink:href`（SVG1.1 正宗，浏览器/Office 都认；且避免 href+xlink 双写把 4MB base64 复制两遍、体积翻倍） |
| `text-anchor` 只在 `<text>`、靠继承 | `svgTextEl` | 每个 `<tspan>` 显式带 `text-anchor` |

**A/B 对照决定性实测**：把用户那张含 3.3MB 内嵌底图的 SVG 做等价修复（A=含底图）vs 删掉 `<image>` 行（B=纯矢量 689 字节）交用户在 WPS 插入——**B 能插入、A 不能**。结论：**WPS/Office 真正噎住的是内嵌的大 base64 栅格**，上面那些语法修复必要但不充分。

**据此改判**：`buildSvg` 改为**纯矢量**（不再烤底图），导出区新增 **「底图 PNG」** 按钮单独导位图层。正式素材走「底图 PNG 垫底 + 纯矢量 SVG 叠加」分层——契合用户既定「正式素材必须分层」路线。概念整图仍用原 PNG 出口一次直出。

## 三、居中「跑位」核查（实测证据，结论：文件本身没错）

用本机 Chrome 无头把用户原文件的 `bubble-1` 文字元素**一字不差**抠出来渲染（品红线标在锚点 x=634.9，也正是椭圆 `cx`），两行文字对该线左右对称；带/不带 per-tspan `text-anchor` 两次渲染字节数一致。**导出 SVG 的居中在真正的 SVG 渲染器里是正确的**。
用户看到的「没居中」，最可能是 **WPS/PowerPoint 的 SVG 导入器不认 `text-anchor`**（把居中按左锚画、整体偏右）——但本机无 WPS，**这条是推断、未证实**。此点连同「WPS 拒内嵌栅格」一起，成为放弃 SVG→WPS 路线、转投 pptx 的依据。

## 四、python-pptx 安装（先安全审查、经用户确认后才装）

- 审查清单（PyPI 官方、TLS 证书校验**重开后**取的哈希，两次一致）：`python-pptx 1.0.2`(MIT, scanny/python-pptx) + 依赖 `lxml 6.1.3`(BSD-3) / `Pillow 13.0.0` / `XlsxWriter 3.3.1` / `typing-extensions 4.16.0`。
- 落地方式经用户两轮追问后定论：**装进项目自带 `.py312`，不套 venv**——① `.py312` 本无 lxml/Pillow，纯新增不冲突；② `.py312/` 已 gitignore，装包不脏工作树；③ 它是可跨盘搬的可移植解释器，venv 绑死绝对路径、搬盘即坏，反而破坏可移植性。
- 安装命令 `pip install --only-binary=:all: --require-hashes -r <pinned>`：只解包 wheel、不跑 setup.py，逐个校验 sha256。已装好，`import pptx` 通过（1.0.2 / lxml 6.1.3 / Pillow 13.0.0）。

## 五、pptx 阶段一：原生可编辑证明

用 python-pptx 产出 `outputs\漫画格-可编辑证明.pptx`（画布 1024×1536，底图=图片铺满、旁白框/椭圆/深色气泡/价格标签=原生形状+原生文本框，对齐用 `PP_ALIGN` 交 WPS 原生处理，中文显式写 `a:ea=Microsoft YaHei`）。
**结构自检通过**：5 形状、坐标/尺寸/对齐/中文字体全部正确。
**本机无 LibreOffice/PowerPoint，我没法本地渲染预览**——视觉这关**待用户在 WPS 实测**（能否打开、两层自动贴合、居中准不准、能否直接改字改价）。

## 六、代码改动与验证

- 改动文件：`web/public/comic.html`（SVG 兼容修复 + 纯矢量 + 底图 PNG 按钮）、`smoke/p21-comic-smoke.cjs`（H 段断言同步）。
- p21 冒烟 **63 → 67 全绿**：新增 H9a 无裸 rgba、H9b 不内嵌 image、H9c tspan 带 text-anchor、H9d 底图 PNG 出口合法；H1/H3 改判适配 XML 声明与纯矢量。
- 全量回归：**⚠️ 按用户指示本次未等全量回归、直接提交推送**（偏差已如实标注）。相关套件 p21（唯一覆盖本次改动的）已 67/67 全绿；其余 12 套件本次改动不触碰其路径，风险低但**未验证**。**明天务必补跑全量回归**（`Desktop\会话存档-20261106\脚本\run-regression.cjs` 那份日志路径要改到自己工作区再跑），确认无回归。

## 七、归属澄清（重要）

- `web/public/poster.html`（230 行，未跟踪、未被 `server.cjs` 接线）是**并行「海报」会话（S16 BLG vs GENG 对垒海报）的产物，不是本会话所做**，本次提交**不纳入**，交由该会话/用户处置。
- `AI漫剧分镜与提示词模板.md` 自 11-02 起 untracked 的旧欠账，仍**等用户定夺**，本次不动。

## 八、遗留与下一步

1. **pptx 阶段二**：待用户 WPS 实测阶段一通过后，把 /comic 接上「导出 PPTX」——页面吐真实版式规格 + 底图，`pipeline/tools/make_pptx.py`（用刚装的 python-pptx）拼原生 pptx，补冒烟、同步三档、一里程碑提交。
2. **居中根因**：需用户确认「没居中」是在 WPS 里还是浏览器里看到的（决定是 WPS 导入器限制、还是几何真 bug）。
3. **杂务**（沿用 11-06 交接）：C 盘隔离目录清理、SVG/manifest 落盘任务目录（第3节 B 项）、带货版式组件（C 项）、批量出格（D 项）。

## 九、关键技术事实（本会话新增，别重新发现）

- **WPS/Office 的 SVG 导入器**：拒绝内嵌大 base64 栅格；不认 `rgba()` 呈现属性；很可能不认 `text-anchor`。→ 面向 WPS 的可编辑图**别走 SVG，走原生 pptx**。
- **WPS 演示不能直接「打开」.svg**（弹「文件损坏」实为类型不支持），只能「插入→图片」。
- **本机无 playwright 时用 Chrome 无头截图验图**：`--headless --user-data-dir=<绝对> --virtual-time-budget=3000`；`--screenshot` 必须给**绝对 Windows 路径**（相对路径落空/ERR_FILE_NOT_FOUND）。写文件别用 heredoc+rm（rm 被文件保护守卫拦会整块中断），直接用 Write 工具。
- **存档回归 runner 的日志路径硬编码到了别的会话工作区**（`mw0ib4a7tt62d3e2`），复用前必须改到自己目录——再次印证「别硬编码绝对路径」。
