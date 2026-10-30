// smoke/p16-console-layout-smoke.cjs —— P16 控制台重排冒烟（纯布局 + /lib 只读路由，零管线零计费）
// A /lib 路由安全（正例/穿越/伪kind/隐藏/不存在）· B 双栏骨架与标签页 · C id 全集对账（行为不变的硬核验）· D 灯箱网格与筛选 · E 其余页面回归位（交给 p9-static/p14）
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./lib.cjs');
const BASE = 'http://127.0.0.1:8787';
let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ FAIL ' + n + (e ? ' — ' + e : '')); } };
async function code(u) { const r = await fetch(BASE + u); return r.status; }

(async () => {
  console.log('A /lib 只读路由安全');
  {
    const lib = path.join(ROOT, 'library');
    const pick = ['images', 'bgm', 'clips'].flatMap((k) => { try { return fs.readdirSync(path.join(lib, k)).filter((f) => !f.startsWith('.')).map((f) => ({ k, f })); } catch { return []; } });
    ok('素材库有样本可测', pick.length > 0, pick.length + ' 个');
    if (pick.length) {
      const s = pick[0];
      const r = await fetch(BASE + '/lib/' + s.k + '/' + encodeURIComponent(s.f));
      const len = Number(r.headers.get('content-length') || 0);
      ok('正例 200 + 字节数对得上', r.status === 200 && len > 0, String(r.status) + '/' + len);
      const rg = await fetch(BASE + '/lib/' + s.k + '/' + encodeURIComponent(s.f), { method: 'GET', headers: { Range: 'bytes=0-63' } });
      ok('Range 请求 206（视频/音频拖动依赖）', rg.status === 206, String(rg.status));
    }
    ok('穿越 .. 400', (await code('/lib/images/..%2F..%2Fpipeline%2Fconfig.local.json')) === 400);
    ok('伪 kind 404', (await code('/lib/evil/x.png')) === 404);
    ok('隐藏文件 400', (await code('/lib/images/.env')) === 400);
    ok('不存在 404', (await code('/lib/images/nope-not-here.png')) === 404);
  }

  console.log('B 双栏骨架与标签页');
  {
    const html = fs.readFileSync(path.join(ROOT, 'web/public/console.html'), 'utf8');
    ok('左栏 + 顶栏 + 五标签', html.includes('class="sidebar"') && html.includes('class="topbar"') && (html.match(/class="tabbtn/g) || []).length === 5);
    ok('五个标签页壳（新建/任务台/素材库/技术库/声音）', ['new', 'work', 'lib', 'tech', 'voice'].every((t) => html.includes('data-pane="' + t + '"')));
    ok('showTab 联动 + 当前任务卡', html.includes('function showTab(') && html.includes('id="curName"') && html.includes('id="taskList"'));
    for (const p of ['/console', '/']) ok('路由 ' + p + ' 200', (await code(p)) === 200);
  }

  console.log('C id 全集对账（旧控制台的功能挂载点一个不能少）');
  {
    const html = fs.readFileSync(path.join(ROOT, 'web/public/console.html'), 'utf8');
    const oldIds = 'text voice name cloneBox cloneFile cloneGo cloneMsg cloneList size coverStyle rate rateVal sceneStyle captions hooks imgs thumbs bgmBox bgm bgmLib go err steps log result hist libTask libMsg aiOff aiBox aiPrompt aiSize aiGo aiMsg aiAttach aiPreview lib tech'.split(' ');
    const present = new Set([...html.matchAll(/id="([\w-]+)"/g)].map((m) => m[1]));
    const miss = oldIds.filter((x) => !present.has(x));
    ok('旧 34 个功能 id 全在位', miss.length === 0, miss.join(','));
  }

  console.log('D 灯箱网格与筛选');
  {
    const html = fs.readFileSync(path.join(ROOT, 'web/public/console.html'), 'utf8');
    ok('缩略图走 /lib + 点击开灯箱', html.includes("const libUrl = (kind, name) => '/lib/'") && html.includes('function openLb('));
    ok('筛选 chips + 搜索框 + libRender 纯前端重绘', html.includes('id="libFilters"') && html.includes('id="libQ"') && html.includes('function libRender(') && html.includes('function libFilter('));
    ok('灯箱 Esc/遮罩关闭', html.includes("e.key === 'Escape'") && html.includes('if(event.target===this)closeLb()'));
    ok('refreshLib 仍同步建任务 BGM 下拉（bgmLib 数据源不断）', html.includes("$('bgmLib')"));
  }

  console.log('E 视觉协调（素材库/技术库共用一套设计件）');
  {
    const html = fs.readFileSync(path.join(ROOT, 'web/public/console.html'), 'utf8');
    ok('统一按钮家族 .mini（含 accent/danger 变体）', html.includes('.mini {') && html.includes('.mini.accent') && html.includes('.mini.danger'));
    ok('统一卡片基类 .itemcard（两网格共用）', html.includes('.itemcard {') && html.includes('titem itemcard') && html.includes('gitem itemcard'));
    ok('徽章语义色 ok/warn/danger 齐备', ['.badge.ok', '.badge.warn', '.badge.danger'].every((c) => html.includes(c)) && html.includes('badge danger') && html.includes('badge warn'));
    // 渲染函数里不应再有裸 <button onclick（全部挂类）
    ok('素材库/技术库渲染零裸按钮', !/^\s*(const card|return).*<button onclick/m.test(html.split('async function refreshTech')[1].split('async function refreshLib')[0] || '') && !/<button onclick="libAdd/.test(html));
    ok('克隆删除钮 danger 语义', html.includes('mini danger" onclick="cloneDel'));
    ok('gname 名称与徽章 flex 排布', html.includes('.gname { font-size:12px; word-break:break-all; line-height:1.5; display:flex'));
  }

  console.log('\nP16 冒烟结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('冒烟异常:', e); process.exitCode = 1; });
