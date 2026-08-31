# -*- coding: utf-8 -*-
"""
星序防线 — 校准器 v0.2g（关 1「超载饥饿」修复方案对比）
Q14: 五种补救方案在关 1–3 上的表现，双指标评估：
     (i) 附魔占比是否达到 M3 的 60%
     (ii) 技术倍差（hybrid ÷ random）是否还 > 2× —— 不能为了凑占比把技巧空间填平
"""
import math, random

src = open("sim_overload_v02e.py", encoding="utf-8").read()
ns = {}
exec(src.split("run, POLS = build(N)")[0], ns)
build, N = ns["build"], ns["N"]
POWER = ns["POWER"]
EP, ELEM_CAP, CHARGE_MAX, K, LOGC = ns["EP"], ns["ELEM_CAP"], ns["CHARGE_MAX"], ns["K"], ns["LOGC"]

RUNS = 100
MOVES = 153
PLANT_DPS, SLOT_BASE, HIT_RATE = 7, 3, 0.75
WAVE_T = [30, 35, 45, 45, 60]
PLANT_PER_LEVEL = PLANT_DPS * SLOT_BASE * sum(WAVE_T) * HIT_RATE
LEVEL_TIER = [([2, 4], [90, 10], 2.2), ([2, 4], [90, 10], 2.2), ([2, 4, 8], [70, 20, 10], 3.0)]

# 方案：(名称, 超载门槛, 起始盘, 植物DPS)
CONFIGS = [
    ("A 现状",            256, None,                       7),
    ("B 门槛降到128",      128, None,                       7),
    ("C 起始盘 32/16",     256, [32, 32, 16, 16, 8, 8],     7),
    ("D 起始盘+门槛128",   128, [32, 32, 16, 16, 8, 8],     7),
    ("E 门槛128+植物DPS5", 128, None,                       5),
]
STAR_MAP = {128: 2.0, 256: 3.5, 512: 6.0, 1024: 10.0, 2048: 16.0, 4096: 25.0}

run, POLS = build(N)


def seed_board(pv, pw, seed_vals, rng):
    b = [[0] * N for _ in range(N)]
    cells = [(r, c) for r in range(N) for c in range(N)]
    rng.shuffle(cells)
    for v, (r, c) in zip(seed_vals, cells):
        b[r][c] = v
    return b


def measure(pol, th, seed_vals, plant_dps, levels=3):
    """返回逐关 (超载次数, 超载池, 附魔占比)"""
    plant = plant_dps * SLOT_BASE * sum(WAVE_T) * HIT_RATE
    acc = [{"ov": 0.0, "pool": 0.0, "chg": 0.0} for _ in range(levels)]
    for _ in range(RUNS):
        board = None
        for li in range(levels):
            pv, pw, E = LEVEL_TIER[li]
            if board is None and seed_vals:
                rng = random.Random()
                board = seed_board(pv, pw, seed_vals, rng)
            r = run(pol, pv, pw, MOVES, board=board)
            board = r["b"]
            mg = r["merges"]
            ov = [v for v in mg if v >= th]
            acc[li]["ov"] += len(ov)
            acc[li]["pool"] += sum(EP * STAR_MAP.get(v, 25.0) * ELEM_CAP for v in ov)
            acc[li]["chg"] += sum(K * math.log2(v / E) * LOGC for v in mg)
    out = []
    for li in range(levels):
        d = acc[li]
        pool = d["pool"] / RUNS
        small = d["chg"] / RUNS / CHARGE_MAX * EP * ELEM_CAP
        ench = pool + small
        out.append((d["ov"] / RUNS, pool, ench / (ench + plant), plant))
    return out


print("=" * 122)
print(f"Q14  关 1 超载饥饿的修复方案对比   {RUNS} 局 × 3 关 × {MOVES} 步   目标：附魔占比 ≥60%，技术倍差 >2×")
print("=" * 122)
print(f"{'方案':<18}{'关':>3}{'策略':<9}{'超载/关':>9}{'超载池':>9}{'附魔占比':>10}"
      f"{'植物占比':>10}{'技术倍差(超载池)':>18}")

RES = {}
for name, th, seed_vals, pdps in CONFIGS:
    for pn in ("random", "hybrid"):
        RES[(name, pn)] = measure(POLS[pn], th, seed_vals, pdps)
    for li in range(3):
        for pn in ("random", "hybrid"):
            ov, pool, share, plant = RES[(name, pn)][li]
            rp = RES[(name, "random")][li][1]
            diff = ("—" if rp < 1e-6 else f"{pool/rp:.2f}×")
            print(f"{name if li==0 and pn=='random' else '':<18}{li+1:>3}{pn:<9}"
                  f"{ov:>9.2f}{pool:>9.0f}{share:>10.1%}{1-share:>10.1%}{diff if pn=='hybrid' else '':>18}")
    print("-" * 122)

print()
print("=" * 122)
print("结论表：关 1 附魔占比 / 关 2 / 关 3 / 技术倍差(关1) / 综合判定")
print("=" * 122)
print(f"{'方案':<18}{'关1占比':>9}{'关2占比':>9}{'关3占比':>9}{'关1倍差':>9}  判定")
for name, *_ in CONFIGS:
    h = RES[(name, "hybrid")]
    r = RES[(name, "random")]
    d1 = h[0][1] / r[0][1] if r[0][1] > 1e-6 else float("inf")
    ok60 = h[0][2] >= 0.58
    okd = d1 >= 2.0
    verdict = ("✓ 达标" if ok60 and okd else
               ("占比不足" if not ok60 else "技巧空间被填平"))
    print(f"{name:<18}{h[0][2]:>9.1%}{h[1][2]:>9.1%}{h[2][2]:>9.1%}"
          f"{(f'{d1:.2f}×' if d1 != float('inf') else '∞'):>9}  {verdict}")
