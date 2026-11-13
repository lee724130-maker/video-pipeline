# CHECKPOINT · 2026-11-13 —— /comic 素材库灯箱选择器（SKU/头像）+ /comic 缓存头修复

> 承接 `CHECKPOINT-2026-11-12.md` 第六节队列第 1 项。本会话只做 `D:\剪辑应用`。

## 一、开工现场（实测）

- HEAD `4842496`（P26），与 origin 同步，工作树只剩旧欠账 `AI漫剧分镜与提示词模板.md`（untracked，非本会话产物）。
- 8787 未监听 → 本会话 `node web/server.cjs --port 8787` 起（当前 PID 19164）。

## 二、素材库灯箱选择器（本会话主线，P25/P26 遗留 B 项）

**目标**：商品卡 SKU、名条头像目前只能本地上传（file input），改成也能从素材库 `/lib/images` 选真实图。

**方案（用户拍板）**：灯箱弹框选择器 + 保留本地上传。

**实现**（`web/public/comic.html`）：
- 名条「头像图」、商品卡「SKU 图」字段用新 `imgField(i,key,label,cur)` 渲染：`🖼 素材库` 按钮（`data-pick`）+ 原 `Choose File`（`data-img`）+ 已选图时显示预览缩略图 `.imgthumb` + `清除`（`data-clearimg`）。
- `openLibPicker(onPick)`：弹 `#libPicker` modal → `fetch('/api/library')` 取 `kinds.images` → 网格渲染 `.libcell` 缩略图 → 点一张 **`fetch(url)→blob→FileReader.readAsDataURL→dataURL`** → 关框回调。
- `assignLibImg(i,key,dataUrl)`：把 dataURL 载入 Image 写入 `w[key]={img,src}`，重绘。
- 关闭：`✕ 关闭`按钮 + 点遮罩空白处。库空时提示改用本地上传。

**关键约束（务必记住）**：pptx 出口 `make_pptx.py` 只认 `^data:image/...;base64,` 的 **dataURL**（第 188 行），SVG 出口把 src 直写 `xlink:href`。所以库图（URL 形态）**必须转成 dataURL 再存**，否则 pptx/SVG 丢图。选图链路统一走 dataURL，与本地上传同路，四出口一致。

**用户实测**：灯箱选择器 OK（能看到、能选图、填入生效）。

## 三、⚠️ 缓存导致"看不到灯箱"的修复

- 现象：用户刷新后看不到「🖼 素材库」按钮/灯箱。
- 排查：用真实 `locator.click`（需可见+派发真事件）在无头复现，灯箱正常弹出（display:flex、z:50、铺满、2 张库图、0 报错）→ 代码没问题。
- 根因：`server.cjs` 的 `/comic` 路由**没设 `Cache-Control`**，浏览器缓存了旧版 comic.html（旧版无选择器）。
- 修法：`/comic` 响应加 `'Cache-Control': 'no-store'`（改 server.cjs 已重启 8787 生效）。用户硬刷一次（Ctrl+Shift+R）清旧缓存后即见。

## 四、验证

- **p25 冒烟 55 → 66/66**：新增 A6 挂载（libPicker/openLibPicker/data-pick）+ [I] 段 10 项（字段素材库按钮齐全、modal 挂载、点开灯箱、网格渲染真实库图、选图后 modal 关闭、头像写入且为 dataURL、预览/清除出现、清除置空、无 JS 报错）。
- **p21 冒烟 67/67**（无回归）。
- 无头截图：灯箱弹框（2 张库图缩略图）、按钮位置标注图各一张。emoji 图标在无头测试浏览器缺字体显示方框属测试假象，真浏览器正常。
- **未跑 16 套全量回归**：按用户"相关套件绿即可提交"，本里程碑只跑 p25+p21（全绿）。

## 五、本次提交内容

- 改动：`web/public/comic.html`（imgField/openLibPicker/assignLibImg/data-pick/data-clearimg 接线 + modal HTML + 灯箱 CSS）、`web/server.cjs`（/comic 加 Cache-Control: no-store）、`smoke/p25-widget-smoke.cjs`（A6 + [I] 段）。
- 文档：`ROADMAP.md`（P27）、`CHECKPOINT-2026-11-13.md`（本文件）。
- **不纳入**：`AI漫剧分镜与提示词模板.md`（旧欠账，仍等用户定夺）。

## 六、遗留与下一步（队列）

1. ~~**pptx 头像裁圆**（P25/P26 遗留 C 项，小改）~~ ✅ 本日已完成（见第七节 P28）。
2. **SVG/manifest 落盘 + 批量出格**（D 项，远期）：SVG/text-manifest 目前只浏览器下载，未落 `output/任务/comic/`；批量出格=一份 `panel-spec.json` 一次出整套格 PNG+SVG+pptx，纯排版零配额。
3. **全量回归**：本里程碑未跑 16 套全量，建议择空闲时段**串行独占 8787** 补跑一次（含 p25/p21 + 哨兵）。
4. 可选：其他 HTML 路由（/、/console、/cut、/wizard）同样没设 no-store，若也遇到"改完看不到"可一并加。

## 七、同日续做 · pptx 头像裁圆（P28）

- **目标**：namebar 头像在 canvas 里被 `clipEllipse` 裁圆，但 pptx 出口是 `add_picture` 矩形放置、不认该标记 → 头像在 WPS 里是方图叠在椭圆上。
- **实现**（`pipeline/tools/make_pptx.py`）：新增 `_clip_pic_to_ellipse(pic)`，image 图元带 `clipEllipse` 时把图片 `<a:prstGeom>` 设成 `prst="ellipse"`（OOXML 图片形状设椭圆即裁成圆，PPT/WPS 支持）；SKU 图不带标记仍矩形。**浏览器端零改**——`buildPptxSpec` 的 `{...p}` 只删 `img`，`clipEllipse` 早已透传给 python。
- **验证**：p24 冒烟 35→**38**（新增 [F] 引擎级 3 条：两张图、头像 `prstGeom=ellipse`、SKU `rect`）；全链路探针（浏览器设头像→buildPptxSpec clipEllipse=true+dataURL→POST 200→解包 pptx 头像图 ellipse）；p25 66/66、p21 67/67 无回归。**用户 WPS 实测**：头像裁圆效果 OK、SKU 保持方。本机无 LibreOffice/PowerPoint，视觉确认依赖用户 WPS。

## 八、全量回归 + 重建串跑器（收工前质量门）

- **重建入库版 `smoke/run-regression.cjs`**：之前那个跑在 `Desktop\会话存档…\脚本\` 的 runner 已随死工作区永久丢失（正是"脚本别只留临时目录"的老坑）。新 runner 规矩：路径全从 `lib.cjs` 的 ROOT 派生、**禁硬编码绝对路径**；`spawnSync` **串行独占 8787**（同一时刻只跑一条管线，并发会假性失败）；**计费套件默认闸住**——`p7-2-imagegen`（真实生图）、`p8-clone`（真实复刻）只在 `--with-billing` 时跑，且跑前须先向用户报价；末尾自动跑 `guard-sentinel` 哨兵；每套件以**退出码 0 为权威判绿**（README 口径），解析到的"通过/失败/跳过"计数作辅助。
- **判定 bug 修正**：初版把"结果行格式不匹配正则、计数解析为 null 但 exit=0"的套件误标 FAIL。修为：`passed = !crashed && code===0 && (failParsed===null || failParsed===0)`，以退出码为准。
- **本次全量回归结果（零计费 16 套 + 哨兵）**：**全绿**——16 套全部 `exit=0`，`guard-sentinel` 干净。comic 三套明确计数 p21 67/0/0、p24 38/0/0、p25 66/0/0（覆盖本日 P26/P27/P28 改动面）；其余 p9-static/p6-check/p7-library/p10-icc/p16/p17/p9-editor/p12/p19/p20/p11/p13/p14 均 exit=0。慢套件耗时：p11 474s、p9-editor 245s、p13 223s、p20 99s（真实管线重跑）。
- **计费 2 套未跑**：`p7-2-imagegen`、`p8-clone` 本轮按报价铁律未执行，需要时先报价再 `--with-billing`。

## 九、断点交接（2026-11-13 收工）

- 本会话三个里程碑（P27 素材库灯箱 + 缓存头、P28 pptx 头像裁圆、以及收工的全量回归 + `smoke/run-regression.cjs`）均已提交推送，`main` 与 `origin/main` 同步后工作树只剩旧欠账 `AI漫剧分镜与提示词模板.md`（untracked，非本会话产物）。
- 8787 收工时停；下会话跑冒烟/回归前先 `node web/server.cjs --port 8787` 重启且**串行独占**（或直接 `node smoke/run-regression.cjs` 跑全量）。
- git 代理 `127.0.0.1:7890` 时好时坏，push 失败就 `git -c http.proxy= -c https.proxy= push origin main` 绕过直连。
- **下一会话一句话开工**：「按 `D:\剪辑应用\CHECKPOINT-2026-11-13.md` 第六节继续，先做第 2 项（SVG/manifest 落盘 + 批量出格）」；或指定其他。计费那两套要跑先报价。
