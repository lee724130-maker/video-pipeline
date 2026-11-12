# CHECKPOINT · 2026-11-12 —— /comic 带货预设模板 + 一键清空 + 左侧栏/顶栏重构 + 白板起步

> 承接 `断点交接-2026-11-11.md` 第 3 节 A 项（带货预设模板），并在其后续做用户实测提出的一串 /comic 排版增强。本会话只做 `D:\剪辑应用`（AI-Anime 归另一会话）。

## 一、开工现场（实测）

- HEAD `278eec9`（= P25 代码里程碑 `6f678f2` + 其上的断点交接文档提交），`main...origin/main` 同步（0/0），工作树只剩旧欠账 `AI漫剧分镜与提示词模板.md`（untracked，非本会话产物，等用户定夺）。
- 8787 服务未监听 → 本会话 `node web/server.cjs --port 8787` 起（PID 2548），`/comic` 静态读 comic.html，改 html 不用重启。
- 依赖 `.py312`（python-pptx/lxml/Pillow）在位。

## 二、本会话完成的 6 个增量（都改 `web/public/comic.html` + 冒烟）

1. **带货预设模板**（P25 遗留 A 项）：加「🎬 一键铺带货版式」按钮 + 通用 `applyPreset(name)`，`PRESETS['live-room']` 复用现成 `newWidget` 默认位一次铺齐名条/观看数/弹幕/商品卡/底部栏五件。**幂等替换带货组件**（只重建 `S.widgets`，旁白/气泡/底图不动），可反复点不堆叠。实测画布 1024×1536 内五件默认位不溢出、互不碰撞（商品卡右缘 994、底部栏右缘 429、名条与观看数分居顶部两角）。
2. **一键清空**：「🗑 一键清空」按钮 + `clearAllContent()`，一次清空**带货组件 + 对话气泡 + 旁白框**（底图/分支卡保留）。`confirm()` 二次确认（无撤销的批量删除），画布已空时直接提示不弹框；`syncInputs()` 把旁白开关/文本框同步回空态不留残影。
3. **底图默认铺法改 contain**（完整可见、不裁切）：`S.view.fit='contain'` + `<select id=fit>` 把 contain option 置首并 `selected`。**两处必须同改**——`initFromDom` 读 DOM→S 且启动不调 `syncInputs`，只改一处会"下拉显示 cover、行为却是 contain"不符。
4. **左侧栏重构**：6 个平铺 `<fieldset>` → **4 大类可折叠 `<details class="grp">`**：🖼 底图与画面 / 💬 文字与气泡 / 🛒 带货组件 / 📤 导出；"文字与气泡"下再嵌 3 个 `<details class="sub">`（旁白框 / 对话气泡 / A/B/C 分支选项卡），解决"分支卡不好找"。**所有控件 id 原样保留**（JS 全按 id 绑定，重排不重命名即安全）。
5. **顶栏重构 + 折叠交互**：4 个导航链接按钮化（`.navbtn` 边框+hover+可点光标）、长操作提示弱化为 ⓘ 灰字右对齐、画布下方状态读数保留；新增「▸ 展开全部 / ▾ 收起全部」`toggleAll`（批量设 `details.open`）与「◀ 收起侧栏 / ▶ 展开侧栏」`collapseAside`（`main.aside-collapsed` → `aside{display:none}` + 网格变单列、画布占满）。**进入页面默认全部收起**（grp/sub 的 `open` 属性都去掉，toggleAll 初始标签改「展开全部」）。
6. **白板起步**：删启动时塞入的 2 个示例气泡（`S.bubs.push(...)` 那段）、旁白默认关（`narOn` 去 `checked`、`narText` 清空、`S.nar.on=false`）。带货组件本就空。加载即"无组件 / 无气泡 / 无旁白"。

## 三、⚠️ 发现并修复的隐性回归（p21）

- **起因**：上一轮（11-12 内）"默认全收起"改完后只复跑了 p25、**没复跑 p21**。
- **症状**：本轮改白板起步后跑 p21，结果从 67 掉到 38（0 失败 / 1 跳过）——少了 ~29 条断言。
- **根因**：p21 [F] 段用 `pg.locator('#addBub').click()` 这类**需要元素可见**的真实点击，而控件被藏进折叠的 `<details>` 里 → locator 超时 → 整个 F/G/H 段被 `try/catch` **静默跳过**（跳过被吞掉，只报 1 skip）。
- **修法**：p21 浏览器段开头加 `document.querySelectorAll('aside details').forEach(d => d.open = true)`（模拟用户用前展开面板），控件即可点。p21 回 **67/67**。
- **对照**：p25 全程用 `pg.evaluate(() => element.click())`，不吃可见性，所以一直没受影响。
- **教训入 MEMORY**：改 UI 默认可见性（折叠/隐藏）要顺带检查所有用 `locator.click` 的冒烟；`try/catch` 吞异常会让"整段被跳过"伪装成"通过数变少但 0 失败"，务必看 SKIP 行和段标题是否缺失。

## 四、验证

- **p25 冒烟 26 → 55/55**：A4/A5 挂载；[F] 预设幂等 6 项（杂散→正好 5 件、五样各一、默认位不溢出、重复点同序同位、无 JS 报错）；[G] 一键清空 7 项（组件/气泡/旁白清零、选中态归零、旁白 DOM 控件同步、分支卡保留、按钮+确认全链路）；[H] 折叠/顶栏/contain 11 项（4 大类齐全、3 子块齐全、重排后 id 全保留、默认全收起、展开/收起、侧栏收起/恢复、contain 默认、顶栏按钮化）；[A0] 白板起步 3 项。
- **p21 冒烟 67/67**（修复后）。
- **未跑 16 套全量回归**：按用户"相关套件绿即可提交"指示，本里程碑只跑直接相关的 p25+p21 两套（全绿）即提交，全量回归留待后续（如实标注）。
- 无头截图目测：预设标准直播间版式、默认收起态、侧栏整体收起态、白板起步态各一张（emoji 图标在测试浏览器缺字体显示方框，属测试假象，真浏览器正常）。

## 五、本次提交内容

- 改动：`web/public/comic.html`（预设/清空/contain/左栏 4 大类折叠/顶栏按钮化/toggleAll/collapseAside/白板起步）、`smoke/p25-widget-smoke.cjs`（+A4/A5/F/G/H/A0）、`smoke/p21-comic-smoke.cjs`（浏览器段开头展开 details + [F] 段自建旁白夹具）。
- 文档：`ROADMAP.md`（新增 P26）、`CHECKPOINT-2026-11-12.md`（本文件）。
- **不纳入**：`AI漫剧分镜与提示词模板.md`（旧欠账，仍等用户定夺）。

## 六、遗留与下一步（明天续办队列）

1. **SKU/头像接素材库选择器**（P25/P26 遗留 B 项，真实 SKU 诉求）：现只本地上传（file input），接 `/lib/images` 灯箱选择器给商品卡 SKU、名条头像选真实素材图。中等工作量。
2. **pptx 头像裁圆**（C 项，小改）：namebar 头像在 pptx 里是方形图叠在椭圆上（canvas 有 clipEllipse，pptx 未裁），精确裁圆需 pptx 图片 fill 或裁剪 XML。
3. **SVG/manifest 落盘 + 批量出格**（D 项，远期）：SVG/text-manifest 目前只浏览器下载，未落 `output/任务/comic/`；批量出格=一份 `panel-spec.json` 一次出整套格 PNG+SVG+pptx，纯排版零配额。
4. **全量回归**：本里程碑未跑 16 套全量回归，建议下次会话择一空闲时段**串行独占 8787** 补跑一次（含 p25/p21 + 哨兵）。

## 七、断点交接（2026-11-12 收工落盘）

- **提交/推送**：见本节末尾——本会话 6 增量 + 文档合并为 P26 一里程碑提交推送，`main` 与 `origin/main` 同步后工作树只剩旧欠账 `AI漫剧分镜与提示词模板.md`（untracked，非本会话产物）。
- **8787**：收工时停（`Stop-Process -Id <pid> -Force`，PID 由 `netstat -ano | findstr :8787` 取），下会话跑冒烟前先 `node web/server.cjs --port 8787` 重启且**串行独占**。
- **环境提醒**：git 代理 `127.0.0.1:7890`（Clash）时好时坏，push 失败就 `git -c http.proxy= -c https.proxy= push origin main` 绕过直连各试一次。
- **下一会话一句话续办**：「按 `D:\剪辑应用\CHECKPOINT-2026-11-12.md` 第六节继续，先做第 1 项（SKU/头像接素材库选择器）」。
- **验证入口**：起 8787 后浏览器开 `http://127.0.0.1:8787/comic`——白板起步、左栏 4 大类默认收起、顶栏「收起侧栏/展开全部」、带货组件区「一键铺带货版式/一键清空」。
