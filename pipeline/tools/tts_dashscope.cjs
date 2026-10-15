// 阿里云百炼 qwen-audio-3.1-tts-next（非实时 SpeechSynthesizer）
// 用法: node tools/tts_dashscope.cjs <narration.txt> <out.mp3> <api-key> [model] [voice] [rate]
// 关键: 端点 /api/v1/services/audio/tts/SpeechSynthesizer；tts-next 的文本字段是 text_prompt（不是 text）
// rate: 模型原生语速（0.5~2.0），比 ffmpeg atempo 时间拉伸音质好；rate 生效时 stdout 打 native_rate=<x>
//       （01 据此决定是否还需要补 atempo 兜底）。rate 被拒会自动去掉重试一次。
const fs = require('fs');

const API = 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer';

function die(msg) { console.error('[dashscope] ' + msg); process.exit(1); }

async function synthOnce({ key, model, voice, text, rate }) {
  const input = { format: 'mp3', sample_rate: 24000 };
  if (voice) input.voice = voice;
  // tts-next 用 text_prompt；其余模型用 text
  if (/tts-next/.test(model)) input.text_prompt = text; else input.text = text;
  if (rate) input.rate = rate;

  const r = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({ model, input }),
  });
  const j = await r.json().catch(() => ({}));
  const a = j.output && j.output.audio;
  if (!r.ok || !a || !a.url) {
    const m = (j && j.message) || JSON.stringify(j).slice(0, 200);
    const err = new Error(`HTTP ${r.status} ${m}`);
    err.status = r.status;
    throw err;
  }
  return a;
}

(async () => {
  const [txtFile, out, key, model = 'qwen-audio-3.1-tts-next', voice = '', rateArg = ''] = process.argv.slice(2);
  if (!txtFile || !out || !key) die('参数不足');
  const text = fs.readFileSync(txtFile, 'utf8').trim().replace(/\s+/g, ' ');
  if (!text) die('口播稿为空');
  let rate = Number(rateArg);
  if (!(rate > 0) || Math.abs(rate - 1) <= 0.01) rate = 0; // 0 = 不传原生语速

  const trySynth = async (withRate) => {
    for (let i = 0; i < 2; i++) {
      try { return await synthOnce({ key, model, voice, text, rate: withRate ? rate : 0 }); }
      catch (e) {
        if (!withRate || e.status !== 400) console.error(`[dashscope] 第${i + 1}次${withRate ? '带 rate' : ''}失败: ${e.message.slice(0, 160)}`);
        if (!withRate) { if (i === 1) throw e; continue; }
        await new Promise((r) => setTimeout(r, 1200));
      }
    }
    return null;
  };

  // 网络抖动重试 2 次；带 rate 失败则去掉 rate 重来（01 会退回 atempo 兜底）
  let audio = null, rateUsed = false, lastErr = null;
  if (rate) {
    try {
      audio = await trySynth(true);
      if (audio) rateUsed = true;
    } catch (e) { lastErr = e.message; console.error('[dashscope] ' + lastErr.slice(0, 160) + ' → 去掉 rate 重试'); }
  }
  if (!audio) {
    try { audio = await trySynth(false); }
    catch (e) { lastErr = e.message; }
  }
  if (!audio) die('合成失败: ' + lastErr);

  const dl = await fetch(audio.url);
  if (!dl.ok) die(`下载失败 HTTP ${dl.status}`);
  const buf = Buffer.from(await dl.arrayBuffer());
  if (buf.length < 1000) die(`音频过小 ${buf.length}B`);
  fs.writeFileSync(out, buf);
  console.log(`[dashscope] ${model} · 声明时长 ${audio.duration}s · ${buf.length}B -> ${out}`);
  if (rateUsed) console.log(`[dashscope] native_rate=${rate}（原生语速生效，无需 atempo）`);
})();
