// P7-2 端点探针（零成本：靠 400 错误信息辨路，绝不真生成）
const fs = require('fs');
const path = require('path');
const ROOT = require('./lib.cjs').ROOT;

const local = JSON.parse(fs.readFileSync(path.join(ROOT, 'pipeline/config.local.json'), 'utf8'));
const key = local.voice?.dashscope?.key || process.env.DASHSCOPE_API_KEY || '';
if (!key) { console.log('NO KEY'); process.exit(1); }

async function probe(tag, url, body) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    const txt = await r.text();
    console.log(`[${tag}] HTTP ${r.status} (${Date.now() - t0}ms) x-request-id=${r.headers.get('x-request-id') || '-'}`);
    console.log(`[${tag}] ${txt.slice(0, 600).replace(/\s+/g, ' ')}`);
    return r.status;
  } catch (e) {
    console.log(`[${tag}] ERR ${e.message}`);
    return 0;
  }
}

(async () => {
  const URLS = {
    maas: 'https://maas.qianwenaiapi.com/compatible-mode/v1/images/generations',
    dash: 'https://dashscope.aliyuncs.com/compatible-mode/v1/images/generations',
  };
  // 1) 非法模型辨路径：404=路径不存在；400 提到 model/模型=路径存在
  await probe('maas-坏模型', URLS.maas, { model: '__probe__', prompt: 'x', size: '1024x1024', n: 1 });
  await probe('dash-坏模型', URLS.dash, { model: '__probe__', prompt: 'x', size: '1024x1024', n: 1 });
  // 2) 真模型 + 非法尺寸：400 提到 size/面积 = 路径+模型都过验证（仍不生成）
  await probe('maas-turbo-坏尺寸', URLS.maas, { model: 'qwen-image-2.1-turbo', prompt: 'x', size: '10x10', n: 1 });
  await probe('maas-3.0-坏尺寸', URLS.maas, { model: 'qwen-image-3.0', prompt: 'x', size: '10x10', n: 1 });
  await probe('maas-2.1pro-坏尺寸', URLS.maas, { model: 'qwen-image-2.1-pro', prompt: 'x', size: '10x10', n: 1 });
})();
