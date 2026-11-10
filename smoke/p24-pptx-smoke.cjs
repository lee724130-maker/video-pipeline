// smoke/p24-pptx-smoke.cjs —— P24 漫画格 → 原生可编辑 pptx 冒烟
// 断言四段：A 路由/按钮 · B buildPptxSpec 规格结构（描边必须是 hex 非 rgba）· C 端到端 POST→python-pptx 重开 · D 负例 · E 清场
// 计费：零（纯本地：headless chromium 取规格 + 服务端 spawnSync .py312 python 拼 pptx，不调任何生图服务）
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { ROOT, OUTPUT, probeDir, sweepProbes } = require('./lib.cjs');
const BASE = 'http://127.0.0.1:8787';
const NAME = '_probe_p24_pptx';
const P = path.join(OUTPUT, NAME);
const PY = path.join(ROOT, '.py312', 'python.exe');
const PW = 'D:/OpenFilm/npm/node_modules/openfilm/node_modules/playwright-core';
const EXE = 'D:/OpenFilm/Browsers/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe';
let pass = 0, failN = 0, skipN = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✓ ' + n); } else { failN++; console.log('  ✗ FAIL ' + n + (e ? ' — ' + e : '')); } };
const skip = (n, why) => { skipN++; console.log('  ‑ SKIP ' + n + ' — ' + why); };

function makePngDataUrl() {
  const fp = path.join(P, '_base.png');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x3a7bd5:s=64x64', '-frames:v', '1', fp]);
  return 'data:image/png;base64,' + fs.readFileSync(fp).toString('base64');
}

(async () => {
  console.log('== P24 漫画格→pptx 冒烟 ==');
  probeDir(NAME);
  const BASE64PNG = makePngDataUrl();

  console.log('\n[A] 路由与按钮');
  const page = await fetch(BASE + '/comic');
  const html = await page.text();
  ok('A1 /comic 返回 200', page.status === 200, 'HTTP ' + page.status);
  ok('A2 导出区挂了 pptx 按钮', /id="pptx"/.test(html));
  ok('A3 服务端有 /api/comic/pptx 路由', fs.readFileSync(path.join(ROOT, 'web', 'server.cjs'), 'utf8').includes("'/api/comic/pptx'"));
  ok('A4 make_pptx.py 工具存在', fs.existsSync(path.join(ROOT, 'pipeline', 'tools', 'make_pptx.py')));

  console.log('\n[B] buildPptxSpec 规格结构（headless chromium）');
  let spec = null;
  if (!fs.existsSync(PW) || !fs.existsSync(EXE)) {
    skip('B/C 浏览器规格+端到端', '未找到本机 playwright-core 或 headless chromium');
  } else {
    const pw = require(PW);
    const b = await pw.chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
    const pg = await (await b.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    const perr = []; pg.on('pageerror', (ex) => perr.push(String(ex.message)));
    await pg.goto(BASE + '/comic', { waitUntil: 'networkidle', timeout: 30000 });
    spec = await pg.evaluate(() => {
      const S = window.__S;
      S.nar.on = true; S.nar.text = '今日推荐 · 宽松落肩毛衣\n¥129 限时'; S.nar.align = 'center'; S.nar.theme = 'light';
      S.bubs.length = 0;
      S.bubs.push({ id: 1, text: '这件毛衣版型宽松落肩\n配同色阔腿裤', x: 0.4, y: 0.35, w: 0.42, tx: 0.5, ty: 0.5, shape: 'ellipse', f: 32, a: 0.94, theme: 'light', align: 'center', fg: '#15181c', tight: 0.35 });
      S.bubs.push({ id: 2, text: '已拍，期待上身效果', x: 0.55, y: 0.72, w: 0.34, tx: 0.5, ty: 0.6, shape: 'rect', f: 30, a: 0.95, theme: 'dark', align: 'left', fg: '#f2f4f7', tight: 0.35 });
      window.__render();
      return window.__buildPptxSpec();
    });
    await b.close();
    ok('B0 页面无 JS 报错', perr.length === 0, perr.slice(0, 2).join(' | '));
    ok('B1 canvas 为 1024×1536', spec.canvas && spec.canvas.w === 1024 && spec.canvas.h === 1536, JSON.stringify(spec.canvas));
    ok('B2 三层（旁白+2气泡）', spec.layers.length === 3, 'layers=' + spec.layers.length);
    const badBox = spec.layers.some(L => !L.box || [L.box.x, L.box.y, L.box.w, L.box.h].some(v => !Number.isFinite(v) || v <= 0 && ['w', 'h'].includes('')));
    ok('B3 每层 box 坐标有限且 w/h>0', spec.layers.every(L => L.box && Number.isFinite(L.box.x) && Number.isFinite(L.box.y) && L.box.w > 0 && L.box.h > 0));
    ok('B4 描边是 hex 不是 rgba（关键：pptx 也走 SVG 同款清洗）', spec.layers.every(L => !L.stroke || !/rgba/i.test(L.stroke)), JSON.stringify(spec.layers.map(L => L.stroke)));
    ok('B5 strokeOpacity 为 0~1 数值', spec.layers.every(L => L.strokeOpacity === undefined || (L.strokeOpacity >= 0 && L.strokeOpacity <= 1)));
    const byKind = {}; spec.layers.forEach(L => { byKind[L.kind + (L.shape || '')] = L; });
    ok('B6 旁白=roundrect 且居中', byKind.narrationroundrect && byKind.narrationroundrect.align === 'center' && byKind.narrationroundrect.lines.length === 2);
    ok('B7 椭圆气泡=ellipse 居中、字号 32', byKind.bubbleellipse && byKind.bubbleellipse.align === 'center' && byKind.bubbleellipse.fontSizePx === 32);
    ok('B8 方角气泡=rect 左对齐、字号 30', byKind.bubblerect && byKind.bubblerect.align === 'left' && byKind.bubblerect.fontSizePx === 30);
    ok('B9 深色气泡字色取自 fg', byKind.bubblerect && byKind.bubblerect.fontColor === '#f2f4f7', byKind.bubblerect && byKind.bubblerect.fontColor);
  }

  console.log('\n[C] 端到端 POST → python-pptx 重开');
  if (spec) {
    const r = await fetch(BASE + '/api/comic/pptx', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spec, base: BASE64PNG }),
    });
    const buf = Buffer.from(await r.arrayBuffer());
    const ct = r.headers.get('content-type') || '';
    ok('C1 端点返回 200', r.status === 200, 'HTTP ' + r.status);
    ok('C2 Content-Type 是 pptx', /presentationml/.test(ct), ct);
    ok('C3 返回是合法 zip（PK 魔数）', buf.slice(0, 2).toString('latin1') === 'PK', buf.slice(0, 4).toString('hex'));
    ok('C4 体积合理（>3KB）', buf.length > 3000, 'bytes=' + buf.length);
    const outPptx = path.join(P, 'e2e.pptx');
    fs.writeFileSync(outPptx, buf);
    // python-pptx 重开清点
    const pyScript = `
import sys, json
from pptx import Presentation
prs=Presentation(sys.argv[1]); sl=prs.slides[0]
info={'shapes':len(sl.shapes),'hasPicture':any(str(s.shape_type).startswith('PICTURE') for s in sl.shapes),
      'slide':[round(prs.slide_width/9525),round(prs.slide_height/9525)],
      'aligns':[],'texts':[]}
for s in sl.shapes:
    if s.has_text_frame and s.text_frame.paragraphs:
        a=s.text_frame.paragraphs[0].alignment
        info['aligns'].append(str(a).split(' ')[0] if a is not None else 'None')
        info['texts'].append(s.text_frame.text.replace(chr(10),'/'))
print(json.dumps(info))
`;
    const pyOut = execFileSync(PY, ['-c', pyScript, outPptx], { encoding: 'utf8' });
    const info = JSON.parse(pyOut.trim().split('\n').pop());
    ok('C5 幻灯片 1024×1536', info.slide[0] === 1024 && info.slide[1] === 1536, JSON.stringify(info.slide));
    ok('C6 形状数=底图1+层数', info.shapes === 1 + spec.layers.length, 'shapes=' + info.shapes + ' layers=' + spec.layers.length);
    ok('C7 底图作为 picture 存在', info.hasPicture === true);
    ok('C8 三处对齐落位（CENTER/CENTER/LEFT）', JSON.stringify(info.aligns) === JSON.stringify(['CENTER', 'CENTER', 'LEFT']), JSON.stringify(info.aligns));
    ok('C9 文字内容原样可编辑', info.texts.some(t => t.includes('¥129')) && info.texts.some(t => t.includes('已拍')), JSON.stringify(info.texts));
  } else {
    skip('C1-C9 端到端', '无浏览器规格（B 段跳过）');
  }

  console.log('\n[D] 负例（宁拦不猜）');
  const postJson = async (obj) => { const r = await fetch(BASE + '/api/comic/pptx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) }); return { status: r.status, j: await r.json().catch(() => ({})) }; };
  const d1 = await postJson({ spec: { layers: [] } });
  ok('D1 缺 canvas → 400 bad spec', d1.status === 400 && /bad spec/.test(d1.j.error || ''), `${d1.status} ${d1.j.error}`);
  const d2 = await postJson({ spec: { canvas: { w: 99999, h: 10 }, layers: [] } });
  ok('D2 canvas 超范围 → 400 bad canvas', d2.status === 400 && /bad canvas/.test(d2.j.error || ''), `${d2.status} ${d2.j.error}`);
  const d3 = await postJson({ spec: { canvas: { w: 1024, h: 1536 }, layers: Array.from({ length: 61 }, () => ({ kind: 'bubble', shape: 'rect', box: { x: 0, y: 0, w: 10, h: 10 }, lines: ['x'] })) } });
  ok('D3 层数>60 → 400', d3.status === 400 && /层数/.test(d3.j.error || ''), `${d3.status} ${d3.j.error}`);
  const d4 = await postJson({ spec: 'not-an-object' });
  ok('D4 spec 非对象 → 400', d4.status === 400, String(d4.status));

  console.log('\n[E] 清场');
  const leftover = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('comic-pptx-'));
  ok('E1 服务端临时目录已清理（无 comic-pptx-* 残留）', leftover.length === 0, leftover.join(','));
  sweepProbes();
  ok('E2 探针目录已清除', !fs.existsSync(P));
  ok('E3 未在 output 外留 pptx', !fs.existsSync(path.join(OUTPUT, 'comic.pptx')));

  console.log(`\n== P24 冒烟结果：${pass} 通过 / ${failN} 失败 / ${skipN} 跳过 ==`);
  process.exit(failN ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
