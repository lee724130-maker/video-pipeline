// 诊断 fs.cpSync 在 deck-demo 上的 0xC0000409 崩溃：全目录清单 + 小样本对照 + filter 二分
const fs = require('fs');
const path = require('path');
const ROOT = require('./lib.cjs').ROOT;
const SRC = path.join(ROOT, 'output', 'deck-demo');
const TMP = path.join(process.env.TEMP, 'smoke', 'cpsync-diag');

// 1) 全目录清单
const all = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { all.push('DIR  ' + p); walk(p); }
    else { const st = fs.statSync(p); all.push(`FILE ${p}  ${st.size}`); }
  }
})(SRC);
console.log('entries:', all.length);
console.log(all.slice(0, 60).join('\n'));

// 2) 小样本对照
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(path.join(TMP, 'mini', 'sub'), { recursive: true });
fs.writeFileSync(path.join(TMP, 'mini', 'a.txt'), 'hi');
fs.writeFileSync(path.join(TMP, 'mini', 'sub', '成片.mp4'), 'x'.repeat(100));
try { fs.cpSync(path.join(TMP, 'mini'), path.join(TMP, 'mini2'), { recursive: true }); console.log('cpSync mini: OK'); }
catch (e) { console.log('cpSync mini: THREW', e.message); }

// 3) deck-demo 分层 cpSync（只顶层文件 / 只单个子目录）定位
function tryCp(label, src, dst) {
  fs.rmSync(dst, { recursive: true, force: true });
  try { fs.cpSync(src, dst, { recursive: true }); console.log(`${label}: OK`); return true; }
  catch (e) { console.log(`${label}: THREW ${e.message}`); return false; }
}
for (const e of fs.readdirSync(SRC, { withFileTypes: true })) {
  const s = path.join(SRC, e.name);
  const d = path.join(TMP, 'part', e.name);
  try {
    fs.mkdirSync(path.join(TMP, 'part'), { recursive: true });
    fs.cpSync(s, d, { recursive: true });
    console.log(`piece OK   ${e.name}`);
  } catch (err) {
    console.log(`piece FAIL ${e.name} — ${err.message}`);
  }
}
console.log('DIAG DONE (if this prints, no crash in pieces)');
