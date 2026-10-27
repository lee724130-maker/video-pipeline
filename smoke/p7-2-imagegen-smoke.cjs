// P7-2 AI 生图冒烟：
//  A 静态：内联 JS 语法 + 页面/服务端结构断言
//  B 无 key 负例：8799 实例用 PIPELINE_CONFIG_OVERRIDES 抹掉所有 key → meta.enabled=false + 400 未启用
//  C 主实例(8787)不花钱负例：空 prompt / 非法尺寸 / 超长 prompt / 附加入不存在任务（花钱前拦截）
//  D 真实生图 1 张（计费，qwen-image-2.1-turbo）→ 存库 + 附加入 deck-demo bg-NN → 断言后还原 deck-demo assets；生成图留在素材库给用户过目
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = require('./lib.cjs').ROOT;
const MAIN = 'http://127.0.0.1:8787';
const SUB = 'http://127.0.0.1:8799';
let fails = 0;
const ok = (n, c, x) => { if (c) console.log('  PASS ' + n); else { fails++; console.log('  FAIL ' + n + (x ? ' :: ' + x : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  try { const r = await fetch(url); return { s: r.status, d: await r.json().catch(() => ({})) }; }
  catch (e) { return { s: 0, d: { error: e.message } }; }
}
async function post(url, body) {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { s: r.status, d: await r.json().catch(() => ({})) };
  } catch (e) { return { s: 0, d: { error: e.message } }; }
}

(async () => {
  console.log('== A 静态 ==');
  const html = fs.readFileSync(path.join(ROOT, 'web/public/index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const tmp = path.join(process.env.TEMP, 'p72-inline.js');
  fs.writeFileSync(tmp, scripts.join('\n;\n'), 'utf8');
  const r = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
  ok('内联 JS 语法', r.status === 0, (r.stderr || '').split('\n').slice(0, 3).join(' | '));
  ['aiBox', 'aiOff', 'aiPrompt', 'aiSize', 'aiGo', 'aiAttach', 'aiMsg', 'aiPreview'].forEach((id) => ok(`页面 #${id}`, html.includes(`id="${id}"`)));
  ok('init 调 initAI', /initAI\(\);/.test(html));
  ok('genImage 函数', /async function genImage\(\)/.test(html));
  ok('fetch /api/txt2img', html.includes("'/api/txt2img'"));
  ok('h2 提示 AI 生图', html.includes('AI 生图（有 key 才启用'));
  const srv = fs.readFileSync(path.join(ROOT, 'web/server.cjs'), 'utf8');
  ok('server 路由 /api/txt2img', srv.includes("p === '/api/txt2img'"));
  ok('server imagegenState', srv.includes('function imagegenState()'));
  ok('server meta 带 imagegen', /imagegen: \{ enabled: igSt\.enabled/.test(srv));
  ok('server 尺寸上游契约 checkImgSize', srv.includes('function checkImgSize('));
  ok('花钱前先校验任务', srv.includes('生成成功后才发现任务不对'));
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'pipeline/config.json'), 'utf8'));
  ok('config.json 有 imagegen 段', cfg.imagegen && cfg.imagegen.key === '' && cfg.imagegen.model === 'qwen-image-2.1-turbo');
  ok('config.json key 仍为空', cfg.imagegen.key === '');

  console.log('== B 无 key 负例（8799）==');
  const busy = await get(SUB + '/api/meta');
  ok('8799 端口空闲', busy.s === 0, '已被占用（旧实例残留？）先杀掉');
  if (busy.s === 0) {
    const patch = path.join(process.env.TEMP, 'p72-override.json');
    fs.writeFileSync(patch, JSON.stringify({ voice: { dashscope: { key: '' } }, imagegen: { key: '' } }));
    const env = { ...process.env, PIPELINE_CONFIG_OVERRIDES: patch };
    delete env.DASHSCOPE_API_KEY;
    const sub = spawn(process.execPath, ['web/server.cjs', '--port', '8799'], { cwd: ROOT, env, stdio: 'ignore' });
    let up = null;
    for (let i = 0; i < 40; i++) { await sleep(250); up = await get(SUB + '/api/meta'); if (up.s === 200) break; }
    ok('8799 启动', up && up.s === 200, up && up.d.error);
    if (up && up.s === 200) {
      ok('imagegen.enabled=false', up.d.imagegen && up.d.imagegen.enabled === false, JSON.stringify(up.d.imagegen));
      ok('key 来源显示未配置', up.d.imagegen && up.d.imagegen.where === '未配置', up.d.imagegen && up.d.imagegen.where);
      const neg = await post(SUB + '/api/txt2img', { prompt: '随便一句' });
      ok('无 key 生图 400', neg.s === 400, 's=' + neg.s);
      ok('400 指明未启用与启用方法', /未启用/.test(neg.d.error || '') && /config\.local\.json/.test(neg.d.error || ''), neg.d.error);
      ok('无 key 响应不泄露 key 字段', !JSON.stringify(neg.d).includes('sk-'));
    }
    sub.kill();
    await sleep(500);
  }

  console.log('== C 主实例负例（不花钱）==');
  const mm = await get(MAIN + '/api/meta');
  ok('8787 已跑新代码（meta.imagegen）', mm.s === 200 && !!mm.d.imagegen, '老实例？先重启服务');
  const ig = (mm.d && mm.d.imagegen) || {};
  ok('有 key → enabled=true', ig.enabled === true, `where=${ig.where}`);
  ok('key 来源合法（local/环境变量）', ['voice.dashscope.key', 'imagegen.key', '环境变量 DASHSCOPE_API_KEY'].includes(ig.where), ig.where);
  ok('模型回传白名单', ['qwen-image-3.0-pro', 'qwen-image-3.0', 'qwen-image-2.1-pro', 'qwen-image-2.1-turbo'].includes(ig.model), ig.model);
  const e1 = await post(MAIN + '/api/txt2img', { prompt: '  ' });
  ok('空 prompt 400', e1.s === 400 && /prompt/.test(e1.d.error || ''), e1.s + ' ' + e1.d.error);
  const e2 = await post(MAIN + '/api/txt2img', { prompt: '正常一句', size: '100x100' });
  ok('面积超界 400', e2.s === 400 && /面积/.test(e2.d.error || ''), e2.s + ' ' + e2.d.error);
  const e3 = await post(MAIN + '/api/txt2img', { prompt: 'x'.repeat(2001) });
  ok('超长 prompt 400', e3.s === 400 && /过长/.test(e3.d.error || ''), e3.s + ' ' + e3.d.error);
  const e4 = await post(MAIN + '/api/txt2img', { prompt: '正常一句', size: '1024x1024', attachTask: 'no-such-task-xyz' });
  ok('附加入不存在任务 404（花钱前）', e4.s === 404 && /任务不存在/.test(e4.d.error || ''), e4.s + ' ' + e4.d.error);

  console.log('== D 真实生图 1 张（计费）→ deck-demo 附加后还原 ==');
  const adir = path.join(ROOT, 'output/deck-demo/assets');
  const before = fs.existsSync(adir) ? fs.readdirSync(adir).sort() : [];
  const gen = await post(MAIN + '/api/txt2img', {
    prompt: '极简奶油色纸面背景，中央一个圆角白底 UI 窗口样机，扁平插画风格，深红点缀，留白充足',
    size: '1024x1024',
    attachTask: 'deck-demo',
    attachMode: 'bg',
  });
  ok('生图 200', gen.s === 200, gen.s + ' ' + (gen.d.error || ''));
  if (gen.s === 200) {
    ok('落库路径 library/images/ai-*', /^library\/images\/ai-.*\.png$/.test(gen.d.saved || ''), gen.d.saved);
    const libFile = path.join(ROOT, gen.d.saved);
    ok('文件存在', fs.existsSync(libFile));
    if (fs.existsSync(libFile)) {
      const magic = fs.readFileSync(libFile).subarray(0, 4);
      ok('PNG 魔数', magic[0] === 0x89 && magic[1] === 0x50 && magic[2] === 0x4e && magic[3] === 0x47);
      ok('留样给用户（≥50KB）', fs.statSync(libFile).size > 50000, fs.statSync(libFile).size + 'B');
    }
    ok('dataUrl 预览可用', /^data:image\/png;base64,/.test(gen.d.dataUrl || ''));
    ok('耗时是数字', typeof gen.d.ms === 'number', String(gen.d.ms));
    const w = gen.d.attach && gen.d.attach.written;
    ok('附加为 bg-NN', !!gen.d.attach && gen.d.attach.ok === true && /^assets\/bg-\d+\.png$/.test(w || ''), JSON.stringify(gen.d.attach));
    if (w) {
      const wname = w.replace('assets/', '');
      ok('任务侧文件已复制', fs.existsSync(path.join(adir, wname)));
      const after = fs.readdirSync(adir).sort();
      ok('deck-demo 只多这一个文件', after.length === before.length + 1 && after.includes(wname), JSON.stringify(after));
      fs.unlinkSync(path.join(adir, wname));
      const restored = fs.readdirSync(adir).sort();
      ok('还原后与事前一致', JSON.stringify(restored) === JSON.stringify(before), JSON.stringify(restored));
    }
    console.log('  留样素材: ' + gen.d.saved + '（不要可在素材库或文件夹里删）');
  }

  console.log(fails ? `\n=== ${fails} 项 FAIL ===` : '\n=== P7-2 生图冒烟全 PASS ===');
  process.exit(fails ? 1 : 0);
})();
