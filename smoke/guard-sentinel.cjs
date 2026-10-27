'use strict';
// 乱码目录哨兵：扫描桌面（或指定目录）顶层的 GBK 误读产物（两次事故签名：私有区字符/已知乱码词）。
// 用法：
//   node smoke/guard-sentinel.cjs               → 只报告，退出码 0=干净 / 2=发现疑似
//   node smoke/guard-sentinel.cjs --trash-empty → 疑似且【空目录树】才送回收站（非空只报告，绝不自动动数据）
//   node smoke/guard-sentinel.cjs --dir <路径>   → 追加扫描目录（可多次）
const path = require('path');
const fs = require('fs');
const { scanGarbled, recycleAbsPath } = require('./lib.cjs');

const args = process.argv.slice(2);
const trashEmpty = args.includes('--trash-empty');
const dirs = [];
for (let i = 0; i < args.length; i++) if (args[i] === '--dir' && args[i + 1]) dirs.push(args[++i]);

const hits = scanGarbled(dirs.length ? dirs : undefined);
if (!hits.length) { console.log('[sentinel] 干净：未发现疑似 GBK 误读目录'); process.exit(0); }

function countFiles(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += countFiles(path.join(dir, e.name));
    else n++;
  }
  return n;
}

for (const h of hits) {
  let info = '';
  let empty = false;
  if (h.isDir) {
    try { const n = countFiles(h.path); empty = n === 0; info = ` 文件数=${n}${empty ? '（空树）' : ''}`; } catch (e) { info = ' 统计失败:' + e.message; }
  }
  console.log(`[sentinel] 疑似乱码：${h.path}  mtime=${h.mtime.toISOString()}${info}`);
  if (trashEmpty && h.isDir && empty) {
    const done = recycleAbsPath(h.path);
    console.log(done ? `  → 已送回收站 ✓（可从回收站恢复）` : '  → 回收失败，请手动处理');
  } else if (!trashEmpty) {
    console.log('  → 处置：确认无数据后跑 node smoke/guard-sentinel.cjs --trash-empty，或资源管理器删除（进回收站）');
  } else {
    console.log('  → 非空目录，哨兵不自动处置，请人工确认');
  }
}
process.exit(2);
