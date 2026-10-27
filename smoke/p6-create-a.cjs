// P6 探针 A（重启服务后重做）：网页 API 建任务 platform=douyin → 应写进 shots.platform
(async () => {
  const r = await fetch('http://127.0.0.1:8787/api/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: '平台规格探针。选抖音竖屏画幅建任务。这条验证网页建任务的平台链路。',
      name: 'P6探针A抖音',
      platform: 'douyin',
      voice: 'loongstella_v3.1',
      rate: 7.2,
      coverStyle: 'tech',
      sceneStyle: 'classic',
      captions: true,
    }),
  });
  const j = await r.json();
  console.log('A(douyin)', r.status, JSON.stringify(j).slice(0, 300));
  process.exit(r.status === 200 ? 0 : 1);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
