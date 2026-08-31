# -*- coding: utf-8 -*-
"""
星序防线 — 校准器 v0.2d（决策实验）
Q6: 生成值分层方案对比 —— 哪一档能保住「技术表达空间」？
判据：高手(random/hybrid) 与 平庸(corner) 在「达成大数字」上的概率倍差。
     倍差被压到 1.3 以下 = 该档位已无技巧可言，退化为挂机。
同时验证：棋盘跨关保留（累计 750 步）时 1024/2048 是否可及。
"""

import random
import math

N = 5

SCHEMES = {
    "A 强分层 v0.1": [([2, 4], [90, 10]), ([4, 8], [80, 20]), ([8, 16], [80, 20]),
                      ([16, 32], [85, 15]), ([32, 64], [85, 15])],
    "B 弱分层":     [([2, 4], [90, 10]), ([2, 4, 8], [70, 20, 10]), ([4, 8], [80, 20]),
                      ([4, 8, 16], [70, 20, 10]), ([8, 16], [80, 20])],
    "C 不分层":     [([2, 4], [90, 10])] * 5,
}

def build(N):
    def empties(b):
        return [(r, c) for r in range(N) for c in range(N) if b[r][c] == 0]
    def spawn(b, rng, pv, pw):
        e = empties(b)
        if e:
            r, c = rng.choice(e); b[r][c] = rng.choices(pv, weights=pw)[0]
    def compress(line):
        vals = [x for x in line if x]; out, mg = [], []; i = 0
        while i < len(vals):
            if i + 1 < len(vals) and vals[i] == vals[i + 1]:
                out.append(vals[i] * 2); mg.append(vals[i] * 2); i += 2
            else:
                out.append(vals[i]); i += 1
        out += [0] * (len(line) - len(out))
        return out, mg
    def apply_move(b, d):
        nb = [[0] * N for _ in range(N)]; allm = []
        for i in range(N):
            if d == 0:   line = [b[i][j] for j in range(N)]
            elif d == 1: line = [b[i][j] for j in range(N - 1, -1, -1)]
            elif d == 2: line = [b[j][i] for j in range(N)]
            else:        line = [b[j][i] for j in range(N - 1, -1, -1)]
            out, mg = compress(line); allm += mg
            for k, v in enumerate(out):
                if d == 0:   nb[i][k] = v
                elif d == 1: nb[i][N - 1 - k] = v
                elif d == 2: nb[k][i] = v
                else:        nb[N - 1 - k][i] = v
        moved = any(nb[i][j] != b[i][j] for i in range(N) for j in range(N))
        return nb, allm, moved
    def valid_dirs(b):
        return [d for d in range(4) if apply_move(b, d)[2]]
    def score(b):
        empty = len(empties(b)); mx = max(max(r) for r in b)
        cb = 4 if max(b[0][0], b[0][-1], b[-1][0], b[-1][-1]) == mx else 0
        mono = 0
        for r in range(N):
            for c in range(N - 1):
                if b[r][c] and b[r][c + 1]: mono += 1 if b[r][c] >= b[r][c + 1] else -1
        for c in range(N):
            for r in range(N - 1):
                if b[r][c] and b[r + 1][c]: mono += 1 if b[r][c] >= b[r + 1][c] else -1
        return empty * 3.0 + mono * 0.6 + cb
    def pol_random(b, rng):
        vd = valid_dirs(b); return rng.choice(vd) if vd else None
    def pol_corner(b, rng):
        for d in (0, 3, 1, 2):
            if apply_move(b, d)[2]: return d
        return None
    def pol_greedy(b, rng):
        best, bs = None, -1e9
        for d in valid_dirs(b):
            nb, _, _ = apply_move(b, d); s = score(nb)
            if s > bs: bs, best = s, d
        return best
    def pol_hybrid(b, rng):
        """熟练玩家：合并数优先 + 盘面整洁次之"""
        best, bs = None, -1e9
        for d in valid_dirs(b):
            nb, mg, _ = apply_move(b, d)
            s = len(mg) * 2.0 + score(nb) * 0.5
            if s > bs: bs, best = s, d
        return best
    def run(pol, pv, pw, moves, board=None):
        rng = random.Random()
        b = [row[:] for row in board] if board else [[0] * N for _ in range(N)]
        if board is None:
            for _ in range(2): spawn(b, rng, pv, pw)
        merges = []; nm = 0; dead = False
        while nm < moves:
            d = pol(b, rng)
            if d is None: dead = True; break
            b, mg, _ = apply_move(b, d); nm += 1
            merges += mg
            spawn(b, rng, pv, pw)
        return {"b": b, "merges": merges, "max": max(merges) if merges else 0,
                "board_max": max(max(r) for r in b), "dead": dead,
                "occ": (N * N - len(empties(b))) / (N * N)}
    return run, {"random": pol_random, "corner": pol_corner,
                 "greedy": pol_greedy, "hybrid": pol_hybrid}

RUNS = 300
MOVES = 150
run, POLS = build(N)

print("=" * 108)
print("Q6  生成值分层方案对比 —— 大数字达成率（技术表达空间的代理指标）")
print(f"    每档 {RUNS} 局 / {MOVES} 步（单关预算）  棋盘 {N}x{N}")
print("=" * 108)
print(f"{'方案':<14}{'档位':<8}{'E[生成]':>8}{'策略':<9}{'P(128+)':>9}{'P(256+)':>9}{'P(512+)':>9}"
      f"{'P(1024+)':>9}{'盘面占用':>9}{'卡死率':>8}")

SUMMARY = {}
for sname, tiers in SCHEMES.items():
    for ti, (pv, pw) in enumerate(tiers):
        E = sum(a * b for a, b in zip(pv, pw)) / 100.0
        for pn, pol in POLS.items():
            agg = [run(pol, pv, pw, MOVES) for _ in range(RUNS)]
            p128 = sum(1 for a in agg if a["max"] >= 128) / RUNS
            p256 = sum(1 for a in agg if a["max"] >= 256) / RUNS
            p512 = sum(1 for a in agg if a["max"] >= 512) / RUNS
            p1024 = sum(1 for a in agg if a["max"] >= 1024) / RUNS
            occ = sum(a["occ"] for a in agg) / RUNS
            dd = sum(1 for a in agg if a["dead"]) / RUNS
            SUMMARY[(sname, ti, pn)] = (p128, p256, p512, p1024)
            print(f"{sname:<14}{'T'+str(ti+1):<8}{E:>8.2f}{pn:<9}{p128:>9.1%}{p256:>9.1%}"
                  f"{p512:>9.1%}{p1024:>9.1%}{occ:>9.0%}{dd:>8.1%}")
    print("-" * 108)

print()
print("=" * 108)
print("技术倍差（hybrid ÷ corner）—— 越接近 1.0 表示该档位技巧已失效")
print("=" * 108)
print(f"{'方案':<14}{'档位':<8}{'P(256) 倍差':>14}{'P(512) 倍差':>14}{'P(1024) 倍差':>15}")
for sname, tiers in SCHEMES.items():
    for ti in range(len(tiers)):
        h = SUMMARY[(sname, ti, "hybrid")]; c = SUMMARY[(sname, ti, "corner")]
        def ratio(a, b):
            return a / b if b > 0.005 else float('inf')
        f = lambda x: ("∞" if x == float('inf') else f"{x:.1f}")
        print(f"{sname:<14}{'T'+str(ti+1):<8}{f(ratio(h[1], c[1])):>14}"
              f"{f(ratio(h[2], c[2])):>14}{f(ratio(h[3], c[3])):>15}")

print()
print("=" * 108)
print("Q7  棋盘跨关保留（一局 5 关 = 750 步，不重置）—— 验证 2048 主题可及性")
print("=" * 108)
print(f"{'方案':<14}{'策略':<9}{'P(512+)':>10}{'P(1024+)':>10}{'P(2048+)':>10}{'P(4096+)':>10}{'末盘占用':>10}")
for sname in ("B 弱分层", "C 不分层"):
    tiers = SCHEMES[sname]
    for pn, pol in POLS.items():
        res = []
        for _ in range(RUNS):
            rng_state_board = None
            maxv = 0; board = None; occ = 0
            for ti in range(5):
                pv, pw = tiers[ti]
                r = run(pol, pv, pw, MOVES, board=board)
                board = r["b"]
                maxv = max(maxv, r["max"], r["board_max"])
                occ = r["occ"]
            res.append((maxv, occ))
        p512 = sum(1 for m, _ in res if m >= 512) / RUNS
        p1024 = sum(1 for m, _ in res if m >= 1024) / RUNS
        p2048 = sum(1 for m, _ in res if m >= 2048) / RUNS
        p4096 = sum(1 for m, _ in res if m >= 4096) / RUNS
        oc = sum(o for _, o in res) / RUNS
        print(f"{sname:<14}{pn:<9}{p512:>10.1%}{p1024:>10.1%}{p2048:>10.1%}{p4096:>10.1%}{oc:>10.0%}")
