#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""asr.py <wav路径> <输出txt> [模型名 small|medium|tiny] —— 复用本项目 ensure_model 的本地 whisper 缓存。

两个必须遵守的实测约束（都踩过）：
  1. 勿喂 initial_prompt —— 实测会让模型跳过首句（把提示当已说过的上下文）。
  2. vad_filter 必须 False —— silero VAD 模型不在本地缓存里，开启会去按需下载，
     取不到时进程直接段错误（退出码 139），**不抛 Python 异常**，极难归因。
     需要抗 BGM 就靠 condition_on_previous_text=False + beam_size=5，align.py 同款配置。
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'pipeline', 'tools'))
from lyrics import ensure_model  # noqa: E402  （import 时已打 av.open 补丁）

wav, out = sys.argv[1], sys.argv[2]
mname = sys.argv[3] if len(sys.argv) > 3 else 'small'

from faster_whisper import WhisperModel
print(f'[asr] 模型 {mname} ← {wav}', flush=True)
model = WhisperModel(ensure_model(mname), device='cpu', compute_type='int8')
segments, info = model.transcribe(
    wav, language='zh', vad_filter=False, condition_on_previous_text=False, beam_size=5,
)
print(f'[asr] 音频时长 {info.duration:.1f}s', flush=True)


def ts(t):
    m, s = divmod(int(t), 60)
    return f'{m:02d}:{s:02d}'


lines, buf, start, last_end = [], [], None, 0.0
for seg in segments:
    txt = seg.text.strip()
    if not txt:
        continue
    if start is None:
        start = seg.start
    buf.append(txt)
    last_end = seg.end
    if last_end - start > 20 or len(''.join(buf)) > 120:
        lines.append(f'[{ts(start)}-{ts(last_end)}] ' + ''.join(buf))
        buf, start = [], None
if buf:
    lines.append(f'[{ts(start)}-{ts(last_end)}] ' + ''.join(buf))

text = '\n'.join(lines)
with open(out, 'w', encoding='utf-8') as f:
    f.write(text + '\n')
print(f'[asr] 段落 {len(lines)} 条，字符 {len(text)} → {out}', flush=True)
print('----- 前 400 字 -----')
print(text[:400])
