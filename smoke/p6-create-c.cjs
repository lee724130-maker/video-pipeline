// P6 回归 C：网页自定义画幅（方形 1080×1080，非平台组）——旧路径必须原样可用
(async () => {
  const r = await fetch('http://127.0.0.1:8787/api/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: '自定义画幅回归探针。不选平台，直接给方形象素。验证旧下拉路径没坏。',
      name: 'P6回归C方形',
      width: 1080, height: 1080,
      voice: 'loongstella_v3.1',
      rate: 7.2,
      coverStyle: 'tech',
      sceneStyle: 'classic',
      captions: true,
    }),
  });
  const j = await r.json();
  console.log('C(square)', r.status, JSON.stringify(j).slice(0, 300));
  process.exit(r.status === 200 ? 0 : 1);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
