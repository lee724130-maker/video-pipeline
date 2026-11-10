# CHECKPOINT · 2026-11-10 —— 补完遗留回归 + /comic → 原生可编辑 pptx（P24）落地

> 承接 `CHECKPOINT-2026-11-09.md` 第八节遗留项。本会话只做 `D:\剪辑应用`。

## 一、开工现场（实测，非记忆）

- HEAD 已到 `be8ebfd`——「海报」并行会话把 `poster.html`（230 行）提交了，我的 `5472b3e` 成了它的父提交；`poster.html` 未被 `server.cjs` 接线（`/poster` 404），是独立文件，不归本会话。
- 8787 服务昨天进程已死，重启（本次 PID 17044）。
- 昨天顺延的全量回归：日志显示 10 套已绿，卡在 p19 未完成。

## 二、补完遗留全量回归（实测）

- 先补跑昨天缺的 4 套：p19 23/23、p20 16/16、p21 67/67、guard-sentinel 干净——全绿。
- 动完 P24 代码后，**全量重跑 14 套件 + 哨兵**（p6-check / p9-static / p7-library / p9-editor 36 / p10-icc 27 / p12 25 / p13 19 / p14 29 / p16 23 / p17 24 / p19 23 / p20 16 / p21 67 / **p24 30** / 哨兵）——**0 失败**。昨天 CHECKPOINT 里「明天务必补跑」的欠账正式关闭。
- 坑：存档回归 runner 的日志路径硬编码到已死工作区 `mw0ib4a7tt62d3e2`，复用前 sed 改到自己目录；杀 8787 用 PowerShell `Stop-Process`（`taskkill //F` 被文件守卫当 UNC 拦）。
- **偏差如实记录**：同日续做（尾巴/分支卡/写入任务目录）这次提交，按用户「直接推送、不等回归」指示**未等全量回归闸门**。直接相关套件 p24 已 35/35 全绿、服务正常启动、comic 路由可达；其余 13 套件本轮改动（make_pptx.py / comic.html buildPptxSpec / server.cjs pptx 端点 task 分支）不触碰其路径，风险低但**未验证**。后台全量回归跑完后另行回报。

## 三、P24：/comic → 原生可编辑 pptx（本会话主线）

**路线改判依据**：昨天 A/B 实测坐实 WPS/Office 的 SVG 导入器既拒内嵌大 base64 栅格、又不认 `text-anchor` → 面向 WPS 的「可编辑交付」走 SVG 是死路，改走原生 pptx。

**依赖（先安全审查、经用户两轮追问确认后才装）**：python-pptx 1.0.2 + lxml 6.1.3 + Pillow 13.0.0 + XlsxWriter + typing-extensions，PyPI 官方、**关掉本机 `NODE_TLS_REJECT_UNAUTHORIZED=0` 重开证书校验取哈希**、`pip install --only-binary=:all: --require-hashes` 哈希锁定 wheel。**装进项目自带 `.py312` 而非 venv**（无冲突、`.py312/` 已 gitignore、且它是可跨盘搬的解释器，venv 绑绝对路径搬盘即坏）。

**引擎** `pipeline/tools/make_pptx.py`：吃「版式规格 spec.json + 底图 png」→ 原生可编辑 pptx。底图=picture 铺满；旁白框/气泡=原生形状**自带文本框**（改字即改内文、垂直居中）；对齐用 `PP_ALIGN`（WPS 原生处理，绕开 text-anchor）；字号 px×0.75→pt；中文显式写 `a:ea`；半透明用标准 OOXML `a:alpha`。

**接线**：
- `comic.html`：`buildPptxSpec()` 从 `_paint/_rect` 生成规格（描边复用 `svgPaint` 把 rgba 洗成 hex+strokeOpacity）+「导出 PPTX（WPS 可编辑）」按钮。
- `server.cjs`：`POST /api/comic/pptx`——校验 spec/canvas 范围/层数上限 → 底图 dataURL 解码到 `os.tmpdir()` 临时 PNG → `spawnSync` 调 `.py312 python make_pptx.py` → 回 pptx 字节流下载 → finally 清临时目录（全 ASCII 目录名防 GBK）。

**分批**：2a 引擎独立验证（结构自检 + 用户 WPS 验字号贴合/半透明 OK）→ 2b 接线（p24 冒烟 30/30）。

**用户 WPS 实测四条全过**：能直接打开 / 两层自动贴合不用手动对齐 / 居中准 / 能改字改价。

## 四、本次提交内容

- 新增：`pipeline/tools/make_pptx.py`、`smoke/p24-pptx-smoke.cjs`、`CHECKPOINT-2026-11-10.md`。
- 改动：`web/server.cjs`（os 导入 + `/api/comic/pptx`）、`web/public/comic.html`（pptx 按钮 + buildPptxSpec）、`ROADMAP.md`（补 P23/P24 两节）、`README.md`（/comic 段补 P23/P24 增补）、`CHECKPOINT-2026-11-09.md`（回归补跑关闭备注）。
- **同日续做（尾巴/分支卡/写入任务目录）一并纳入本次提交**：`make_pptx.py` 加 `build_freeform` 尾巴 + `add_choice`（遮罩+引导语+三金边选项，选项文字金色标签 run + 浅色正文 run）；`comic.html` `buildPptxSpec` 带 `tail` + `choice` 层（choice 最先入层压暗底图）+ 新增「PPTX 入任务目录」按钮；`server.cjs` `/api/comic/pptx` 加 `task`+`name` 分支（PNG 同款白名单守卫，落 `output/<任务>/comic/<name>.pptx` 回 JSON）；`smoke/p24-pptx-smoke.cjs` 由 30→35。
- **不纳入**：`AI漫剧分镜与提示词模板.md`（11-02 旧欠账，仍等用户定夺）。

## 五、遗留与下一步

1. ~~**pptx 尾巴/分支卡**：本版未还原~~ ✅ 同日已做：尾巴 `build_freeform`、分支卡遮罩+引导语+三选项。**如实标注**：尾巴朝向/接缝、分支卡排版的视觉 WPS 细测用户未逐条回报，按其「做完就推送」指示收尾推送；若观感有偏差下次微调。
2. ~~**pptx 写入任务目录**：只浏览器下载~~ ✅ 同日已做：`/api/comic/pptx` 带 task+name 落 `output/任务/comic/`。（注：`/api/comic/list` 仍只列 `.png`，pptx 不在产物缩略网格回显。）
3. **居中根因**：昨天「没居中」到底是 WPS 不认 text-anchor 还是别的——pptx 路线已绕开它（原生 PP_ALIGN 实测居中准），SVG 那条不再纠结。
4. **杂务**（沿用 11-06/11-09 交接）：C 盘隔离目录清理（**2026-11-10 核实：该副本已不存在，桌面/用户目录递归/回收站均无，任务实际已完成**）、第3节 B 项（SVG/manifest 落盘）、C 项带货版式组件、D 项批量出格。
