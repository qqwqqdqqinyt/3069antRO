/* ============================================================
 *  Meta —— 元游戏系统（永久养成 / 花园 / 商店 / 存档）
 *
 *  职责边界：
 *    · 只管「局与局之间」的东西：养成树、商店、图鉴、存档
 *    · 不参与局内循环，不认识 Board / Battle
 *    · 对外只提供 profile（存档数据）+ decorator()（永久加成）
 *
 *  ★ 花园（2026-09-02 改造）：
 *    旧的「种植物 → 收星尘」花园已彻底移除，改为「室内花园」——
 *    里面只养一株培育植物（宠物），玩法见 systems/pet.js。
 *    星尘产出随之取消，星尘改由关卡结算给（见 run.js finish()）。
 *    本文件只保留宠物相关的存档字段与商店项，不含任何宠物逻辑。
 *
 *  养成占比红线（GDD v0.1 §13.4）：
 *    永久养成必须弱于局内卡牌，否则肉鸽三选一会沦为过场动画。
 *    本文件所有加成都按 GDD §10.4 的线性数值实现，满级约 +30~40%，
 *    配合编队位（伙伴位 50% 效率）后总养成倍率约 5.3×，局内卡牌仍占大头。
 *
 *  数值来源：GDD v0.1 §10.2 / §10.3 / §10.4
 * ============================================================ */
(function (global) {
  'use strict';
  var EV = global.Bus.EV, M = global.M;

  var SAVE_KEY = 'xingxu_meta_v1';

  /* ---------------- 永久养成树：4 分支 × 10 级 ----------------
   * Cost(n) = 40 × 1.30^(n-1)，n 为「要买的那一级」（1-indexed）
   * 全树满级 = 4 × Σ40×1.3^(n-1) ≈ 6,820 星尘
   */
  var UPGRADES = {
    root: {
      name: '根系', icon: '根', color: '#8fd9a0', maxLv: 10,
      desc: '棋盘侧：步数上限 +0.2 / 步数回复 +3% / 充能条 −2%',
      per: '步数上限 +0.2，回复 +3%，充能需求 −2%'
    },
    branch: {
      name: '枝叶', icon: '枝', color: '#7ec86a', maxLv: 10,
      desc: '战斗侧：全植物伤害 +3% / 星枢 HP +4%',
      per: '植物伤害 +3%，星枢上限 +4%'
    },
    bud: {
      name: '花蕾', icon: '蕾', color: '#c79bff', maxLv: 10,
      desc: '附魔侧：全元素威力 +4%',
      per: '全元素威力 +4%'
    },
    fruit: {
      name: '果实', icon: '果', color: '#ffc95e', maxLv: 10,
      desc: '经济侧：金币 +4% / 碎片 +6% / 材料掉落 +5%',
      per: '金币 +4%，碎片 +6%，材料掉落 +5%'
    }
  };

  // 养成成本曲线参数抽成对象，便于外部数值表覆盖（见 data/balance.js）
  var UPGRADE_COST = { base: 40, pow: 1.30 };
  function upCost(level) { return Math.round(UPGRADE_COST.base * Math.pow(UPGRADE_COST.pow, level - 1)); }

  /* ---------------- 商店 ----------------
   * ★ 2026-09-02 改造：旧花园的「花盆 pot3~6」随花园一并移除，
   *   换成「培育槽位 petslot2 / petslot3」—— 主人定：等另外两条异变链
   *   开放后，用商店扩编队，让多株培育植物同场作战。
   * ★ 基础材料出售 + 宠物血瓶来自 data/basicMat.js，保持数值同源。
   *   （加载顺序：data/*.js 必须先于 systems/*.js，见 index.html）
   */
  var BASE_SHOP = [
    {
      id: 'slot4', name: '编队位 · 第 4 位', cost: { gold: 5000, material: 0 },
      desc: '编队位 3 → 4（伙伴位按 50% 效率计入战力）',
      tag: 'formation', once: true
    },
    {
      id: 'slot5', name: '编队位 · 第 5 位', cost: { gold: 20000, material: 5 },
      desc: '编队位 4 → 5', tag: 'formation', once: true,
      requires: 'slot4'
    },
    {
      id: 'slot6', name: '编队位 · 第 6 位', cost: { gold: 60000, material: 15 },
      desc: '编队位 5 → 6', tag: 'formation', once: true,
      requires: 'slot5'
    },
    {
      id: 'petslot2', name: '培育槽位 · 第 2 位', cost: { gold: 30000, material: 5 },
      desc: '可同时派出的培育植物 1 → 2（需已拥有第二株培育植物）',
      tag: 'pet', once: true
    },
    {
      id: 'petslot3', name: '培育槽位 · 第 3 位', cost: { gold: 100000, material: 15 },
      desc: '可同时派出的培育植物 2 → 3（需已拥有第三株培育植物）',
      tag: 'pet', once: true, requires: 'petslot2'
    },
    {
      id: 'hex', name: '棋盘元素地格', cost: { material: 8 },
      desc: '把棋盘一格永久染成某元素；在该格触发的合成必出该元素。可重复购买。',
      tag: 'board', once: false
    }
  ];

  /* 合并基础材料 / 宠物血瓶商店项（数值同源，见 data/basicMat.js） */
  var SHOP = BASE_SHOP.concat(global.BasicMat ? global.BasicMat.SHOP_ITEMS : []);

  /* ============================================================ */

  /**
   * ★ version 2（2026-09-02）：旧花园（gardenLevel / pots / garden）拆除，
   *   改为「室内花园」只养培育植物。旧档 load() 时会自动迁移 ——
   *   星尘、养成树、编队、图鉴全部保留，只是花园没了。
   */
  function blankProfile() {
    return {
      version: 2,
      stardust: 0,
      gold: 0, shard: 0, material: 0, core: 0,
      upgrades: { root: 0, branch: 0, bud: 0, fruit: 0 },

      /* ---- 培育植物（宠物）：数据在这里，逻辑全在 systems/pet.js ---- */
      petChoice: null,      // 'red' | 'green' | 'withered' —— 三选一，选完永不可改
      pets: [],             // [{id, kind, level, exp, hp, tickAt, waterUntil, waterCdAt, bornAt}]
      // ★ 常驻编队：玩家拥有的、允许被派出的 pet id。choose() 时写入，之后只增不减。
      //   它**不是**「局内已派出几只」—— 那个由 Pet._battleId 表达（每局清空）。
      //   拿 petParty 当局内计数会用一次就永远满编（详见 Pet.canDeploy 注释）。
      petParty: [],
      petSlots: 1,          // 可同时派出的培育植物数（商店 petslot2/3 扩编队）
      materials: {},        // 进化材料字典 {redtomato: n, smallchili: n}
      basic: 0,             // 基础材料：关卡掉落，只能卖钱（1 : 1）

      plants: {
        sprout: { unlocked: true, star: 1, level: 1 },
        peashooter: { unlocked: true, star: 1, level: 1 },
        cabbagepult: { unlocked: true, star: 1, level: 1 }
      },
      formationSlots: 3,
      party: ['peashooter'],         // ★ 养成树编队（植物 kind），不是培育植物
      boardHexes: [],                // {r, c, element}
      bought: {},                    // 一次性商店项
      stats: { runs: 0, bestLevel: 0, totalKills: 0, bestTile: 0, totalStardust: 0 },
      lastSeen: Date.now()
    };
  }

  function Meta(opts) {
    opts = opts || {};
    this.storage = opts.storage !== false ? safeStorage() : null;
    this.profile = this.load();
    // 养成成本曲线（实例级）：数值表覆盖层（挂载点⑦）可经 opts.tuning.economy
    // 覆盖 upgradeCostBase / upgradeCostPow；缺省与模块默认 UPGRADE_COST 一致。
    this.upgradeCost = Object.assign({}, UPGRADE_COST);
    if (opts.tuning && opts.tuning.economy) {
      var eco = opts.tuning.economy;
      if (typeof eco.upgradeCostBase === 'number') this.upgradeCost.base = eco.upgradeCostBase;
      if (typeof eco.upgradeCostPow === 'number') this.upgradeCost.pow = eco.upgradeCostPow;
    }
    this._bind();
  }

  Meta.UPGRADES = UPGRADES;
  Meta.SHOP = SHOP;
  Meta.BASE_SHOP = BASE_SHOP;
  Meta.UPGRADE_COST = UPGRADE_COST;
  Meta.upCost = upCost;
  Meta.SAVE_KEY = SAVE_KEY;

  function safeStorage() {
    try {
      var s = global.localStorage;
      var probe = '__xq__';
      s.setItem(probe, '1'); s.removeItem(probe);
      return s;
    } catch (e) { return null; }   // 隐私模式 / 禁用 storage → 内存模式
  }

  /* ---------------- 存档 ---------------- */

  Meta.prototype.load = function () {
    var p = blankProfile();
    if (!this.storage) return p;
    try {
      var raw = this.storage.getItem(SAVE_KEY);
      if (!raw) return p;
      var o = JSON.parse(raw);
      // 浅合并，容忍旧档缺字段
      for (var k in p) if (o[k] !== undefined) p[k] = o[k];
      p.upgrades = Object.assign({ root: 0, branch: 0, bud: 0, fruit: 0 }, o.upgrades || {});
      p.stats = Object.assign(blankProfile().stats, o.stats || {});
      p.plants = Object.assign(blankProfile().plants, o.plants || {});
      // 培育植物字段迁移（旧档没有 → 补空，靠 Pet 系统自己填）
      if (global.Pet) global.Pet.migrate(p);
      return p;
    } catch (e) {
      console.warn('[Meta] 存档损坏，已重置', e);
      return p;
    }
  };

  Meta.prototype.save = function () {
    this.profile.lastSeen = Date.now();
    if (!this.storage) return false;
    try {
      this.storage.setItem(SAVE_KEY, JSON.stringify(this.profile));
      return true;
    } catch (e) { return false; }
  };

  Meta.prototype.wipe = function () {
    this.profile = blankProfile();
    if (this.storage) { try { this.storage.removeItem(SAVE_KEY); } catch (e) {} }
    global.Bus.emit(EV.META_CHANGED, { profile: this.profile });
  };

  /* ---------------- 事件 ---------------- */

  Meta.prototype._bind = function () {
    var self = this;
    global.Bus.on(EV.CMD_UPGRADE, function (p) { self.buyUpgrade(p.key); }, this);
    global.Bus.on(EV.CMD_SHOP_BUY, function (p) { self.buyShop(p.key, p.arg); }, this);
    global.Bus.on(EV.CMD_SAVE, function () { self.save(); }, this);
    // 每局结束自动吸收结算收益
    global.Bus.on(EV.RUN_GAME_OVER, function (s) { self.absorbSettlement(s); }, this);
  };

  /* ---------------- 养成树 ---------------- */

  Meta.prototype.upLevel = function (key) { return this.profile.upgrades[key] || 0; };
  Meta.prototype.upMaxed = function (key) {
    return this.upLevel(key) >= (UPGRADES[key] ? UPGRADES[key].maxLv : 10);
  };
  Meta.prototype.nextCost = function (key) { return this.upCost(this.upLevel(key) + 1); };
  /** 实例级养成成本（受 tuning.economy 覆盖影响） */
  Meta.prototype.upCost = function (level) {
    return Math.round(this.upgradeCost.base * Math.pow(this.upgradeCost.pow, level - 1));
  };

  Meta.prototype.buyUpgrade = function (key) {
    if (!UPGRADES[key]) return false;
    if (this.upMaxed(key)) { toast('【' + UPGRADES[key].name + '】已满级', 'bad'); return false; }
    var cost = this.nextCost(key);
    if (this.profile.stardust < cost) {
      toast('星尘不足（需 ' + cost + '）', 'bad');
      return false;
    }
    this.profile.stardust -= cost;
    this.profile.upgrades[key]++;
    this.save();
    global.Bus.emit(EV.META_CHANGED, { profile: this.profile });
    toast('【' + UPGRADES[key].name + '】升至 Lv.' + this.upLevel(key), 'good');
    return true;
  };

  /* ---------------- 室内花园（培育植物） ----------------
   * 花园本身不再产出任何资源 —— 它只是培育植物待的地方。
   * 所有宠物逻辑（喂养 / 浇水 / 进化 / 回血 / 出战）都在 systems/pet.js，
   * 这里只留几个只读查询，方便 view 不用到处摸 profile 的内部结构。
   */

  /** 主力培育植物（v1 只有一只） */
  Meta.prototype.pet = function () { return this.profile.pets[0] || null; };
  Meta.prototype.hasPet = function () { return this.profile.pets.length > 0; };
  /** 是否已做过首次三选一 */
  Meta.prototype.petChosen = function () { return !!this.profile.petChoice; };

  /* ---------------- 商店 ---------------- */

  Meta.prototype.canAfford = function (cost) {
    var p = this.profile;
    if (cost.gold && p.gold < cost.gold) return false;
    if (cost.material && p.material < cost.material) return false;
    if (cost.shard && p.shard < cost.shard) return false;
    if (cost.stardust && p.stardust < cost.stardust) return false;
    return true;
  };

  Meta.prototype.shopItemState = function (item) {
    if (item.requires && !this.profile.bought[item.requires]) return 'locked';
    if (item.once && this.profile.bought[item.id]) return 'owned';
    if (!this.canAfford(item.cost)) return 'poor';
    return 'buy';
  };

  Meta.prototype.buyShop = function (key, arg) {
    var item = null;
    for (var i = 0; i < SHOP.length; i++) if (SHOP[i].id === key) item = SHOP[i];
    if (!item) return false;

    var st = this.shopItemState(item);
    if (st === 'locked') { toast('需先购买前置项', 'bad'); return false; }
    if (st === 'owned') { toast('已拥有', 'bad'); return false; }
    if (st === 'poor') { toast('资源不足', 'bad'); return false; }

    // ★ 基础材料出售 / 宠物血瓶：实际效果要动宠物的血条与材料库存，
    //   逻辑都在 Pet 系统里。这里只做门面转发，不在 Meta 侧重复扣钱，
    //   否则会出现「钱扣了两次、血没回」的经典 bug。
    if (item.tag === 'basic') {
      global.Bus.emit(EV.CMD_BASIC_SELL, { count: 'all' });
      return true;
    }
    if (item.tag === 'potion') {
      global.Bus.emit(EV.CMD_PET_POTION, { id: item.id });
      return true;
    }

    this.profile.gold -= (item.cost.gold || 0);
    this.profile.material -= (item.cost.material || 0);
    this.profile.shard -= (item.cost.shard || 0);
    this.profile.stardust -= (item.cost.stardust || 0);

    if (item.id === 'slot4' || item.id === 'slot5' || item.id === 'slot6') {
      this.profile.formationSlots++;
    } else if (item.id === 'petslot2' || item.id === 'petslot3') {
      this.profile.petSlots++;
    } else if (item.id === 'hex') {
      // 元素地格：arg = {r, c, element}
      if (arg) this.profile.boardHexes.push({ r: arg.r, c: arg.c, element: arg.element });
    }
    if (item.once) this.profile.bought[item.id] = true;
    this.save();
    global.Bus.emit(EV.META_CHANGED, { profile: this.profile });
    toast('购买成功：' + item.name, 'good');
    return true;
  };

  /* ---------------- 结算吸收 ---------------- */

  Meta.prototype.absorbSettlement = function (s) {
    if (!s || !s.kept) return;
    var p = this.profile;
    p.gold += Math.floor(s.kept.gold || 0);
    p.shard += (s.kept.shard || 0);
    p.material += Math.floor(s.kept.material || 0);
    p.core += Math.floor(s.kept.core || 0);
    p.stardust += Math.floor(s.kept.stardust || 0);
    // 培育材料：进化材料是字典，要逐个累加；基础材料是单数量
    var km = s.kept.materials;
    if (km) {
      for (var mk in km) p.materials[mk] = (p.materials[mk] || 0) + Math.floor(km[mk] || 0);
    }
    p.basic = Math.floor((p.basic || 0) + (s.kept.basic || 0));
    p.stats.runs++;
    if (s.level > p.stats.bestLevel) p.stats.bestLevel = s.level;
    if (s.stats) {
      p.stats.totalKills += s.stats.kills || 0;
      if (s.stats.best > p.stats.bestTile) p.stats.bestTile = s.stats.best;
    }
    this.save();
    global.Bus.emit(EV.META_CHANGED, { profile: this.profile });
  };

  /* ---------------- 永久加成 → 局内 mod ---------------- */

  /**
   * 把养成树加成写进局内 mod。以装饰器形式注入 Cards，
   * 这样「卡牌加成」与「养成加成」在同一处合成，顺序明确、可追溯。
   */
  Meta.prototype.decorator = function () {
    var self = this;
    return function (m) {
      var u = self.profile.upgrades;
      var root = u.root || 0, branch = u.branch || 0, bud = u.bud || 0, fruit = u.fruit || 0;
      if (branch) {
        m.plantDmg *= (1 + branch * 0.03);
        m.nodeMaxAdd += 100 * branch * 0.04;
      }
      if (bud) {
        for (var k in m.elemPower) m.elemPower[k] *= (1 + bud * 0.04);
      }
      if (fruit) {
        m.goldMult *= (1 + fruit * 0.04);
        m.shardMult *= (1 + fruit * 0.06);
        // 2026-09-02：花园不再产星尘，「果实」的第三条加成改为材料掉落率
        if (typeof m.matDrop === 'number') m.matDrop *= (1 + fruit * 0.05);
      }
      // 根系：步数回复 +3%/级（步数上限与充能条由 Board / Director 侧读取 meta 提供）
      if (root) m.stepRegen *= (1 + root * 0.03);
    };
  };

  /** 棋盘侧的养成参数（步数上限 / 充能需求）—— 不由 mod 传递，单独查 */
  Meta.prototype.boardBonus = function () {
    var root = this.profile.upgrades.root || 0;
    return {
      stepMaxAdd: Math.floor(root * 0.2),
      stepRegen: 1 + root * 0.03,
      chargeMaxMult: 1 - root * 0.02
    };
  };

  function toast(text, kind) { global.Bus.emit(EV.TOAST, { text: text, kind: kind }); }

  global.Meta = Meta;
})(window);
