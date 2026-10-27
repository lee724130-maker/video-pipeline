// P7-1 素材库 API 冒烟：列表过滤 / 选用复制 / 白名单负例 / findBgm 契约 / create 早校验 / 还原现场
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = 'C:\\Users\\Administrator\\Desktop\\\u526a\u8f91\u5e94\u7528';
const LIB = path.join(root, 'library');
const TASK = 'deck-demo';
const TDIR = path.join(root, 'output', TASK);
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  PASS ' + msg); } else { fail++; console.log('  FAIL ' + msg); } };

async function api(p, opt) {
  const r = await fetch('http://127.0.0.1:8787' + p, opt);
  let d = {}; try { d = await r.json(); } catch (e) {}
  return { status: r.status, data: d };
}
const post = (p, body) => api(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

function silence(file) {
  const r = spawnSync('ffmpeg', ['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '3', '-y', file], { stdio: 'ignore' });
  if (r.status !== 0 || !fs.existsSync(file)) fs.writeFileSync(file, Buffer.from('FAKE' + Math.random()));
  return fs.existsSync(file);
}

(async () => {
  // —— 0. 还原点：备份 deck-demo 现有 bgm（libBgmInto 会清同名旧文件，必须留原件）——
  const os = require('os');
  const adir = path.join(TDIR, 'assets');
  const adirExisted = fs.existsSync(adir);
  const before = adirExisted ? fs.readdirSync(adir) : [];
  const origBgm = before.filter((f) => /^bgm\./i.test(f));
  const bkpDir = path.join(os.tmpdir(), 'p7-bgm-backup');
  fs.rmSync(bkpDir, { recursive: true, force: true });
  fs.mkdirSync(bkpDir, { recursive: true });
  for (const f of origBgm) fs.copyFileSync(path.join(adir, f), path.join(bkpDir, f));
  console.log('[0] deck-demo/assets 原状: ' + (before.join(', ') || '(无)') + (origBgm.length ? '（已备份 bgm×' + origBgm.length + '）' : ''));

  // —— 1. 种子文件（真实静音 3s 音频，其余任意字节）+ 错扩展名诱饵 ——
  fs.mkdirSync(path.join(LIB, 'bgm'), { recursive: true });
  fs.mkdirSync(path.join(LIB, 'images'), { recursive: true });
  fs.mkdirSync(path.join(LIB, 'clips'), { recursive: true });
  silence(path.join(LIB, 'bgm', 'libtest-bgm.mp3'));
  silence(path.join(LIB, 'bgm', 'libtest-bgm2.wav'));
  fs.writeFileSync(path.join(LIB, 'bgm', 'notes.txt'), 'decoy');
  fs.writeFileSync(path.join(LIB, 'bgm', 'evil.exe'), 'decoy');
  fs.writeFileSync(path.join(LIB, 'images', 'libtest-img.jpg'), 'FAKEJPG');
  fs.writeFileSync(path.join(LIB, 'clips', 'libtest-clip.mp4'), 'FAKEMP4');
  console.log('[1] 种子文件已放入 library/');

  // —— 2. GET /api/library：列表 + 白名单过滤 ——
  const L = await api('/api/library');
  ok(L.status === 200, 'GET /api/library 200');
  const bn = (L.data.kinds?.bgm || []).map((x) => x.name);
  ok(bn.includes('libtest-bgm.mp3') && bn.includes('libtest-bgm2.wav'), 'bgm 列出 mp3+wav');
  ok(!bn.includes('notes.txt') && !bn.includes('evil.exe'), '白名单外扩展名静默忽略');
  ok((L.data.kinds?.images || []).some((x) => x.name === 'libtest-img.jpg'), 'images 列出 jpg');
  ok((L.data.kinds?.clips || []).some((x) => x.name === 'libtest-clip.mp4'), 'clips 列出 mp4');

  // —— 3. 负例（全在排队前 404/400，不会触发跑片）——
  let r = await post('/api/library/add', { kind: 'hack', name: 'x.mp3', task: TASK });
  ok(r.status === 400 && /白名单/.test(r.data.error || ''), '400 kind 白名单: ' + (r.data.error || ''));
  r = await post('/api/library/add', { kind: 'images', name: '../config.json', task: TASK });
  ok(r.status === 400 && /非法/.test(r.data.error || ''), '400 路径穿越文件名');
  r = await post('/api/library/add', { kind: 'bgm', name: 'evil.exe', task: TASK });
  ok(r.status === 400 && /不支持的类型/.test(r.data.error || ''), '400 错扩展名');
  r = await post('/api/library/add', { kind: 'bgm', name: 'nope.mp3', task: TASK });
  ok(r.status === 404, '404 库里没有该文件');
  r = await post('/api/library/add', { kind: 'bgm', name: 'libtest-bgm.mp3', task: 'no-such-task-x' });
  ok(r.status === 404, '404 任务不存在');

  // —— 4. 正例：BGM 选用（含旧 bgm 清理 + 多扩展）——
  r = await post('/api/library/add', { kind: 'bgm', name: 'libtest-bgm.mp3', task: TASK });
  ok(r.status === 200 && r.data.written === 'assets/bgm.mp3', 'BGM 复制 → assets/bgm.mp3');
  r = await post('/api/library/add', { kind: 'bgm', name: 'libtest-bgm2.wav', task: TASK });
  ok(r.status === 200 && r.data.written === 'assets/bgm.wav', '换 wav → assets/bgm.wav');
  const nowBgm = fs.readdirSync(adir).filter((f) => /^bgm\./i.test(f));
  ok(nowBgm.length === 1 && nowBgm[0] === 'bgm.wav', '旧 bgm.mp3 已清理（findBgm 无歧义），现: ' + nowBgm.join(','));

  // findBgm 真实契约：管线函数按任务目录找到我们复制进去的文件
  const { findBgm } = require(path.join(root, 'pipeline', 'lib', 'common.cjs'));
  const found = findBgm(TDIR);
  ok(found && path.basename(found) === 'bgm.wav', '管线 findBgm 命中 assets/bgm.wav: ' + found);

  // —— 5. 正例：图片（bg-NN 自动编号 / 原名复制 + 同名 409）与片段 ——
  r = await post('/api/library/add', { kind: 'images', name: 'libtest-img.jpg', task: TASK, mode: 'bg' });
  const bgName = r.data.written || '';
  ok(r.status === 200 && /^assets\/bg-\d+\.jpg$/.test(bgName), '图片作背景 → ' + bgName);
  r = await post('/api/library/add', { kind: 'images', name: 'libtest-img.jpg', task: TASK, mode: 'as-is' });
  ok(r.status === 200 && r.data.written === 'assets/libtest-img.jpg', '图片原名复制');
  r = await post('/api/library/add', { kind: 'images', name: 'libtest-img.jpg', task: TASK, mode: 'as-is' });
  ok(r.status === 409 && /同名/.test(r.data.error || ''), '同名重复添加 409');
  r = await post('/api/library/add', { kind: 'clips', name: 'libtest-clip.mp4', task: TASK });
  ok(r.status === 200 && r.data.written === 'assets/libtest-clip.mp4', '片段复制进任务');

  // —— 6. create 早校验负例（在排队前返回，不会跑片）——
  r = await post('/api/create', { text: '测试文案', name: 'libtest-create-400', bgm: 'data:audio/mpeg;base64,QQ==', bgmFromLibrary: 'libtest-bgm.mp3' });
  ok(r.status === 400 && /二选一/.test(r.data.error || ''), '400 自带上传与素材库同传');
  r = await post('/api/create', { text: '测试文案', name: 'libtest-create-404', bgmFromLibrary: 'nope.mp3' });
  ok(r.status === 404, '404 create 时库文件不存在');
  r = await post('/api/create', { text: '测试文案', name: 'libtest-create-400b', bgmFromLibrary: 'evil.exe' });
  ok(r.status === 400 && /文件名非法/.test(r.data.error || ''), '400 create 时错扩展名');
  ok(!fs.existsSync(path.join(root, 'output', 'libtest-create-400')), '早校验未落任务目录');

  // —— 7. 还原现场：清测试产物 + 回填原件 bgm + 清种子文件 ——
  for (const f of fs.readdirSync(adir)) {
    if (/^bgm\./i.test(f) || f === 'libtest-img.jpg' || f === 'libtest-clip.mp4' || (bgName && f === path.basename(bgName))) {
      fs.unlinkSync(path.join(adir, f));
    }
  }
  for (const f of origBgm) fs.copyFileSync(path.join(bkpDir, f), path.join(adir, f));
  if (!adirExisted && fs.readdirSync(adir).length === 0) fs.rmdirSync(adir);
  const after = fs.existsSync(adir) ? fs.readdirSync(adir) : [];
  ok(JSON.stringify([...after].sort()) === JSON.stringify([...before].sort()), 'deck-demo/assets 已还原原状: ' + (after.join(', ') || '(无)'));
  for (const f of ['libtest-bgm.mp3', 'libtest-bgm2.wav', 'notes.txt', 'evil.exe']) { const p = path.join(LIB, 'bgm', f); if (fs.existsSync(p)) fs.unlinkSync(p); }
  for (const p of [path.join(LIB, 'images', 'libtest-img.jpg'), path.join(LIB, 'clips', 'libtest-clip.mp4')]) if (fs.existsSync(p)) fs.unlinkSync(p);
  ok(true, '种子文件已清理（library 回到仅 README）');

  console.log(`\nRESULT pass=${pass} fail=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('SMOKE CRASH: ' + e.stack); process.exit(1); });
