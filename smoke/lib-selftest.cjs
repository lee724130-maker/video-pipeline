'use strict';
// smoke/lib-selftest.cjs —— 围栏库自测（零副作用：探针建了即删，只读扫描桌面）
const fs = require('fs');
const assert = require('assert');
const lib = require('./lib.cjs');

// 1) 乱码名判定：私有区字符命中，正常中文/ASCII 不误报
assert(lib.isGarbledName('\u9353\ue047\u7deb\u6434\u65c2\u6564'), 'P9 事故目录名应判乱码');
assert(lib.isGarbledName('\u9353緫搴旂敤'), '含乱码词片段应判乱码');
assert(!lib.isGarbledName('剪辑应用'), '真名不得误报');
assert(!lib.isGarbledName('deck-demo'), 'ASCII 不得误报');
console.log('  ✓ 1 乱码判定');

// 2) probeDir：合规名可建可删；坏名/越界必拦
const d = lib.probeDir('_selftest');
assert(fs.existsSync(d) && d.includes('_probe__selftest'));
const dFull = lib.probeDir('_probe_selftestfull');
assert(fs.existsSync(dFull) && dFull.endsWith('_probe_selftestfull'));
fs.rmSync(d, { recursive: true, force: true });
fs.rmSync(dFull, { recursive: true, force: true });
assert.throws(() => lib.probeDir('../evil'), /探针名须为/);
assert.throws(() => lib.probeDir('有中文的名字'), /探针名须为/);
assert.throws(() => lib.assertAllowedBase(lib.ROOT + '/../outside', 't'), /越界/);
console.log('  ✓ 2 探针目录守卫');

// 3) psAsciiLiteral：输出纯 ASCII 且语义还原正确
const lit = lib.psAsciiLiteral('C:\\t\\剪辑应用');
assert(!/[^\x00-\x7F]/.test(lit), '必须纯 ASCII');
assert(lit.includes("'C:\\t\\'"), 'ASCII 段保留');
console.log('  ✓ 3 PS 传参纯 ASCII');

// 4) sweepProbes：枚举清扫 _probe_* 全灭、任务目录不误伤
const a = lib.probeDir('_sweepa'), b = lib.probeDir('_sweepb');
const removed = lib.sweepProbes();
assert(removed.length >= 2 && !fs.existsSync(a) && !fs.existsSync(b));
assert(fs.existsSync(lib.OUTPUT), 'output 本体不动');
console.log('  ✓ 4 枚举清扫');

// 5) 哨兵扫描跑通（桌面当前应干净）
assert(Array.isArray(lib.scanGarbled()));
console.log('  ✓ 5 哨兵可跑');

console.log('LIB SELFTEST 5/5 PASS');
