// smoke/run-regression.cjs —— 全量回归串跑器（入库版，替代曾丢失的桌面 run-regression.cjs）
// 规矩：① 路径一律从 lib.cjs 的 ROOT 派生，禁硬编码绝对路径（搬盘即失效的教训）；
//       ② 串行独占 8787——8787 同一时刻只跑一条管线，并发会互相抢→假性失败；
//       ③ 计费套件默认闸住：p7-2-imagegen（真实生图）、p8-clone（真实复刻）只在 --with-billing 时跑，跑前须先向用户报价。
// 用法：node smoke/run-regression.cjs [--with-billing] [--only p21,p24,p25]
// 退出码：任一套件失败→1；全绿→0。
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT } = require('./lib.cjs');
const SMOKE = path.join(ROOT, 'smoke');

// 零计费套件（含用免费额度 TTS 的真实重跑 p11/p13/p14）
const SUITES = [
  'p9-static.cjs',
  'p6-check.cjs',
  'p7-library-smoke.cjs',
  'p10-icc-smoke.cjs',
  'p16-console-layout-smoke.cjs',
  'p17-library-enhance-smoke.cjs',
  'p21-comic-smoke.cjs',
  'p24-pptx-smoke.cjs',
  'p25-widget-smoke.cjs',
  'p9-editor-smoke.cjs',
  'p12-edit-contract-smoke.cjs',
  'p19-cut-export-smoke.cjs',
  'p20-jianying-relay-smoke.cjs',
  'p11-editor-v2-smoke.cjs',
  'p13-timeline-smoke.cjs',
  'p14-wizard-smoke.cjs',
];
// 计费套件（默认不跑）
const BILLING = ['p7-2-imagegen-smoke.cjs', 'p8-clone-smoke.cjs'];
const SENTINEL = 'guard-sentinel.cjs';

const argv = process.argv.slice(2);
const withBilling = argv.includes('--with-billing');
const onlyIdx = argv.indexOf('--only');
const only = onlyIdx > -1 ? (argv[onlyIdx + 1] || '').split(',').map(s => s.trim()).filter(Boolean) : null;

let list = only ? SUITES.concat(BILLING).filter(f => only.some(o => f.startsWith('p' + o.replace(/^p/, '')) || f.includes(o))) : SUITES.slice();
if (withBilling) list = list.concat(BILLING);

function runSuite(file) {
  const full = path.join(SMOKE, file);
  const r = spawnSync(process.execPath, [full], { cwd: ROOT, encoding: 'utf8', timeout: 600000, maxBuffer: 32 * 1024 * 1024 });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/(\d+)\s*通过\s*\/\s*(\d+)\s*失败\s*\/\s*(\d+)\s*跳过/);
  const tail = out.trim().split('\n').filter(Boolean).slice(-1)[0] || '';
  const crashed = r.error ? String(r.error.message || r.error) : null;
  const failParsed = m ? +m[2] : null;
  // 权威判定：退出码 0 且未崩溃且（解析到的失败数为 0 或无法解析）→ PASS；README 口径「退出码 0 + FAIL 计数 0」
  const passed = !crashed && r.status === 0 && (failParsed === null || failParsed === 0);
  return { file, code: r.status, pass: m ? +m[1] : null, fail: failParsed, skip: m ? +m[3] : null, tail, crashed, passed };
}

console.log('== 全量回归串跑（串行独占 8787）==');
console.log('套件数=' + list.length + (withBilling ? '（含计费）' : '（计费套件已闸住，加 --with-billing 才跑）') + '\n');
const results = [];
let totalPass = 0, totalFail = 0, totalSkip = 0, anyFail = false;
for (const f of list) {
  const t0 = Date.now();
  const res = runSuite(f);
  res.ms = Date.now() - t0;
  results.push(res);
  const badge = res.crashed ? 'CRASH' : (res.passed ? 'PASS' : 'FAIL');
  if (!res.passed) anyFail = true;
  totalPass += res.pass || 0; totalFail += res.fail || 0; totalSkip += res.skip || 0;
  console.log(`[${badge}] ${f}  exit=${res.code}  ${res.pass ?? '?'}通过/${res.fail ?? '?'}失败/${res.skip ?? '?'}跳过  ${(res.ms / 1000).toFixed(0)}s` + (res.crashed ? '  ⚠ ' + res.crashed : ''));
}

console.log('\n== 哨兵 guard-sentinel ==');
const sen = runSuite(SENTINEL);
console.log(`[${sen.code === 0 ? 'OK' : 'WARN'}] ${SENTINEL}  exit=${sen.code}  ${sen.tail}`);

console.log('\n== 汇总 ==');
console.log(`套件 ${results.length} · 断言 ${totalPass} 通过 / ${totalFail} 失败 / ${totalSkip} 跳过 · 哨兵 exit=${sen.code}`);
if (anyFail || sen.code !== 0) { console.log('结果：❌ 有失败/异常，见上方 FAIL/CRASH 行'); process.exit(1); }
console.log('结果：✅ 全绿');
process.exit(0);
