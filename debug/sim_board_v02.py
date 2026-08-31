# -*- coding: utf-8 -*-
"""
星序防线 — 2048 棋盘蒙特卡洛校准器 v0.2
目的：校准 v0.1 中两个最大的估算不确定性
  1) MERGE_RATE  每次有效移动的期望合成次数
  2) 平均合成值  进而决定 CV / 充能 / 超载触发频率
附带验证：生成值分层是否合理（256 在关 1 到底可不可及）
用法： python sim_board_v02.py [每档局数]
"""

import random
import math
import sys
from collections import Counter

N = 5
MOVES_PER_LEVEL = 150      # 一关步数预算（约 30 步/波 × 5 波）
MOVES_PER_WAVE = 30

# ---------------- 棋盘基础 ----------------

def new_board():
    return [[0] * N for _ in range(N)]

def empties(b):
    return [(r, c) for r in range(N) for c in range(N) if b[r][c] == 0]

def spawn(b, rng, pool_vals, pool_w):
    e = empties(b)
    if not e:
        return
    r, c = rng.choice(e)
    b[r][c] = rng.choices(pool_vals, weights=pool_w)[0]

def compress(line):
    """标准 2048 单行合并，返回 (新行, 合并产生的方块值列表)"""
    vals = [x for x in line if x]
    out, merged = [], []
    i = 0
    while i < len(vals):
        if i + 1 < len(vals) and vals[i] == vals[i + 1]:
            v = vals[i] * 2
            out.append(v)
            merged.append(v)
            i += 2
        else:
            out.append(vals[i])
            i += 1
    out += [0] * (len(line) - len(out))
    return out, merged

def apply_move(b, d):
    """d: 0=左 1=右 2=上 3=下。返回 (新盘, 合并值列表, 是否变化)"""
    nb = [[0] * N for _ in range(N)]
    merged_all = []
    for i in range(N):
        if d == 0:
            line = [b[i][j] for j in range(N)]
        elif d == 1:
            line = [b[i][j] for j in range(N - 1, -1, -1)]
        elif d == 2:
            line = [b[j][i] for j in range(N)]
        else:
            line = [b[j][i] for j in range(N - 1, -1, -1)]
        out, merged = compress(line)
        merged_all += merged
        for k, v in enumerate(out):
            if d == 0:
                nb[i][k] = v
            elif d == 1:
                nb[i][N - 1 - k] = v
            elif d == 2:
                nb[k][i] = v
            else:
                nb[N - 1 - k][i] = v
    moved = any(nb[i][j] != b[i][j] for i in range(N) for j in range(N))
    return nb, merged_all, moved

def valid_dirs(b):
    return [d for d in range(4) if apply_move(b, d)[2]]

# ---------------- 玩家策略（技术水平代理） ----------------

def pol_random(b, rng):
    vd = valid_dirs(b)
    return rng.choice(vd) if vd else None

def pol_corner(b, rng):
    """角落流：固定优先级 左→下→右→上，最经典的 2048 新手策略"""
    for d in (0, 3, 1, 2):
        if apply_move(b, d)[2]:
            return d
    return None

def _score(b):
    """启发式评分：空格 + 单调性 + 最大值贴角"""
    empty = len(empties(b))
    mx = max(max(r) for r in b)
    corner_bonus = 4 if max(b[0][0], b[0][-1], b[-1][0], b[-1][-1]) == mx else 0
    mono = 0
    for r in range(N):
        for c in range(N - 1):
            if b[r][c] and b[r][c + 1]:
                mono += 1 if math.log2(b[r][c]) >= math.log2(b[r][c + 1]) else -1
    for c in range(N):
        for r in range(N - 1):
            if b[r][c] and b[r + 1][c]:
                mono += 1 if math.log2(b[r][c]) >= math.log2(b[r + 1][c]) else -1
    return empty * 3.0 + mono * 0.6 + corner_bonus

def pol_greedy(b, rng):
    """高手流：四方向各试一步，选启发式评分最高的"""
    best, best_s = None, -1e9
    for d in valid_dirs(b):
        nb, _, _ = apply_move(b, d)
        s = _score(nb)
        if s > best_s:
            best_s, best = s, d
    return best

POLICIES = {
    "新手 random": pol_random,
    "中等 corner": pol_corner,
    "高手 greedy": pol_greedy,
}

# ---------------- 生成值分层（v0.1 §3.2） ----------------

TIERS = [
    ("T1 关1-2", [2, 4], [90, 10]),
    ("T2 关3-4", [4, 8], [80, 20]),
    ("T3 关5-6", [8, 16], [80, 20]),
    ("T4 关7-9", [16, 32], [85, 15]),
    ("T5 关10+", [32, 64], [85, 15]),
]

# ---------------- 核心指标 ----------------

def charge_of(v):
    """v0.1 §5.1 充能公式"""
    return 4 * (math.log2(v) - 1)

def run_one(policy, pool_vals, pool_w, moves=MOVES_PER_LEVEL, init_tiles=2):
    rng = random.Random()
    b = new_board()
    for _ in range(init_tiles):
        spawn(b, rng, pool_vals, pool_w)

    n_moves = 0
    merges = []                  # 每次合成的方块值
    per_wave_charge = []
    per_wave_cv = []
    cur_charge, cur_cv = 0.0, 0.0
    dead = False

    while n_moves < moves:
        d = policy(b, rng)
        if d is None:
            dead = True
            break
        b, merged, _ = apply_move(b, d)
        n_moves += 1
        for v in merged:
            merges.append(v)
            cur_charge += charge_of(v)
            cur_cv += v
        spawn(b, rng, pool_vals, pool_w)
        if n_moves % MOVES_PER_WAVE == 0:
            per_wave_charge.append(cur_charge)
            per_wave_cv.append(cur_cv)
            cur_charge, cur_cv = 0.0, 0.0

    occupied = N * N - len(empties(b))
    return {
        "moves": n_moves,
        "merges": merges,
        "merge_rate": len(merges) / max(1, n_moves),
        "avg_merge": (sum(merges) / len(merges)) if merges else 0.0,
        "cv_per_move": sum(merges) / max(1, n_moves),
        "charge_per_move": sum(charge_of(v) for v in merges) / max(1, n_moves),
        "wave_charge": per_wave_charge,
        "wave_cv": per_wave_cv,
        "max_tile": (max(merges) if merges else 0),
        "overload": Counter(v for v in merges if v >= 256),
        "dead": dead,
        "occupied": occupied / (N * N),
        "board_max": max(max(r) for r in b),
    }

# ---------------- 主流程 ----------------

def main():
    runs = int(sys.argv[1]) if len(sys.argv) > 1 else 3000
    print(f"蒙特卡洛校准器 v0.2 | 每档 {runs} 局 | {MOVES_PER_LEVEL} 步/关 | 棋盘 {N}x{N}")
    print("=" * 104)

    for tname, pv, pw in TIERS:
        print(f"\n【{tname}】生成池 {pv} 权重 {pw}  期望生成值 {sum(a*b for a,b in zip(pv,pw))/100:.2f}")
        print("-" * 104)
        print(f"{'策略':<14}{'合成/步':>9}{'平均合成值':>11}{'CV/步':>9}{'充能/步':>9}"
              f"{'小附魔/波':>10}{'CV/波':>8}{'P(256+)':>9}{'P(512+)':>9}{'卡死率':>8}{'盘面占用':>9}")
        for pname, pol in POLICIES.items():
            agg = []
            dead_cnt = 0
            reach256 = reach512 = 0
            for _ in range(runs):
                r = run_one(pol, pv, pw)
                agg.append(r)
                dead_cnt += 1 if r["dead"] else 0
                if r["max_tile"] >= 256:
                    reach256 += 1
                if r["max_tile"] >= 512:
                    reach512 += 1
            mr = sum(a["merge_rate"] for a in agg) / runs
            am = sum(a["avg_merge"] for a in agg) / runs
            cv = sum(a["cv_per_move"] for a in agg) / runs
            ch = sum(a["charge_per_move"] for a in agg) / runs
            # 每波 30 步
            mini = sum(a["charge_per_move"] for a in agg) / runs * MOVES_PER_WAVE / 100
            wcv = sum(a["cv_per_move"] for a in agg) / runs * MOVES_PER_WAVE
            occ = sum(a["occupied"] for a in agg) / runs
            print(f"{pname:<14}{mr:>9.2f}{am:>11.1f}{cv:>9.1f}{ch:>9.1f}"
                  f"{mini:>10.2f}{wcv:>8.0f}{reach256/runs:>9.1%}{reach512/runs:>9.1%}"
                  f"{dead_cnt/runs:>8.1%}{occ:>9.0%}")

    # 超载触发计数（关键：v0.1 假设 256 是关 1-2 的主要目标）
    print("\n" + "=" * 104)
    print("【超载触发次数 / 关】v0.1 假设 256/512/1024/2048 是大附魔来源 —— 验证其真实频率")
    print("-" * 104)
    print(f"{'档位':<10}{'策略':<14}{'256':>8}{'512':>8}{'1024':>8}{'2048':>8}{'4096':>8}{'超载合计':>10}")
    for tname, pv, pw in TIERS:
        for pname, pol in POLICIES.items():
            tot = Counter()
            for _ in range(runs):
                r = run_one(pol, pv, pw)
                tot.update(r["overload"])
            s = sum(tot.values())
            print(f"{tname:<10}{pname:<14}{tot[256]:>8.2f}{tot[512]:>8.2f}{tot[1024]:>8.2f}"
                  f"{tot[2048]:>8.2f}{tot[4096]:>8.2f}{s/runs:>10.2f}" if False else
                  f"{tname:<10}{pname:<14}{tot[256]/runs:>8.2f}{tot[512]/runs:>8.2f}"
                  f"{tot[1024]/runs:>8.2f}{tot[2048]/runs:>8.2f}{tot[4096]/runs:>8.2f}{s/runs:>10.2f}")

if __name__ == "__main__":
    main()
