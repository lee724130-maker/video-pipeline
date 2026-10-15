// 编排器：node pipeline/run.cjs <任务目录> [--from N] [--only N] [--steps 1,2,3]
// 步骤: 0 检查环境 · 1 配音 · 2 编排时间轴 · 3 场景 HTML · 4 渲染 · 5 合成 · 6 质检
const path = require('path');
const { run, fail, log } = require('./lib/common.cjs');

const STEPS = [
  { n: 0, name: '环境自检', file: '00-checkenv.cjs' },
  { n: 1, name: '配音', file: '01-tts.cjs' },
  { n: 2, name: '时间轴编排', file: '02-compile.cjs' },
  { n: 3, name: '场景生成', file: '03-scenes.cjs' },
  { n: 4, name: '场景渲染', file: '04-render.cjs' },
  { n: 5, name: '合成', file: '05-compose.cjs' },
  { n: 6, name: '质检', file: '06-qc.cjs' },
];

function main() {
  const args = process.argv.slice(2);
  const taskDir = args.find((a) => !a.startsWith('--'));
  if (!taskDir) fail('用法: node pipeline/run.cjs <任务目录> [--from N] [--only N] [--steps 1,2,3]');
  if (!require('fs').existsSync(path.join(taskDir, 'shots.json'))) fail(`缺 ${taskDir}/shots.json`);

  const get = (k) => {
    const i = args.indexOf('--' + k);
    return i >= 0 ? args[i + 1] : null;
  };
  let selected;
  if (get('steps')) selected = get('steps').split(',').map(Number);
  else if (get('only') !== null) selected = [Number(get('only'))];
  else if (get('from') !== null) {
    const from = Number(get('from'));
    selected = STEPS.map((s) => s.n).filter((n) => n >= from);
  } else selected = STEPS.map((s) => s.n);

  for (const n of selected) {
    const step = STEPS.find((s) => s.n === n);
    if (!step) fail(`未知步骤 ${n}`);
    const t0 = Date.now();
    log('run', `—— 步骤 ${step.n} ${step.name} ——`);
    const r = run('node', [path.join(__dirname, step.file), taskDir], { stdio: 'inherit' });
    if (!r.ok) fail(`步骤 ${step.n} ${step.name} 失败（exit ${r.code}）`);
    log('run', `步骤 ${step.n} 完成（${((Date.now() - t0) / 1000).toFixed(1)}s）`);
  }
  log('run', '全部完成 ✅');
}

main();
