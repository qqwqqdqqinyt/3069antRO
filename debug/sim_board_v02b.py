# -*- coding: utf-8 -*-
"""
星序防线 — 校准器 v0.2b（补充实验）
Q1: 4x4 vs 5x5 —— 经典角落流在 5x5 是否失效？
Q2: CV / 充能 归一化后能否跨档位恒定？
Q3: 技术差距的真实倍率是多少？
"""

import random
import math
from collections import Counter

TIERS = [
    ("T1 关1-2", [2, 4], [90, 10]),
    ("T2 关3-4", [4, 8], [80, 20]),
    ("T3 关5-6", [8, 16], [80, 20]),
    ("T4 关7-9", [16, 32], [85, 15]),
    ("T5 关10+", [32, 64], [85, 15]),
]

def make_env(N):
    def empties(b):
        return [(r, c) for r in range(N) for c in range(N) if b[r][c] == 0]

    def spawn(b, rng, pv, pw):
        e = empties(b)
        if e:
            r, c = rng.choice(e)
            b[r][c] = rng.choices(pv, weights=pw)[0]

    def compress(line):
        vals = [x for x in line if x]
        out, merged = [], []
        i = 0
        while i < len(vals):
            if i + 1 < len(vals) and vals[i] == vals[i + 1]:
                out.append(vals[i] * 2); merged.append(vals[i] * 2); i += 2
            else:
                out.append(vals[i]); i += 1
        out += [0] * (len(line) - len(out))
        return out, merged

    def apply_move(b, d):
        nb = [[0] * N for _ in range(N)]
        allm = []
        for i in range(N):
            if d == 0:   line = [b[i][j] for j in range(N)]
            elif d == 1: line = [b[i][j] for j in range(N - 1, -1, -1)]
            elif d == 2: line = [b[j][i] for j in range(N)]
            else:        line = [b[j][i] for j in range(N - 1, -1, -1)]
            out, merged = compress(line)
            allm += merged
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
        empty = len(empties(b))
        mx = max(max(r) for r in b)
        cb = 4 if max(b[0][0], b[0][-1], b[-1][0], b[-1][-1]) == mx else 0
        mono = 0
        for r in range(N):
            for c in range(N - 1):
                if b[r][c] and b[r][c + 1]:
                    mono += 1 if b[r][c] >= b[r][c + 1] else -1
        for c in range(N):
            for r in range(N - 1):
                if b[r][c] and b[r + 1][c]:
                    mono += 1 if b[r][c] >= b[r + 1][c] else -1
        return empty * 3.0 + mono * 0.6 + cb

    def pol_random(b, rng):
        vd = valid_dirs(b); return rng.choice(vd) if vd else None

    def pol_corner(b, rng):
        for d in (0, 3, 1, 2):
            if apply_move(b, d)[2]:
                return d
        return None

    def pol_greedy(b, rng):
        best, bs = None, -1e9
        for d in valid_dirs(b):
            nb, _, _ = apply_move(b, d)
            s = score(nb)
            if s > bs: bs, best = s, d
        return best

    def run(pol, pv, pw, moves, init=2):
        rng = random.Random()
        b = [[0] * N for _ in range(N)]
        for _ in range(init): spawn(b, rng, pv, pw)
        merges, dead, nm = [], False, 0
        while nm < moves:
            d = pol(b, rng)
            if d is None: dead = True; break
            b, m, _ = apply_move(b, d)
            nm += 1
            merges += m
            spawn(b, rng, pv, pw)
        return {
            "moves": nm, "merges": merges,
            "merge_rate": len(merges) / max(1, nm),
            "avg_merge": (sum(merges) / len(merges)) if merges else 0,
            "max_tile": max(merges) if merges else 0,
            "dead": dead,
            "occupied": (N * N - len(empties(b))) / (N * N),
        }

    return run, {
        "random": pol_random, "corner": pol_corner, "greedy": pol_greedy,
    }

RUNS = 400
MOVES = 150
WAVE = 30

# ============ Q1: 4x4 vs 5x5 ============
print("=" * 100)
print("Q1  棋盘尺寸验证：经典角落流（玩家肌肉记忆）在不同尺寸下的表现")
print("=" * 100)
print(f"{'尺寸':<8}{'档位':<10}{'策略':<10}{'合成/步':>9}{'平均合成':>10}{'P(256+)':>9}{'P(512+)':>9}{'卡死率':>8}{'盘面占用':>9}")
for N in (4, 5):
    run, POLS = make_env(N)
    for tn, pv, pw in TIERS:
        for pn, pol in POLS.items():
            agg = [run(pol, pv, pw, MOVES) for _ in range(RUNS)]
            mr = sum(a["merge_rate"] for a in agg) / RUNS
            am = sum(a["avg_merge"] for a in agg) / RUNS
            r256 = sum(1 for a in agg if a["max_tile"] >= 256) / RUNS
            r512 = sum(1 for a in agg if a["max_tile"] >= 512) / RUNS
            dd = sum(1 for a in agg if a["dead"]) / RUNS
            oc = sum(a["occupied"] for a in agg) / RUNS
            print(f"{N}x{N:<6}{tn:<10}{pn:<10}{mr:>9.2f}{am:>10.1f}{r256:>9.1%}{r512:>9.1%}{dd:>8.1%}{oc:>9.0%}")

# ============ Q2 + Q3: 归一化 ============
print()
print("=" * 100)
print("Q2  归一化方案验证  CV' = v / E[spawn]   充能' = 4 x log2(v / E[spawn])")
print("    若两列跨档位基本恒定 → 归一化成立，下游经济不会膨胀")
print("=" * 100)
N = 5
run, POLS = make_env(N)
print(f"{'档位':<10}{'策略':<10}{'CV波(原)':>10}{'CV波(归一)':>11}{'小附魔/波(原)':>14}{'小附魔/波(归一)':>15}{'技术倍率':>10}")
TECH = {}
for tn, pv, pw in TIERS:
    E = sum(a * b for a, b in zip(pv, pw)) / 100.0
    base = None
    for pn, pol in POLS.items():
        agg = [run(pol, pv, pw, MOVES) for _ in range(RUNS)]
        tot_cv_raw = 0.0; tot_cv_norm = 0.0; tot_ch_raw = 0.0; tot_ch_norm = 0.0
        for a in agg:
            for v in a["merges"]:
                tot_cv_raw += v
                tot_cv_norm += v / E
                tot_ch_raw += 4 * (math.log2(v) - 1)
                tot_ch_norm += 4 * math.log2(v / E)
        n = RUNS * (MOVES / WAVE)   # 折算成"每波"
        cv_raw = tot_cv_raw / n; cv_nm = tot_cv_norm / n
        ch_raw = tot_ch_raw / n / 100; ch_nm = tot_ch_norm / n / 100
        if base is None:
            base = cv_nm
        print(f"{tn:<10}{pn:<10}{cv_raw:>10.0f}{cv_nm:>11.0f}{ch_raw:>14.2f}{ch_nm:>15.2f}{cv_nm/base:>10.2f}")
        TECH[(tn, pn)] = cv_nm

print()
print("=" * 100)
print("Q3  技术差距的真实倍率（以归一化 CV/波 衡量）")
print("=" * 100)
print(f"{'档位':<10}{'greedy/random':>16}{'greedy/corner':>16}{'random/corner':>16}")
for tn, _, _ in TIERS:
    g = TECH[(tn, "greedy")]; r = TECH[(tn, "random")]; c = TECH[(tn, "corner")]
    print(f"{tn:<10}{g/r:>16.2f}{g/c:>16.2f}{r/c:>16.2f}")
