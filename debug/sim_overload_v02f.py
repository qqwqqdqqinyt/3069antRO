# -*- coding: utf-8 -*-
"""
星序防线 — 校准器 v0.2f（关 1 超载饥饿的根因定位）
Q11: 棋盘跨关保留时，逐关的超载次数/伤害池是多少？
     判定 v0.2e 发现的「关 1 超载几乎为零」是只有首关的冷启动问题，还是系统性缺口。
Q12: 若把超载门槛从 256 下调到 128，关 1 能否救回来？
"""
import math, random, importlib.util, sys

spec = importlib.util.spec_from_file_location("e2", "sim_overload_v02e.py")
# 直接复用 e 的 build()，避免重复造轮子：把它的 build 抄过来（e2 顶层有副作用，故手工导入函数）
src = open("sim_overload_v02e.py", encoding="utf-8").read()
ns = {}
exec(src.split("run, POLS = build(N)")[0], ns)
build, N = ns["build"], ns["N"]
POWER = ns["POWER"]
EP, ELEM_CAP, CHARGE_MAX, K, LOGC = ns["EP"], ns["ELEM_CAP"], ns["CHARGE_MAX"], ns["K"], ns["LOGC"]

RUNS = 120
MOVES = 153
WAVES = 5
# 关 1–2 = T1, 关 3–4 = T2, 关 5–6 = T3
LEVEL_TIER = [([2, 4], [90, 10], 2.2), ([2, 4], [90, 10], 2.2),
              ([2, 4, 8], [70, 20, 10], 3.0), ([2, 4, 8], [70, 20, 10], 3.0),
              ([4, 8], [80, 20], 4.8), ([4, 8], [80, 20], 4.8)]
PLANT_DPS, SLOT_BASE, HIT_RATE = 7, 3, 0.75
WAVE_T = [30, 35, 45, 45, 60]
PLANT_PER_LEVEL = PLANT_DPS * SLOT_BASE * sum(WAVE_T) * HIT_RATE

run, POLS = build(N)

print("=" * 120)
print(f"Q11  棋盘跨关保留（BOARD_CARRY=1）—— 逐关超载与输出占比   {RUNS} 局 × 6 关 × {MOVES} 步")
print("=" * 120)
print(f"{'策略':<9}{'关':>3}{'E[生成]':>8}{'超载/关':>9}{'超载池/关':>11}{'小附魔/关':>10}"
      f"{'附魔合计':>10}{'植物':>8}{'附魔占比':>10}{'盘面占用':>9}")

OUT = {}
for pn in ("random", "hybrid"):
    acc = {}
    for _ in range(RUNS):
        board = None
        for li, (pv, pw, E) in enumerate(LEVEL_TIER):
            r = run(POLS[pn], pv, pw, MOVES, board=board)
            board = r["b"]
            mg = r["merges"]
            ov = [v for v in mg if v >= 256]
            d = acc.setdefault(li, {"ov": 0, "pool": 0.0, "chg": 0.0, "occ": 0.0})
            d["ov"] += len(ov)
            d["pool"] += sum(EP * POWER.get(v, 25.0) * ELEM_CAP for v in ov)
            d["chg"] += sum(K * math.log2(v / E) * LOGC for v in mg)
            d["occ"] += r["occ"]
    for li, (pv, pw, E) in enumerate(LEVEL_TIER):
        d = acc[li]
        ov = d["ov"] / RUNS
        pool = d["pool"] / RUNS
        small = d["chg"] / RUNS / CHARGE_MAX
        small_pool = small * EP * 1.0 * ELEM_CAP
        ench = pool + small_pool
        tot = ench + PLANT_PER_LEVEL
        OUT[(pn, li)] = (ov, pool, small_pool, ench / tot)
        print(f"{pn:<9}{li+1:>3}{E:>8.2f}{ov:>9.2f}{pool:>11.0f}{small:>10.2f}"
              f"{ench:>10.0f}{PLANT_PER_LEVEL:>8.0f}{ench/tot:>10.1%}{d['occ']/RUNS:>9.0%}")
    print("-" * 120)

print()
print("=" * 120)
print("Q12  若超载门槛下调到 128（1★），关 1 的超载次数能涨多少？")
print("=" * 120)
print(f"{'策略':<9}{'门槛':>8}{'超载/关':>10}{'超载池/关':>12}{'附魔占比':>10}{'植物占比':>10}")
for pn in ("random", "hybrid"):
    for th in (256, 128):
        ov_n = pool_t = chg_t = 0.0
        for _ in range(RUNS):
            pv, pw, E = LEVEL_TIER[0]
            r = run(POLS[pn], pv, pw, MOVES)
            mg = r["merges"]
            ov = [v for v in mg if v >= th]
            ov_n += len(ov)
            pool_t += sum(EP * POWER.get(v, {128: 1.0}.get(v, POWER.get(v, 25.0))) * ELEM_CAP for v in ov)
            chg_t += sum(K * math.log2(v / E) * LOGC for v in mg)
        ov_n /= RUNS
        pool_t /= RUNS
        small_pool = chg_t / RUNS / CHARGE_MAX * EP * ELEM_CAP
        ench = pool_t + small_pool
        tot = ench + PLANT_PER_LEVEL
        print(f"{pn:<9}{th:>8}{ov_n:>10.2f}{pool_t:>12.0f}{ench/tot:>10.1%}"
              f"{PLANT_PER_LEVEL/tot:>10.1%}")

print()
print("=" * 120)
print("Q13  达标所需：关 1 要让附魔占 60%，超载池需要多大？（当前 hybrid 实测对照）")
print("=" * 120)
for pn in ("random", "hybrid"):
    ov, pool, small_pool, share = OUT[(pn, 0)]
    need_ench = PLANT_PER_LEVEL * 0.60 / 0.40
    need_pool = need_ench - small_pool
    print(f"  {pn:<8} 当前超载池 {pool:>7,.0f} / 需要 {need_pool:>8,.0f}  "
          f"→ 缺口 {need_pool/max(pool,1):>6.1f}×   当前附魔占比 {share:.1%} / 目标 60.0%")
