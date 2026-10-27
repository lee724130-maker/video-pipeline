// P6 UI 冒烟：index.html 内联脚本语法 + 发布规格下拉结构断言（无头环境替代方案）
const fs = require('fs');
const { spawnSync } = require('child_process');
const path = require('path');
const ROOT = require('./lib.cjs').ROOT;
let fails = 0;
const ok = (n, c, x) => { if (c) console.log('  PASS ' + n); else { fails++; console.log('  FAIL ' + n + (x ? ' :: ' + x : '')); } };

const html = fs.readFileSync(path.join(ROOT, 'web/public/index.html'), 'utf8');

// 下拉结构
ok('平台组 douyin', /value="plat:douyin"/.test(html));
ok('平台组 shipinhao', /value="plat:shipinhao"/.test(html));
ok('平台组 xiaohongshu', /value="plat:xiaohongshu"/.test(html));
ok('平台组 bilibili', /value="plat:bilibili"/.test(html));
ok('自定义组 3 尺寸', ['size:1080x1920', 'size:1920x1080', 'size:1080x1080'].every((v) => html.includes(`value="${v}"`)));
ok('两个 optgroup', (html.match(/<optgroup/g) || []).length === 2);
ok('label 改发布规格', html.includes('<label>发布规格</label>'));
ok('create 走 spec 分派', html.includes("specKind === 'plat'") && html.includes('{ platform: specVal }'));
ok('尺寸分支保留', html.includes("width: Number(specVal.split('x')[0])"));
ok('不再旧拆法', !html.includes("value.split('x').map(Number)"));

// 内联脚本语法
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
ok('有内联脚本', scripts.length >= 1, 'count=' + scripts.length);
const tmp = path.join(process.env.TEMP, 'p6-inline-check.js');
fs.writeFileSync(tmp, scripts.join('\n;\n'), 'utf8');
const r = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
ok('内联 JS 语法', r.status === 0, (r.stderr || '').split('\n').slice(0, 3).join(' | '));

console.log(fails ? `\n=== ${fails} 项 FAIL ===` : '\n=== UI 冒烟全 PASS ===');
process.exit(fails ? 1 : 0);
