/* ============================================================
 *  Run —— 单局流程系统（关卡推进 / 继续与收手 / 结算）
 *
 *  职责边界：
 *    · 只认识「局」这个概念：第几关、累积池多少、该不该继续
 *    · 不认识 Board / Battle / Cards 的内部，全靠事件
 *    · 战斗期间它基本是休眠的，只在关卡边界醒来
 *
 *  决策数学（GDD v0.1 §9，本文做了精确化）：
 *    收工 EV = P
 *    继续 EV = p × (P + R) + (1 − p) × b × P
 *    继续优于收工 ⟺ p > (1−b) / ((1−b) + R/P)
 *
 *  ★ 修正：GDD 把阈值写成常数 43%，那是取 R/P ≈ 0.8 的近似。
 *    实际上 R/P 随关卡递减（累进倍率 1.3 让分母追上来）：
 *      关1 R/P=1.30 → p*=31.6%    关5 R/P=0.41 → p*=59.4%
 *    阈值从 32% 一路升到 64% —— 决策张力会自然升级，
 *    这是比常数阈值更好的性质，所以按真实曲线实现。
 * ============================================================ */
(function (global) {
  'use strict';
  var EV = global.Bus.EV, M = global.M;

  var K = {
    LEVEL_MULT: 1.30,     // 每关收益递增倍率
    FAIL_KEEP: 0.40,      // b：失败保底比例
    WAVES_PER_LEVEL: 5,
    // 各货币折算成「价值单位」的权重 —— 只用于 EV 比较，不显示给玩家
    VALUE: { gold: 1.0, shard: 12.0, material: 40.0, core: 30.0, star: 8.0, stardust: 6.0 }
  };

  function Run(opts) {
    opts = opts || {};
    this.state = 'playing';       // playing | decision | settled
    this.level = 1;
    this.wave = 0;
    this.outcome = null;          // 'cashout' | 'dead'
    this.decision = null;         // 当前决策面板数据
    this.settle = null;           // 结算结果

    // 本关统计（每关开始清零，用于估算下一关收益 R）
    this.lv = this._blankLevel();
    // 本关开始时钱包快照 —— 用来算「这一关赚了多少」
    this._walletAtLevelStart = null;
    this.history = [];            // 每关的战报

    this._bind();
  }

  Run.K = K;

  Run.prototype._blankLevel = function () {
    return { kills: 0, merges: 0, cvTotal: 0, leaks: 0, best: 0, casts: 0, dmg: 0, time: 0 };
  };

  Run.prototype._bind = function () {
    var self = this;
    global.Bus.on(EV.WAVE_START, function (p) { self.wave = p.wave; }, this);
    global.Bus.on(EV.LEVEL_CLEAR, function (p) { self.onLevelClear(p.level); }, this);
    global.Bus.on(EV.NODE_DEAD, function () { self.onDead(); }, this);
    global.Bus.on(EV.BOARD_MERGE, function (m) {
      self.lv.merges++;
      self.lv.cvTotal += (m.value || 0);
      if (m.value > self.lv.best) self.lv.best = m.value;
    }, this);
    global.Bus.on(EV.ENEMY_DEAD, function () { self.lv.kills++; }, this);
    global.Bus.on(EV.ENEMY_LEAK, function () { self.lv.leaks++; }, this);
    global.Bus.on(EV.ENCHANT_CAST, function () { self.lv.casts++; }, this);
    global.Bus.on(EV.CMD_CONTINUE, function () { self.chooseContinue(); }, this);
    global.Bus.on(EV.CMD_CASH_OUT, function () { self.chooseCashOut(); }, this);
  };

  /* ---------------- 钱包快照 ---------------- */

  /** 从 Director 取当前钱包；Director 不存在时返回空钱包（保证可独立运行） */
  Run.prototype.wallet = function () {
    var d = global.__GAME && global.__GAME.director;
    var c = d ? d.currency : null;
    return {
      gold: c ? c.gold : 0, shard: c ? c.shard : 0, material: c ? c.material : 0,
      core: c ? c.core : 0, star: c ? c.star : 0, stardust: c ? c.stardust : 0
    };
  };

  Run.prototype.valueOf = function (w) {
    var v = 0;
    for (var k in K.VALUE) v += (w[k] || 0) * K.VALUE[k];
    return v;
  };

  /* ---------------- 关卡通过 ---------------- */

  Run.prototype.onLevelClear = function (level) {
    if (this.state !== 'playing') return;
    this.level = level || this.level;
    this.state = 'decision';

    var w = this.wallet();
    var start = this._walletAtLevelStart || { gold: 0, shard: 0, material: 0, core: 0, star: 0, stardust: 0 };
    var earned = {};
    for (var k in w) earned[k] = (w[k] || 0) - (start[k] || 0);

    // P = 当前累积池；R = 本关收益 × 递增倍率（下一关的预期增量）
    var P = this.valueOf(w);
    var R = this.valueOf(earned) * K.LEVEL_MULT;

    this.history.push({
      level: this.level, kills: this.lv.kills, merges: this.lv.merges,
      leaks: this.lv.leaks, best: this.lv.best, casts: this.lv.casts,
      earned: earned
    });

    this.decision = {
      level: this.level,
      wallet: w,
      earned: earned,
      P: P,
      R: R,
      ratio: P > 0 ? R / P : K.LEVEL_MULT,
      threshold: this.thresholdAt(P, R),
      chance: this.estimateChance(),
      threat: this.threatPreview(this.level + 1),
      keep: K.FAIL_KEEP
    };

    global.Bus.emit(EV.RUN_DECISION, this.decision);
  };

  /** 继续优于收工的临界概率 p* */
  Run.prototype.thresholdAt = function (P, R) {
    var b = K.FAIL_KEEP;
    if (R <= 0) return 1;
    return (1 - b) / ((1 - b) + R / P);
  };

  /**
   * 系统预估通关概率 —— 只是给玩家的参考，不是真理。
   * 三个可观测量：星枢剩余比例 / 本关漏怪数 / 附魔是否「饿死」（超载匮乏）
   */
  Run.prototype.estimateChance = function () {
    var b = global.__GAME && global.__GAME.battle;
    var d = global.__GAME && global.__GAME.director;
    var hpRatio = 1, leaks = this.lv.leaks;
    if (b) hpRatio = b.nodeMax > 0 ? M.clamp(b.nodeHp / b.nodeMax, 0, 1) : 0;

    // 附魔匮乏：整关几乎没有超载 → 输出结构不健康
    var starvation = 0;
    if (d && d.casts) {
      var total = d.casts.small + d.casts.overload;
      if (total > 0 && d.casts.overload / total < 0.15) starvation = 1;
    }

    var c = 0.18 + hpRatio * 0.72 - leaks * 0.055 - starvation * 0.12;
    // 关卡越高越难
    c -= (this.level - 1) * 0.028;
    return M.clamp(c, 0.02, 0.96);
  };

  /** 下一关威胁预览：用星级抽象，不堆数值（GDD §9.3 UI 要求） */
  Run.prototype.threatPreview = function (n) {
    var hp = Math.pow(1.55, n - 1) * (1 + 0.05 * (n - 1));
    var stars = M.clamp(Math.round(Math.log(hp) / Math.LN2 * 0.72), 1, 10);
    var names = ['', '微风', '轻扰', '警戒', '压迫', '严峻', '危险', '致命', '绝望', '灭绝'];
    return {
      level: n,
      stars: stars,
      label: names[M.clamp(Math.ceil(stars / 1.2), 1, 9)] || '灭绝',
      hpMult: hp,
      mult: Math.pow(K.LEVEL_MULT, n - 1)
    };
  };

  /* ---------------- 玩家抉择 ---------------- */

  Run.prototype.chooseContinue = function () {
    if (this.state !== 'decision') return;
    this.level++;
    this.lv = this._blankLevel();
    this._walletAtLevelStart = this.wallet();
    this.decision = null;
    this.state = 'playing';
    global.Bus.emit(EV.TOAST, {
      text: '进入第 ' + this.level + ' 关 · 收益倍率 ×' + Math.pow(K.LEVEL_MULT, this.level - 1).toFixed(2),
      kind: 'level'
    });
    global.Bus.emit(EV.CMD_NEXT_LEVEL, { level: this.level });
  };

  Run.prototype.chooseCashOut = function () {
    if (this.state !== 'decision') return;
    this.finish('cashout', 1.0);
  };

  Run.prototype.onDead = function () {
    if (this.state === 'settled') return;
    this.finish('dead', K.FAIL_KEEP);
  };

  /* ---------------- 结算 ---------------- */

  Run.prototype.finish = function (outcome, keepRatio) {
    this.state = 'settled';
    this.outcome = outcome;

    var w = this.wallet();
    var kept = {}, lost = {};
    for (var k in w) {
      kept[k] = (w[k] || 0) * keepRatio;
      lost[k] = (w[k] || 0) * (1 - keepRatio);
    }
    // 星尘只在结算时给（GDD：花园为主、收工为辅）
    var stardust = Math.round(Math.pow(this.level, 1.35) * 6 * keepRatio);
    kept.stardust = (kept.stardust || 0) + stardust;

    this.settle = {
      outcome: outcome,
      level: this.level,
      wave: this.wave,
      keepRatio: keepRatio,
      kept: kept,
      lost: lost,
      stardust: stardust,
      stats: {
        kills: this.totalKills(), merges: this.totalMerges(),
        best: this.bestTile(), casts: this.totalCasts()
      },
      history: this.history.slice(),
      value: this.valueOf(kept)
    };
    global.Bus.emit(EV.RUN_GAME_OVER, this.settle);
  };

  Run.prototype.totalKills = function () {
    var b = global.__GAME && global.__GAME.battle;
    return b ? b.stats.kills : 0;
  };
  Run.prototype.totalMerges = function () {
    var b = global.__GAME && global.__GAME.board;
    return b ? b.stats.merges : 0;
  };
  Run.prototype.bestTile = function () {
    var b = global.__GAME && global.__GAME.board;
    return b ? b.stats.best : 0;
  };
  Run.prototype.totalCasts = function () {
    var d = global.__GAME && global.__GAME.director;
    return d ? d.casts.small + d.casts.overload : 0;
  };

  /** 新的一局（元游戏层调用） */
  Run.prototype.startNew = function () {
    this.state = 'playing';
    this.level = 1;
    this.wave = 0;
    this.outcome = null;
    this.decision = null;
    this.settle = null;
    this.lv = this._blankLevel();
    this.history = [];
    this._walletAtLevelStart = { gold: 0, shard: 0, material: 0, core: 0, star: 0, stardust: 0 };
  };

  global.Run = Run;
})(window);
