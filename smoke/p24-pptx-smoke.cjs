// smoke/p24-pptx-smoke.cjs —— P24 漫画格 → 原生可编辑 pptx 冒烟
// 断言段：A 路由/按钮 · B buildPptxSpec 规格（含尾巴 tail + 分支卡 choice，描边/遮罩必须 hex 非 rgba）
//        · C 端到端 POST→python-pptx 重开（尾巴=FREEFORM、分支卡选项可编辑）· C2 写入任务目录正例
//        · D 负例（spec/canvas/层数/task/name）· E 清场
// 计费：零（headless chromium 取规格 + 服务端 spawnSync .py312 python 拼 pptx，不调任何生图服务）
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
function reopen(pptxPath) {
  const pyScript = `
import sys, json
from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE
prs=Presentation(sys.argv[1]); sl=prs.slides[0]
info={'shapes':len(sl.shapes),'hasPicture':any(str(s.shape_type).startswith('PICTURE') for s in sl.shapes),
      'freeforms':sum(1 for s in sl.shapes if s.shape_type==MSO_SHAPE_TYPE.FREEFORM),
      'slide':[round(prs.slide_width/9525),round(prs.slide_height/9525)],'aligns':[],'texts':[]}
for s in sl.shapes:
    if s.has_text_frame and s.text_frame.paragraphs:
        a=s.text_frame.paragraphs[0].alignment
        info['aligns'].append(str(a).split(' ')[0] if a is not None else 'None')
        info['texts'].append(s.text_frame.text.replace(chr(10),'/'))
print(json.dumps(info))
`;
  return JSON.parse(execFileSync(PY, ['-c', pyScript, pptxPath], { encoding: 'utf8' }).trim().split('\n').pop());
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
  ok('A3 导出区挂了 pptxTask 按钮', /id="pptxTask"/.test(html));
  ok('A4 服务端有 /api/comic/pptx 路由', fs.readFileSync(path.join(ROOT, 'web', 'server.cjs'), 'utf8').includes("'/api/comic/pptx'"));
  ok('A5 make_pptx.py 工具存在', fs.existsSync(path.join(ROOT, 'pipeline', 'tools', 'make_pptx.py')));

  console.log('\n[B] buildPptxSpec 规格结构（含尾巴 + 分支卡）');
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
      S.ch.on = true; S.ch.prompt = '你想看哪一套？'; S.ch.a = '通勤极简'; S.ch.b = '休闲慵懒'; S.ch.c = '约会氛围';
      window.__render();
      return window.__buildPptxSpec();
    });
    await b.close();
    ok('B0 页面无 JS 报错', perr.length === 0, perr.slice(0, 2).join(' | '));
    ok('B1 canvas 为 1024×1536', spec.canvas && spec.canvas.w === 1024 && spec.canvas.h === 1536, JSON.stringify(spec.canvas));
    const kinds = spec.layers.map(L => L.kind);
    ok('B2 层含 choice + narration + 2 bubble', kinds.filter(k => k === 'bubble').length === 2 && kinds.includes('narration') && kinds.includes('choice'), JSON.stringify(kinds));
    ok('B3 choice 排在最前（遮罩压底图）', kinds[0] === 'choice', JSON.stringify(kinds));
    ok('B4 全层描边/遮罩无 rgba', spec.layers.every(L => {
      const chk = (c) => !c || !/rgba/i.test(String(c));
      if (L.kind === 'choice') return chk(L.overlay && L.overlay.fill) && (L.options || []).every(o => chk(o.stroke) && chk(o.fill));
      return chk(L.stroke) && chk(L.fill);
    }));
    const bub = spec.layers.filter(L => L.kind === 'bubble');
    ok('B5 椭圆气泡带 tail（≥3 顶点 [x,y]）', bub.some(L => Array.isArray(L.tail) && L.tail.length >= 3 && L.tail.every(q => Array.isArray(q) && q.length === 2 && Number.isFinite(q[0]) && Number.isFinite(q[1]))), JSON.stringify(bub.map(L => L.tail && L.tail.length)));
    const choice = spec.layers.find(L => L.kind === 'choice');
    ok('B6 choice 有引导语 + 3 选项', choice && choice.prompt && choice.prompt.lines.length >= 1 && choice.options.length === 3, choice && JSON.stringify(choice.options.map(o => o.label)));
    ok('B7 选项带金色标签 A:/B:/C:', choice && ['A:', 'B:', 'C:'].every(k => choice.options.some(o => o.label === k)));
    ok('B8 选项正文可编辑（含"通勤极简"）', choice && choice.options.some(o => (o.lines || []).join('').includes('通勤极简')));
  }

  console.log('\n[C] 端到端 POST（下载模式）→ python-pptx 重开');
  if (spec) {
    const r = await fetch(BASE + '/api/comic/pptx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spec, base: BASE64PNG }) });
    const buf = Buffer.from(await r.arrayBuffer());
    const ct = r.headers.get('content-type') || '';
    ok('C1 端点返回 200', r.status === 200, 'HTTP ' + r.status);
    ok('C2 Content-Type 是 pptx', /presentationml/.test(ct), ct);
    ok('C3 返回是合法 zip（PK 魔数）', buf.slice(0, 2).toString('latin1') === 'PK', buf.slice(0, 4).toString('hex'));
    const outPptx = path.join(P, 'e2e.pptx');
    fs.writeFileSync(outPptx, buf);
    const info = reopen(outPptx);
    ok('C4 幻灯片 1024×1536', info.slide[0] === 1024 && info.slide[1] === 1536, JSON.stringify(info.slide));
    ok('C5 底图 picture 存在', info.hasPicture === true);
    ok('C6 尾巴渲染为 FREEFORM（≥1 个）', info.freeforms >= 1, 'freeforms=' + info.freeforms);
    ok('C7 分支卡选项文字可编辑（含 A: 通勤极简）', info.texts.some(t => /A:.*通勤极简/.test(t)), JSON.stringify(info.texts.filter(t => /A:|B:|C:/.test(t))));
    ok('C8 形状数 ≥ 底图+层数（尾巴/选项会多出形状）', info.shapes >= 1 + spec.layers.length, 'shapes=' + info.shapes + ' layers=' + spec.layers.length);

    console.log('\n[C2] 写入任务目录（task+name 模式）');
    const rt = await fetch(BASE + '/api/comic/pptx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spec, base: BASE64PNG, task: NAME, name: '格01.pptx' }) });
    const jt = await rt.json();
    ok('C2-1 返回 JSON ok', rt.status === 200 && jt.ok === true && jt.rel === 'comic/格01.pptx', JSON.stringify(jt));
    const wrote = path.join(OUTPUT, NAME, 'comic', '格01.pptx');
    ok('C2-2 文件落 comic/ 子目录', fs.existsSync(wrote));
    ok('C2-3 落盘字节是合法 pptx', fs.existsSync(wrote) && fs.readFileSync(wrote).slice(0, 2).toString('latin1') === 'PK');
  } else {
    skip('C1-C8 / C2', '无浏览器规格（B 段跳过）');
  }

  console.log('\n[D] 负例（宁拦不猜）');
  const postJson = async (obj) => { const r = await fetch(BASE + '/api/comic/pptx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) }); return { status: r.status, j: await r.json().catch(() => ({})) }; };
  const d1 = await postJson({ spec: { layers: [] } });
  ok('D1 缺 canvas → 400 bad spec', d1.status === 400 && /bad spec/.test(d1.j.error || ''), `${d1.status} ${d1.j.error}`);
  const d2 = await postJson({ spec: { canvas: { w: 99999, h: 10 }, layers: [] } });
  ok('D2 canvas 超范围 → 400 bad canvas', d2.status === 400 && /bad canvas/.test(d2.j.error || ''), `${d2.status} ${d2.j.error}`);
  const d3 = await postJson({ spec: { canvas: { w: 1024, h: 1536 }, layers: Array.from({ length: 61 }, () => ({ kind: 'bubble', shape: 'rect', box: { x: 0, y: 0, w: 10, h: 10 }, lines: ['x'] })) } });
  ok('D3 层数>60 → 400', d3.status === 400 && /层数/.test(d3.j.error || ''), `${d3.status} ${d3.j.error}`);
  const d4 = await postJson({ spec: { canvas: { w: 1024, h: 1536 }, layers: [{ kind: 'bubble', shape: 'rect', box: { x: 0, y: 0, w: 10, h: 10 }, lines: ['x'] }] }, task: 'bad/../task', name: '格01.pptx' });
  ok('D4 坏 task → 400 bad task', d4.status === 400 && /bad task/.test(d4.j.error || ''), `${d4.status} ${d4.j.error}`);
  const d5 = await postJson({ spec: { canvas: { w: 1024, h: 1536 }, layers: [{ kind: 'bubble', shape: 'rect', box: { x: 0, y: 0, w: 10, h: 10 }, lines: ['x'] }] }, task: 'no_such_task_zzz', name: '格01.pptx' });
  ok('D5 task 不存在 → 404', d5.status === 404, `${d5.status} ${d5.j.error}`);
  const d6 = await postJson({ spec: { canvas: { w: 1024, h: 1536 }, layers: [{ kind: 'bubble', shape: 'rect', box: { x: 0, y: 0, w: 10, h: 10 }, lines: ['x'] }] }, task: NAME, name: '格01.png' });
  ok('D6 name 非 .pptx → 400 bad name', d6.status === 400 && /bad name/.test(d6.j.error || ''), `${d6.status} ${d6.j.error}`);
  ok('D7 负例未污染磁盘', !fs.existsSync(path.join(OUTPUT, NAME, 'comic', '格01.png')) && !fs.existsSync(path.join(OUTPUT, 'no_such_task_zzz')));

  console.log('\n[E] 清场');
  const leftover = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('comic-pptx-'));
  ok('E1 服务端临时目录已清理（无 comic-pptx-* 残留）', leftover.length === 0, leftover.join(','));
  sweepProbes();
  ok('E2 探针目录已清除', !fs.existsSync(P));
  ok('E3 未在 output 外留 pptx', !fs.existsSync(path.join(OUTPUT, 'comic.pptx')));

  console.log(`\n== P24 冒烟结果：${pass} 通过 / ${failN} 失败 / ${skipN} 跳过 ==`);
  process.exit(failN ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
