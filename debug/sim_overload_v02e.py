# -*- coding: utf-8 -*-
"""
星序防线 — 校准器 v0.2e（补 10_波次预算表缺失的超载输出）
Q8: 超载事件（合成出 >=256 的方块）在各档位、各策略下的发生频率与伤害池期望。
    10_波次预算表的「附魔输出」只算了小附魔，缺了超载这一半 —— 用它补齐。
Q9: 顺带复核「超载次数技术倍率 M」到底是 2.0（GDD v0.2 假设）还是 3.0（表里的 0.33）。
"""
import random

N = 5
TIERS = [
    ("T1", ([2, 4], [90, 10]), 2.2, 12.034),
    ("T2", ([2, 4, 8], [70, 20, 10]), 3.0, 16.410),
    ("T3", ([4, 8], [80, 20]), 4.8, 26.256),
    ("T4", ([4, 8, 16], [70, 20, 10]), 6.0, 32.820),
    ("T5", ([8, 16], [80, 20]), 9.6, 52.512),
]
POWER = {256: 2.0, 512: 3.5, 1024: 6.0, 2048: 10.0, 4096: 16.0, 8192: 25.0}
EP, ELEM_CAP, CHARGE_MAX, K, LOGC = 180, 2.5, 100, 2.9, 0.78

RUNS = 150
MOVES = 153          # 关 1 单关步数（5 波 × 30.67）
WAVES = 5


def build(N):
    def empties(b):
        return [(r, c) for r in range(N) for c in range(N) if b[r][c] == 0]

    def spawn(b, rng, pv, pw):
        e = empties(b)
        if e:
            r, c = rng.choice(e)
            b[r][c] = rng.choices(pv, weights=pw)[0]

    def compress(line):
        vals = [x for x in line if x]
        out, mg = [], []
        i = 0
        while i < len(vals):
            if i + 1 < len(vals) and vals[i] == vals[i + 1]:
                out.append(vals[i] * 2)
                mg.append(vals[i] * 2)
                i += 2
            else:
                out.append(vals[i])
                i += 1
        out += [0] * (len(line) - len(out))
        return out, mg

    def apply_move(b, d):
        nb = [[0] * N for _ in range(N)]
        allm = []
        for i in range(N):
            if d == 0:
                line = [b[i][j] for j in range(N)]
            elif d == 1:
                line = [b[i][j] for j in range(N - 1, -1, -1)]
            elif d == 2:
                line = [b[j][i] for j in range(N)]
            else:
                line = [b[j][i] for j in range(N - 1, -1, -1)]
            out, mg = compress(line)
            allm += mg
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
        vd = valid_dirs(b)
        return rng.choice(vd) if vd else None

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
            if s > bs:
                bs, best = s, d
        return best

    def pol_hybrid(b, rng):
        best, bs = None, -1e9
        for d in valid_dirs(b):
            nb, mg, _ = apply_move(b, d)
            s = len(mg) * 2.0 + score(nb) * 0.5
            if s > bs:
                bs, best = s, d
        return best

    def run(pol, pv, pw, moves, board=None):
        rng = random.Random()
        b = [row[:] for row in board] if board else [[0] * N for _ in range(N)]
        if board is None:
            for _ in range(2):
                spawn(b, rng, pv, pw)
        merges, nm, dead, occ_hist = [], 0, False, []
        while nm < moves:
            d = pol(b, rng)
            if d is None:
                dead = True
                break
            b, mg, _ = apply_move(b, d)
            nm += 1
            merges += mg
            occ_hist.append((N * N - len(empties(b))) / (N * N))
            spawn(b, rng, pv, pw)
        return {"b": b, "merges": merges, "dead": dead,
                "occ": sum(occ_hist) / len(occ_hist) if occ_hist else 1.0}

    return run, {"random": pol_random, "corner": pol_corner,
                 "greedy": pol_greedy, "hybrid": pol_hybrid}


run, POLS = build(N)

print("=" * 118)
print("Q8  超载事件频率与伤害池 —— 关 1（T1 档，153 步 = 5 波）棋盘每关重置")
print(f"    {RUNS} 局 / 档位 / 策略     超载伤害池 = Σ n(v) × EP({EP}) × 威力(v) × ELEM_CAP({ELEM_CAP})")
print("=" * 118)
print(f"{'档位':<6}{'E[生成]':>8}{'策略':<9}{'超载次数/关':>12}{'超载次数/波':>12}"
      f"{'伤害池/关':>12}{'伤害池/波':>12}{'小附魔/波':>11}{'超载占比':>10}{'盘面占用':>9}")

RES = {}
for tname, (pv, pw), E, _ in TIERS:
    # 只在 T1 上跑全策略；其余档位为参考列，仍全跑
    for pn, pol in POLS.items():
        if tname != "T1" and pn not in ("hybrid", "random"):
            continue
        agg = [run(pol, pv, pw, MOVES) for _ in range(RUNS)]
        nov = sum(sum(1 for v in a["merges"] if v >= 256) for a in agg) / RUNS
        pool = sum(sum(EP * POWER.get(v, 25.0) * ELEM_CAP for v in a["merges"] if v >= 256)
                   for a in agg) / RUNS
        # 小附魔：充能条从合并充能累加，每满 CHARGE_MAX 触发一次
        sm = sum(sum(K * __import__("math").log2(v / E) * LOGC for v in a["merges"])
                 for a in agg) / RUNS / CHARGE_MAX
        occ = sum(a["occ"] for a in agg) / RUNS
        tot_ench_w = pool / WAVES + sm / WAVES * EP * 1.0 * ELEM_CAP
        share = (pool / WAVES) / tot_ench_w if tot_ench_w else 0
        RES[(tname, pn)] = (nov, pool, sm, occ, share)
        print(f"{tname:<6}{E:>8.2f}{pn:<9}{nov:>12.3f}{nov/WAVES:>12.3f}"
              f"{pool:>12.0f}{pool/WAVES:>12.0f}{sm/WAVES:>11.2f}{share:>10.1%}{occ:>9.0%}", flush=True)
    print("-" * 118)

print()
print("=" * 118)
print("Q9  超载技术倍率 M = 高手(hybrid) ÷ 各策略 —— GDD v0.2 假设 M≈2.0，表里用的是 0.33(⇒M=3.0)")
print("=" * 118)
print(f"{'档位':<6}{'random 次数比':>14}{'corner 次数比':>14}{'greedy 次数比':>14}"
      f"{'伤害池 random比':>16}{'伤害池 corner比':>16}")
for tname, _, E, _ in TIERS:
    base_n = RES[(tname, "hybrid")][0]
    base_p = RES[(tname, "hybrid")][1]
    f = lambda x: ("—" if base_n < 1e-6 else f"{x/base_n:.2f}")
    g = lambda x: ("—" if base_p < 1e-6 else f"{x/base_p:.2f}")
    gv = lambda k: (RES[(tname,k)][0] if (tname,k) in RES else float('nan'))
    gp = lambda k: (RES[(tname,k)][1] if (tname,k) in RES else float('nan'))
    print(f"{tname:<6}{f(gv('random')):>14}{f(gv('corner')):>14}"
          f"{f(gv('greedy')):>14}{g(gp('random')):>16}{g(gp('corner')):>16}")

print()
print("=" * 118)
print("Q10  关 1 输出占比复核（M3 验收：附魔 60% : 植物 40%）")
print("=" * 118)
PLANT_DPS, SLOT_BASE, HIT_RATE = 7, 3, 0.75
wave_t = [30, 35, 45, 45, 60]
plant_total = sum(PLANT_DPS * SLOT_BASE * t * HIT_RATE for t in wave_t)
print(f"  植物全关输出 = {PLANT_DPS} × {SLOT_BASE} × Σ时长{wave_t} × {HIT_RATE} = {plant_total:,.0f}")
for pn in POLS:
    small_w = RES[("T1", pn)][2] / WAVES
    over_pool = RES[("T1", pn)][1]
    ench_total = over_pool + small_w * WAVES * EP * ELEM_CAP
    tot = ench_total + plant_total
    print(f"  {pn:<8} 超载全关 {over_pool:>8,.0f}  小附魔全关 {small_w*WAVES*EP*ELEM_CAP:>8,.0f}"
          f"  附魔合计 {ench_total:>8,.0f} ({ench_total/tot:>5.1%})"
          f"  植物 {plant_total:>7,.0f} ({plant_total/tot:>5.1%})")
