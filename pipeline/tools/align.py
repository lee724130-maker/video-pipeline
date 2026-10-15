# 口播逐词对齐：voice.mp3 → audio/words.json（喂给 02 的 line 路径）
# 用法: py align.py <voice.mp3> <words.json>
# 输出: {"engine":"whisper-small","words":[{"text","start","end"}]}
# 环境与坑同 lyrics.py（.py312 + ct2 4.5.0 + av 补丁），import 直接复用。
import sys, json, os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lyrics import ensure_model, decode_wav16  # noqa: E402  （import 时已打 av.open 补丁）


def main():
    if len(sys.argv) < 3:
        raise SystemExit('用法: py align.py <voice.mp3> <words.json>')
    mp3, out = sys.argv[1], sys.argv[2]

    from faster_whisper import WhisperModel
    model = WhisperModel(ensure_model('small'), device='cpu', compute_type='int8')
    wav = decode_wav16(mp3, tag='_align')

    # 注意：勿喂 initial_prompt——实测会让模型跳过首句（把文案当已说过的上下文）；
    # 数字等归一化差异由 02 的 normChar 兜底。干净 TTS 语音 small 模型词级时间戳足够准。
    segments, info = model.transcribe(
        wav, language='zh', word_timestamps=True, vad_filter=False,
        condition_on_previous_text=False, beam_size=5,
    )
    words = []
    for s in segments:
        for w in (s.words or []):
            # 剥掉 whisper 词内标点（02 侧只认文字，标点时间自然摊给保留的字）
            t = ''.join(ch for ch in str(w.word)
                        if '一' <= ch <= '鿿' or '㐀' <= ch <= '䶿'
                        or ch.isascii() and ch.isalnum())
            if t:
                words.append({'text': t, 'start': round(w.start, 3), 'end': round(w.end, 3)})
    if not words:
        raise SystemExit('对齐结果为空')
    json.dump({'engine': f'whisper-{info.language}', 'words': words},
              open(out, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    print(f'WORDS_OK:{len(words)} 语言={info.language} p={info.language_probability:.2f}')


if __name__ == '__main__':
    main()
