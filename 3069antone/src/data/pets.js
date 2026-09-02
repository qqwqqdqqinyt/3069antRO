/* ============================================================
 *  data/pets.js —— 培育植物（宠物）数据表
 *
 *  世界观：晶枢碎片坠入主角家后院，一株普通牙苗受异变能量影响，
 *          分化出 红 / 绿 / 灰 三种异变变种。玩家首场三选一，选完永不可改。
 *
 *  本期范围（v1）：
 *    · 只有「红色牙苗」可选（绿 / 灰为数据预占位，UI 显示但点不开）
 *    · 进化链：红牙苗 → 龙葵（红番茄）/ 灯笼椒（小辣椒）
 *    · 进化条件 = 等级门槛 + 材料 + 金币（★ 三者全满足才能进化）
 *
 *  等级系统（主人 2026-09-02 定的规则）：
 *    · 经验来源：喂养材料（少量）+ 浇水施肥（少量）+ 战斗击杀（主来源，高等级敌人给更多）
 *    · 等级影响：全部战斗属性（hp / dmg / interval …）
 *    · 进化后等级保留继承，不重置
 *
 *  ★ 数值真相源：本文件是宠物战斗数值的唯一来源。
 *    battlefield.js 的 PLANTS 表通过 Battlefield.registerPlants() 合并这里的
 *    combatDefs() 输出，避免两处硬编码漂移。
 * ============================================================ */
(function (global) {
  'use strict';

  /* ---------------- 三选一的初始变种 ---------------- */
  /* locked:true 表示该链本期未开放 —— UI 要显示（让玩家看见未来内容），但点不开。 */
  var VARIANTS = [
    { key: 'red', name: '红色牙苗', kind: 'redsprout', color: '#ff6b6b', locked: false,
      desc: '泛着暗红微光的牙苗。脾气比看上去要烈。' },
    { key: 'green', name: '绿色牙苗', kind: 'greensprout', color: '#6cc04a', locked: true,
      desc: '枝叶舒展，恢复得比谁都快。' },
    { key: 'withered', name: '枯萎牙苗', kind: 'witheredsprout', color: '#9a8f7a', locked: true,
      desc: '半枯不死，靠掠夺他人的生机活着。' }
  ];

  /* ---------------- 培育植物形态表 ----------------
   * base 字段与 battlefield.js 的 PLANTS 同构（dmg/interval/range/proj/speed/hp/muzzle/desc），
   * 这样注册进 PLANTS 后，索敌 / 开火 / 受伤全走现成流程，无需特判。
   * recover 是「恢复 1% 最大 HP 需要的秒数」—— 越高级血越厚，恢复也越慢。
   */
  var PLANTS_META = {
    redsprout: {
      name: '红色牙苗', color: '#ff6b6b', locked: false,
      desc: '被晶枢异变的牙苗。射出的籽实带着灼热的红。',
      hpMax: 100, recover: 30,
      base: {
        name: '红色牙苗', dmg: 12, interval: 1.3, range: 1e9,
        proj: 'pea', speed: 430, hp: 100,
        muzzle: { dx: 15, dy: -14 },
        desc: '异变牙苗 · 单体直射，比普通豌豆射手更烫'
      }
    },
    longkui: {
      name: '龙葵', color: '#a86bd8', locked: false,
      desc: '吞噬红番茄后异变而成。浆果里全是让人发软的毒。',
      hpMax: 180, recover: 45,
      base: {
        name: '龙葵', dmg: 18, interval: 1.25, range: 1e9,
        proj: 'poison', speed: 460, hp: 180,
        muzzle: { dx: 14, dy: -16 }, poison: 2,
        desc: '毒系单体 · 命中后附加持续毒伤'
      }
    },
    denglongjiao: {
      name: '灯笼椒', color: '#ff8c42', locked: false,
      desc: '吞噬小辣椒后异变而成。灯笼里烧着的火，泼谁谁倒霉。',
      hpMax: 260, recover: 60,
      base: {
        name: '灯笼椒', dmg: 10, interval: 1.0, range: 1e9,
        proj: 'seed', speed: 460, hp: 260,
        aoe: 52, aoeRatio: 0.6, muzzle: { dx: 13, dy: -16 }, burn: 3,
        desc: '火系溅射 · 皮厚，落点范围伤害'
      }
    },

    /* ---- 以下两条链本期未开放：数据预占位，UI 显示但点不开 ---- */
    greensprout: {
      name: '绿色牙苗', color: '#6cc04a', locked: true,
      desc: '枝叶舒展的异变牙苗。恢复得比谁都快。',
      hpMax: 110, recover: 22,
      base: {
        name: '绿色牙苗', dmg: 10, interval: 1.2, range: 1e9,
        proj: 'pea', speed: 440, hp: 110,
        muzzle: { dx: 15, dy: -14 },
        desc: '（未开放）恢复型异变牙苗'
      }
    },
    witheredsprout: {
      name: '枯萎牙苗', color: '#9a8f7a', locked: true,
      desc: '半枯不死的异变牙苗。靠掠夺他人的生机活着。',
      hpMax: 90, recover: 38,
      base: {
        name: '枯萎牙苗', dmg: 14, interval: 1.35, range: 1e9,
        proj: 'pea', speed: 420, hp: 90,
        muzzle: { dx: 15, dy: -14 }, lifesteal: 0.15,
        desc: '（未开放）吸血型异变牙苗'
      }
    }
  };

  /* ---------------- 进化分支表 ----------------
   * ★ 进化条件 = 等级门槛 + 材料 + 金币，三者全满足（主人 2026-09-02 定）。
   *   等级也是硬门槛，光有材料和金币不够。
   */
  var BRANCHES = {
    redsprout: [
      {
        to: 'longkui', level: 5, gold: 100,
        materials: { redtomato: 1 },
        hint: '喂下红番茄，牙苗会往「毒」的那边长。'
      },
      {
        to: 'denglongjiao', level: 5, gold: 100,
        materials: { smallchili: 1 },
        hint: '喂下小辣椒，牙苗会往「火」的那边长。'
      }
    ],
    greensprout: [],      // 未开放
    witheredsprout: []    // 未开放
  };

  /* ---------------- 等级系统 ---------------- */
  var LEVEL = {
    maxLevel: 30,
    expBase: 40,        // Lv1→2 需要 40 经验
    expPow: 1.30,       // 每级需求 ×1.30
    // 每级加成（累乘）—— 影响全部战斗属性
    bonus: {
      hp: 0.08,         // 最大 HP +8%/级
      dmg: 0.06,        // 伤害 +6%/级
      aspd: 0.02        // 攻速 +2%/级（体现为 interval 缩短）
    }
  };

  /** 升到下一级所需经验（当前等级 → 下一级） */
  function expNext(level) {
    return Math.round(LEVEL.expBase * Math.pow(LEVEL.expPow, Math.max(0, level - 1)));
  }

  /** 累计到某等级所需的总经验（仅供展示 / 调试） */
  function expTotal(level) {
    var t = 0;
    for (var i = 1; i < level; i++) t += expNext(i);
    return t;
  }

  /* ---------------- 经验来源 ----------------
   * 主人定调：喂养 / 浇水分少量给，战斗击杀是主来源，高等级敌人给更多。
   */
  var EXP = {
    feed: 5,            // 每喂 1 个材料
    water: 2,           // 每次浇水 / 施肥
    // 战斗击杀：按敌人 role 给分。越硬越值钱。
    kill: {
      grunt: 2, swarm: 1, swift: 3, armor: 5,
      elite: 10, boss: 25, spider: 8, bee: 4
    },
    // 兜底：role 不在表内时按敌人最大 HP 反推（每 60 点 HP ≈ 1 经验，下限 1）
    killFallbackPerHp: 60
  };

  /** 击杀某敌人给多少经验（role 命中表优先，否则按 HP 兜底） */
  function killExp(roleKey, hpMax) {
    if (roleKey && EXP.kill[roleKey] !== undefined) return EXP.kill[roleKey];
    if (hpMax && hpMax > 0) return Math.max(1, Math.round(hpMax / EXP.killFallbackPerHp));
    return 1;
  }

  /* ---------------- 等级加成 ---------------- */

  /**
   * 某形态在某等级下的战斗属性。
   * 全部战斗属性都受等级影响（主人定：影响全部战斗属性）。
   */
  function statAt(kind, level, key) {
    var m = PLANTS_META[kind];
    if (!m || !m.base) return 0;
    var lv = Math.max(1, level || 1) - 1;      // Lv1 无加成
    if (key === 'hp') return Math.round(m.base.hp * (1 + LEVEL.bonus.hp * lv));
    if (key === 'dmg') return round2(m.base.dmg * (1 + LEVEL.bonus.dmg * lv));
    if (key === 'interval') return round2(m.base.interval / (1 + LEVEL.bonus.aspd * lv));
    return m.base[key];
  }

  /** 某等级下的最大 HP（宠物自己的血条，非战场实例血） */
  function hpMaxAt(kind, level) {
    var m = PLANTS_META[kind];
    if (!m) return 1;
    var lv = Math.max(1, level || 1) - 1;
    return Math.round(m.hpMax * (1 + LEVEL.bonus.hp * lv));
  }

  function round2(v) { return Math.round(v * 100) / 100; }

  /* ---------------- 进化判定 ---------------- */

  /**
   * 能否进化到某分支。三条件（等级 + 材料 + 金币）全满足才行。
   *
   * ★ 材料与金币存在 profile 上，不在 pet 上 —— 必须显式传 res。
   *   res 缺省时回退到 pet.materials / pet.gold（兼容旧的单元测试写法）。
   *
   * @param pet   {kind, level, ...}
   * @param branch BRANCHES 里的一条
   * @param res   {materials:{key:n}, gold:n}
   * @returns {ok, reason, key?, have?, need?}
   *          reason: 'locked'|'level'|'material'|'gold'|null
   */
  function canEvolve(pet, branch, res) {
    if (!pet || !branch) return { ok: false, reason: 'locked' };
    var m = PLANTS_META[branch.to];
    if (!m || m.locked) return { ok: false, reason: 'locked' };
    var lv = pet.level || 1;
    if (lv < branch.level) return { ok: false, reason: 'level', have: lv, need: branch.level };

    res = res || { materials: pet.materials || {}, gold: pet.gold || 0 };
    var mats = res.materials || {};
    var need = branch.materials || {};
    for (var k in need) {
      var have = mats[k] || 0;
      if (have < need[k]) return { ok: false, reason: 'material', key: k, have: have, need: need[k] };
    }
    var g = res.gold || 0;
    if (g < (branch.gold || 0)) return { ok: false, reason: 'gold', have: g, need: branch.gold || 0 };
    return { ok: true, reason: null };
  }

  /** 把 canEvolve 的失败原因翻译成人话（UI / toast 直接显示） */
  function canEvolveText(chk) {
    if (!chk || chk.ok) return '';
    if (chk.reason === 'locked') return '该形态尚未开放';
    if (chk.reason === 'level') return '等级不足（需 Lv.' + chk.need + '，当前 Lv.' + chk.have + '）';
    if (chk.reason === 'material') return '缺少 ' + matName(chk.key) + '（' + chk.have + '/' + chk.need + '）';
    if (chk.reason === 'gold') return '金币不足（' + chk.have + '/' + chk.need + '）';
    return '条件不满足';
  }

  /** 进化条件的中文描述（UI 直接显示） */
  function branchReqText(branch) {
    if (!branch) return '';
    var parts = ['Lv.' + branch.level];
    for (var k in (branch.materials || {})) {
      parts.push(matName(k) + ' ×' + branch.materials[k]);
    }
    if (branch.gold) parts.push(branch.gold + ' 金币');
    return parts.join(' + ');
  }

  /* ---------------- 材料 ---------------- */

  var MATERIALS = {
    redtomato: { name: '红番茄', color: '#e8503a', shape: 'tomato', locked: false,
      desc: '饱满的红番茄。喂下去，牙苗会往「毒」的那边长。' },
    smallchili: { name: '小辣椒', color: '#d63b2f', shape: 'chili', locked: false,
      desc: '辛辣的小辣椒。喂下去，牙苗会往「火」的那边长。' }
  };

  function matName(key) { return (MATERIALS[key] && MATERIALS[key].name) || key; }

  /* ---------------- 战斗数值导出 ----------------
   * 给 battlefield.js 的 PLANTS 表用。只输出「可参战」的形态，
   * 未开放的（locked）也一并导出无害 —— 反正 UI 点不开、也拿不到。
   */
  function combatDefs() {
    var out = {};
    for (var k in PLANTS_META) {
      var m = PLANTS_META[k];
      // 深拷贝 base，避免外部改动污染本表
      out[k] = JSON.parse(JSON.stringify(m.base));
      out[k].petKind = k;            // 标记这是培育植物
      out[k].petLocked = !!m.locked; // 未开放的即使被强行种下也不该出战
    }
    return out;
  }

  /* ---------------- 导出 ---------------- */
  global.PetsData = {
    VARIANTS: VARIANTS,
    PLANTS_META: PLANTS_META,
    BRANCHES: BRANCHES,
    LEVEL: LEVEL,
    EXP: EXP,
    MATERIALS: MATERIALS,

    expNext: expNext,
    expTotal: expTotal,
    killExp: killExp,
    statAt: statAt,
    hpMaxAt: hpMaxAt,
    canEvolve: canEvolve,
    canEvolveText: canEvolveText,
    branchReqText: branchReqText,
    matName: matName,
    combatDefs: combatDefs,

    /** 某形态的进化分支列表（无分支返回空数组） */
    branchesOf: function (kind) { return BRANCHES[kind] || []; },
    /** 形态定义 */
    defOf: function (kind) { return PLANTS_META[kind] || null; },
    /** 该形态是否已开放 */
    isOpen: function (kind) { var m = PLANTS_META[kind]; return !!m && !m.locked; }
  };
})(window);
