// hypit capture run 的入口脚本：把一个本地 HTML 页面录制成 mp4
// 用法: hypit capture run tools/capture.mjs --viewport 1080x1920 --channel chrome -- \
//        --url file:///.../s01.html --out segments/s01.mp4 --seconds 4.2 --fps 30
export const options = { channel: 'chrome' };

import { writeFileSync } from 'fs';

export default async ({ page, record, args, log }) => {
  const a = {};
  for (let i = 0; i < args.length; i += 2) a[String(args[i]).replace(/^--/, '')] = args[i + 1];

  const url = a.url;
  const out = a.out;
  const seconds = parseFloat(a.seconds || '5');
  const fps = parseInt(a.fps || '30', 10);

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction('window.__SCENE_READY === true', { timeout: 8000 });

  // 先起播、等首帧动画画完、再开录。hypit 的 screencast 会话可能延迟 0~1.6s 才开始送帧，
  // 迟到的首帧会用「开录瞬间的截图」回填——若那一刻场景还没起播，成片开头就空一段。
  // 顺序反过来后，回填的初始状态已是「场景完整可见」，附带延迟多久都不吃画面。
  // settle 250ms > scene-in 淡入 0.15s，保证截图是全亮状态。
  await page.evaluate('window.__start()');
  await new Promise((r) => setTimeout(r, 250));
  const t0 = Date.now();
  const recorder = await record({ path: out, fps });
  const dt = Date.now() - t0;
  writeFileSync(out.replace(/\.mp4$/, '.json'), JSON.stringify({
    offsetSec: 0,
    recordMs: dt,
  }));
  log(`recording ${seconds}s -> ${out} (start-before-record, record setup ${dt}ms)`);
  await new Promise((r) => setTimeout(r, seconds * 1000 + 200));
  await recorder.stop();
  log('done ' + out);
};
