// P6 负例（不入队）：未知平台 400 / platform+width 同传 400
(async () => {
  const post = async (label, body) => {
    const r = await fetch('http://127.0.0.1:8787/api/create', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    console.log(label, r.status, JSON.stringify(await r.json()).slice(0, 300));
    return r.status;
  };
  const s1 = await post('未知平台', { text: '不该建成。', name: 'P6neg-hack', platform: 'tiktok' });
  const s2 = await post('platform+width同传', { text: '不该建成。', name: 'P6neg-both', platform: 'douyin', width: 1920, height: 1080 });
  const s3 = await post('platform+size同传', { text: '不该建成。', name: 'P6neg-both2', platform: 'douyin', width: 1080, height: 1920 });
  const pass = s1 === 400 && s2 === 400 && s3 === 400;
  console.log(pass ? '=== 负例 PASS（400/400/400）===' : `=== FAIL ${s1}/${s2}/${s3} ===`);
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
