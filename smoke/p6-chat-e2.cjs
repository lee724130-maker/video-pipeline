// P6 E2：等队列空闲 → 聊天框发「改成发小红书」→ 验 chat→parseNeed/qwen→startRerun 集成
(async () => {
  let idle = false;
  for (let i = 0; i < 180; i++) {
    try {
      const s = await (await fetch('http://127.0.0.1:8787/api/status')).json();
      if (!s.running && !(s.queue || []).length) { idle = true; break; }
    } catch (e) { /* 服务喘气 */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!idle) { console.log('FAIL 等空闲超时'); process.exit(1); }
  console.log('queue idle ✓');

  const r = await fetch('http://127.0.0.1:8787/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'P6探针A抖音', text: '改成发小红书' }),
  });
  const j = await r.json();
  console.log('chat', r.status, JSON.stringify(j).slice(0, 700));
  process.exit(r.status === 200 ? 0 : 1);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
