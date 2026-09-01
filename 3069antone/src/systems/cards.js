/* ============================================================
 *  Cards —— 肉鸽三选一卡牌系统
 *
 *  架构约束（与 Board2048 / Battlefield 同等级别的独立性）：
 *    · 不 import 任何系统，只通过 Bus 广播 MOD_CHANGED
 *    · 各系统自行订阅、自行取用自己关心的字段，并保留自己的默认值副本
 *    · 这样即使 Cards 整个移除，Board / Battle 依然能跑
 *
 *  数值来源：sim_card_pp.py —— 战力点(PP)统一尺子
 *    1 PP = 关 1 每波总输出(1366) 的 1% = 13.66 伤害/波
 *    合格区间：普通 4–7 / 稀有 7–11 / 史诗 11–20 / 传说 20+
 *
 *  设计规则（GDD v0.2 §3）：
 *    1. 步数/充能类是最强杠杆，不进普通池
 *    2. 经济卡独立成池，每 3 次三选一的第 3 张固定从经济池抽
 *    3. 星枢告急（<40%）时，第 3 张改从生存池抽 —— 响应式救场
 * ============================================================ */
(function (global) {
  'use strict';
  var EV = global.Bus.EV, M = global.M;

  var ELEMENTS = ['fire', 'water', 'wood', 'light', 'thunder', 'ice'];
  var ELEMENT_CN = { fire: '火', water: '水', wood: '木', light: '光', thunder: '雷', ice: '冰' };

  /* ---------------- 修正值默认值（各系统会复制一份） ---------------- */
  function defaultMod() {
    return {
      // 植物侧
      plantDmg: 1,          // 植物伤害倍率
      plantAspd: 1,         // 植物攻速倍率
      critRate: 0,          // 暴击率
      critMult: 2.0,        // 暴击倍率
      pierce: 0,            // 无视护甲比例
      symbiosis: 0,         // 共生层数：每株植物 +5% × 层数
      cabbageDmg: 1,
      cabbageR: 1,          // 溅射半径倍率
      cabbageAoe: 0,        // 溅射伤害比增量
      extraPea: 0,          // 额外豌豆数
      extraPeaRatio: 0,     // 额外豌豆伤害比

      // 附魔侧
      chargeGain: 1,        // 充能获取倍率
      poolMult: 1,          // 伤害池倍率
      chainCharge: 1,       // 连锁合成充能倍率
      twinCast: 0,          // 追加打击比例
      overloadGate: 256,    // 超载门槛
      starBonus: 0,         // 星级威力 +n 档
      elemPower: { fire: 1, water: 1, wood: 1, light: 1, thunder: 1, ice: 1 },
      iceSlowAdd: 0,
      iceDurAdd: 0,

      // 棋盘侧
      stepRegen: 1,         // 步数回复速度倍率
      stepGiftAdd: 0,       // 波首赠送步数增量
      cvMult: 1,            // CV' 倍率

      // 经济
      goldMult: 1, shardMult: 1, starMult: 1, matAdd: 0,

      // 生存
      nodeMaxAdd: 0, leakDmgMult: 1, waveHeal: 0,

      // 开局
      extraSprout: 0
    };
  }

  /* ============================================================
   *  卡池定义
   *  pp      —— 战力点（由 sim_card_pp.py 计算，改动必须同步重算）
   *  rarity  —— 普通/稀有/史诗/传说/经济/生存
   *  apply   —— 把效果写进 mod；需要运行时行为的卡只写标记，由对应系统读
   *  max     —— 持有上限（默认 99）
   * ============================================================ */
  var POOL = [
    /* ---------------- 普通 ---------------- */
    {
      id: 'sharp', name: '锋锐', rarity: '普通', pp: 6.0, tag: 'plant',
      desc: '植物伤害 +12%', flavor: '磨快的叶缘能割开甲壳。',
      apply: function (m) { m.plantDmg *= 1.12; }
    },
    {
      id: 'rapid', name: '连射', rarity: '普通', pp: 6.0, tag: 'plant',
      desc: '植物攻速 +12%', flavor: '快到看不清第二颗。',
      apply: function (m) { m.plantAspd *= 1.12; }
    },
    {
      id: 'crit', name: '暴击', rarity: '普通', pp: 6.0, tag: 'plant',
      desc: '植物暴击率 +12%（暴击 2.0×）', flavor: '瞄准节肢之间的缝隙。',
      apply: function (m) { m.critRate += 0.12; }
    },
    {
      id: 'pierce', name: '破甲', rarity: '普通', pp: 4.5, tag: 'situational',
      desc: '无视目标 60% 护甲', flavor: '情境卡 —— 对无甲目标无效。',
      apply: function (m) { m.pierce += 0.60; }
    },
    {
      id: 'frostbite', name: '霜噬', rarity: '普通', pp: 4.4, tag: 'situational',
      desc: '冰减速 30%→60%、持续 +2.5s，冰附魔伤害 +20%',
      flavor: '冻住的不只是腿，还有时间。',
      apply: function (m) { m.elemPower.ice += 0.20; m.iceSlowAdd += 0.30; m.iceDurAdd += 2.5; }
    },

    /* ---------------- 稀有 ---------------- */
    {
      id: 'gale', name: '疾风', rarity: '稀有', pp: 7.6, tag: 'step',
      desc: '步数回复速度 +15%', flavor: '手快的人，棋盘也跟着快。',
      apply: function (m) { m.stepRegen *= 1.15; }
    },
    {
      id: 'symbiosis', name: '共生', rarity: '稀有', pp: 7.4, tag: 'plant',
      desc: '每株植物使全体植物伤害 +5%（3 株 = +15%）',
      flavor: '根在地下牵着手。',
      apply: function (m) { m.symbiosis += 1; }
    },
    {
      id: 'overcharge', name: '超充', rarity: '稀有', pp: 9.1, tag: 'charge',
      desc: '充能获取 +18%', flavor: '把余量塞进不该塞的地方。',
      apply: function (m) { m.chargeGain *= 1.18; }
    },
    {
      id: 'cascade', name: '连锁', rarity: '稀有', pp: 7.7, tag: 'charge',
      desc: '单次移动中第 2 次及以后的合成，充能 +45%',
      flavor: '一次推动，层层回响。（重做自「连锁核心」）',
      apply: function (m) { m.chainCharge += 0.45; }
    },
    {
      id: 'bigshot', name: '巨弹', rarity: '稀有', pp: 7.3, tag: 'plant',
      desc: '卷心菜伤害 +10%，溅射半径 +40%，溅射伤害比 +25%',
      flavor: '砸下去的时候，地面会凹一块。',
      apply: function (m) { m.cabbageDmg *= 1.10; m.cabbageR *= 1.40; m.cabbageAoe += 0.25; }
    },
    {
      id: 'twinbarrel', name: '双管', rarity: '稀有', pp: 8.6, tag: 'plant',
      desc: '豌豆射手每次攻击额外发射 1 颗 30% 伤害的豌豆',
      flavor: '第二根管子是后来焊上去的。',
      apply: function (m) { m.extraPea += 1; m.extraPeaRatio += 0.30; }
    },

    /* ---------------- 史诗 ---------------- */
    {
      id: 'surge', name: '涌流', rarity: '史诗', pp: 18.4, tag: 'step',
      desc: '充能获取 +30%，波首赠送步数 +2',
      flavor: '潮水从棋盘底下涌上来。',
      apply: function (m) { m.chargeGain *= 1.30; m.stepGiftAdd += 2; }
    },
    {
      id: 'overload_core', name: '超载核心', rarity: '史诗', pp: 12.6, tag: 'enchant',
      desc: '所有附魔伤害池 +25%', flavor: '核心早就超过额定功率了。',
      apply: function (m) { m.poolMult *= 1.25; }
    },
    {
      id: 'twin_cast', name: '双生', rarity: '史诗', pp: 15.1, tag: 'enchant',
      desc: '每次附魔追加一次 30% 伤害池的随机元素打击',
      flavor: '同一道咒文，念了两遍。',
      apply: function (m) { m.twinCast += 0.30; }
    },
    {
      id: 'genesis', name: '创世', rarity: '史诗', pp: 11.6, tag: 'econ', max: 3,
      desc: '每关开始额外获得 1 株牙苗', flavor: '一切从一颗芽开始。',
      apply: function (m) { m.extraSprout += 1; }
    },

    /* ---------------- 传说 ---------------- */
    {
      id: 'harvest', name: '丰收', rarity: '传说', pp: 20.2, tag: 'econ', max: 2,
      desc: '充能获取 ×1.40，CV ×1.20（重做自「丰饶」）',
      flavor: '原版每步多生成 1 方块 —— 战力点 48.8，必须重做。',
      apply: function (m) { m.chargeGain *= 1.40; m.cvMult *= 1.20; }
    },
    {
      id: 'singularity', name: '奇点', rarity: '传说', pp: 27.7, tag: 'enchant', max: 1,
      desc: '超载门槛 256 → 128，且星级威力 +1 档',
      flavor: '在这一点上，规则失效。',
      apply: function (m) { m.overloadGate = 128; m.starBonus += 1; }
    },

    /* ---------------- 经济池（不与战斗卡竞争） ---------------- */
    {
      id: 'greed', name: '贪婪', rarity: '经济', pp: 0, tag: 'econ',
      desc: '金币获取 +30%', flavor: '金币不会自己长腿跑掉。',
      apply: function (m) { m.goldMult *= 1.30; }
    },
    {
      id: 'shard_seeker', name: '碎屑搜寻', rarity: '经济', pp: 0, tag: 'econ',
      desc: '碎片获取 +40%', flavor: '甲壳碎片也是碎片。',
      apply: function (m) { m.shardMult *= 1.40; }
    },
    {
      id: 'stardust', name: '星尘亲和', rarity: '经济', pp: 0, tag: 'econ',
      desc: '星核获取 +25%', flavor: '合成时的光，收集起来。',
      apply: function (m) { m.starMult *= 1.25; }
    },
    {
      id: 'scavenger', name: '拾荒', rarity: '经济', pp: 0, tag: 'econ',
      desc: '击杀护甲敌人额外掉落 1 材料', flavor: '天牛的鞘翅是硬通货。',
      apply: function (m) { m.matAdd += 1; }
    },

    /* ---------------- 生存池（星枢告急时才会出现） ---------------- */
    {
      id: 'bastion', name: '壁垒', rarity: '生存', pp: 0, tag: 'defense',
      desc: '星枢上限 +40，并立即回满', flavor: '先活下来，再谈输出。',
      apply: function (m) { m.nodeMaxAdd += 40; }
    },
    {
      id: 'thorn', name: '尖刺', rarity: '生存', pp: 0, tag: 'defense',
      desc: '漏怪伤害 -35%', flavor: '星枢外面长了一圈刺。',
      apply: function (m) { m.leakDmgMult *= 0.65; }
    },
    {
      id: 'mender', name: '修补', rarity: '生存', pp: 0, tag: 'defense',
      desc: '每清一波回复星枢 6 点', flavor: '清完场，喘口气。',
      apply: function (m) { m.waveHeal += 6; }
    }
  ];

  /* 元素亲和 6 个变体 —— 代码生成，避免手写 6 份 */
  ELEMENTS.forEach(function (el) {
    POOL.push({
      id: 'affinity_' + el, name: '元素亲和·' + ELEMENT_CN[el],
      rarity: '普通', pp: 4.2, tag: 'element', variant: true,
      desc: ELEMENT_CN[el] + '元素威力 +50%',
      flavor: '同调越深，回响越强。',
      element: el,
      apply: function (m) { m.elemPower[el] += 0.50; }
    });
  });

  var BY_ID = Object.create(null);
  POOL.forEach(function (c) {
    c.max = c.max || 99;
    BY_ID[c.id] = c;
  });

  /* ---------------- 稀有度抽取权重（随波次推进） ----------------
   * 设计意图：前两波只给普通，让玩家先建立「卡是干什么的」的认知；
   *          第 3 波起放稀有，第 6 波起放史诗，第 10 波起放传说。
   */
  function rarityWeights(wave) {
    var w = wave || 1;
    return {
      '普通': Math.max(0, 100 - w * 6),
      '稀有': w >= 3 ? Math.min(46, (w - 2) * 8) : 0,
      '史诗': w >= 6 ? Math.min(24, (w - 5) * 4) : 0,
      '传说': w >= 10 ? Math.min(9, (w - 9) * 2) : 0
    };
  }

  /* ============================================================ */

  function CardSystem(opts) {
    opts = opts || {};
    this.rng = new global.RNG(opts.seed || (Math.random() * 1e9) | 0);
    this.mod = defaultMod();
    this.owned = Object.create(null);   // id -> 层数
    this.history = [];                  // 取卡顺序
    this.wave = 0;
    this.drafts = 0;
    this.pending = null;                // 当前待选的三张
    this.enabled = true;

    // 外部加成注入点（元养成树）。函数签名 fn(mod) -> void，按注册顺序执行。
    // 用装饰器而不是让 Meta 直接改 mod，是为了让「谁改了什么」永远可追溯。
    this._decorators = [];

    // 数值表覆盖层（挂载点⑦）：编辑器导出的 tuning.cards 可改卡牌 pp/上限/稀有度等。
    // 仅改数值字段，不碰 apply() 逻辑与元素变体标记；缺省（无编辑器数据）不受影响。
    if (opts.tuning && opts.tuning.cards) this.applyTuning(opts.tuning.cards);

    this._bind();
  }

  /**
   * 注册一个 mod 装饰器。典型用法：Meta 把永久养成树的加成叠进来。
   * @returns 反注册函数
   */
  CardSystem.prototype.addDecorator = function (fn) {
    this._decorators.push(fn);
    var self = this;
    return function () {
      self._decorators = self._decorators.filter(function (f) { return f !== fn; });
    };
  };

  CardSystem.POOL = POOL;
  CardSystem.BY_ID = BY_ID;
  CardSystem.ELEMENTS = ELEMENTS;
  CardSystem.ELEMENT_CN = ELEMENT_CN;
  CardSystem.defaultMod = defaultMod;
  CardSystem.rarityWeights = rarityWeights;

  CardSystem.prototype._bind = function () {
    var self = this;
    global.Bus.on(EV.WAVE_START, function (p) { self.wave = p.wave || 1; }, this);
    global.Bus.on(EV.CMD_CARD_PICK, function (p) { self.pick(p.id); }, this);
  };

  /* ---------------- 抽卡 ---------------- */

  CardSystem.prototype._pickRarity = function () {
    var w = rarityWeights(this.wave);
    var total = 0, k;
    for (k in w) total += w[k];
    if (total <= 0) return '普通';
    var r = this.rng.next() * total;
    for (k in w) { r -= w[k]; if (r <= 0) return k; }
    return '普通';
  };

  CardSystem.prototype._candidates = function (rarity) {
    var self = this;
    return POOL.filter(function (c) {
      return c.rarity === rarity && (self.owned[c.id] || 0) < c.max;
    });
  };

  /** 按稀有度抽一张；该稀有度抽空则逐级降级，保证永远给得出卡 */
  CardSystem.prototype._drawByRarity = function (rarity) {
    var order = ['传说', '史诗', '稀有', '普通'];
    var start = order.indexOf(rarity);
    if (start < 0) start = 3;
    for (var i = start; i < order.length; i++) {
      var cand = this._candidates(order[i]);
      if (cand.length) return cand[this.rng.int(0, cand.length - 1)];
    }
    // 全池兜底（理论上到不了这里）
    var all = POOL.filter(function (c) {
      return c.rarity !== '经济' && c.rarity !== '生存';
    });
    return all[this.rng.int(0, all.length - 1)];
  };

  CardSystem.prototype._drawFrom = function (poolName) {
    var self = this;
    var cand = POOL.filter(function (c) {
      return c.rarity === poolName && (self.owned[c.id] || 0) < c.max;
    });
    if (!cand.length) return null;
    return cand[this.rng.int(0, cand.length - 1)];
  };

  /**
   * 开一次三选一。
   *  reason: 'wave'（波次清空）/ 'level'（过关）
   * 第三张的归属规则：
   *   · 星枢 < 40%  → 生存池（响应式救场）
   *   · 每第 3 次    → 经济池（保证拿得到，又不占构筑位）
   */
  CardSystem.prototype.openDraft = function (reason, nodeRatio) {
    this.drafts++;
    var opts = [];
    var used = Object.create(null);

    function push(c) { if (c && !used[c.id]) { used[c.id] = 1; opts.push(c); } }

    push(this._drawByRarity(this._pickRarity()));
    push(this._drawByRarity(this._pickRarity()));

    var third = null;
    if (nodeRatio !== undefined && nodeRatio < 0.40) {
      third = this._drawFrom('生存');
    } else if (this.drafts % 3 === 0) {
      third = this._drawFrom('经济');
    }
    if (third) push(third);
    while (opts.length < 3) {
      var extra = this._drawByRarity(this._pickRarity());
      if (used[extra.id]) break;
      push(extra);
    }

    this.pending = { options: opts, wave: this.wave, reason: reason || 'wave', t: 0 };
    global.Bus.emit(EV.CARD_DRAFT, {
      options: opts, wave: this.wave, reason: this.pending.reason
    });
    return this.pending;
  };

  /** 选卡：叠加 → 重算 mod → 广播 */
  CardSystem.prototype.pick = function (id) {
    if (!this.pending) return null;
    var card = null, idx = -1;
    for (var i = 0; i < this.pending.options.length; i++) {
      if (this.pending.options[i].id === id) { card = this.pending.options[i]; idx = i; break; }
    }
    if (!card) return null;

    this.owned[id] = (this.owned[id] || 0) + 1;
    this.history.push({ id: id, wave: this.wave, at: Date.now() });
    this.recompute();

    // 壁垒需要立刻回满星枢 —— 这类「一次性生效」用命令事件下发，不污染 mod
    if (id === 'bastion') global.Bus.emit(EV.CMD_HEAL_NODE, { amount: 9999 });

    this.pending = null;
    global.Bus.emit(EV.CARD_PICKED, { card: card, index: idx, stack: this.owned[id] });
    global.Bus.emit(EV.TOAST, {
      text: '获得【' + card.name + '】' + (this.owned[id] > 1 ? ' ×' + this.owned[id] : ''),
      kind: card.rarity === '传说' ? 'jackpot' : 'good'
    });
    return card;
  };

  /** 从零重算 mod —— 保证「拿卡顺序不影响最终数值」 */
  CardSystem.prototype.recompute = function () {
    var m = defaultMod();
    for (var id in this.owned) {
      var card = BY_ID[id];
      if (!card) continue;
      var n = this.owned[id];
      for (var i = 0; i < n; i++) card.apply(m);
    }
    for (var d = 0; d < this._decorators.length; d++) {
      try { this._decorators[d](m); }
      catch (e) { console.error('[Cards] decorator error', e); }
    }
    this.mod = m;
    global.Bus.emit(EV.MOD_CHANGED, { mod: m });
    return m;
  };

  /* ---------------- 查询 ---------------- */

  CardSystem.prototype.count = function (id) { return this.owned[id] || 0; };

  CardSystem.prototype.totalPP = function () {
    var t = 0;
    for (var id in this.owned) {
      var c = BY_ID[id];
      if (c) t += c.pp * this.owned[id];
    }
    return t;
  };

  /** 构筑摘要：按稀有度分组，供结算页展示 */
  CardSystem.prototype.summary = function () {
    var out = [];
    for (var id in this.owned) {
      var c = BY_ID[id];
      if (!c) continue;
      out.push({ card: c, n: this.owned[id], pp: c.pp * this.owned[id] });
    }
    out.sort(function (a, b) { return b.pp - a.pp; });
    return out;
  };

  CardSystem.prototype.reset = function () {
    this.owned = Object.create(null);
    this.history = [];
    this.drafts = 0;
    this.wave = 0;
    this.pending = null;
    this.recompute();
  };

  /**
   * 数值表覆盖层（挂载点⑦）：把编辑器 tuning.cards 合并进卡池。
   * 只改数值/展示字段（pp / max / rarity / tag / name / desc / flavor），
   * 不碰 apply() 与 element 变体标记，避免破坏抽卡与加成逻辑。
   * POOL 与 BY_ID 指向同一批对象，改一处即两处生效。
   */
  CardSystem.prototype.applyTuning = function (cards) {
    if (!cards || typeof cards !== 'object') return;
    for (var id in cards) {
      var c = BY_ID[id];
      if (!c) continue;
      var ov = cards[id];
      if (typeof ov !== 'object') continue;
      if (typeof ov.pp === 'number') c.pp = ov.pp;
      if (typeof ov.max === 'number') c.max = ov.max;
      if (typeof ov.rarity === 'string') c.rarity = ov.rarity;
      if (typeof ov.tag === 'string') c.tag = ov.tag;
      if (typeof ov.name === 'string') c.name = ov.name;
      if (typeof ov.desc === 'string') c.desc = ov.desc;
      if (typeof ov.flavor === 'string') c.flavor = ov.flavor;
    }
  };

  global.Cards = CardSystem;
})(window);
