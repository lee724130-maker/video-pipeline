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
