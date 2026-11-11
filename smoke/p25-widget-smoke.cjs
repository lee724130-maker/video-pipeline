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

  if (!fs.existsSync(PW) || !fs.existsSync(EXE)) {
    skip('B/C/D 浏览器与端到端', '未找到 playwright-core 或 headless chromium');
  } else {
    const pw = require(PW);
    const b = await pw.chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
    const pg = await (await b.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    const perr = []; pg.on('pageerror', (ex) => perr.push(String(ex.message)));
    await pg.goto(BASE + '/comic', { waitUntil: 'networkidle', timeout: 30000 });

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
    await b.close();
  }

  console.log('\n[E] 清场');
  sweepProbes();
  ok('E1 探针目录已清除', !fs.existsSync(P));

  console.log(`\n== 带货组件冒烟结果：${pass} 通过 / ${failN} 失败 / ${skipN} 跳过 ==`);
  process.exit(failN ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
