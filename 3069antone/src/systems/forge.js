/* ============================================================
 *  systems/forge.js —— 「异变工坊」合成系统（主页「合成」入口的幕后）
 *
 *  定位：工坊 = 培育植物养成 UI 的**门面层 / 状态机**，本身不持有存档。
 *    · 所有真正的写操作都在 Pet 系统里（Pet 改 profile 并 save）
 *    · 本模块只做三件事：
 *        1. 聚合查询 —— 把材料 / 血瓶 / 进化分支整理成 view 直接能画的结构
 *        2. UI 状态 —— 工坊开没开、在哪个 tab、选中了哪条进化链
 *        3. 意图转发 —— 把 UI 动作翻译成 CMD_* 事件（不直接调 Pet）
 *
 *  为什么要多这一层：
 *    · forgeView 不该关心 profile 的字段结构，也不该自己 emit 命令
 *    · 「碎片合成」本期明确不做（主人 2026-09-02），但入口留在这里：
 *      以后加 shard→材料的配方，只需往 RECIPES 里加，view 不用大改。
 *
 *  ★ 材料两套，别混：
 *      materials（进化材料字典：红番茄 / 小辣椒）→ 喂养 or 进化
 *      basic（基础材料，单数量）              → 只能卖钱（1:1）
 * ============================================================ */
(function (global) {
  'use strict';
  var EV = global.Bus.EV, D = global.PetsData, BM = global.BasicMat;

  var TABS = [
    { key: 'plant', name: '植物' },
    { key: 'material', name: '材料' },
    { key: 'back', name: '返回' }
  ];

  /* 碎片合成配方（本期为空 —— 主人说暂不做，接口先留着） */
  var RECIPES = [
    // 例：{ id:'r_tomato', out:{key:'redtomato', n:1}, cost:{shard:20, gold:30}, desc:'…' }
  ];

  function Forge(meta, pet) {
    this.meta = meta;
    this.pet = pet;
    this.state = {
      open: false,
      tab: 'plant',          // plant | material
      selected: null,        // 选中的进化目标 kind
      confirm: false         // 是否处于「确认进化」二次确认
    };
    this._bind();
  }

  /* ============================================================
   *  UI 状态
   * ============================================================ */

  Forge.prototype.isOpen = function () { return this.state.open; };
  Forge.prototype.tab = function () { return this.state.tab; };

  Forge.prototype.open = function (tab) {
    this.state.open = true;
    this.state.tab = tab || 'plant';
    this.state.selected = null;
    this.state.confirm = false;
    global.Bus.emit(EV.PET_CHANGED, { pet: this.pet.pet() });
  };

  Forge.prototype.close = function () {
    this.state.open = false;
    this.state.selected = null;
    this.state.confirm = false;
  };

  Forge.prototype.setTab = function (t) {
    if (t === 'back') { this.close(); return; }
    this.state.tab = t;
    this.state.selected = null;
    this.state.confirm = false;
  };

  Forge.prototype.selected = function () { return this.state.selected; };

  Forge.prototype.select = function (to) {
    this.state.selected = (this.state.selected === to) ? null : to;
    this.state.confirm = false;
  };

  Forge.prototype.confirm = function (on) { this.state.confirm = !!on; };
  Forge.prototype.isConfirming = function () { return this.state.confirm; };

  /* ============================================================
   *  查询：植物页
   * ============================================================ */

  /** 当前宠物摘要（没宠物时返回 null，view 显示「先去三选一」） */
  Forge.prototype.petInfo = function () {
    var pet = this.pet.pet();
    if (!pet) return null;
    var def = D.defOf(pet.kind);
    var maxHp = this.pet.maxHp(pet);
    var need = this.pet.expNeed(pet);
    return {
      pet: pet,
      kind: pet.kind,
      name: def ? def.name : pet.kind,
      color: def ? def.color : '#888',
      desc: def ? def.desc : '',
      level: pet.level,
      maxLevel: D.LEVEL.maxLevel,
      exp: Math.floor(pet.exp || 0),
      expNeed: need,
      expRatio: this.pet.expRatio(pet),
      hp: Math.floor(pet.hp),
      hpMax: maxHp,
      hpRatio: this.pet.hpRatio(pet),
      // 恢复：越高级血越厚、恢复越慢（主人定）
      recoverSecPer1: def ? def.recover : 0,
      etaSec: this.pet.recoverETA(pet),
      waterCdSec: this.pet.waterCd(pet),
      waterLeftSec: this.pet.waterLeft(pet),
      // 战斗属性（受等级影响，主人定：等级影响全部战斗属性）
      dmg: D.statAt(pet.kind, pet.level, 'dmg'),
      interval: D.statAt(pet.kind, pet.level, 'interval')
    };
  };

  /** 进化分支（含可用性判定与缺什么） */
  Forge.prototype.evolveOptions = function () {
    return this.pet.branches();
  };

  /* ============================================================
   *  查询：材料页
   * ============================================================ */

  /** 进化材料库存列表（不足的也列出，方便玩家知道要刷什么） */
  Forge.prototype.materials = function () {
    var p = this.meta.profile, out = [];
    for (var k in D.MATERIALS) {
      var m = D.MATERIALS[k];
      out.push({
        key: k, name: m.name, color: m.color, shape: m.shape, desc: m.desc,
        count: p.materials[k] || 0,
        locked: !!m.locked
      });
    }
    return out;
  };

  /** 基础材料（只能卖钱） */
  Forge.prototype.basicInfo = function () {
    var p = this.meta.profile;
    var n = Math.floor(p.basic || 0);
    var r = BM.sellAll(n);
    return {
      count: n,
      rate: BM.BASIC.sellRate,
      gold: r.gold,
      name: BM.BASIC.name,
      color: BM.BASIC.color,
      desc: BM.BASIC.desc
    };
  };

  /** 血瓶列表（含买得起与否） */
  Forge.prototype.potions = function () {
    var p = this.meta.profile, out = [];
    for (var i = 0; i < BM.POTIONS.length; i++) {
      var q = BM.POTIONS[i];
      out.push({
        id: q.id, name: q.name, ratio: q.ratio, gold: q.gold,
        color: q.color, desc: q.desc,
        afford: p.gold >= q.gold
      });
    }
    return out;
  };

  /** 碎片合成配方（本期为空） */
  Forge.prototype.recipes = function () {
    var p = this.meta.profile, out = [];
    for (var i = 0; i < RECIPES.length; i++) {
      var r = RECIPES[i];
      var afford = true;
      if (r.cost.shard && p.shard < r.cost.shard) afford = false;
      if (r.cost.gold && p.gold < r.cost.gold) afford = false;
      out.push({
        id: r.id, out: r.out, cost: r.cost, desc: r.desc, afford: afford
      });
    }
    return out;
  };

  /* ============================================================
   *  动作：只发事件，不直接改数据
   * ============================================================ */

  Forge.prototype.doEvolve = function (to) {
    var pet = this.pet.pet();
    if (!pet) return false;
    var list = D.branchesOf(pet.kind), br = null;
    for (var i = 0; i < list.length; i++) if (list[i].to === to) br = list[i];
    if (!br) return false;
    var chk = D.canEvolve(pet, br, this.pet.res());
    if (!chk.ok) {
      global.Bus.emit(EV.TOAST, { text: D.canEvolveText(chk), kind: 'bad' });
      // 条件不足时取消选中，避免 UI 停在「已选中但点不动」的死状态
      this.state.selected = null;
      this.state.confirm = false;
      return false;
    }
    global.Bus.emit(EV.CMD_PET_EVOLVE, { to: to });
    this.state.selected = null;
    this.state.confirm = false;
    return true;
  };

  Forge.prototype.doFeed = function (key) { global.Bus.emit(EV.CMD_PET_FEED, { key: key }); };
  Forge.prototype.doWater = function () { global.Bus.emit(EV.CMD_PET_WATER, {}); };
  Forge.prototype.doPotion = function (id) { global.Bus.emit(EV.CMD_PET_POTION, { id: id }); };
  Forge.prototype.doSellBasic = function (count) {
    global.Bus.emit(EV.CMD_BASIC_SELL, { count: count === undefined ? 'all' : count });
  };

  /* ============================================================
   *  事件
   * ============================================================ */

  Forge.prototype._bind = function () {
    var self = this;
    global.Bus.on(EV.CMD_FORGE_OPEN, function (p) { self.open(p && p.tab); }, this);
    global.Bus.on(EV.CMD_FORGE_CLOSE, function () { self.close(); }, this);
  };

  Forge.TABS = TABS;
  Forge.RECIPES = RECIPES;

  global.Forge = Forge;
})(window);
