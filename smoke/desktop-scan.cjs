// 桌面乱码文件夹侦察：名单(unicode 转义防控制台乱码) + 乱码目录的出生时间/属性/内容 + 编码解码验证 + 真身完好性
const fs = require('fs');
const path = require('path');
const DESK = path.join(require('os').homedir(), 'Desktop');
const REAL = path.join(DESK, '剪辑应用');

console.log('== 桌面全部条目 ==');
for (const n of fs.readdirSync(DESK)) {
  const p = path.join(DESK, n);
  let st;
  try { st = fs.lstatSync(p); } catch (e) { console.log(JSON.stringify(n), 'stat FAIL', e.message); continue; }
  const kind = st.isSymbolicLink() ? 'LINK/JUNCTION' : (st.isDirectory() ? 'dir' : 'file');
  console.log(`${JSON.stringify(n)}  [${kind}]  born=${st.birthtime.toLocaleString('sv')}`);
}

// 找乱码目录：名字以 鍓 开头（剪 的 UTF-8 E5 89 AA 按 GBK 读出的首字）
const mojiName = fs.readdirSync(DESK).find((n) => n.startsWith('\u9353') && n.length <= 8 && n !== '剪辑应用');
console.log('\n== 乱码目录细查 ==');
if (!mojiName) { console.log('没找到以 鍓 开头的候选'); process.exit(0); }
console.log('name =', JSON.stringify(mojiName));
const mp = path.join(DESK, mojiName);
const st = fs.lstatSync(mp);
console.log('kind =', st.isSymbolicLink() ? 'LINK/JUNCTION（不是普通文件夹！）' : '普通目录');
console.log('born =', st.birthtime.toLocaleString('sv'), ' mtime =', st.mtime.toLocaleString('sv'));
console.log('attrs =', st.isDirectory() ? 'dir' : '', st.isSymbolicLink() ? 'reparse' : '', 'readonly=' + st.isFile() && st.mode);
const kids = fs.readdirSync(mp);
console.log('children =', kids.length, kids.map((k) => JSON.stringify(k)).join(', ') || '(空)');

// 编码验证：乱码名按 GB18030 解码是否等于 剪辑应用
const dec = require('util');
const asBuf = Buffer.from(mojiName, 'utf8');
console.log('\n== 编码验证 ==');
console.log('乱码名 UTF-8 字节:', [...asBuf].map((b) => b.toString(16).padStart(2, '0')).join(' '));
console.log('真名   UTF-8 字节:', [...Buffer.from('剪辑应用', 'utf8')].map((b) => b.toString(16).padStart(2, '0')).join(' '));

// 真身完好性
console.log('\n== 真身 剪辑应用 ==');
const rst = fs.statSync(REAL);
console.log('exists = true  born =', rst.birthtime.toLocaleString('sv'));
const top = fs.readdirSync(REAL);
console.log('顶层条目', top.length, '个:', top.join(', '));
console.log('git 在:', fs.existsSync(path.join(REAL, '.git')), ' web/server.cjs 在:', fs.existsSync(path.join(REAL, 'web/server.cjs')));
