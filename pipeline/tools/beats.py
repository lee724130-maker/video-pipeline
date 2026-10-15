# 节拍检测：BGM → 节拍网格，供 02 吸附镜头边界（卡点）
# 用法: py beats.py <bgm文件>   → stdout 打一行  JSON:{...}
# 算法: 10ms 能量包络 → 对数能量正通量做 onset → 自相关估 BPM → 相位搜索定网格 → 逐拍邻域寻峰
import subprocess, sys, json, math

FFMPEG = 'D:/ffmpeg/bin/ffmpeg.exe'
SR = 8000
FRAME = 80          # 10ms @ 8kHz → 100 帧/秒
MIN_PERIOD, MAX_PERIOD = 28, 200   # 0.28s ~ 2.0s（30~214 BPM）


def read_pcm(path):
    import struct
    r = subprocess.run([FFMPEG, '-i', path, '-ac', '1', '-ar', str(SR), '-f', 's16le', '-'],
                       stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=True)
    n = len(r.stdout) // 2
    return struct.unpack(f'<{n}h', r.stdout[: n * 2])


def envelope(x):
    nf = len(x) // FRAME
    out = []
    for i in range(nf):
        fr = x[i * FRAME:(i + 1) * FRAME]
        out.append(math.sqrt(sum(s * s for s in fr) / FRAME) / 32768.0)
    return out


def onsets(env):
    # 对数能量的正通量（鼓点 = 能量跳变）
    lg = [math.log(v + 1e-5) for v in env]
    o = [0.0]
    for i in range(1, len(lg)):
        o.append(max(0.0, lg[i] - lg[i - 1]))
    # 3 帧滑动平均压毛刺
    sm = []
    for i in range(len(o)):
        a, b = max(0, i - 1), min(len(o), i + 2)
        sm.append(sum(o[a:b]) / (b - a))
    return sm


def estimate_period(o):
    n = len(o)
    mean = sum(o) / n
    dev = [v - mean for v in o]
    e0 = sum(v * v for v in dev)
    if e0 <= 1e-9:
        return None
    best, best_r = 0, 0.0
    for lag in range(MIN_PERIOD, min(MAX_PERIOD, n // 2)):
        e1 = sum(dev[i] * dev[i] for i in range(n - lag))
        if e1 <= 1e-12:
            continue
        r = sum(dev[i] * dev[i + lag] for i in range(n - lag)) / math.sqrt(e0 * e1)
        if r > best_r:
            best_r, best = r, lag
    if not best or best_r < 0.15:  # 相关度太低 = 无明显节奏（如语音/环境声），别硬凑网格
        return None
    period = best
    # 折到 70~180 BPM 常用区间（自相关常选到半拍/双拍）；period 单位=帧(100fps)，BPM=6000/period
    bpm = 6000.0 / period
    while bpm < 70 and period >= MIN_PERIOD * 2:
        period //= 2
        bpm = 6000.0 / period
    while bpm > 180 and period * 2 <= MAX_PERIOD:
        period *= 2
        bpm = 6000.0 / period
    return period, best_r


def find_phase(o, period):
    best_off, best_s = 0, -1.0
    for off in range(period):
        s = sum(o[i] for i in range(off, len(o), period))
        if s > best_s:
            best_s, best_off = s, off
    return best_off


def refine(o, center, win=3):
    lo, hi = max(0, center - win), min(len(o), center + win + 1)
    bi = max(range(lo, hi), key=lambda i: o[i])
    return bi


def main():
    if len(sys.argv) < 2:
        print('用法: py beats.py <bgm文件>', file=sys.stderr)
        sys.exit(2)
    pcm = read_pcm(sys.argv[1])
    env = envelope(pcm)
    if len(env) < MIN_PERIOD * 3:
        print('JSON:{"bpm":0,"beats":[]}')
        return
    o = onsets(env)
    est = estimate_period(o)
    if not est:
        print('JSON:{"bpm":0,"beats":[]}')
        return
    period, corr = est
    phase = find_phase(o, period)
    beats = []
    t = phase
    while t < len(o):
        if t >= period // 2:  # 起拍前半拍内的一律并入，避免 0 时刻假拍
            beats.append(round(refine(o, t) / 100.0, 3))
        t += period
    # 去重（邻域寻峰后可能撞车）
    uniq = []
    for b in beats:
        if not uniq or b - uniq[-1] > period / 100.0 * 0.6:
            uniq.append(b)
    print('JSON:' + json.dumps({
        'bpm': round(6000.0 / period, 1),
        'corr': round(corr, 3),
        'count': len(uniq),
        'beats': uniq,
    }))


if __name__ == '__main__':
    main()
