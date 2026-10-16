// 01 · 配音：shots.json 口播稿 → voice.mp3（+ 可选逐词时间戳）
const fs = require('fs');
const path = require('path');
const { ROOT, FFMPEG, run, durationOf, durationDecoded, ensureDir, readJson, writeJson, log, warn, fail, loadConfig } = require('./lib/common.cjs');

const cfg = loadConfig();

function buildNarration(shots) {
  // 每镜口播按顺序拼成整条配音文本；镜头边界由 02 用时间戳反推
  return shots.map((s) => (s.narration || '').trim().replace(/\s+/g, ' ')).join('');
}

function main() {
  const taskDir = process.argv[2];
  if (!taskDir) fail('用法: node pipeline/01-tts.cjs <任务目录>');
  const task = path.resolve(taskDir);
  const shots = readJson(path.join(task, 'shots.json'));
  if (!shots || !Array.isArray(shots.shots) || !shots.shots.length) fail('缺 shots.json 或 shots 为空');

  const voiceCfg = cfg.voice || {};
  // --provider <名字> 可强制指定配音通道（测试/调试用），优先级高于 config
  const pi = process.argv.indexOf('--provider');
  let provider = (pi > -1 && process.argv[pi + 1]) || voiceCfg.provider || 'auto';
  // 语速按 provider 分别配：dashscope 原速 ≈6-8 字/秒（gTTS ≈3.1），共用一个 tempo 会快一倍
  const tempoOf = (p) => {
    const c = voiceCfg[p] || {};
    return Number(c.tempo !== undefined ? c.tempo : (voiceCfg.tempo || 1));
  };
  const narration = buildNarration(shots.shots);
  if (!narration) fail('shots.json 里 narration 全为空');
  fs.writeFileSync(path.join(task, 'narration.txt'), narration, 'utf8');
  log('01', `口播稿 ${narration.length} 字`);

  ensureDir(path.join(task, 'audio'));
  const mp3 = path.join(task, 'audio', 'voice.mp3');
  const words = path.join(task, 'audio', 'words.json');
  [mp3, words].forEach((f) => fs.existsSync(f) && fs.unlinkSync(f));

  // sapi = Windows 自带语音离线兜底（断网/无额度也能出配音），排在所有联网通道之后
  const attempts = provider === 'gtts' ? ['gtts']
    : provider === 'edge' ? ['edge']
    : provider === 'sapi' ? ['sapi']
    : provider === 'dashscope' ? ['dashscope', 'gtts', 'sapi']
    : ['dashscope', 'edge', 'gtts', 'sapi'];
  let used = null;
  let dashNativeRate = false; // dashscope 是否走成了模型原生语速（免 atempo）
  let dashVoice = '';         // 实际使用的 dashscope 音色（shots.voice 覆盖后写进 meta）
  // 原生语速开关：config 里 voice.dashscope.nativeRate > 0 才走模型原生 rate（推荐 0.5，
  // 实测 0.62/0.75 减速不足、0.45 会崩）；不配则维持旧行为 = 纯 atempo 用 tempo。
  const dashNative = Number((voiceCfg.dashscope || {}).nativeRate || 0);
  const dashRate = dashNative > 0 && Math.abs(dashNative - 1) > 0.01 ? dashNative : 0;

  for (const p of attempts) {
    let r;
    if (p === 'edge') {
      const e = voiceCfg.edge || {};
      r = run('py', [
        path.join(__dirname, 'tools/tts.py'), path.join(task, 'narration.txt'),
        e.name || 'zh-CN-YunxiNeural', e.rate || '+8%', mp3, words,
      ], { env: { ...process.env, HTTPS_PROXY: cfg.proxy, HTTP_PROXY: cfg.proxy } });
    } else if (p === 'dashscope') {
      const d = voiceCfg.dashscope || {};
      const key = d.key || process.env.DASHSCOPE_API_KEY || '';
      if (!key) { warn('01', 'dashscope 未配置 key，跳过'); continue; }
      // 音色优先级：shots.json.voice（按任务/按视频指定）> config.voice.dashscope.voice
      // ⚠️ 只有 qwen-audio-3.1-tts-flash 严格校验 voice；next 模型会忽略该参数
      const voiceName = String(shots.voice || d.voice || '');
      dashVoice = voiceName;
      r = run(process.execPath, [
        path.join(__dirname, 'tools/tts_dashscope.cjs'), path.join(task, 'narration.txt'),
        mp3, key, d.model || 'qwen-audio-3.1-tts-next', voiceName,
        String(dashRate),
      ]);
      if (r.ok) dashNativeRate = dashRate > 0 && /native_rate=/.test(r.out);
    } else if (p === 'sapi') {
      // SAPI：Windows 自带 TTS（离线），先出 wav 再用 ffmpeg 转 mp3
      const sv = voiceCfg.sapi || {};
      const wav = mp3 + '.sapi.wav';
      const sr = run('powershell', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'tools/tts_sapi.ps1'),
        '-TextFile', path.join(task, 'narration.txt'), '-WavPath', wav,
        '-Rate', String(Number(sv.rate !== undefined ? sv.rate : 2)),
        ...(sv.voice ? ['-Voice', String(sv.voice)] : []),
      ]);
      if (sr.ok && fs.existsSync(wav)) {
        const cv = run(FFMPEG, ['-y', '-i', wav, '-codec:a', 'libmp3lame', '-q:a', '2', mp3]);
        r = { ok: cv.ok && fs.existsSync(mp3), out: sr.out + '\n' + cv.out };
      } else {
        r = sr;
      }
      fs.existsSync(wav) && fs.unlinkSync(wav);
    } else {
      const g = voiceCfg.gtts || {};
      r = run('py', [
        path.join(__dirname, 'tools/tts_gtts.py'), path.join(task, 'narration.txt'),
        g.lang || 'zh-CN', mp3, cfg.proxy || '',
      ]);
    }
    if (r.ok && fs.existsSync(mp3) && fs.statSync(mp3).size > 1000) { used = p; break; }
    warn('01', `${p} 失败，降级下一个：${r.out.split('\n').filter(Boolean).slice(-1)[0]}`);
    fs.existsSync(mp3) && fs.unlinkSync(mp3);
    fs.existsSync(words) && fs.unlinkSync(words);
  }

  if (!used) fail('配音失败（dashscope / edge-tts / gTTS 都不可用）——检查网络、代理 ' + cfg.proxy + ' 或 key');

  // 语速统一：在时间轴计算之前变速，后续所有对齐基于变速后的音频
  const tempo = tempoOf(used);
  const applyAtempo = (factor, why) => {
    const raw = mp3 + '.raw.mp3';
    fs.renameSync(mp3, raw);
    const r = run(FFMPEG, [
      '-y', '-i', raw, '-filter:a', `atempo=${factor}`, '-codec:a', 'libmp3lame', '-q:a', '2', mp3,
    ]);
    fs.unlinkSync(raw);
    if (!r.ok || !fs.existsSync(mp3)) fail('语速调整失败');
    log('01', `语速 ×${factor.toFixed(3)}（${why}）`);
  };

  // 目标字/秒残差校正：把节奏钉在 target 上（demo 稿 4.73 字/秒 = 378字/79.9s）
  // 安全带：短稿句子停顿占比大、自然字/秒本来就低，偏差 >30% 判为内容结构差异，不硬拉。
  const residualCorrect = (target) => {
    const want = narration.length / target;
    const residual = durationDecoded(mp3) / want;
    if (residual > 1.3 || residual < 0.7) {
      log('01', `偏差 ${((residual - 1) * 100).toFixed(0)}% 超安全带（短稿停顿结构差异），跳过校正`);
    } else if (residual > 1.03 || residual < 0.97) {
      applyAtempo(Math.min(1.35, Math.max(0.75, residual)), `目标 ${target} 字/秒残差校正`);
    } else {
      log('01', `已在目标 ${target} 字/秒 的 ±3% 内，免校正`);
    }
  };

  if (used === 'dashscope' && dashNativeRate) {
    // 模型已按原生 rate 出稿（语速由模型自己读稿，音质优于时间拉伸）
    log('01', `语速 ×${dashRate}（模型原生 rate，无时间拉伸）`);
    const target = Number((voiceCfg.dashscope || {}).targetCharsPerSec || 0);
    if (target > 0) residualCorrect(target);
  } else if (tempo > 0 && Math.abs(tempo - 1) > 0.01) {
    applyAtempo(tempo, 'atempo');
    // SAPI 兜底同样按目标字/秒做残差微调（与主路同参数同安全带）
    if (used === 'sapi') {
      const target = Number((voiceCfg.sapi || {}).targetCharsPerSec || 0);
      if (target > 0) residualCorrect(target);
    }
  }

  const dur = durationDecoded(mp3);
  if (!(dur > 1)) fail('配音时长异常');
  writeJson(path.join(task, 'audio/meta.json'), {
    provider: used,
    duration: Number(dur.toFixed(3)),
    chars: narration.length,
    charsPerSec: Number((narration.length / dur).toFixed(2)),
    nativeRate: used === 'dashscope' && dashNativeRate ? dashRate : 0,
    voice: used === 'edge' ? (cfg.voice.edge || {})
      : used === 'dashscope' ? { ...(cfg.voice.dashscope || {}), voice: dashVoice }
      : used === 'sapi' ? (cfg.voice.sapi || {})
      : (cfg.voice.gtts || {}),
    hasWordTiming: fs.existsSync(words),
    at: new Date().toISOString(),
  });
  log('01', `配音 OK：${used} · ${dur.toFixed(1)}s · ${(narration.length / dur).toFixed(1)} 字/秒${fs.existsSync(words) ? ' · 逐词时间戳' : ' · 逐词时间戳无（02 用静音对齐兜底）'}`);
}

main();
