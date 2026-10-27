// P6 平台规格 · 统一检查：语法 + config.json 合法性 + chat-rules 单测
const { spawnSync } = require('child_process');
const assert = require('assert');
const path = require('path');

const ROOT = require('./lib.cjs').ROOT;
let fails = 0;
const ok = (name, cond, extra) => {
  if (cond) console.log('  PASS ' + name);
  else { fails++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); }
};

console.log('[1] node --check 语法');
const files = [
  'pipeline/02-compile.cjs', 'pipeline/03-scenes.cjs', 'pipeline/05-compose.cjs',
  'pipeline/06-qc.cjs', 'web/server.cjs', 'web/chat-rules.cjs', 'web/chat-qwen.cjs',
];
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', path.join(ROOT, f)], { encoding: 'utf8' });
  ok(f, r.status === 0, (r.stderr || '').split('\n').slice(0, 3).join(' | '));
}

console.log('[2] config.json 合法 + platforms 表');
let cfg = null;
try { cfg = JSON.parse(require('fs').readFileSync(path.join(ROOT, 'pipeline/config.json'), 'utf8')); } catch (e) { ok('json parse', false, String(e)); }
if (cfg) {
  const p = cfg.platforms || {};
  ok('4 平台键', ['douyin', 'shipinhao', 'xiaohongshu', 'bilibili'].every((k) => p[k]), Object.keys(p).join(','));
  ok('画幅整数', Object.values(p).every((v) => Number.isInteger(v.width) && Number.isInteger(v.height)));
  ok('bilibili 横屏', p.bilibili && p.bilibili.width === 1920 && p.bilibili.height === 1080);
  ok('xiaohongshu 3:4', p.xiaohongshu && p.xiaohongshu.width === 1080 && p.xiaohongshu.height === 1440);
}

console.log('[3] chat-rules parseNeed 单测');
const { parseNeed, SHOTS_PATCH } = require(path.join(ROOT, 'web/chat-rules.cjs'));

let r = parseNeed('发抖音，做个30秒的片子', []);
ok('发抖音 → platform', r.shots && r.shots.platform === 'douyin', JSON.stringify(r.shots));
ok('发抖音 → from=2（含 02）', r.from === 2, 'from=' + r.from);
ok('发抖音 → 不写 width', r.shots && !('width' in r.shots), JSON.stringify(r.shots));

r = parseNeed('横屏发B站', []);
ok('横屏发B站 → platform+width 同写（值一致 02 放行）', r.shots && r.shots.platform === 'bilibili' && r.shots.width === 1920 && r.shots.height === 1080, JSON.stringify(r.shots));
ok('横屏发B站 → from=2', r.from === 2, 'from=' + r.from);

r = parseNeed('别发抖音，改竖屏', []);
ok('别发抖音 → 不认平台', !(r.shots && r.shots.platform), JSON.stringify(r.shots));
ok('别发抖音+改竖屏 → 竖屏仍生效', r.shots && r.shots.width === 1080, JSON.stringify(r.shots));

r = parseNeed('发小红书', []);
ok('发小红书 → platform', r.shots && r.shots.platform === 'xiaohongshu', JSON.stringify(r.shots));

r = parseNeed('改成横屏', []);
ok('纯画幅词 → width/height', r.shots && r.shots.width === 1920 && r.shots.height === 1080, JSON.stringify(r.shots));
ok('纯画幅词 → from=2（02 重排时间轴）', r.from === 2, 'from=' + r.from);

r = parseNeed('字幕大一点', []);
ok('字幕大一点 → config 且 from=5', r.config && r.config.compose.captionSize === 76 && r.from === 5, JSON.stringify({ c: r.config, from: r.from }));

r = parseNeed('用演示风', []);
ok('演示风 → sceneStyle 且 from=3（回归）', r.shots && r.shots.sceneStyle === 'deck' && r.from === 3, JSON.stringify({ s: r.shots, from: r.from }));

r = parseNeed('字幕大一点，横屏发B站', []);
ok('混合需求 → from=2（最早受影响步）', r.from === 2, 'from=' + r.from);

r = parseNeed('随便说点什么', []);
ok('没匹配 → shots null（宁缺勿错）', r.shots === null, JSON.stringify(r.shots));

console.log('[4] SHOTS_PATCH.platform 白名单');
ok('douyin 合法', SHOTS_PATCH.platform('douyin') === true);
ok('bilibili 合法', SHOTS_PATCH.platform('bilibili') === true);
ok('未知键拒绝', SHOTS_PATCH.platform('tiktok') === false);
ok('大写拒绝', SHOTS_PATCH.platform('Douyin') === false);
ok('非字符串拒绝', SHOTS_PATCH.platform(42) === false);
ok('注入串拒绝', SHOTS_PATCH.platform('a"; rm -rf /') === false);

console.log(fails ? `\n=== ${fails} 项 FAIL ===` : '\n=== 全部 PASS ===');
process.exit(fails ? 1 : 0);
