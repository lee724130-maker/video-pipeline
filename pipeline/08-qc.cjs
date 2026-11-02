// 08-qc · 精修质检包装：把 06 的参数化旗标固定指向 精修/ 产物（P12-C；06 本体零改动，单一判据出处）
// 用法: node pipeline/08-qc.cjs <任务目录>
'use strict';
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT, fail } = require('./lib/common.cjs');

const task = path.resolve(process.argv[2] || fail('用法: node pipeline/08-qc.cjs <任务目录>'));
const r = spawnSync(process.execPath, [
  path.join(__dirname, '06-qc.cjs'), task,
  '--video', path.join(task, '精修', '成片.mp4'),
  '--timeline', path.join(task, '精修', 'effective-timeline.json'),
  '--report', path.join(task, '精修', 'qc-report.txt'),
  '--qcdir', path.join(task, '精修', 'qc'),
], { stdio: 'inherit' });
process.exit(r.status == null ? 1 : r.status);
