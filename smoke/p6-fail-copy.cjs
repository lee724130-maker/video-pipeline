const fs = require('fs');
const path = require('path');
const OUT = require('./lib.cjs').OUTPUT;
const src = path.join(OUT, '_probe_p6_d_noplat', 'narration.txt');
for (const d of ['_probe_p6_f1_badplat', '_probe_p6_f2_conflict']) {
  fs.copyFileSync(src, path.join(OUT, d, 'narration.txt'));
  console.log('copied narration -> ' + d);
}
console.log('OK');
