#!/usr/bin/env python
# gTTS 配音封装（免费、无 key，需网络/代理）
# 用法: python tts_gtts.py <文本文件> <lang> <out.mp3> [proxy]
import sys
from gtts import gTTS

def main():
    text_path, lang, out_mp3 = sys.argv[1:4]
    if len(sys.argv) > 4 and sys.argv[4]:
        import os
        os.environ["HTTPS_PROXY"] = sys.argv[4]
        os.environ["HTTP_PROXY"] = sys.argv[4]
    text = open(text_path, encoding="utf-8").read().strip()
    gTTS(text, lang=lang).save(out_mp3)
    print("TTS_OK gtts %d chars" % len(text))

if __name__ == "__main__":
    main()
