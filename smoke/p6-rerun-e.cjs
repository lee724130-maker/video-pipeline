// P6 探针 E：/api/rerun platform douyin→bilibili（from=3 应被钳到 2，02 重排画幅）
(async () => {
  const r = await fetch('http://127.0.0.1:8787/api/rerun', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'P6探针A抖音', from: 3, shots: { platform: 'bilibili' } }),
  });
  const j = await r.json();
  console.log('rerun', r.status, JSON.stringify(j));
  const pass = r.status === 200 && j.ok === true && j.from === 2;
  console.log(pass ? '=== E 入口 PASS（from 3→2 钳制）===' : `=== E 入口 FAIL status=${r.status} ===`);
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
