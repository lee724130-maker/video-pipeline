// P6 收尾：删除本日探针目录（output/ 白名单只留 5 个生产目录）
const fs = require('fs');
const path = require('path');
const OUT = require('./lib.cjs').OUTPUT;
const kill = ['_probe_p6_b_xhs', '_probe_p6_d_noplat', '_probe_p6_f1_badplat', '_probe_p6_f2_conflict', 'P6探针A抖音', 'P6回归C方形'];
for (const d of kill) {
  const p = path.join(OUT, d);
  if (fs.existsSync(p)) { fs.rmSync(p, { recursive: true, force: true }); console.log('deleted ' + d); }
  else console.log('absent ' + d);
}
console.log('remaining: ' + fs.readdirSync(OUT).join(' | '));
