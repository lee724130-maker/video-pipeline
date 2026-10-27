// P6 准备：等服务 UP + 删掉旧代码跑出来的 A 探针目录（platform 被丢弃的错版）
const { OUTPUT } = require('./lib.cjs');
const fs = require('fs');
const path = require('path');
(async () => {
  for (let i = 0; i < 20; i++) {
    try {
      const r = await fetch('http://127.0.0.1:8787/api/status');
      const j = await r.json();
      console.log('UP running=' + j.running, 'queue=' + (j.queue || []).length);
      break;
    } catch (e) { await new Promise((r) => setTimeout(r, 500)); if (i === 19) throw e; }
  }
  const old = path.join(require('./lib.cjs').OUTPUT, 'P6探针A抖音');
  if (fs.existsSync(old)) { fs.rmSync(old, { recursive: true, force: true }); console.log('已删旧 A 目录'); }
  else console.log('旧 A 目录不存在（无需删）');
  // 负例残留目录也不该有
  for (const d of ['P6neg-hack', 'P6neg-both', 'P6neg-size']) {
    const p = path.join(require('./lib.cjs').OUTPUT, d);
    if (fs.existsSync(p)) { fs.rmSync(p, { recursive: true, force: true }); console.log('已删 ' + d); }
  }
  console.log('PREP OK');
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
