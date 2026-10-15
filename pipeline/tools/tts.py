#!/usr/bin/env python
# edge-tts 封装：生成配音 mp3 + 逐词时间戳 json
# 用法: python tts.py <文本文件> <voice> <rate> <out.mp3> <out.json>
import asyncio, json, sys
import edge_tts

def main():
    text_path, voice, rate, out_mp3, out_json = sys.argv[1:6]
    text = open(text_path, encoding="utf-8").read().strip()

    async def run():
        com = edge_tts.Communicate(text, voice, rate=rate)
        words = []
        with open(out_mp3, "wb") as f:
            async for chunk in com.stream():
                if chunk["type"] == "audio":
                    f.write(chunk["data"])
                elif chunk["type"] == "WordBoundary":
                    start = chunk["offset"] / 1e7
                    dur = chunk["duration"] / 1e7
                    words.append({
                        "text": chunk["text"],
                        "start": round(start, 3),
                        "end": round(start + dur, 3),
                    })
        return words

    words = asyncio.run(run())
    json.dump({"voice": voice, "rate": rate, "text": text, "words": words},
              open(out_json, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("TTS_OK %d words" % len(words))

if __name__ == "__main__":
    main()
