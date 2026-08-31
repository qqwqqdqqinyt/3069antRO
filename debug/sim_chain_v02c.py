# -*- coding: utf-8 -*-
"""
星序防线 — 校准器 v0.2c
Q4: 连锁（一次移动内多重合并）分布 —— 技术回报能从哪里找回来？
核心发现前提：MERGE_RATE ≈ 0.90 是 2048 的结构性常数，几乎不随技术变化。
因此技巧必须表达在"连锁长度"上，而非合成频率。
"""

import random
import math

N = 5
MOVES = 150

TIERS = [
    ("T1 关1-2", [2, 4], [90, 10]),
    ("T2 关3-4", [4, 8], [80, 20]),
    ("T3 关5-6", [8, 16], [80, 20]),
    ("T4 关7-9", [16, 32], [85, 15]),
    ("T5 关10+", [32, 64], [85, 15]),
]

def empties(b):
    return [(r, c) for r in range(N) for c in range(N) if b[r][c] == 0]

def spawn(b, rng, pv, pw):
    e = empties(b)
    if e:
        r, c = rng.choice(e); b[r][c] = rng.choices(pv, weights=pw)[0]

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
        nb, _, _ = apply_move(b, d)
        s = score(nb)
        if s > bs: bs, best = s, d
    return best

POLS = {"random": pol_random, "corner": pol_corner, "greedy": pol_greedy}
RUNS = 400

def run(pol, pv, pw):
    rng = random.Random()
    b = [[0] * N for _ in range(N)]
    for _ in range(2): spawn(b, rng, pv, pw)
    chains = []
    nm = 0
    while nm < MOVES:
        d = pol(b, rng)
        if d is None: break
        b, m, _ = apply_move(b, d)
        nm += 1
        if m: chains.append(len(m))
        spawn(b, rng, pv, pw)
    return chains

def chain_mult(n, k):
    """连锁倍率：一次移动中第 i 次合并的 CV/充能 × (1 + k*(i-1))，返回该次移动的总倍率"""
    return sum(1 + k * i for i in range(n))

print("=" * 96)
print("Q4  连锁长度分布（仅统计有合成的移动）")
print("=" * 96)
print(f"{'档位':<10}{'策略':<10}{'1连':>8}{'2连':>8}{'3连':>8}{'4连+':>8}{'平均连锁':>10}{'3连+占比':>10}")
for tn, pv, pw in TIERS:
    for pn, pol in POLS.items():
        allc = []
        for _ in range(RUNS):
            allc += run(pol, pv, pw)
        t = len(allc)
        d1 = sum(1 for c in allc if c == 1) / t
        d2 = sum(1 for c in allc if c == 2) / t
        d3 = sum(1 for c in allc if c == 3) / t
        d4 = sum(1 for c in allc if c >= 4) / t
        avg = sum(allc) / t
        print(f"{tn:<10}{pn:<10}{d1:>8.1%}{d2:>8.1%}{d3:>8.1%}{d4:>8.1%}{avg:>10.2f}{d3+d4:>10.1%}")

print()
print("=" * 96)
print("Q5  连锁倍率带来的技术回报（相对 corner 基准）")
print("    方案：第 i 次合并 × (1 + k×(i-1))，k 为连锁系数")
print("=" * 96)
print(f"{'档位':<10}{'k':>6}{'random':>10}{'corner':>10}{'greedy':>10}{'greedy/corner':>15}{'greedy/random':>15}")
for tn, pv, pw in TIERS:
    res = {}
    for pn, pol in POLS.items():
        allc = []
        for _ in range(RUNS):
            allc += run(pol, pv, pw)
        res[pn] = allc
    for k in (0.00, 0.25, 0.35, 0.50):
        vals = {pn: sum(chain_mult(c, k) for c in cs) for pn, cs in res.items()}
        print(f"{tn:<10}{k:>6.2f}{vals['random']:>10}{vals['corner']:>10.0f}{vals['greedy']:>10}"
              f"{vals['greedy']/vals['corner']:>15.2f}{vals['greedy']/vals['random']:>15.2f}")
    print("-" * 96)
