// web/llm-dashscope.cjs —— DashScope qwen 适配器（OpenAI 兼容端点）
// key 复用 voice.dashscope.key（config.local.json）；「用完即停」额度耗尽时 DashScope 会返回
// 配额/计费类错误码——按 kind='quota' 抛出，上层据此在界面明示并降级规则模式。

const DEFAULT_ENDPOINT = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

// 出错分类：quota=额度/限流/欠费（需通知用户充值或等额度恢复）· nokey=没配 key · network=连不上 · api=其他接口错误
function classify(status, data) {
  const code = (data && data.error && data.error.code) || '';
  const msg = (data && data.error && data.error.message) || `HTTP ${status}`;
  const text = `${code} ${msg}`;
  const quota = /Quota|Balance|Throttling|Insufficient|Limit|欠费|限额|额度|超出/i.test(text);
  return { code, msg, kind: quota ? 'quota' : 'api' };
}

async function llmChat(cfg, messages, expectJson) {
  const l = cfg.llm || {};
  const key = cfg.voice && cfg.voice.dashscope && cfg.voice.dashscope.key;
  if (!key) { const e = new Error('未配置 DashScope key'); e.kind = 'nokey'; throw e; }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Number(l.timeoutMs) || 30000);
  let res;
  try {
    res = await fetch(l.endpoint || DEFAULT_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: l.model || 'qwen-plus',
        messages,
        temperature: 0.2,
        ...(expectJson ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: ctrl.signal,
    });
  } catch (e) {
    const err = new Error(e.name === 'AbortError' ? `超时 ${(l.timeoutMs || 30000) / 1000}s` : `网络失败：${e.message}`);
    err.kind = 'network';
    throw err;
  } finally { clearTimeout(timer); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const c = classify(res.status, data);
    const err = new Error(`${c.code ? c.code + '：' : ''}${c.msg}`);
    err.kind = c.kind;
    throw err;
  }
  const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!text) { const e = new Error('空回复'); e.kind = 'api'; throw e; }
  return text;
}

module.exports = { llmChat };
