// P9 静态体检：文件语法 + 页面内联 JS + 关键件在位
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const ROOT = require('./lib.cjs').ROOT;
const TEMP = path.join(process.env.TEMP, 'smoke'); fs.mkdirSync(TEMP, { recursive: true });

function jsCheck(code, tag) {
  const f = path.join(TEMP, '_chk_' + tag + '.js');
  fs.writeFileSync(f, code);
  execSync(`node --check "${f}"`, { stdio: 'inherit' });
  console.log(`  ✓ ${tag} 语法 OK`);
}
for (const f of ['web/server.cjs', 'web/chat-rules.cjs', 'pipeline/01-tts.cjs']) {
  execSync(`node --check "${path.join(ROOT, f).replace(/\//g, '/')}"`, { stdio: 'inherit' });
  console.log(`  ✓ ${f} 语法 OK`);
}
const ed = fs.readFileSync(path.join(ROOT, 'web/public/editor.html'), 'utf8');
const edm = ed.match(/<script>([\s\S]*?)<\/script>/);
if (!edm) throw new Error('editor.html no script');
jsCheck(edm[1], 'editor-inline');
for (const id of ['task', 'loadBtn', 'taskInfo', 'editCard', 'shotList', 'doRerun', 'saveBtn', 'saveMsg', 'runStat', 'diffCount']) {
  if (!ed.includes(`id="${id}"`)) throw new Error('editor 缺 id: ' + id);
}
['async function init', 'async function load', 'function render', 'function cardHTML', 'function itemsHTML', 'async function save', 'function startPoll'].forEach((fn) => {
  if (!ed.includes(fn)) throw new Error('editor 缺: ' + fn);
});
console.log('  ✓ editor.html ids/函数在位');

const idx = fs.readFileSync(path.join(ROOT, 'web/public/index.html'), 'utf8');
if (!idx.includes('href="/wizard"') || !idx.includes('href="/console"')) throw new Error('入口页缺向导/控制台双卡');
console.log('  ✓ index.html 入口双卡在位');
const con = fs.readFileSync(path.join(ROOT, 'web/public/console.html'), 'utf8');
if (!con.includes('href="/editor"')) throw new Error('console 缺 /editor 链接');
const idxm = con.match(/<script>([\s\S]*?)<\/script>/);
jsCheck(idxm[1], 'console-inline');
console.log('  ✓ console.html 链接 + 内联 JS OK');

const srv = fs.readFileSync(path.join(ROOT, 'web/server.cjs'), 'utf8');
for (const s of ["'/api/editor/shots'", "'/editor'", "'/console'", 'narrationDrift', 'SHOT_EDIT[fk]', 'shots.json.bak', 'copyFileSync(sj, sj + \'.bak\')', 'EDIT_TASK_FIELDS', 'structural', 'narrationSeg']) {
  if (!srv.includes(s)) throw new Error('server 缺: ' + s);
}
const t01 = fs.readFileSync(path.join(ROOT, 'pipeline/01-tts.cjs'), 'utf8');
for (const s of ['narrationSeg.json', 'buildNarration']) {
  if (!t01.includes(s)) throw new Error('01-tts 缺: ' + s);
}
const cr = require(path.join(ROOT, 'web/chat-rules.cjs'));
if (!cr.SHOT_EDIT || !cr.TYPE_WL) throw new Error('chat-rules 导出缺');
if (!cr.SHOT_EDIT.type('bullet') || cr.SHOT_EDIT.type('nope')) throw new Error('SHOT_EDIT.type 判定错');
if (!cr.SHOT_EDIT.narration('一句话') || cr.SHOT_EDIT.narration('') || cr.SHOT_EDIT.narration(123)) throw new Error('SHOT_EDIT.narration 判定错');
if (!cr.SHOT_EDIT.items([{ t: 'a', d: 'b' }, 'plain']) || cr.SHOT_EDIT.items([{ t: '' }]) || cr.SHOT_EDIT.items([{ x: 1 }])) throw new Error('SHOT_EDIT.items 判定错');
console.log('  ✓ SHOT_EDIT/TYPE_WL 导出与判定 OK');
console.log('P9 静态体检全过');
