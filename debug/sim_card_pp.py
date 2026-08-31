# -*- coding: utf-8 -*-
"""
================================================================================
 卡牌战力点（Power Point, PP）计算器   ——  星序防线 v0.2.1
================================================================================
用途：把任何一张卡的效果折算到同一把尺子上，再据尺子定稀有度。
      GDD v0.2 §3 定义了尺子，但用的是 v0.1 遗留单位 11.5，
      而「关1每波总输出的 1%」实测为 13.66。本脚本两个单位都算，
      新卡一律按新单位（PP13）定稀有度，旧卡保留旧列以便对照审计结论。

用法：  python sim_card_pp.py
输出：  全部卡牌的 PP 表 + 稀有度判定 + 越界告警
================================================================================
"""
import math

# ------------------------------------------------------------------ 基准模型
# 全部来自 GDD v0.2 §2.2 波次预算表（关 1）
WAVES = [
    # 时长, 步数,  附魔,   植物,   敌人总HP
    (30, 22, 495, 473, 570),
    (35, 25, 563, 551, 610),
    (45, 32, 720, 709, 950),
    (45, 32, 720, 709, 890),
    (60, 42, 945, 945, 1310),
]

T = sum(w[0] for w in WAVES) / len(WAVES)          # 平均波时长 43.0s
S = sum(w[1] for w in WAVES) / len(WAVES)          # 平均步数   30.6
ENCH = sum(w[2] for w in WAVES) / len(WAVES)       # 平均附魔输出 688.6
PLANT = sum(w[3] for w in WAVES) / len(WAVES)      # 平均植物输出 677.4
TOTAL = ENCH + PLANT                               # 1366.0
TOTAL_HP = sum(w[4] for w in WAVES)                # 关1总HP 4330
N_PLANT = 3                                        # 基准植物数

PP_OLD = 11.5        # GDD v0.2 §3 沿用的 v0.1 单位（实为 0.84%）
PP_NEW = TOTAL / 100.0   # 严格定义：关1每波总输出的 1% = 13.66

# 稀有度合格区间（GDD §3 规则 3）
BAND = {
    '普通': (4.0, 7.0),
    '稀有': (7.0, 11.0),
    '史诗': (11.0, 20.0),
    '传说': (20.0, 1e9),
}
BAND_ORDER = ['普通', '稀有', '史诗', '传说']

# 护甲类情境卡的有效占比：重甲/精英血量占总血量的比例
ARMOR_HP_SHARE = (2 * 190 + 2 * 190 + 1 * 450) / TOTAL_HP   # ≈ 0.279
ARMOR_AVG = (0.30 * 2 + 0.30 * 2 + 0.15 * 1) / 5            # ≈ 0.27 平均减伤


def band_of(pp):
    """低于普通带下限的卡是「偏弱」，不是传说 —— 必须单独标出来。"""
    if pp < BAND['普通'][0]:
        return '普通'
    for name in BAND_ORDER:
        lo, hi = BAND[name]
        if lo <= pp < hi:
            return name
    return '传说'


def weak_of(pp):
    return pp < BAND['普通'][0]


# ------------------------------------------------------------------ 卡牌定义
# 每个 est() 返回「每波增量伤害」。经济/生存卡给 pp_note，不计入战力池。
CARDS = [
    # ================= 普通 =================
    dict(id='sharp', name='锋锐', rarity='普通', tag='plant',
         desc='植物伤害 +12%',
         est=lambda: PLANT * 0.12),

    dict(id='rapid', name='连射', rarity='普通', tag='plant',
         desc='植物攻速 +12%',
         est=lambda: PLANT * 0.12),

    dict(id='crit', name='暴击', rarity='普通', tag='plant',
         desc='植物暴击率 +12%（暴击 2.0×）',
         est=lambda: PLANT * 0.12 * (2.0 - 1.0)),

    dict(id='pierce', name='破甲', rarity='普通', tag='situational',
         desc='无视目标 60% 护甲（情境卡：对无甲目标无效）',
         est=lambda: TOTAL * ARMOR_HP_SHARE * ARMOR_AVG * 0.60),

    dict(id='affinity', name='元素亲和·X', rarity='普通', tag='element',
         desc='指定元素威力 +50%（6 种变体）',
         est=lambda: ENCH * (1.0 / 6.0) * 0.50),

    dict(id='frostbite', name='霜噬', rarity='普通', tag='situational',
         desc='冰减速 30%→60%、持续 +2.5s，冰附魔伤害 +20%',
         est=lambda: PLANT * 0.055 + ENCH * (1.0 / 6.0) * 0.20),

    # ================= 稀有 =================
    dict(id='gale', name='疾风', rarity='稀有', tag='step',
         desc='步数回复速度 +15%',
         est=lambda: S * (1.15 - 1.0) * 22.5),

    dict(id='symbiosis', name='共生', rarity='稀有', tag='plant',
         desc='每株植物使全体植物伤害 +5%（3 株 = +15%）',
         est=lambda: PLANT * (0.05 * N_PLANT)),

    dict(id='overcharge', name='超充', rarity='稀有', tag='charge',
         desc='充能获取 +18%',
         est=lambda: ENCH * 0.18),

    dict(id='cascade', name='连锁', rarity='稀有', tag='charge',
         desc='单次移动中第 2 次及以后的合成，充能 +45%',
         est=lambda: ENCH * 0.45 * 0.34),   # 0.34 = 连锁合成占比（实测 v0.2c）

    dict(id='bigshot', name='巨弹', rarity='稀有', tag='plant',
         desc='卷心菜伤害 +10%，溅射半径 +40%，溅射伤害比 +25%',
         est=lambda: PLANT * 0.42 * (0.10 + 0.25)),

    dict(id='twinbarrel', name='双管', rarity='稀有', tag='plant',
         desc='豌豆射手每次攻击额外发射 1 颗 30% 伤害的豌豆',
         est=lambda: PLANT * 0.58 * 0.30),

    # ================= 史诗 =================
    dict(id='surge', name='涌流', rarity='史诗', tag='step',
         desc='充能获取 +30%，且波首赠送步数 +2',
         est=lambda: ENCH * 0.30 + 2 * 22.5),

    dict(id='overload_core', name='超载核心', rarity='史诗', tag='enchant',
         desc='所有附魔伤害池 +25%',
         est=lambda: ENCH * 0.25),

    dict(id='twin_cast', name='双生', rarity='史诗', tag='enchant',
         desc='每次附魔追加一次 30% 伤害池的随机元素打击',
         est=lambda: ENCH * 0.30),

    dict(id='genesis', name='创世', rarity='史诗', tag='econ',
         desc='每关开始额外获得 1 株牙苗（可进化）',
         est=lambda: PLANT * (1.0 / N_PLANT) * 0.70),  # 折 70%（需金币进化）

    # ================= 传说 =================
    dict(id='harvest', name='丰收', rarity='传说', tag='econ',
         desc='充能获取 ×1.40，CV ×1.20（原「丰饶」重做版）',
         est=lambda: ENCH * 0.40),

    dict(id='singularity', name='奇点', rarity='传说', tag='enchant',
         desc='超载门槛 256 → 128，且星级威力 +1 档',
         est=lambda: ENCH * 0.55),

    # ================= 经济卡（独立池，不参与战力竞争）=================
    dict(id='greed', name='贪婪', rarity='经济', tag='econ',
         desc='金币获取 +30%', est=lambda: 0.0),
    dict(id='shard_seeker', name='碎屑搜寻', rarity='经济', tag='econ',
         desc='碎片获取 +40%', est=lambda: 0.0),
    dict(id='stardust', name='星尘亲和', rarity='经济', tag='econ',
         desc='星核获取 +25%', est=lambda: 0.0),
    dict(id='scavenger', name='拾荒', rarity='经济', tag='econ',
         desc='材料掉落 +1（护甲敌人）', est=lambda: 0.0),

    # ================= 生存卡（独立池）=================
    dict(id='bastion', name='壁垒', rarity='生存', tag='defense',
         desc='星枢上限 +40，并立即回满', est=lambda: 0.0),
    dict(id='thorn', name='尖刺', rarity='生存', tag='defense',
         desc='漏怪伤害 -35%', est=lambda: 0.0),
    dict(id='mender', name='修补', rarity='生存', tag='defense',
         desc='每清一波回复星枢 6 点', est=lambda: 0.0),
]

# ------------------------------------------------------------------ 旧池审计
LEGACY = [
    # 名称, v0.1稀有度, 旧PP, 处置建议
    ('丰饶（每步多生成 1 方块）', '史诗', 58.0, '超模，重做 → 丰收'),
    ('充能加速（充能 +25%）', '普通', 14.7, '超模，升史诗 → 涌流'),
    ('共生（每植物 +8%）', '传说', 9.8, '合格，降稀有（PP 落在稀有带）'),
    ('疾风（步数回复 +15%）', '普通', 8.8, '偏强，升稀有'),
    ('锋锐（植物伤害 +15%）', '普通', 6.2, '合格'),
    ('暴击（暴击率 +10%）', '稀有', 5.0, '降普通（PP 落在普通带）'),
    ('连射（植物攻速 +12%）', '普通', 4.9, '合格'),
    ('破甲（无视 30% 护甲）', '稀有', 3.6, '情境卡，改 40% 并降普通'),
    ('元素亲和·X（威力 +30%）', '普通', 2.9, '偏弱，改 +50%'),
    ('稳健（步数上限 +1）', '普通', 2.0, '近废卡，删除'),
    ('结晶（CV ×1.15）', '稀有', 3.6, '经济卡，移入经济池'),
    ('连锁核心（第 3+ 次合并翻倍）', '传说', 5.8, '废卡且方向错误，删除 → 连锁'),
]


def main():
    print('=' * 96)
    print(' 基准模型（GDD v0.2 §2.2，关 1 五波平均）')
    print('=' * 96)
    print(f'  波时长 T = {T:.1f}s    步数 S = {S:.1f}')
    print(f'  附魔输出 = {ENCH:.1f}    植物输出 = {PLANT:.1f}    合计 = {TOTAL:.1f}')
    print(f'  战力点单位：旧 PP_OLD = {PP_OLD:.2f}（v0.1 遗留，实为 {PP_OLD / TOTAL * 100:.2f}%）')
    print(f'              新 PP_NEW = {PP_NEW:.2f}（严格 1%）')
    print(f'  护甲情境：护甲血量占比 {ARMOR_HP_SHARE * 100:.1f}%，平均减伤 {ARMOR_AVG * 100:.1f}%')

    print()
    print('=' * 96)
    print(' 新卡池 PP 表')
    print('=' * 96)
    hdr = f'{"稀有":<6}{"ID":<16}{"名称":<14}{"增量/波":>9}{"PP(旧)":>9}{"PP(新)":>9}{"应属":>7}  判定'
    print(hdr)
    print('-' * 96)
    bad = []
    rows = []
    for c in CARDS:
        dmg = c['est']()
        po = dmg / PP_OLD
        pn = dmg / PP_NEW
        should = band_of(pn) if c['rarity'] in BAND else c['rarity']
        ok = (should == c['rarity'])
        # 经济/生存池战力点本就是 0 —— 这是设计（GDD §3 规则 2），不算越界
        exempt = c['rarity'] not in BAND
        if not ok:
            bad.append((c['name'], c['rarity'], should, pn))
        elif weak_of(pn) and not exempt:
            bad.append((c['name'], c['rarity'], '≥普通下限(4.0)', pn))
        flag = 'OK ' if ok else '⚠ 应属 ' + should
        if weak_of(pn):
            flag += '（经济/生存池，不计战力）' if exempt else '  ⚠偏弱'
        print(f'{c["rarity"]:<6}{c["id"]:<16}{c["name"]:<14}{dmg:>9.1f}{po:>9.1f}{pn:>9.1f}'
              f'{should:>7}  {flag}')
        rows.append((c, dmg, po, pn, should))
    print('-' * 96)
    if bad:
        print(f' [!] {len(bad)} 张卡的稀有度与其 PP 不符：')
        for n, r, s, p in bad:
            print(f'     · {n}：标称 {r}，PP {p:.1f} → 应为 {s}')
    else:
        print(' [PASS] 全部卡牌稀有度与 PP 区间一致')

    print()
    print('=' * 96)
    print(' 旧池审计（PP 单位换算 旧→新：× %.3f）' % (PP_OLD / PP_NEW))
    print('=' * 96)
    print(f'{"卡":<28}{"v0.1稀有度":<10}{"旧PP":>7}{"新PP":>8}{"应属":>7}  处置建议')
    print('-' * 96)
    for name, r, po, note in LEGACY:
        pn = po * PP_OLD / PP_NEW
        should = band_of(pn)
        print(f'{name:<28}{r:<10}{po:>7.1f}{pn:>8.1f}{should:>7}  {note}')

    print()
    print('=' * 96)
    print(' 稀有度合格区间（新 PP）')
    print('=' * 96)
    for k in BAND_ORDER:
        lo, hi = BAND[k]
        hs = '∞' if hi > 1e8 else f'{hi:.0f}'
        print(f'  {k}：{lo:.0f} – {hs}  （每波 {lo * PP_NEW:.0f} – '
              f'{1e9 if hi > 1e8 else hi * PP_NEW:.0f} 伤害）')


if __name__ == '__main__':
    main()
