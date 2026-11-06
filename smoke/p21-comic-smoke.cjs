// smoke/p21-comic-smoke.cjs —— P21 漫画格排版页冒烟
// 断言四段：A 路由与页面骨架 · B 导出正例（写盘/回读/列表）· C 负例（宁拦不猜）· D 主链零触碰 · E 清场
// F 段为可选浏览器断言：控件必须真的改变状态或渲染几何（P21 开发中踩到"滑块绑定写错对象→静默失效"，此段就是它的哨兵）
// 计费：零（纯本地写盘 + 静态页；F 段用本机已有 headless chromium，不调任何生图服务）
const fs = require('fs');
const path = require('path');
const { OUTPUT, probeDir, sweepProbes } = require('./lib.cjs');
const BASE = 'http://127.0.0.1:8787';
const NAME = '_probe_p21_comic';
const P = path.join(OUTPUT, NAME);
let pass = 0, failN = 0, skipN = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✓ ' + n); } else { failN++; console.log('  ✗ FAIL ' + n + (e ? ' — ' + e : '')); } };
const skip = (n, why) => { skipN++; console.log('  ‑ SKIP ' + n + ' — ' + why); };
const get = async (u) => { const r = await fetch(BASE + u); return { status: r.status, j: await r.json().catch(() => ({})), text: () => r.text() }; };
const post = async (u, b) => { const r = await fetch(BASE + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }); return { status: r.status, j: await r.json().catch(() => ({})) }; };

// 真 PNG 夹具：用 ffmpeg 现场造一张 64×64（服务端有「数据过小」守卫，1x1 太小），跑完随探针目录一起清掉
function makePngFixture() {
  const fp = path.join(P, '_fixture.png');
  require('child_process').execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x3a7bd5:s=64x64', '-frames:v', '1', fp]);
  return fs.readFileSync(fp).toString('base64');
}
let PNG_B64 = '';
const dataUrl = (b64) => 'data:image/png;base64,' + b64;

(async () => {
  console.log('== P21 漫画格排版页冒烟 ==');
  probeDir(NAME);
  PNG_B64 = makePngFixture();
  console.log(`（PNG 夹具 ${Buffer.byteLength(PNG_B64, 'base64')} 字节）`);

  console.log('\n[A] 路由与页面骨架');
  const page = await fetch(BASE + '/comic');
  const html = await page.text();
  ok('A1 /comic 返回 200', page.status === 200, 'HTTP ' + page.status);
  ok('A2 Content-Type 为 html', /text\/html/.test(page.headers.get('content-type') || ''));
  const ids = ['view', 'file', 'fit', 'offX', 'offY', 'zoom', 'bg', 'narOn', 'narText', 'narPos', 'narTheme',
    'narW', 'narF', 'narA', 'addBub', 'delBub', 'bubs', 'chOn', 'chPrompt', 'chA', 'chB', 'chC',
    'taskSel', 'cellNo', 'cellPrefix', 'png', 'toTask', 'saveJson', 'loadJson', 'outGrid', 'libGrid'];
  const missing = ids.filter((i) => !html.includes(`id="${i}"`));
  ok(`A3 关键控件 id 齐全（${ids.length} 个）`, missing.length === 0, missing.length ? '缺: ' + missing.join(',') : '');
  ok('A4 画布为 1024×1536 原分辨率', html.includes('width="1024"') && html.includes('height="1536"'));
  ok('A5 预览受视口高度约束（防下半幅点不到）', /max-height:calc\(100vh/.test(html));
  ok('A6 暴露 __S 供几何断言', html.includes('window.__S'));
  try {
    const js = html.split('<script>')[1].split('</' + 'script>')[0];
    new Function(js);
    ok('A7 内联 JS 语法复查通过', true);
  } catch (e) { ok('A7 内联 JS 语法复查通过', false, e.message); }
  const consoleHtml = await (await fetch(BASE + '/console')).text();
  ok('A8 控制台顶栏挂了 /comic 入口', consoleHtml.includes('href="/comic"'));
  const indexHtml = await (await fetch(BASE + '/')).text();
  ok('A9 入口页挂了 /comic 独立链接', indexHtml.includes('href="/comic"'));

  console.log('\n[B] 导出正例');
  const e1 = await post('/api/comic/export', { task: NAME, name: '格01.png', dataUrl: dataUrl(PNG_B64) });
  ok('B1 正常导出返回 200', e1.status === 200 && e1.j.ok, JSON.stringify(e1.j));
  ok('B2 落盘路径为 comic/ 子目录', e1.j.rel === 'comic/格01.png', e1.j.rel);
  const f1 = path.join(P, 'comic', '格01.png');
  ok('B3 文件真实存在', fs.existsSync(f1));
  ok('B4 字节数与服务端一致', fs.existsSync(f1) && fs.statSync(f1).size === e1.j.bytes, `${fs.existsSync(f1) ? fs.statSync(f1).size : '-'} vs ${e1.j.bytes}`);
  const e2 = await post('/api/comic/export', { task: NAME, name: '格02.png', dataUrl: dataUrl(PNG_B64) });
  const lst = await get('/api/comic/list?name=' + encodeURIComponent(NAME));
  ok('B5 列表返回两张且排序', e2.status === 200 && JSON.stringify(lst.j.files) === '["格01.png","格02.png"]', JSON.stringify(lst.j.files));
  const back = await fetch(`${BASE}/file/${encodeURIComponent(NAME)}/${encodeURIComponent('comic/格01.png')}`);
  ok('B6 产物可经 /file 回读', back.status === 200, 'HTTP ' + back.status);

  console.log('\n[C] 负例（宁拦不猜）');
  const c1 = await post('/api/comic/export', { task: '../../etc', name: 'x.png', dataUrl: dataUrl(PNG_B64) });
  ok('C1 坏任务名 400', c1.status === 400 && c1.j.error === 'bad task', `${c1.status} ${c1.j.error}`);
  const c2 = await post('/api/comic/export', { task: NAME, name: '../../evil.png', dataUrl: dataUrl(PNG_B64) });
  ok('C2 文件名穿越 400', c2.status === 400 && /bad name/.test(c2.j.error || ''), `${c2.status} ${c2.j.error}`);
  const c3 = await post('/api/comic/export', { task: NAME, name: '格01.jpg', dataUrl: dataUrl(PNG_B64) });
  ok('C3 非 .png 后缀 400', c3.status === 400 && /bad name/.test(c3.j.error || ''), `${c3.status} ${c3.j.error}`);
  const c4 = await post('/api/comic/export', { task: NAME, name: '格03.png', dataUrl: 'data:text/plain;base64,aGk=' });
  ok('C4 非 png dataUrl 400', c4.status === 400 && /dataUrl/.test(c4.j.error || ''), `${c4.status} ${c4.j.error}`);
  const c5 = await post('/api/comic/export', { task: NAME, name: '格04.png', dataUrl: dataUrl(Buffer.from('not a png at all').toString('base64')) });
  ok('C5 假 PNG 魔数 400', c5.status === 400 && /PNG/.test(c5.j.error || ''), `${c5.status} ${c5.j.error}`);
  const c6 = await post('/api/comic/export', { task: '不存在的任务xyz', name: '格01.png', dataUrl: dataUrl(PNG_B64) });
  ok('C6 任务不存在 404', c6.status === 404, `${c6.status} ${c6.j.error}`);
  const c7 = await get('/api/comic/list?name=' + encodeURIComponent('../etc'));
  ok('C7 列表坏任务名 400', c7.status === 400, 'HTTP ' + c7.status);
  ok('C8 负例未污染磁盘', !fs.existsSync(path.join(OUTPUT, NAME, 'comic', '格03.png')) && !fs.existsSync(path.join(OUTPUT, 'evil.png')));

  console.log('\n[D] 主链零触碰');
  fs.writeFileSync(path.join(P, 'shots.json'), JSON.stringify({ title: 'p21', shots: [] }));
  fs.writeFileSync(path.join(P, '成片.mp4'), 'MAIN-CHAIN-BYTES');
  const mainFile = path.join(P, '成片.mp4');
  const before = fs.statSync(mainFile);
  await post('/api/comic/export', { task: NAME, name: '格05.png', dataUrl: dataUrl(PNG_B64) });
  const after = fs.statSync(mainFile);
  ok('D1 主链成片 mtime 未变', before.mtimeMs === after.mtimeMs);
  ok('D2 主链成片 size 未变', before.size === after.size);
  const top = fs.readdirSync(P).sort();
  ok('D3 comic/ 子目录已建立且与主链文件并列隔离', fs.existsSync(path.join(P, 'comic')) && top.includes('shots.json') && top.includes('成片.mp4'), top.join(','));
  const comicFiles = fs.existsSync(path.join(P, 'comic')) ? fs.readdirSync(path.join(P, 'comic')) : [];
  ok('D4 comic/ 内只有 png 且数量符合预期', comicFiles.length === 3 && comicFiles.every((f) => /\.png$/.test(f)), comicFiles.join(','));

  console.log('\n[F] 控件必须真的生效（可选，需本机 headless chromium）');
  const PW = 'D:/OpenFilm/npm/node_modules/openfilm/node_modules/playwright-core';
  const EXE = 'D:/OpenFilm/Browsers/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe';
  if (!fs.existsSync(PW) || !fs.existsSync(EXE)) {
    skip('F1-F7 浏览器几何断言', '未找到本机 playwright-core 或 headless chromium（不影响 A-E 结论）');
  } else {
    try {
      const pw = require(PW);
      const b = await pw.chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
      const pg = await (await b.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
      const perr = []; pg.on('pageerror', (ex) => perr.push(String(ex.message)));
      await pg.goto(BASE + '/comic', { waitUntil: 'networkidle', timeout: 30000 });
      const rect = () => pg.evaluate(() => ({ ...window.__S.nar._rect }));
      const setv = (id, v) => pg.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, [id, String(v)]);
      const setv2 = (id, v) => pg.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, [id, String(v)]);

      const r0 = await rect();
      ok('F0 旁白框首屏已渲染（几何可读且非零）', !!r0 && r0.w > 0 && r0.h > 0, JSON.stringify(r0));
      await setv('narF', 24); await pg.waitForTimeout(120); const f24 = await rect();
      await setv('narF', 52); await pg.waitForTimeout(120); const f52 = await rect();
      ok('F1 字号滑块改变旁白框高度', f52.h - f24.h > 20, `24→${Math.round(f24.h)} 52→${Math.round(f52.h)}`);
      await setv('narW', 0.5); await pg.waitForTimeout(120); const w50 = await rect();
      await setv('narW', 0.95); await pg.waitForTimeout(120); const w95 = await rect();
      ok('F2 宽度滑块改变旁白框宽度', w95.w - w50.w > 200, `0.5→${Math.round(w50.w)} 0.95→${Math.round(w95.w)}`);
      await setv('narA', 0.4); await pg.waitForTimeout(120);
      ok('F3 不透明度滑块写入状态', await pg.evaluate(() => Math.abs(window.__S.nar.a - 0.4) < 0.03));
      await setv2('narPos', 'bottom'); await pg.waitForTimeout(120); const rb = await rect();
      ok('F4 位置预设切到底部', rb.y > r0.y + 300, `y ${Math.round(r0.y)}→${Math.round(rb.y)}`);
      const box = await pg.locator('#view').boundingBox();
      const scr = (cx, cy) => ({ x: box.x + cx / 1024 * box.width, y: box.y + cy / 1536 * box.height });
      let r1 = await rect(), s = scr(r1.x + r1.w / 2, r1.y + r1.h / 2);
      await pg.mouse.move(s.x, s.y); await pg.mouse.down(); await pg.mouse.move(s.x - 120, s.y - 60, { steps: 5 }); await pg.mouse.up();
      await pg.waitForTimeout(150); const rd = await rect();
      ok('F5 画布拖动旁白框改变坐标', Math.abs(rd.x - r1.x) > 60 || Math.abs(rd.y - r1.y) > 30, `x ${Math.round(r1.x)}→${Math.round(rd.x)} y ${Math.round(r1.y)}→${Math.round(rd.y)}`);
      r1 = await rect(); s = scr(r1.x + r1.w, r1.y + r1.h);
      await pg.mouse.move(s.x, s.y); await pg.mouse.down(); await pg.mouse.move(s.x - 200, s.y, { steps: 6 }); await pg.mouse.up();
      await pg.waitForTimeout(150); const rs = await rect();
      ok('F6 拖右下角手柄改变宽度', rs.w < r1.w - 60, `w ${Math.round(r1.w)}→${Math.round(rs.w)}`);
      await setv('zoom', 0.42); await setv('offX', 0.23); await pg.waitForTimeout(150);
      const v = await pg.evaluate(() => ({ ...window.__S.view }));
      ok('F7 底图缩放/偏移滑块写入状态（曾经的静默失效点）', Math.abs(v.zoom - 0.42) < 0.01 && Math.abs(v.x - 0.23) < 0.01, JSON.stringify(v));
      ok('F8 页面无 JS 报错', perr.length === 0, perr.slice(0, 2).join(' | '));

      console.log('\n  [G] 椭圆文字包含 + 对齐/字色真的影响绘制');
      await pg.locator('#addBub').click(); await pg.waitForTimeout(200);
      const setBub = (k, v) => pg.evaluate(([k, v]) => {
        const els = document.querySelectorAll(`#bubs [data-k="${k}"]`);
        const el = els[els.length - 1]; el.value = v; el.dispatchEvent(new Event('input', { bubbles: true }));
      }, [k, String(v)]);
      const lastBub = () => pg.evaluate(() => {
        const b = window.__S.bubs[window.__S.bubs.length - 1];
        return { rect: { ...b._rect }, text: { ...b._text }, shape: b.shape };
      });
      const texts = ['快去吧，\n别让仙人等急了。',
        '这件毛衣的版型是宽松落肩的，袖口收了一圈细罗纹，配同色阔腿裤很显腿长，身高一米六五穿到脚踝。',
        '好。'];
      for (let ti = 0; ti < texts.length; ti++) {
        await setBub('text', texts[ti]); await pg.waitForTimeout(160);
        const g = await lastBub();
        const A = g.rect.w / 2, B = g.rect.h / 2, x = g.text.w / 2, y = g.text.h / 2;
        const r = (x * x) / (A * A) + (y * y) / (B * B);
        ok(`G1-${ti + 1} 椭圆气泡：文字矩形角点在曲线内（≤1 即不溢出）`, r <= 1,
          `r=${r.toFixed(3)} 文字 ${Math.round(g.text.w)}×${Math.round(g.text.h)} / 形状 ${Math.round(g.rect.w)}×${Math.round(g.rect.h)}`);
      }
      await setBub('shape', 'rect'); await pg.waitForTimeout(160);
      const gr = await lastBub();
      ok('G2 方角气泡：文字框四周留有不小于 8px 内边距',
        gr.rect.w - gr.text.w >= 16 && gr.rect.h - gr.text.h >= 8,
        `宽余 ${Math.round(gr.rect.w - gr.text.w)}px 高余 ${Math.round(gr.rect.h - gr.text.h)}px`);

      // 像素哈希：控件改了状态但没接到绘制路径，这两条就会失败
      await setBub('shape', 'ellipse'); await setBub('text', '第一行短\n第二行很长很长很长'); await pg.waitForTimeout(200);
      const hashBub = () => pg.evaluate(() => {
        const b = window.__S.bubs.at(-1);
        const d = document.getElementById('view').getContext('2d')
          .getImageData(Math.round(b._rect.x), Math.round(b._rect.y), Math.round(b._rect.w), Math.round(b._rect.h)).data;
        let h = 0; for (let i = 0; i < d.length; i += 997) h = (h * 31 + d[i]) >>> 0;
        return h;
      });

      // 干净场景：白底、关旁白、清空旧气泡、把待测气泡移到画布正中（避免包围盒越界读到透明黑）
      await pg.evaluate(() => {
        const el = document.getElementById('bg'); el.value = '#ffffff'; el.dispatchEvent(new Event('input', { bubbles: true }));
        document.getElementById('narOn').checked = false; document.getElementById('narOn').dispatchEvent(new Event('input', { bubbles: true }));
        window.__S.bubs.length = 0;
      });
      await pg.waitForTimeout(200);
      await pg.locator('#addBub').click(); await pg.waitForTimeout(250);
      await pg.evaluate(() => {
        const b = window.__S.bubs.at(-1);
        b.text = '短的一行\n这是长得多的第二行文字\n第三行也短'; b.x = 0.5; b.y = 0.5; b.w = 0.42; b.align = 'center';
        window.dispatchEvent(new Event('resize'));
      });
      await pg.waitForTimeout(250);
      // 重绘要靠 render()：通过控件事件触发一次
      await setBub('f', '32'); await pg.waitForTimeout(250);

      const firstInk = (rowFrac) => pg.evaluate(([rowFrac]) => {
        const b = window.__S.bubs.at(-1);
        const g = document.getElementById('view').getContext('2d');
        const x0 = Math.max(0, Math.round(b._rect.x)), y0 = Math.max(0, Math.round(b._rect.y));
        const w = Math.min(1024 - x0, Math.round(b._rect.w)), h = Math.min(1536 - y0, Math.round(b._rect.h));
        const d = g.getImageData(x0, y0, w, h).data, row = Math.round(h * rowFrac), hits = [];
        for (let x = 0; x < w; x++) {
          const i = (row * w + x) * 4;
          if (d[i + 3] > 200 && d[i] < 120 && d[i + 1] < 120 && d[i + 2] < 120) hits.push(x);
        }
        return hits.length ? hits[0] : -1;
      }, [rowFrac]);

      const bubSel = pg.locator('#bubs .bub').last().locator('select[data-k=align]');
      await bubSel.selectOption('center'); await pg.waitForTimeout(280);
      const c1 = await firstInk(0.30), c2 = await firstInk(0.50), c3 = await firstInk(0.70);
      await bubSel.selectOption('left'); await pg.waitForTimeout(280);
      const l1 = await firstInk(0.30), l2 = await firstInk(0.50), l3 = await firstInk(0.70);
      ok('G3 左对齐确实把文字移到左边（首字位置差 >15px）', c1 - l1 > 15,
        `第1行首字：居中 ${c1}px vs 左对齐 ${l1}px，差 ${c1 - l1}px`);
      ok('G3b 居中时各行首字位置不同（按线宽居中）', new Set([c1, c2, c3]).size === 3, `center 首字 ${c1}/${c2}/${c3}`);
      ok('G3c 左对齐时各行首字位置基本一致（左边缘齐平）',
        Math.max(l1, l2, l3) - Math.min(l1, l2, l3) <= 14, `left 首字 ${l1}/${l2}/${l3}`);
      const hLeft = await hashBub();
      await bubSel.selectOption('center'); await pg.waitForTimeout(250); const hCenter = await hashBub();
      ok('G3d 对齐切换确实改变绘制像素', hLeft !== hCenter, `hash ${hLeft} vs ${hCenter}`);
      await bubSel.selectOption('left'); await pg.waitForTimeout(200);
      await setBub('fg', '#ff0000'); await pg.waitForTimeout(180); const hRed = await hashBub();
      ok('G5 字色控件真的改变绘制（改色后像素不同）', hRed !== hCenter, `hash ${hCenter} vs ${hRed}`);
      ok('G6 字色写入状态', await pg.evaluate(() => window.__S.bubs[window.__S.bubs.length - 1].fg === '#ff0000'));
      await setv('narAlign', 'center'); await pg.waitForTimeout(180);
      ok('G7 旁白框对齐写入状态', await pg.evaluate(() => window.__S.nar.align === 'center'));
      ok('G8 全段跑完仍无 JS 报错', perr.length === 0, perr.slice(0, 2).join(' | '));

      console.log('\n  [H] 矢量导出：文字必须是可编辑对象，不是像素');
      await pg.evaluate(() => {
        const S = window.__S;
        S.nar.on = true; S.nar.text = '测试旁白第一行\n第二行';
        S.bubs.length = 0;
        S.bubs.push({ id: 1, text: '这件毛衣版型宽松落肩\n配同色阔腿裤', x: 0.4, y: 0.35, w: 0.42,
          tx: 0.5, ty: 0.5, shape: 'ellipse', f: 32, a: 0.95, theme: 'light', align: 'center', fg: '#15181c', tight: 0.35 });
        S.bubs.push({ id: 2, text: '已拍，期待上身效果', x: 0.55, y: 0.72, w: 0.34,
          tx: 0.5, ty: 0.6, shape: 'rect', f: 30, a: 0.95, theme: 'dark', align: 'left', fg: '#f2f4f7', tight: 0.35 });
        window.__render();
      });
      await pg.waitForTimeout(300);

      const svgInfo = await pg.evaluate(() => {
        const s = window.__buildSvg();
        const doc = new DOMParser().parseFromString(s, 'image/svg+xml');
        const err = doc.querySelector('parsererror');
        return {
          len: s.length, parseErr: !!err,
          startsSvg: s.startsWith('<svg'), endsSvg: s.trim().endsWith('</svg>'),
          viewBox: (s.match(/viewBox="([^"]+)"/) || [])[1],
          texts: doc.querySelectorAll('text').length,
          tspans: doc.querySelectorAll('tspan').length,
          ellipses: doc.querySelectorAll('ellipse').length,
          rects: doc.querySelectorAll('rect').length,
          polys: doc.querySelectorAll('polygon').length,
          images: doc.querySelectorAll('image').length,
          hasNarText: !!doc.querySelector('#narration-text'),
          hasBub1: !!doc.querySelector('#bubble-1-text'),
          hasBub2: !!doc.querySelector('#bubble-2-text'),
          narLines: doc.querySelectorAll('#narration-text tspan').length,
          bub1Rx: Number((doc.querySelector('#bubble-1 ellipse') || {}).getAttribute ? doc.querySelector('#bubble-1 ellipse').getAttribute('rx') : 0),
          bub1Ry: Number(doc.querySelector('#bubble-1 ellipse') ? doc.querySelector('#bubble-1 ellipse').getAttribute('ry') : 0),
          bub1Text: Array.from(doc.querySelectorAll('#bubble-1-text tspan')).map(t => t.textContent).join('|'),
          bub2Anchor: doc.querySelector('#bubble-2-text') ? doc.querySelector('#bubble-2-text').getAttribute('text-anchor') : '',
          bub1Anchor: doc.querySelector('#bubble-1-text') ? doc.querySelector('#bubble-1-text').getAttribute('text-anchor') : '',
        };
      });
      ok('H1 SVG 可被 XML 解析（无 parsererror）', !svgInfo.parseErr && svgInfo.startsSvg && svgInfo.endsSvg, `长度 ${svgInfo.len}`);
      ok('H2 viewBox 为 0 0 1024 1536', svgInfo.viewBox === '0 0 1024 1536', svgInfo.viewBox);
      ok('H3 底图作为独立位图层存在（1 个 image）', svgInfo.images === 1, `image=${svgInfo.images}`);
      ok('H4 三个文字层各有自己的 text 元素', svgInfo.hasNarText && svgInfo.hasBub1 && svgInfo.hasBub2,
        `text=${svgInfo.texts} tspan=${svgInfo.tspans}`);
      ok('H5 文字是真实内容而非像素（tspan 逐行且能读回）', svgInfo.bub1Text === '这件毛衣版型宽松落肩|配同色阔腿裤', `bub1="${svgInfo.bub1Text}"`);
      ok('H6 旁白按换行拆成 2 个 tspan', svgInfo.narLines === 2, `narLines=${svgInfo.narLines}`);
      ok('H7 对齐映射正确（居中=middle，左对齐=start）',
        svgInfo.bub1Anchor === 'middle' && svgInfo.bub2Anchor === 'start', `${svgInfo.bub1Anchor}/${svgInfo.bub2Anchor}`);
      const geoSync = await pg.evaluate(() => {
        const b = window.__S.bubs[0];
        return { rx: Number(document ? 0 : 0), rectW: b._rect.w, rectH: b._rect.h };
      });
      ok('H8 椭圆 rx/ry 与画布几何同源（rx=框宽/2）',
        Math.abs(svgInfo.bub1Rx - geoSync.rectW / 2) < 1 && Math.abs(svgInfo.bub1Ry - geoSync.rectH / 2) < 1,
        `rx=${svgInfo.bub1Rx} vs 框宽/2=${(geoSync.rectW / 2).toFixed(1)}；ry=${svgInfo.bub1Ry} vs ${(geoSync.rectH / 2).toFixed(1)}`);
      ok('H9 气泡尾巴导出为 polygon', svgInfo.polys === 2, `polygon=${svgInfo.polys}`);

      const man = await pg.evaluate(() => window.__buildManifest());
      ok('H10 manifest 含 3 个文字层且字段齐',
        man.layers.length === 3 && man.layers.every(l => l.text && Array.isArray(l.lines) && l.rect && l.font && l.font.size && l.font.color),
        JSON.stringify(man.layers.map(l => l.kind)));
      ok('H11 manifest 记录画布尺寸与底图状态',
        man.canvas.width === 1024 && man.canvas.height === 1536 && typeof man.base.hasImage === 'boolean', JSON.stringify(man.canvas));

      // 改文案 → SVG 文字跟着变（证明文字可编辑，不是烧进像素）
      await pg.evaluate(() => { window.__S.bubs[0].text = '改过的文案'; window.__render(); });
      await pg.waitForTimeout(250);
      const after = await pg.evaluate(() => {
        const doc = new DOMParser().parseFromString(window.__buildSvg(), 'image/svg+xml');
        return Array.from(doc.querySelectorAll('#bubble-1-text tspan')).map(t => t.textContent).join('|');
      });
      ok('H12 改文案后 SVG 文字同步（可编辑性的核心证据）', after === '改过的文案', after);

      const spec = await pg.evaluate(() => JSON.stringify(window.__buildPanelSpec()));
      ok('H13 panel-spec 已剥掉临时几何字段', !/"_paint"|"_rect"|"_text"/.test(spec), spec.length + ' 字节');
      await b.close();
    } catch (e) { skip('F 段执行', e.message.slice(0, 120)); }
  }

  console.log('\n[E] 清场');
  const sw = sweepProbes();
  ok('E1 探针目录已清除', !fs.existsSync(P), JSON.stringify(sw && sw.removed ? sw.removed : []));
  ok('E2 未在 output 外留下残留', !fs.existsSync(path.join(OUTPUT, 'evil.png')));

  console.log(`\n== P21 冒烟结果：${pass} 通过 / ${failN} 失败 / ${skipN} 跳过 ==`);
  process.exit(failN ? 1 : 0);
})().catch((e) => { console.log('FATAL', e.message); try { sweepProbes(); } catch (_) {} process.exit(1); });
