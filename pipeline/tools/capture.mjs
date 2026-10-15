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

  const recorder = await record({ path: out, fps });
  // 录制起点到动画起点之间的偏移（写入 sidecar，05 合成时据此裁掉开头黑帧）
  const t0 = Date.now();
  await page.evaluate('window.__start()');
  const dt = Date.now() - t0;
  writeFileSync(out.replace(/\.mp4$/, '.json'), JSON.stringify({
    offsetSec: Number(((dt / 2) / 1000).toFixed(3)),
    roundTripMs: dt,
  }));
  log(`recording ${seconds}s -> ${out} (start offset ~${(dt / 2).toFixed(0)}ms)`);
  await new Promise((r) => setTimeout(r, seconds * 1000 + 200));
  await recorder.stop();
  log('done ' + out);
};
