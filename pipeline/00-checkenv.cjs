// 00 · 环境自检：工具链是否就绪（硬项不过流水线跑不了；软项只提示，有替代路径）
const fs = require('fs');
const path = require('path');
const { ROOT, FFMPEG, FFPROBE, run, log, warn, fail, loadConfig } = require('./lib/common.cjs');

const cfg = loadConfig();
let pass = 0, total = 0;

function check(name, ok, detail = '') {
  total++;
  if (ok) pass++;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  return ok;
}
function optional(name, ok, detail = '') {
  console.log(`  ${ok ? '✓' : '⚠'} ${name}${detail ? ' — ' + detail : ''}`);
}

function main() {
  console.log('[00] 环境自检');

  // ffmpeg / ffprobe（common 已按 config.ffmpeg → PATH → 常见路径探测）
  const fv = run(FFMPEG, ['-version']);
  check('ffmpeg', fv.ok, (fv.out.split('\n')[0] || '').slice(0, 48) || `未找到（装好后写进 config.json 的 ffmpeg 字段或加 PATH）`);
  const pv = run(FFPROBE, ['-version']);
  check('ffprobe', pv.ok);

  // 配音：主路径 DashScope（key 在 config.local.json 或环境变量 DASHSCOPE_API_KEY）
  const key = (cfg.voice?.dashscope?.key) || process.env.DASHSCOPE_API_KEY || '';
  check('DashScope key（配音主路径）', !!key, key ? `已配置（音色 ${cfg.voice?.dashscope?.voice || '默认'}）` : '缺：config.local.json 填 key 或设 DASHSCOPE_API_KEY');

  // 兜底 TTS（可选）：gTTS / edge-tts 跑在系统 Python 上
  const py = run('py', ['--version']);
  optional('系统 Python（gTTS/edge-tts 兜底用）', py.ok, py.out.trim() || '未安装');
  if (py.ok) {
    const gtts = run('py', ['-c', 'import gtts; print("ok")']);
    optional('gTTS（兜底配音）', gtts.ok, gtts.ok ? '已装' : '缺：py -m pip install gTTS');
    const edge = run('py', ['-c', 'import edge_tts; print("ok")']);
    optional('edge-tts（兜底，逐词时间戳）', edge.ok, edge.ok ? '已装' : '未装（可选）');
  }

  // SAPI 离线语音（断网/无额度的最后兜底）：Windows 自带 TTS，列得到中文语音才算可用
  const sapiList = run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'tools/tts_sapi.ps1'), '-List']);
  const sapiVoices = sapiList.ok ? sapiList.out.split('\n').map((l) => l.trim()).filter((l) => /\|/.test(l)) : [];
  const sapiZh = sapiVoices.find((l) => /^zh-/i.test(l.split('|')[1] || ''));
  optional('SAPI 离线语音（断网兜底）', !!sapiZh,
    sapiZh ? `可用（${sapiZh.split('|')[0]}）` : sapiVoices.length ? '无中文语音（Windows 设置→语言→语音添加），兜底会用非中文声' : '无 SAPI 语音');

  // whisper 环境（可选）：逐词对齐 + KTV 识别兜底；缺失时 02 自动退回字数比例时间轴
  const wpy = path.join(ROOT, (cfg.ktv && cfg.ktv.python) || '.py312/python.exe');
  const wv = fs.existsSync(wpy) ? run(wpy, ['--version']) : { ok: false, out: '' };
  optional('whisper 环境 .py312（逐词对齐/KTV，推荐）', wv.ok,
    wv.ok ? wv.out.trim() : '缺：跑 setup.ps1 一键安装（不装也能出片，字幕走字数比例）');

  // 已缓存的 whisper 模型（config.ktv.alignModel / ktv.model 切档前先看这里）
  const mdir = path.join(ROOT, 'cache', 'whisper');
  const cached = fs.existsSync(mdir)
    ? fs.readdirSync(mdir).filter((d) => fs.existsSync(path.join(mdir, d, 'model.bin'))) : [];
  const want = [...new Set([
    (cfg.ktv && cfg.ktv.alignModel) || 'small',
    (cfg.ktv && cfg.ktv.model) || 'small',
  ])];
  const miss = want.filter((m) => !cached.includes(m));
  optional('whisper 模型缓存（config.ktv.alignModel/model 切档）', miss.length === 0,
    `已缓存: ${cached.join(', ') || '无'}；当前配置: ${want.join(' / ')}` +
    (miss.length ? `；缺 ${miss.join('/')}（首次用到自动下载，medium 约 1.5GB，换档需删缓存 words.json/lyrics.json 重算）` : ''));

  // hypit
  const hypit = path.join(process.env.APPDATA, 'npm', 'hypit.cmd');
  const hv = fs.existsSync(hypit) ? run(hypit, ['version']) : { ok: false, out: 'not found' };
  check('hypit CLI（场景录制）', hv.ok, hv.out.trim().slice(0, 60) || '缺：npm install -g hypit');

  // Chrome（hypit capture 用）
  const chromePaths = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe',
  ];
  const chrome = chromePaths.find((p) => fs.existsSync(p));
  check('Chrome（场景录制）', !!chrome, chrome || '未找到，装 Chrome 或 hypit capture install-browser');

  // 模板与规则书
  const tplDir = path.join(ROOT, 'templates');
  const scenes = fs.existsSync(path.join(tplDir, 'scenes')) ? fs.readdirSync(path.join(tplDir, 'scenes')) : [];
  check('场景模板', scenes.length >= 5, scenes.join(', '));
  check('设计令牌 base.css', fs.existsSync(path.join(tplDir, 'base.css')));
  check('运行时 runtime.js', fs.existsSync(path.join(tplDir, 'runtime.js')));
  ['script.md', 'visuals.md', 'qc.md'].forEach((f) =>
    check('规则书 ' + f, fs.existsSync(path.join(ROOT, 'skills', f))));

  // 配音连通性（可选，走代理打一次极短合成）
  if (process.env.CHECKENV_NET === '1') {
    const t = path.join(process.env.TEMP || '.', 'envcheck.txt');
    fs.writeFileSync(t, '你好', 'utf8');
    const r = run('py', [path.join(__dirname, 'tools/tts_gtts.py'), t, 'zh-CN',
      path.join(process.env.TEMP || '.', 'envcheck.mp3'), cfg.proxy || '']);
    check('配音服务连通', r.ok, r.ok ? '已连通' : r.out.split('\n').slice(-1)[0]);
  }

  console.log(`  ——— ${pass}/${total} 硬项就绪（⚠ 为可选项）`);
  if (pass < total) fail('环境未就绪，请补齐上面 ✗ 的项（安装步骤见 INSTALL.md）');
  log('00', '环境 OK');
}

main();
