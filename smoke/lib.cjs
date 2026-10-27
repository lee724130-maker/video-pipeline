'use strict';
// smoke/lib.cjs —— 冒烟基建围栏库（单一出处）
// 背景：本机出现过两次「PowerShell/子进程中文路径被 GBK 误读 → 桌面建出乱码假根」事故
// （10-23 桌面事故 commit 076d5d4；10-26 P9 冒烟后 Desktop\鍓緫搴旂敤\output\_probe_editor_e2e 空壳）。
// 本库把当时口头定下的三条规矩固化成代码：
//   ① 项目根一律 __dirname 派生（ROOT），禁任何硬编码绝对路径；
//   ② 探针目录只允许建在 ROOT\output\_probe_* 或 os.tmpdir() 之下，mkdir 一律走 probeDir()，越界直接 throw；
//   ③ 收尾清扫按 _probe_* 前缀枚举删（sweepProbes()），不依赖当初传入的路径字符串——即使路径被误读，也不会在项目外留下目录。
// 另附：乱码哨兵（isGarbledName / scanGarbled）与安全回收（recycleAbsPath，走 Windows 回收站 API、纯 ASCII 传参）。
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'output');

// ---------- ① 路径守卫 ----------

function inside(a, b) { // a 是否位于 b 内（含相等）
  const ra = path.resolve(a), rb = path.resolve(b);
  return ra === rb || ra.startsWith(rb + path.sep);
}

/** 目录类断言：允许 ROOT 内 或 系统临时目录内；其余（桌面、盘根、未派生的怪路径）一律拒绝 */
function assertAllowedBase(p, what) {
  const rp = path.resolve(p);
  if (inside(rp, ROOT) || inside(rp, fs.realpathSync(os.tmpdir()))) return rp;
  throw new Error(`[guard] ${what} 越界：${rp} 不在项目根(${ROOT})或系统临时目录内，拒绝操作`);
}

// ---------- ② 探针目录 ----------

/** 生成/领取一个探针任务目录（ROOT\output\_probe_<name>），带越界与命名双守卫。
 *  name 可传裸后缀（editor_e2e）或全名（_probe_editor_e2e），落盘统一 _probe_ 前缀。 */
function probeDir(name) {
  const full = /^_probe_[A-Za-z0-9_-]+$/.test(name) ? name
    : (/^[A-Za-z0-9_-]+$/.test(name) ? '_probe_' + name : null);
  if (!full) {
    throw new Error(`[guard] 探针名须为 _probe_ 前缀全名或裸后缀 [A-Za-z0-9_-]+，收到：${name}`);
  }
  const dir = path.join(assertAllowedBase(OUTPUT, '探针根'), full);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 枚举式清扫：删 ROOT\output 与 <base> 下所有 _probe_* 目录；dry 时只报告 */
function sweepProbes(opts = {}) {
  const { dry = false, extraBases = [] } = opts;
  const removed = [];
  for (const base of [OUTPUT, ...extraBases]) {
    let names = [];
    try { names = fs.readdirSync(base); } catch { continue; }
    for (const n of names) {
      if (!n.startsWith('_probe_')) continue;
      const p = path.join(base, n);
      if (!fs.statSync(p).isDirectory()) continue;
      assertAllowedBase(p, `清扫 ${n}`);
      removed.push(p);
      if (!dry) fs.rmSync(p, { recursive: true, force: true });
    }
  }
  return removed;
}

// ---------- ③ 乱码哨兵 ----------

// 已知签名：项目/常用中文名的 UTF-8 字节被 cp936 误读后的产物（实测「剪辑应用」含 GBK 未定义
// 单字节 0x87 → 私有区 U+E047，因此私有区/替换符出现即高置信乱码；再比对已知名单兜底）。
const GARBLE_HINTS = ['鍓緫', '鎴愬搧', '娴嬭瘯', '鑴氭湰', '锟斤拷'];

function isGarbledName(name) {
  for (const ch of name) {
    const c = ch.codePointAt(0);
    if ((c >= 0xe000 && c <= 0xf8ff) || c === 0xfffd) return true; // 私有区/替换符
  }
  return GARBLE_HINTS.some((h) => name.includes(h));
}

/** 扫描若干目录（默认桌面）顶层，返回疑似乱码目录清单（只读侦察，不动文件） */
function scanGarbled(dirs) {
  const targets = dirs && dirs.length ? dirs : [path.join(os.homedir(), 'Desktop')];
  const hits = [];
  for (const d of targets) {
    let names = [];
    try { names = fs.readdirSync(d); } catch { continue; }
    for (const n of names) {
      if (isGarbledName(n)) {
        const full = path.join(d, n);
        let st; try { st = fs.statSync(full); } catch { continue; }
        hits.push({ path: full, name: n, isDir: st.isDirectory(), mtime: st.mtime });
      }
    }
  }
  return hits;
}

// ---------- ④ 安全回收（Windows 回收站，禁永久删） ----------

/** 绝对路径 → PowerShell 单引号字面量：非 ASCII 一律拆成 [char]0xXXXX 拼接，命令行零中文 */
function psAsciiLiteral(absPath) {
  const parts = [];
  let run = '';
  for (const ch of absPath) {
    if (ch.codePointAt(0) < 128) { run += ch === "'" ? "''" : ch; }
    else { if (run) { parts.push(`'${run}'`); run = ''; } parts.push(`([char]0x${ch.codePointAt(0).toString(16).padStart(4, '0')})`); }
  }
  if (run) parts.push(`'${run}'`);
  return parts.length ? parts.join('+') : "''";
}

/** 把路径送进 Windows 回收站（文件/目录自适应）；成功 true */
function recycleAbsPath(absPath) {
  const lit = psAsciiLiteral(path.resolve(absPath));
  const cmd =
    `Add-Type -AssemblyName Microsoft.VisualBasic; $p=${lit}; ` +
    `if (Test-Path -LiteralPath $p -PathType Container) { ` +
    `[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p,'OnlyErrorDialogs','SendToRecycleBin') } ` +
    `else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p,'OnlyErrorDialogs','SendToRecycleBin') }; ` +
    `if (Test-Path -LiteralPath $p) { exit 1 }`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8' });
  return r.status === 0;
}

module.exports = { ROOT, OUTPUT, assertAllowedBase, probeDir, sweepProbes, isGarbledName, scanGarbled, recycleAbsPath, psAsciiLiteral };
