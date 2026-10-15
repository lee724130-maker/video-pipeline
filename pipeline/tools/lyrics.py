# 歌词对齐：歌曲 → 逐句/逐词时间戳（KTV 字幕用）
# 用法: py lyrics.py <歌曲> <out.json> [--model small|medium|tiny]
# 输出: {"segments":[{"start","end","text","words":[{"start","end","word"}]}]}
#
# 环境备注（都踩过坑，勿删）：
# - faster-whisper 只跑在项目内 .py312（Python 3.12.9）上，系统 py=3.14 + ctranslate2 会段错误
# - ctranslate2 必须 4.5.0（4.8.3 在本机加载模型 access violation）；av 必须 19 + 本文件的 open 补丁
# - 模型文件用 curl 从 hf-mirror 下到 cache/whisper/<name>/，不走 huggingface_hub（xet 传输会写入截断文件；
#   镜像偶发返回 200+限流文本页，下载后必须校验内容）
import subprocess, sys, json, os, shutil

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
WHISPER_DIR = os.path.join(ROOT, 'cache', 'whisper')
MIRROR = 'https://hf-mirror.com/Systran'
MODEL_FILES = ['model.bin', 'config.json', 'tokenizer.json', 'vocabulary.txt']


def _detect_ffmpeg():
    # config.json 的 ffmpeg（目录或 exe）→ PATH → 常见手动安装位；与 common.cjs 同策略
    exe = 'ffmpeg.exe' if os.name == 'nt' else 'ffmpeg'
    cands = []
    try:
        c = json.load(open(os.path.join(ROOT, 'pipeline', 'config.json'), encoding='utf8'))
        if c.get('ffmpeg'):
            cands += [os.path.join(c['ffmpeg'], exe), c['ffmpeg'] if c['ffmpeg'].endswith(exe) else '']
    except Exception:
        pass
    cands += [shutil.which('ffmpeg') or '', os.path.join('D:/ffmpeg/bin', exe)]
    for p in cands:
        if p and os.path.exists(p):
            return p
    return exe


FFMPEG = _detect_ffmpeg()

# av.open 在 av 19 移除了 metadata_errors 参数，faster-whisper 1.2.1 还在传 → 打补丁
import av
_orig_av_open = av.open


def _av_open(*a, **kw):
    kw.pop('metadata_errors', None)
    return _orig_av_open(*a, **kw)


av.open = _av_open


def decode_wav16(src, tag='_lyrics_in'):
    dst = os.path.join(os.environ.get('TEMP', '.'), tag + '.wav')
    r = subprocess.run([FFMPEG, '-y', '-i', src, '-ac', '1', '-ar', '16000', dst],
                       stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    if r.returncode != 0:
        raise SystemExit('ffmpeg 转码失败: ' + r.stderr.decode('utf8', 'ignore')[-300:])
    return dst


def ensure_model(name):
    d = os.path.join(WHISPER_DIR, name)
    os.makedirs(d, exist_ok=True)
    for f in MODEL_FILES:
        p = os.path.join(d, f)
        if os.path.exists(p) and os.path.getsize(p) > 2000:
            head = open(p, 'rb').read(200)
            if b'rate limit' not in head:  # 镜像限流时会返回 200+文本页
                continue
        ok = False
        for attempt in range(4):
            print(f'下载 {name}/{f} 第{attempt + 1}次…', flush=True)
            subprocess.run(['curl.exe', '-sSL', '--retry', '3', '-o', p,
                            f'{MIRROR}/faster-whisper-{name}/resolve/main/{f}'],
                           check=False)
            if os.path.exists(p) and os.path.getsize(p) > 2000:
                head = open(p, 'rb').read(200)
                if b'rate limit' not in head:
                    ok = True
                    break
            import time
            time.sleep(15)  # 镜像限流窗口 5 分钟，退避重试
        if not ok:
            raise SystemExit(f'模型文件下载失败: {name}/{f}（手动下 {MIRROR}/faster-whisper-{name} 放到 {d}）')
    return d


def main():
    if len(sys.argv) < 3:
        raise SystemExit('用法: py lyrics.py <歌曲> <out.json> [--model small]')
    src, out = sys.argv[1], sys.argv[2]
    model_name = 'small'
    if '--model' in sys.argv:
        model_name = sys.argv[sys.argv.index('--model') + 1]

    from faster_whisper import WhisperModel
    model_dir = ensure_model(model_name)
    print(f'加载模型 {model_name}（{model_dir}）…', flush=True)
    model = WhisperModel(model_dir, device='cpu', compute_type='int8')

    wav = decode_wav16(src)
    segments, info = model.transcribe(
        wav, language='zh', word_timestamps=True, vad_filter=False,
        initial_prompt='以下是歌曲的歌词。', condition_on_previous_text=False,
    )
    segs = []
    for s in segments:
        words = [{'start': round(w.start, 3), 'end': round(w.end, 3), 'word': w.word}
                 for w in (s.words or [])]
        segs.append({'start': round(s.start, 3), 'end': round(s.end, 3),
                     'text': s.text.strip(), 'words': words})
        print(f'[{s.start:7.2f} → {s.end:7.2f}] {s.text}', flush=True)

    json.dump({'file': os.path.basename(src), 'lang': info.language,
               'prob': round(info.language_probability, 3), 'segments': segs},
              open(out, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    print(f'JSON_WROTE:{out} segments={len(segs)}')


if __name__ == '__main__':
    main()
