// smoke/p25-widget-smoke.cjs —— 带货预设组件（C1 观看数/名条/商品卡 + C2 弹幕条/底部操作栏）冒烟
// 断言：A UI 挂载 · B 添加/字段/拖动真的改几何/_prims/_box · C 三导出含全部组件（SVG group / pptx widget 层 / manifest / panel-spec）· D 端到端 pptx 重开含组件文字 · E 清场
// 计费：零（headless chromium + 本地 spawnSync python）
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ROOT, OUTPUT, probeDir, sweepProbes } = require('./lib.cjs');
const BASE = 'http://127.0.0.1:8787';
const NAME = '_probe_p25_widget';
const P = path.join(OUTPUT, NAME);
const PY = path.join(ROOT, '.py312', 'python.exe');
const PW = 'D:/OpenFilm/npm/node_modules/openfilm/node_modules/playwright-core';
const EXE = 'D:/OpenFilm/Browsers/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe';
let pass = 0, failN = 0, skipN = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✓ ' + n); } else { failN++; console.log('  ✗ FAIL ' + n + (e ? ' — ' + e : '')); } };
const skip = (n, why) => { skipN++; console.log('  ‑ SKIP ' + n + ' — ' + why); };

(async () => {
  console.log('== 带货组件冒烟（C1+C2）==');
  probeDir(NAME);

  console.log('\n[A] UI 挂载');
  const html = await (await fetch(BASE + '/comic')).text();
  ok('A1 /comic 200', (await fetch(BASE + '/comic')).status === 200);
  ok('A2 五个添加按钮齐全', ['addViewer', 'addNamebar', 'addProduct', 'addDanmaku', 'addBar'].every(id => html.includes(`id="${id}"`)));
  ok('A3 删除按钮 + widgets 容器', html.includes('id="delWidget"') && html.includes('id="widgets"'));
  ok('A4 带货预设模板按钮 + applyPreset 已挂载', html.includes('id="presetLiveRoom"') && /function\s+applyPreset/.test(html) && html.includes("'live-room'"));
  ok('A5 一键清空按钮 + clearAllContent 已挂载', html.includes('id="clearAll"') && /function\s+clearAllContent/.test(html));
  ok('A6 素材库灯箱选择器已挂载', html.includes('id="libPicker"') && /function\s+openLibPicker/.test(html) && html.includes('data-pick='));

  if (!fs.existsSync(PW) || !fs.existsSync(EXE)) {
    skip('B/C/D 浏览器与端到端', '未找到 playwright-core 或 headless chromium');
  } else {
    const pw = require(PW);
    const b = await pw.chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
    const pg = await (await b.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    const perr = []; pg.on('pageerror', (ex) => perr.push(String(ex.message)));
    await pg.goto(BASE + '/comic', { waitUntil: 'networkidle', timeout: 30000 });

    console.log('\n[A0] 白板起步默认（加载即无组件/无气泡/无旁白）');
    const blank = await pg.evaluate(() => ({ w: window.__S.widgets.length, b: window.__S.bubs.length, narOn: window.__S.nar.on, narText: window.__S.nar.text }));
    ok('A0a 加载时无带货组件', blank.w === 0, JSON.stringify(blank));
    ok('A0b 加载时无对话气泡', blank.b === 0, JSON.stringify(blank));
    ok('A0c 加载时旁白关闭且文案为空', blank.narOn === false && blank.narText === '', JSON.stringify(blank));

    console.log('\n[B] 添加 / 字段 / 拖动真的改几何');
    await pg.evaluate(() => { ['addViewer', 'addNamebar', 'addProduct', 'addDanmaku', 'addBar'].forEach(id => document.getElementById(id).click()); });
    await pg.waitForTimeout(250);
    ok('B0 页面无 JS 报错', perr.length === 0, perr.slice(0, 2).join(' | '));
    ok('B1 添加后 5 个组件', await pg.evaluate(() => window.__S.widgets.length) === 5);
    const types = await pg.evaluate(() => window.__S.widgets.map(w => w.type));
    ok('B2 类型五样齐全', ['viewer', 'namebar', 'product', 'danmaku', 'actionbar'].every(t => types.includes(t)), JSON.stringify(types));
    const geom = await pg.evaluate(() => window.__S.widgets.map(w => ({ t: w.type, box: w._box && { w: Math.round(w._box.w), h: Math.round(w._box.h) }, prims: w._prims && w._prims.length })));
    ok('B3 每个组件都有 _box 且 _prims≥2', geom.every(g => g.box && g.box.w > 0 && g.prims >= 2), JSON.stringify(geom));
    const dm = geom.find(g => g.t === 'danmaku');
    ok('B4 弹幕条按行拆多条 pill（prims≥6=3行×2）', dm && dm.prims >= 6, dm && 'prims=' + dm.prims);
    const ab = geom.find(g => g.t === 'actionbar');
    ok('B5 底部操作栏含 CTA+3图标（prims≥8）', ab && ab.prims >= 8, ab && 'prims=' + ab.prims);
    // 改商品卡价格 → 文字图元真的变
    const priceChanged = await pg.evaluate(() => {
      const w = window.__S.widgets.find(x => x.type === 'product');
      w.price = '¥999'; w.title = '测试标题超长超长超长超长超长'; window.render();
      return JSON.stringify(window.__S.widgets.find(x => x.type === 'product')._prims.filter(p => p.op === 'text').map(p => p.lines)).includes('¥999');
    });
    ok('B6 改价格字段真的写进文字图元', priceChanged);
    // 改弹幕 lines → pill 数真的变
    const dmChanged = await pg.evaluate(() => {
      const w = window.__S.widgets.find(x => x.type === 'danmaku');
      const before = w._prims.filter(p => p.op === 'rect').length;
      w.lines = '只有一条'; window.render();
      const after = window.__S.widgets.find(x => x.type === 'danmaku')._prims.filter(p => p.op === 'rect').length;
      return { before, after };
    });
    ok('B7 改弹幕行数真的改变 pill 数', dmChanged.after < dmChanged.before, JSON.stringify(dmChanged));
    // 拖动观看数胶囊 → 锚点真的变
    const dragRes = await pg.evaluate(() => {
      const w = window.__S.widgets.find(x => x.type === 'viewer');
      const before = { x: w.x, y: w.y };
      const cv = document.getElementById('view'); const r = cv.getBoundingClientRect();
      const cx = r.left + (w._box.x + w._box.w / 2) / 1024 * r.width;
      const cy = r.top + (w._box.y + w._box.h / 2) / 1536 * r.height;
      const mk = (t, x, y) => new PointerEvent(t, { clientX: x, clientY: y, bubbles: true, pointerId: 1 });
      cv.dispatchEvent(mk('pointerdown', cx, cy)); cv.dispatchEvent(mk('pointermove', cx + 80, cy + 60)); cv.dispatchEvent(mk('pointerup', cx + 80, cy + 60));
      return { moved: Math.abs(w.x - before.x) > 0.01 || Math.abs(w.y - before.y) > 0.01, sel: window.__S.selKind };
    });
    ok('B8 拖动组件真的改变锚点几何', dragRes.moved);
    ok('B9 点选组件 selKind=widget', dragRes.sel === 'widget', dragRes.sel);

    console.log('\n[C] 三导出含全部组件');
    const spec = await pg.evaluate(() => window.__buildPptxSpec());
    const wlayers = spec.layers.filter(L => L.kind === 'widget');
    ok('C1 pptx 规格含 5 个 widget 层', wlayers.length === 5, 'widget 层=' + wlayers.length);
    ok('C2 widget 层带 prims 且无 img 残留', wlayers.every(L => Array.isArray(L.prims) && L.prims.length >= 2 && L.prims.every(p => !('img' in p))), JSON.stringify(wlayers.map(L => L.prims.length)));
    const svg = await pg.evaluate(() => window.__buildSvg());
    ok('C3 SVG 含 widget-1..5 组', [1, 2, 3, 4, 5].every(k => svg.includes(`id="widget-${k}"`)));
    ok('C4 SVG widget 组含 rect 与 text', /<g id="widget-\d+">[\s\S]*?<rect/.test(svg) && /<g id="widget-\d+">[\s\S]*?<text/.test(svg));
    const man = await pg.evaluate(() => window.__buildManifest());
    ok('C5 manifest 含 widget 层', man.layers.filter(L => L.kind === 'widget').length === 5);
    const pspec = await pg.evaluate(() => window.__buildPanelSpec());
    ok('C6 panel-spec 含 5 widgets 且无 _prims/_box/img', pspec.widgets.length === 5 && pspec.widgets.every(w => !('_prims' in w) && !('_box' in w) && (!w.avatar || !('img' in w.avatar)) && (!w.sku || !('img' in w.sku))));

    console.log('\n[D] 端到端 pptx 重开含组件文字');
    const r = await fetch(BASE + '/api/comic/pptx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spec, base: '' }) });
    const buf = Buffer.from(await r.arrayBuffer());
    ok('D1 端点 200 + PK', r.status === 200 && buf.slice(0, 2).toString('latin1') === 'PK', 'HTTP ' + r.status);
    const outPptx = path.join(P, 'widget.pptx');
    fs.writeFileSync(outPptx, buf);
    const pyScript = `
import sys, json
from pptx import Presentation
prs=Presentation(sys.argv[1]); sl=prs.slides[0]
texts=[]
for s in sl.shapes:
    if s.has_text_frame: texts.append(s.text_frame.text.replace(chr(10),'/'))
print(json.dumps({'shapes':len(sl.shapes),'texts':texts}))
`;
    const info = JSON.parse(execFileSync(PY, ['-c', pyScript, outPptx], { encoding: 'utf8' }).trim().split('\n').pop());
    ok('D2 pptx 含商品卡价格 ¥999', info.texts.some(t => t.includes('¥999')));
    ok('D3 pptx 含底部栏 CTA 立即购买', info.texts.some(t => t.includes('立即购买')), JSON.stringify(info.texts.slice(0, 12)));
    ok('D4 pptx 含图标标签 点赞/评论/分享', ['点赞', '评论', '分享'].every(k => info.texts.some(t => t.includes(k))));
    ok('D5 pptx 含弹幕文字', info.texts.some(t => t.includes('只有一条') || t.includes('颜色')));
    ok('D6 形状数充足（5 组件图元多）', info.shapes >= 20, 'shapes=' + info.shapes);

    console.log('\n[F] 带货预设模板（一键铺标准直播间版式）');
    // 先制造杂散组件（在 D 遗留状态上再加两个观看数），验证预设会清空并只留标准 5 件
    await pg.evaluate(() => { document.getElementById('addViewer').click(); document.getElementById('addViewer').click(); });
    const strayN = await pg.evaluate(() => window.__S.widgets.length);
    ok('F0 铺预设前确有杂散（>5）', strayN > 5, 'widgets=' + strayN);
    await pg.evaluate(() => { document.getElementById('presetLiveRoom').click(); });
    await pg.waitForTimeout(200);
    const preset = await pg.evaluate(() => ({ n: window.__S.widgets.length, types: window.__S.widgets.map(w => w.type) }));
    ok('F1 点预设幂等替换为正好 5 件（清掉杂散）', preset.n === 5, JSON.stringify(preset));
    ok('F2 标准直播间五样各 1', ['namebar', 'viewer', 'danmaku', 'product', 'actionbar'].every(t => preset.types.filter(x => x === t).length === 1), JSON.stringify(preset.types));
    const bounds = await pg.evaluate(() => { const W = 1024, H = 1536; return window.__S.widgets.map(w => ({ t: w.type, ok: !!w._box && w._box.x >= -1 && w._box.y >= -1 && (w._box.x + w._box.w) <= W + 1 && (w._box.y + w._box.h) <= H + 1 })); });
    ok('F3 五件默认位均在画布内不溢出', bounds.every(b => b.ok), JSON.stringify(bounds));
    const anchors = await pg.evaluate(() => window.__S.widgets.map(w => w.type + '@' + w.x.toFixed(2) + ',' + w.y.toFixed(2)).join(' | '));
    await pg.evaluate(() => { document.getElementById('presetLiveRoom').click(); });
    await pg.waitForTimeout(150);
    const again = await pg.evaluate(() => window.__S.widgets.map(w => w.type + '@' + w.x.toFixed(2) + ',' + w.y.toFixed(2)).join(' | '));
    ok('F4 重复点预设幂等（同序同位）', again === anchors, '首次=' + anchors + ' 再点=' + again);
    ok('F5 预设不产生 JS 报错', perr.length === 0, perr.slice(0, 2).join(' | '));

    console.log('\n[G] 一键清空（组件+气泡+旁白框，保留底图/分支卡）');
    await pg.evaluate(() => {
      document.getElementById('presetLiveRoom').click();
      document.getElementById('addBub').click(); document.getElementById('addBub').click();
      const S = window.__S; S.nar.on = true; S.nar.text = '旁白应被清空'; S.ch.on = true; S.ch.prompt = '分支应保留'; window.render();
    });
    const before = await pg.evaluate(() => ({ w: window.__S.widgets.length, b: window.__S.bubs.length, narOn: window.__S.nar.on, nar: window.__S.nar.text }));
    ok('G0 清空前确有组件+气泡+旁白', before.w >= 5 && before.b >= 2 && before.narOn && before.nar.trim() !== '', JSON.stringify(before));
    await pg.evaluate(() => window.clearAllContent());
    await pg.waitForTimeout(150);
    const after = await pg.evaluate(() => ({
      w: window.__S.widgets.length, b: window.__S.bubs.length, selKind: window.__S.selKind, selW: window.__S.selWidget, selB: window.__S.sel,
      narOn: window.__S.nar.on, nar: window.__S.nar.text, domNarOn: document.getElementById('narOn').checked, domNarText: document.getElementById('narText').value,
      ch: window.__S.ch.prompt,
    }));
    ok('G1 清空后组件=0 且气泡=0', after.w === 0 && after.b === 0, JSON.stringify(after));
    ok('G2 清空后选中态归零', after.selKind === 'none' && after.selW === -1 && after.selB === -1, JSON.stringify(after));
    ok('G3 旁白框被清空（状态+DOM 控件同步）', after.narOn === false && after.nar === '' && after.domNarOn === false && after.domNarText === '', JSON.stringify(after));
    ok('G4 分支卡保留（清空不波及）', after.ch === '分支应保留', after.ch);
    // 走按钮 + 确认框全链路
    await pg.evaluate(() => {
      document.getElementById('addProduct').click(); document.getElementById('addBub').click();
      const S = window.__S; S.nar.on = true; S.nar.text = '再写点旁白'; window.render();
    });
    pg.on('dialog', d => d.accept());
    await pg.evaluate(() => { document.getElementById('clearAll').click(); });
    await pg.waitForTimeout(150);
    const viaBtn = await pg.evaluate(() => ({ w: window.__S.widgets.length, b: window.__S.bubs.length, narOn: window.__S.nar.on, nar: window.__S.nar.text }));
    ok('G5 点按钮+确认=组件/气泡/旁白全清', viaBtn.w === 0 && viaBtn.b === 0 && viaBtn.narOn === false && viaBtn.nar === '', JSON.stringify(viaBtn));
    ok('G6 清空全程无 JS 报错', perr.length === 0, perr.slice(0, 2).join(' | '));

    console.log('\n[H] 左侧栏 4 大类折叠 + 顶栏按钮化 + contain 默认');
    const struct = await pg.evaluate(() => ({
      grps: [...document.querySelectorAll('aside details.grp > summary')].map(s => s.textContent.trim()),
      subs: [...document.querySelectorAll('aside details.sub > summary')].map(s => s.textContent.trim()),
    }));
    ok('H1 4 大类分组齐全', ['底图与画面', '文字与气泡', '带货组件', '导出'].every(t => struct.grps.some(g => g.includes(t))), JSON.stringify(struct.grps));
    ok('H2 文字与气泡下 3 子块齐全', ['旁白框', '对话气泡', 'A/B/C 分支选项卡'].every(t => struct.subs.some(s => s.includes(t))), JSON.stringify(struct.subs));
    const idsAlive = await pg.evaluate(() => ['fit', 'offX', 'zoom', 'bg', 'narOn', 'narText', 'addBub', 'bubs', 'chOn', 'chPrompt', 'presetLiveRoom', 'clearAll', 'widgets', 'taskSel', 'png', 'pptx', 'outGrid'].every(id => !!document.getElementById(id)));
    ok('H3 重排后关键控件 id 全部保留', idsAlive);
    const dflt = await pg.evaluate(() => { const a = [...document.querySelectorAll('aside details')]; return { total: a.length, allClosed: a.every(d => !d.open) }; });
    ok('H3b 进入页面默认全部收起', dflt.total >= 7 && dflt.allClosed, JSON.stringify(dflt));
    await pg.evaluate(() => { document.getElementById('toggleAll').click(); });
    await pg.waitForTimeout(120);
    const opened = await pg.evaluate(() => { const a = [...document.querySelectorAll('aside details')]; return { allOpen: a.every(d => d.open), label: document.getElementById('toggleAll').textContent.trim() }; });
    ok('H4 点展开全部→所有 details 打开', opened.allOpen && opened.label.includes('收起'), JSON.stringify(opened));
    await pg.evaluate(() => { document.getElementById('toggleAll').click(); });
    await pg.waitForTimeout(120);
    const closed2 = await pg.evaluate(() => { const a = [...document.querySelectorAll('aside details')]; return { allClosed: a.every(d => !d.open), label: document.getElementById('toggleAll').textContent.trim() }; });
    ok('H5 再点收起全部→所有 details 关闭', closed2.allClosed && closed2.label.includes('展开'), JSON.stringify(closed2));
    await pg.evaluate(() => { document.getElementById('collapseAside').click(); });
    await pg.waitForTimeout(120);
    const asideHidden = await pg.evaluate(() => ({ cls: document.querySelector('main').classList.contains('aside-collapsed'), disp: getComputedStyle(document.querySelector('aside')).display, label: document.getElementById('collapseAside').textContent.trim() }));
    ok('H5b 点收起侧栏→aside 隐藏、主区单列', asideHidden.cls && asideHidden.disp === 'none' && asideHidden.label.includes('展开'), JSON.stringify(asideHidden));
    await pg.evaluate(() => { document.getElementById('collapseAside').click(); });
    await pg.waitForTimeout(120);
    const asideShown = await pg.evaluate(() => ({ cls: document.querySelector('main').classList.contains('aside-collapsed'), disp: getComputedStyle(document.querySelector('aside')).display }));
    ok('H5c 再点展开侧栏→aside 恢复显示', !asideShown.cls && asideShown.disp !== 'none', JSON.stringify(asideShown));
    const fitDefault = await pg.evaluate(() => ({ state: window.__S.view.fit, sel: document.getElementById('fit').value }));
    ok('H6 底图默认铺法=contain（状态+下拉一致）', fitDefault.state === 'contain' && fitDefault.sel === 'contain', JSON.stringify(fitDefault));
    const navbtn = await pg.evaluate(() => { const a = [...document.querySelectorAll('header nav a.navbtn')]; return a.length === 4 && a.every(x => { const cs = getComputedStyle(x); return parseFloat(cs.borderTopWidth) > 0 && cs.cursor === 'pointer'; }); });
    ok('H7 顶栏 4 导航链接按钮化（有边框+可点光标）', navbtn);
    ok('H8 布局改造无 JS 报错', perr.length === 0, perr.slice(0, 2).join(' | '));

    console.log('\n[I] 素材库灯箱选择器（SKU/头像）');
    await pg.evaluate(() => { document.getElementById('addNamebar').click(); document.getElementById('addProduct').click(); });
    await pg.waitForTimeout(150);
    const pickBtns = await pg.evaluate(() => ({
      avatar: !!document.querySelector('#widgets [data-pick="avatar"]'),
      sku: !!document.querySelector('#widgets [data-pick="sku"]'),
      modal: !!document.getElementById('libPicker'),
    }));
    ok('I1 namebar 头像字段有素材库按钮', pickBtns.avatar);
    ok('I2 product SKU 字段有素材库按钮', pickBtns.sku);
    ok('I3 灯箱 modal 已挂载', pickBtns.modal);
    await pg.evaluate(() => { document.querySelector('#widgets [data-pick="avatar"]').click(); });
    await pg.waitForTimeout(500);
    const pickerOpen = await pg.evaluate(() => ({ disp: getComputedStyle(document.getElementById('libPicker')).display, cells: document.querySelectorAll('#libPickerGrid .libcell').length }));
    ok('I4 点素材库→灯箱打开', pickerOpen.disp !== 'none', JSON.stringify(pickerOpen));
    if (pickerOpen.cells > 0) {
      ok('I5 灯箱网格渲染出库图缩略图', pickerOpen.cells > 0, 'cells=' + pickerOpen.cells);
      await pg.evaluate(() => { document.querySelector('#libPickerGrid .libcell img').click(); });
      await pg.waitForTimeout(600);
      const assigned = await pg.evaluate(() => {
        const w = window.__S.widgets.find(x => x.type === 'namebar');
        return { disp: getComputedStyle(document.getElementById('libPicker')).display, hasAvatar: !!(w && w.avatar && w.avatar.src), isDataUrl: !!(w && w.avatar && /^data:image\//.test(w.avatar.src)), thumb: !!document.querySelector('#widgets [data-clearimg="avatar"]') };
      });
      ok('I6 选图后 modal 关闭', assigned.disp === 'none', assigned.disp);
      ok('I7 头像写入且为 dataURL（四出口一致前提）', assigned.hasAvatar && assigned.isDataUrl, JSON.stringify(assigned));
      ok('I8 字段出现预览/清除按钮', assigned.thumb);
      await pg.evaluate(() => { document.querySelector('#widgets [data-clearimg="avatar"]').click(); });
      await pg.waitForTimeout(200);
      const cleared = await pg.evaluate(() => { const w = window.__S.widgets.find(x => x.type === 'namebar'); return { av: w.avatar, thumb: !!document.querySelector('#widgets [data-clearimg="avatar"]') }; });
      ok('I9 点清除→头像置空、预览消失', !cleared.av && !cleared.thumb, JSON.stringify(cleared));
    } else {
      skip('I6-I9 选图端到端', '素材库 images 目录为空（无库图可选，仅验到灯箱打开）');
    }
    ok('I10 灯箱选择器无 JS 报错', perr.length === 0, perr.slice(0, 2).join(' | '));

    await b.close();
  }

  console.log('\n[E] 清场');
  sweepProbes();
  ok('E1 探针目录已清除', !fs.existsSync(P));

  console.log(`\n== 带货组件冒烟结果：${pass} 通过 / ${failN} 失败 / ${skipN} 跳过 ==`);
  process.exit(failN ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
