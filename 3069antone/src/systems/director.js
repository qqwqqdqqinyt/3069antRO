/* ============================================================
 *  Director —— 胶水层（唯一允许同时认识两个系统的地方）
 *
 *  职责：把 Board2048 的产出翻译成战场能懂的语言，反之亦然。
 *    merge  → CV' 归一化 → 星核/金币/碎片/晶核 + 充能
 *    充能满 → 小附魔（元素轮盘）→ 伤害池
 *    ≥256   → 超载（星级威力）→ 伤害池
 *    波次开 → 赠送步数 STEP_GIFT
 *    漏怪   → 星枢扣血（由 Battlefield 内部处理，这里只做 UI 反馈）
 *
 *  数值全部来自 Balance_星序防线_v0.2.xlsx 的 01_核心常量。
 * ============================================================ */
(function (global) {
  'use strict';
  var EV = global.Bus.EV, M = global.M;

  var K = {
    CHARGE_MAX: 100,
    CHARGE_K: 2.9,
    LOG_CORR: 0.78,
    EP_BASE: 180,
    ELEM_CAP: 2.5,
    K_STAR: 0.15,
    K_GOLD: 1.0,
    K_SHARD: 0.04,
    STEP_GIFT: 2,
    RES2: 1.4,
    RES3: 1.8,
    // 星级威力系数：index = 星数（0 保留给小附魔=1.0）
    STAR_POW: [1.0, 2.0, 3.5, 6.0, 10.0, 16.0, 25.0]
  };

  /* ---------------- 培育材料掉落表 ----------------
   * 主人 2026-09-02 定：第一关 22% 概率各掉 1 个红番茄 / 小辣椒。
   * 基础材料（只能卖钱，1:1）单独一条，50% 掉 1 个。
   *
   * ★ 两类材料别混（它们的消费路径完全不同）：
   *     materials —— 进化材料字典，喂宠物 or 进化
   *     basic     —— 基础材料，只能卖金币
   *
   * ★ 每个敌人独立判定，不是「整关保底」。想要关卡专属掉落表，
   *   往 DROP.materials 里加关卡号即可，缺的关卡回落到第 1 关。
   */
  var DROP = {
    materials: {
      1: [
        { key: 'redtomato', rate: 0.22, n: 1 },
        { key: 'smallchili', rate: 0.22, n: 1 }
      ]
    },
    basic: { rate: 0.50, n: 1 }
  };

  function Director(opts) {
    opts = opts || {};
    this.board = opts.board;
    this.battle = opts.battle;

    this.charge = 0;
    this.lastElement = null;
    this.streak = 0;
    this.level = 1;              // 当前关卡（决定用哪张掉落表）
    this.currency = {
      stardust: 0, shard: 0, gold: 0, material: 0, core: 0, star: 0,
      materials: {},             // 进化材料字典 {redtomato: n, …}
      basic: 0                   // 基础材料（卖钱用）
    };
    this.roulette = ['thunder', 'fire', 'ice', 'wood', 'water', 'light'];
    this.wheelPtr = 0;
    this.casts = { small: 0, overload: 0 };
    this.lastCast = null;
    this.castFx = [];        // {element, pool, star, t, life}
    this.enabled = true;

    // 卡牌修正值副本（只取 Director 关心的字段）
    this.mod = {
      chargeGain: 1, chainCharge: 1, cvMult: 1, poolMult: 1,
      overloadGate: 256, starBonus: 0,
      goldMult: 1, shardMult: 1, starMult: 1, matAdd: 0, stepGiftAdd: 0,
      matDrop: 1            // 材料掉落率倍率（养成树「果实」分支 +5%/级）
    };

    // 核心常量副本（实例级）：数值表覆盖层（挂载点⑦）可经 opts.tuning.economy 覆盖
    // CHARGE_MAX / CHARGE_K / EP_BASE / ELEM_CAP / STEP_GIFT / STAR_POW 等。
    // 缺省（无编辑器数据）则与模块默认 K 逐位一致 —— 游戏本体行为不变。
    this.K = Object.assign({}, K);
    if (opts.tuning && opts.tuning.economy) {
      var eco = opts.tuning.economy;
      ['CHARGE_MAX', 'CHARGE_K', 'EP_BASE', 'ELEM_CAP', 'STEP_GIFT',
        'STAR_POW', 'K_STAR', 'K_GOLD', 'K_SHARD', 'RES2', 'RES3'].forEach(function (k) {
        if (eco[k] !== undefined && eco[k] !== null) this.K[k] = eco[k];
      }, this);
    }

    this._bind();
  }

  Director.K = K;

  Director.prototype._bind = function () {
    var self = this;
    global.Bus.on(EV.BOARD_MERGE, function (m) { self.onMerge(m); }, this);
    global.Bus.on(EV.WAVE_START, function (p) {
      if (p.level) self.level = p.level;
      if (self.board) self.board.grantSteps(self.K.STEP_GIFT + self.mod.stepGiftAdd);
      global.Bus.emit(EV.TOAST, { text: '第 ' + p.wave + ' 波 · ' + (p.intent || ''), kind: 'wave' });
    }, this);
    global.Bus.on(EV.WAVE_CLEAR, function (p) {
      global.Bus.emit(EV.TOAST, { text: '波次清空 · 累计击杀 ' + p.kills, kind: 'good' });
    }, this);
    global.Bus.on(EV.LEVEL_CLEAR, function (p) {
      var nt = M.clamp(p.level + 1, 1, 5);
      var tierFor = [1, 1, 2, 2, 3, 3, 4, 4, 4, 5, 5];
      var t = tierFor[M.clamp(p.level, 1, 11) - 1] || 5;
      if (self.board) self.board.setTier(t);
      global.Bus.emit(EV.TOAST, { text: '第 ' + p.level + ' 关通过 · 生成池升至 T' + t, kind: 'level' });
    }, this);
    global.Bus.on(EV.ENEMY_DEAD, function (p) {
      self.currency.gold += p.enemy.gold * self.mod.goldMult;
      // 拾荒：护甲敌人额外掉材料（掉落数 = 1 基础 + 卡层数）
      if (p.enemy.armor > 0.2) self.currency.material += 1 + self.mod.matAdd;
      // 培育材料掉落（进化材料 + 基础材料，逐个独立判定）
      var items = self.rollDrop(p.enemy);
      if (items.length) {
        global.Bus.emit(EV.MATERIAL_DROP, { items: items, enemy: p.enemy });
      }
      self._emitCurrency();
    }, this);
    global.Bus.on(EV.BOARD_JAMMED, function () {
      global.Bus.emit(EV.TOAST, { text: '棋盘已堵死 —— 尽快合成腾出空间', kind: 'bad' });
    }, this);

    // 卡牌修正：按字段取值
    global.Bus.on(EV.MOD_CHANGED, function (p) {
      var keys = ['chargeGain', 'chainCharge', 'cvMult', 'poolMult', 'overloadGate',
        'starBonus', 'goldMult', 'shardMult', 'starMult', 'matAdd', 'stepGiftAdd',
        'matDrop'];
      for (var i = 0; i < keys.length; i++) self.mod[keys[i]] = p.mod[keys[i]];
    }, this);
  };

  /* ---------------- 合成 → 资源 + 充能 ---------------- */

  Director.prototype.onMerge = function (m) {
    if (!this.enabled || !this.board) return;
    var E = this.board.E();
    var cv = (m.value / E) * this.mod.cvMult;   // CV'（归一化合成值）

    // 货币
    var gain = {
      star: cv * this.K.K_STAR * this.mod.starMult,
      gold: cv * this.K.K_GOLD * this.mod.goldMult,
      shard: cv * this.K.K_SHARD * this.mod.shardMult,
      core: this._coreOf(m.value)
    };
    this.currency.star += gain.star;
    this.currency.gold += gain.gold;
    this.currency.shard += gain.shard;
    this.currency.core += gain.core;
    this._emitCurrency();

    // 充能
    // ★ 注意：LOG_CORR 是「用平均合成值反推期望充能」时的 Jensen 修正，
    //   不是每次合成都要乘的系数。每次合成的公式就是 k × log2(v/E)；
    //   对 v 取期望后自然等于 k × LOG_CORR × log2(E[v]/E) = k × 0.78 × log2(5.47)。
    //   （v0.2 表里把 LOG_CORR 又乘了一遍，导致充能速率被系统性低估 22%。）
    // 连锁：本次移动中第 2 次及以后的合成，充能额外加成
    var chainBoost = (m.seq > 0) ? this.mod.chainCharge : 1;
    var cg = this.K.CHARGE_K * Math.log(m.value / E) / Math.LN2 * this.mod.chargeGain * chainBoost;
    this.charge += cg;
    global.Bus.emit(EV.CHARGE_GAIN, { gain: cg, charge: this.charge, max: this.K.CHARGE_MAX });

    // 超载：v >= 门槛（「奇点」把它从 256 降到 128）
    if (m.value >= this.mod.overloadGate) {
      var star = Math.round(Math.log(m.value) / Math.LN2) - 7 + this.mod.starBonus;
      star = M.clamp(star, 1, 6);
      var power = this.K.STAR_POW[star];
      var pool = this.K.EP_BASE * power * this.K.ELEM_CAP * this.mod.poolMult;
      this.casts.overload++;
      this._cast(pool, 'overload', star, m);
      return;
    }

    // 小附魔：充能满
    while (this.charge >= this.K.CHARGE_MAX) {
      this.charge -= this.K.CHARGE_MAX;
      var p2 = this.K.EP_BASE * 1.0 * this.K.ELEM_CAP * this.mod.poolMult;
      this.casts.small++;
      this._cast(p2, 'small', 0, m);
    }
  };

  Director.prototype._coreOf = function (v) {
    if (v >= 2048) return 8;
    if (v >= 512) return 3;
    if (v >= 128) return 1;
    return 0;
  };

  /* ---------------- 附魔释放 ---------------- */

  Director.prototype._cast = function (pool, source, star, merge) {
    var el = this._nextElement();
    // 共鸣：连续同元素
    var mult = 1;
    if (el === this.lastElement) {
      this.streak++;
      if (this.streak >= 2) mult = this.K.RES3;
      else mult = this.K.RES2;
    } else {
      this.streak = 0;
    }
    this.lastElement = el;
    var total = pool * mult;

    this.lastCast = { element: el, pool: total, star: star, source: source, t: 0, streak: this.streak, mult: mult };
    this.castFx.push(this.lastCast);

    global.Bus.emit(EV.ENCHANT_CAST, {
      element: el, pool: total, base: pool, mult: mult,
      star: star, source: source, merge: merge || null
    });
    global.Bus.emit(EV.CMD_DAMAGE_POOL, { pool: total, element: el, star: star, source: source });

    if (star >= 3) {
      global.Bus.emit(EV.TOAST, {
        text: '★' + star + ' 超载 ' + (global.Battlefield.ELEMENT_CN[el] || el) + '元素 · ' + Math.round(total) + ' 伤害池',
        kind: 'jackpot'
      });
    }
  };

  Director.prototype._nextElement = function () {
    var el = this.roulette[this.wheelPtr % this.roulette.length];
    this.wheelPtr++;
    return el;
  };

  Director.prototype.rotateWheel = function (i, dir) {
    // 玩家手动旋转轮盘某格（+1 换下一个元素）
    var list = global.Battlefield.ELEMENTS;
    var cur = this.roulette.indexOf(this.roulette[i]);
    var idx = list.indexOf(this.roulette[i]);
    this.roulette[i] = list[(idx + (dir || 1) + list.length) % list.length];
  };

  Director.prototype._emitCurrency = function () {
    global.Bus.emit(EV.CURRENCY, this.currency);
  };

  /* ---------------- 培育材料掉落 ---------------- */

  /** 该关卡的进化材料掉落表（缺配置时回落到第 1 关） */
  Director.prototype.dropTable = function (level) {
    return DROP.materials[level] || DROP.materials[1] || [];
  };

  /**
   * 一次击杀的材料掉落投骰 —— 每个条目独立判定，不是「整关保底」。
   * 概率受养成树「果实」分支加成（mod.matDrop，+5%/级）。
   * @returns [{key, count}] 本次实际掉到的东西（什么都没掉则空数组）
   */
  Director.prototype.rollDrop = function () {
    var mult = this.mod.matDrop || 1;
    var got = [];
    var table = this.dropTable(this.level || 1);

    for (var i = 0; i < table.length; i++) {
      var t = table[i];
      if (Math.random() < t.rate * mult) {
        var n = t.n || 1;
        this.currency.materials[t.key] = (this.currency.materials[t.key] || 0) + n;
        got.push({ key: t.key, count: n });
      }
    }
    var b = DROP.basic;
    if (Math.random() < b.rate * mult) {
      this.currency.basic += b.n;
      got.push({ key: 'basic', count: b.n });
    }
    return got;
  };

  Director.prototype.update = function (dt) {
    for (var i = this.castFx.length - 1; i >= 0; i--) {
      this.castFx[i].t += dt;
      if (this.castFx[i].t > 1.4) this.castFx.splice(i, 1);
    }
  };

  global.Director = Director;
})(window);
