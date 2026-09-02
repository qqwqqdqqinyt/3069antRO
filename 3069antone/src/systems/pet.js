/* ============================================================
 *  systems/pet.js —— 培育植物（宠物）养成系统
 *
 *  世界观：晶枢碎片坠入主角家，一株普通牙苗被异变能量浸染。
 *          玩家首进游戏三选一（红 / 绿 / 枯萎），选完永不可改；
 *          此后在「室内花园」里喂养、浇水、进化，并可带进战场参战。
 *
 *  与 Meta 的关系：
 *    · 本系统不自己存档 —— 所有状态写进 meta.profile（持久化由 Meta 负责）
 *    · pet 对象就是 profile.pets[i] 的引用，改它即改存档（关键节点手动 save）
 *    · 材料 / 金币也读 profile，不另开钱包
 *
 *  与其它系统的边界：
 *    · 不认识 Board / Battle 的内部结构，只通过事件耦合：
 *        收：CMD_PET_* 、ENEMY_DEAD、PLANT_HIT、PLANT_DEAD、RUN_GAME_OVER
 *        发：PET_CHANGED / PET_LEVELUP / PET_EVOLVED / PET_HEALED
 *    · 战场侧要种培育植物时，问本系统要 combatStats(pet)，
 *      由 main.js 转成 CMD_PLANT_PLACE 下发 —— 本系统不直接调 battlefield
 *
 *  ★ 主人的三条定调（2026-09-02）：
 *    1. 经验来源：喂养 / 浇水少量，战斗击杀是主来源，高等级敌人给更多
 *    2. 等级影响全部战斗属性（hp / dmg / 攻速）
 *    3. 进化 = 等级 + 材料 + 金币，三者全满足
 *
 *  ★ 血量模型：宠物的「花园血条」就是它的战场血量。
 *    上场时战场实例 HP = pet.hp 当前值，战斗中挨打直接扣 pet.hp，
 *    死亡 pet.hp 归零，回花园后按现实时间恢复（越高级血越厚、恢复越慢）。
 * ============================================================ */
(function (global) {
  'use strict';
  var EV = global.Bus.EV, M = global.M, D = global.PetsData, BM = global.BasicMat;

  /* ---------------- 恢复机制参数 ----------------
   * 恢复速度 = 每秒恢复 maxHp/100/def.recover（即每 recover 秒回 1%）
   * 浇水施肥：×2，持续 10 分钟，冷却 5 分钟（后期可挂广告加速点）
   */
  var WATER = { boostMult: 2, boostSec: 600, cdSec: 300 };
  var OFFLINE_CAP_H = 8;                 // 离线最多累计 8 小时恢复（防纯挂机）

  function nowMs() { return Date.now(); }

  function Pet(meta) {
    this.meta = meta;
    this.inBattle = false;     // 局内暂停自然恢复（不然恢复惩罚不成立）
    this._battleId = null;     // 当前已部署到战场的 pet.id
    Pet.migrate(meta.profile);
    this._bind();
  }

  /* ---------------- 存档迁移 ----------------
   * 旧档没有宠物字段 —— 补齐后即可无痛升级，不丢原来的星尘/养成树。
   */
  Pet.migrate = function (p) {
    if (!p) return p;
    if (p.petChoice === undefined) p.petChoice = null;
    if (!Array.isArray(p.pets)) p.pets = [];
    if (!Array.isArray(p.petParty)) p.petParty = [];      // 常驻编队（≠ 养成树 party、≠ 局内已派出）
    if (!p.materials || typeof p.materials !== 'object') p.materials = {};
    if (typeof p.basic !== 'number') p.basic = 0;
    if (!p.petSlots) p.petSlots = 1;                      // 培育植物出战槽位（商店可扩）
    // 单只宠物内部字段兜底
    for (var i = 0; i < p.pets.length; i++) {
      var q = p.pets[i];
      if (typeof q.exp !== 'number') q.exp = 0;
      if (typeof q.level !== 'number') q.level = 1;
      if (typeof q.hp !== 'number') q.hp = D.hpMaxAt(q.kind, q.level);
      if (!q.tickAt) q.tickAt = nowMs();
      if (!q.waterUntil) q.waterUntil = 0;
      if (!q.waterCdAt) q.waterCdAt = 0;
    }
    return p;
  };

  /* ============================================================
   *  查询
   * ============================================================ */

  Pet.prototype.profile = function () { return this.meta.profile; };

  /** 已选过变种？ */
  Pet.prototype.chosen = function () { return !!this.profile().petChoice; };
  Pet.prototype.hasPet = function () { return this.profile().pets.length > 0; };

  /** 当前主力宠物（v1 只有一只） */
  Pet.prototype.pet = function () { return this.profile().pets[0] || null; };

  Pet.prototype.byId = function (id) {
    var a = this.profile().pets;
    for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i];
    return null;
  };

  Pet.prototype.def = function (pet) { return pet ? D.defOf(pet.kind) : null; };

  /** 该宠物当前的最大 HP（受等级加成） */
  Pet.prototype.maxHp = function (pet) { return pet ? D.hpMaxAt(pet.kind, pet.level) : 0; };

  Pet.prototype.hpRatio = function (pet) {
    if (!pet) return 0;
    var m = this.maxHp(pet);
    return m > 0 ? M.clamp(pet.hp / m, 0, 1) : 0;
  };

  /** 进化判定要用的资源视图（材料字典 + 金币都在 profile 上） */
  Pet.prototype.res = function () {
    var p = this.profile();
    return { materials: p.materials, gold: p.gold };
  };

  /** 出战槽位 */
  Pet.prototype.slots = function () { return this.profile().petSlots || 1; };
  Pet.prototype.party = function () { return this.profile().petParty; };
  Pet.prototype.inParty = function (id) { return this.profile().petParty.indexOf(id) >= 0; };

  /* ============================================================
   *  首次三选一
   * ============================================================ */

  /**
   * 选初始变种。选完永不可改 —— 这是存档级的决定。
   * @param variantKey 'red' | 'green' | 'withered'
   */
  Pet.prototype.choose = function (variantKey) {
    var p = this.profile();
    if (p.petChoice) { toast('已经选过了', 'bad'); return false; }

    var v = null;
    for (var i = 0; i < D.VARIANTS.length; i++) if (D.VARIANTS[i].key === variantKey) v = D.VARIANTS[i];
    if (!v) return false;
    if (v.locked) { toast('这条异变链尚未开放', 'bad'); return false; }

    var def = D.defOf(v.kind);
    if (!def) return false;

    var pet = {
      id: 'pet' + (p.pets.length + 1),
      kind: v.kind,
      level: 1,
      exp: 0,
      hp: def.hpMax,
      tickAt: nowMs(),
      waterUntil: 0,
      waterCdAt: 0,
      bornAt: nowMs()
    };

    p.petChoice = v.key;
    p.pets.push(pet);
    p.petParty = [pet.id];

    this.meta.save();
    global.Bus.emit(EV.PET_CHANGED, { pet: pet });
    global.Bus.emit(EV.META_CHANGED, { profile: p });
    toast('异变开始：' + def.name, 'good');
    return true;
  };

  /* ============================================================
   *  等级 / 经验
   * ============================================================ */

  /** 当前等级升到下一级还差多少经验 */
  Pet.prototype.expNeed = function (pet) {
    if (!pet) return 0;
    if (pet.level >= D.LEVEL.maxLevel) return 0;
    return D.expNext(pet.level);
  };

  Pet.prototype.expRatio = function (pet) {
    var need = this.expNeed(pet);
    if (!need) return pet && pet.level >= D.LEVEL.maxLevel ? 1 : 0;
    return M.clamp((pet.exp || 0) / need, 0, 1);
  };

  /**
   * 加经验，可能连升多级。
   * ★ 升级后 maxHp 变大 —— 把新增的那部分血补满（否则升级反而「变虚」）。
   * 主人定调：等级影响全部战斗属性。
   * @returns 升了几级
   */
  Pet.prototype.gainExp = function (pet, n) {
    if (!pet || !(n > 0)) return 0;
    var ups = 0;
    var guard = 0;
    while (n > 0 && pet.level < D.LEVEL.maxLevel && guard++ < 200) {
      var need = D.expNext(pet.level);
      var room = need - (pet.exp || 0);
      var add = Math.min(room, n);
      pet.exp = (pet.exp || 0) + add;
      n -= add;
      if (pet.exp >= need) {
        pet.exp -= need;
        var oldMax = this.maxHp(pet);
        pet.level++;
        ups++;
        // 补满新增的最大 HP
        pet.hp = Math.min(this.maxHp(pet), pet.hp + (this.maxHp(pet) - oldMax));
        global.Bus.emit(EV.PET_LEVELUP, { pet: pet, level: pet.level });
      } else {
        break;
      }
    }
    if (pet.level >= D.LEVEL.maxLevel) pet.exp = 0;
    if (ups > 0) {
      this.meta.save();
      global.Bus.emit(EV.PET_CHANGED, { pet: pet });
      toast('【' + (this.def(pet) ? this.def(pet).name : '宠物') + '】升到 Lv.' + pet.level, 'good');
    }
    return ups;
  };

  /* ============================================================
   *  培育动作
   * ============================================================ */

  /** 喂一个进化材料换经验（材料同时是进化耗材 —— 喂了就没得进化，玩家自己权衡） */
  Pet.prototype.feed = function (matKey) {
    var p = this.profile(), pet = this.pet();
    if (!pet) return false;
    if (!D.MATERIALS[matKey]) return false;
    if ((p.materials[matKey] || 0) < 1) {
      toast('没有' + D.matName(matKey) + '，去关卡里找找', 'bad');
      return false;
    }
    p.materials[matKey]--;
    this.gainExp(pet, D.EXP.feed);
    if (p.materials[matKey] <= 0) delete p.materials[matKey];
    this.meta.save();
    global.Bus.emit(EV.PET_CHANGED, { pet: pet });
    global.Bus.emit(EV.META_CHANGED, { profile: p });
    if (D.EXP.feed > 0) toast('喂下' + D.matName(matKey) + '，+' + D.EXP.feed + ' 经验');
    return true;
  };

  /** 浇水施肥：恢复速度 ×2 一段时间 + 少量经验。有冷却。 */
  Pet.prototype.water = function () {
    var pet = this.pet();
    if (!pet) return false;
    var now = nowMs();
    if (now < (pet.waterCdAt || 0)) {
      toast('土壤还湿着（' + fmtSec((pet.waterCdAt - now) / 1000) + '后可再浇）', 'bad');
      return false;
    }
    this._recover(pet, now);                       // 先结算存量，再进入加速期
    pet.waterUntil = now + WATER.boostSec * 1000;
    pet.waterCdAt = now + WATER.cdSec * 1000;
    this.gainExp(pet, D.EXP.water);
    this.meta.save();
    global.Bus.emit(EV.PET_CHANGED, { pet: pet });
    toast('浇水施肥：恢复 ×' + WATER.boostMult + '，持续 ' + (WATER.boostSec / 60) + ' 分钟', 'good');
    return true;
  };

  /** 浇水剩余冷却（秒，0 表示可浇） */
  Pet.prototype.waterCd = function (pet) {
    if (!pet) return 0;
    var left = (pet.waterCdAt || 0) - nowMs();
    return left > 0 ? Math.ceil(left / 1000) : 0;
  };

  /** 加速恢复剩余时间（秒） */
  Pet.prototype.waterLeft = function (pet) {
    if (!pet) return 0;
    var left = (pet.waterUntil || 0) - nowMs();
    return left > 0 ? Math.ceil(left / 1000) : 0;
  };

  /**
   * 分支进化。★ 等级 + 材料 + 金币 三者全满足。
   * 进化后等级与经验保留，形态更换，HP 补满。
   */
  Pet.prototype.evolve = function (to) {
    var p = this.profile(), pet = this.pet();
    if (!pet) return false;

    var list = D.branchesOf(pet.kind), br = null;
    for (var i = 0; i < list.length; i++) if (list[i].to === to) br = list[i];
    if (!br) { toast('没有这条进化链', 'bad'); return false; }

    var chk = D.canEvolve(pet, br, this.res());
    if (!chk.ok) { toast(D.canEvolveText(chk), 'bad'); return false; }

    // 扣费
    for (var k in (br.materials || {})) {
      p.materials[k] = (p.materials[k] || 0) - br.materials[k];
      if (p.materials[k] <= 0) delete p.materials[k];
    }
    p.gold -= (br.gold || 0);

    var from = pet.kind;
    pet.kind = to;
    pet.hp = this.maxHp(pet);        // 异变 = 新生，血补满
    pet.tickAt = nowMs();
    pet.waterUntil = 0;

    this.meta.save();
    global.Bus.emit(EV.PET_EVOLVED, { pet: pet, from: from, to: to });
    global.Bus.emit(EV.PET_CHANGED, { pet: pet });
    global.Bus.emit(EV.META_CHANGED, { profile: p });
    var nd = D.defOf(to);
    toast('异变成功：' + (nd ? nd.name : to), 'good');
    return true;
  };

  /** 当前形态所有分支的可用性（合成屏直接遍历这个画按钮） */
  Pet.prototype.branches = function (pet) {
    pet = pet || this.pet();
    if (!pet) return [];
    var res = this.res(), out = [], list = D.branchesOf(pet.kind);
    for (var i = 0; i < list.length; i++) {
      var br = list[i];
      var chk = D.canEvolve(pet, br, res);
      out.push({
        to: br.to, name: (D.defOf(br.to) || {}).name || br.to,
        req: br, chk: chk, hint: br.hint,
        reqText: D.branchReqText(br),
        reason: chk.ok ? '' : D.canEvolveText(chk)
      });
    }
    return out;
  };

  /* ============================================================
   *  回血：自然恢复 / 血瓶
   * ============================================================ */

  /**
   * 按现实时间结算恢复。局内（inBattle）不走这里 —— 战斗中靠自己。
   * @returns 实际回了多少血
   */
  Pet.prototype._recover = function (pet, now) {
    if (!pet) return 0;
    var maxHp = this.maxHp(pet);
    if (pet.hp >= maxHp) { pet.hp = maxHp; pet.tickAt = now; return 0; }

    var def = D.defOf(pet.kind);
    if (!def || !def.recover) { pet.tickAt = now; return 0; }

    var t0 = pet.tickAt || now;
    var el = (now - t0) / 1000;
    if (el <= 0) { pet.tickAt = now; return 0; }

    // 离线截断：最多累计 OFFLINE_CAP_H 小时
    var capSec = OFFLINE_CAP_H * 3600;
    if (el > capSec) { t0 = now - capSec * 1000; el = capSec; }

    // 分段：加速段（浇水生效）+ 普通段
    var boostEnd = Math.max(t0, pet.waterUntil || 0);
    var mid = Math.min(now, boostEnd);
    var t1 = Math.max(0, mid - t0) / 1000;          // 加速段秒数
    var t2 = Math.max(0, now - mid) / 1000;         // 普通段秒数

    var perSec = maxHp / (100 * def.recover);       // 每 recover 秒回 1% maxHp
    var gain = perSec * (t1 * WATER.boostMult + t2);

    var before = pet.hp;
    pet.hp = Math.min(maxHp, pet.hp + gain);
    pet.tickAt = now;
    return pet.hp - before;
  };

  /** 每帧调用：推进所有宠物的自然恢复（局内跳过） */
  Pet.prototype.tick = function (now) {
    if (this.inBattle) {                 // 战斗中冻结恢复计时，避免出场瞬间回满
      var b = this.profile().pets;
      for (var j = 0; j < b.length; j++) b[j].tickAt = now;
      return;
    }
    now = now || nowMs();
    var a = this.profile().pets, dirty = false;
    for (var i = 0; i < a.length; i++) {
      var g = this._recover(a[i], now);
      if (g > 0.01) dirty = true;
    }
    if (dirty) global.Bus.emit(EV.PET_CHANGED, { pet: this.pet() });
  };

  /** 满血还需多少秒（UI 倒计时用） */
  Pet.prototype.recoverETA = function (pet) {
    if (!pet) return 0;
    var maxHp = this.maxHp(pet);
    var missing = maxHp - pet.hp;
    if (missing <= 0) return 0;
    var def = D.defOf(pet.kind);
    if (!def) return 0;
    var perSec = maxHp / (100 * def.recover);
    var mult = this.waterLeft(pet) > 0 ? WATER.boostMult : 1;
    return Math.ceil(missing / (perSec * mult));
  };

  /** 买血瓶立即按比例回血 */
  Pet.prototype.usePotion = function (id) {
    var p = this.profile(), pet = this.pet();
    if (!pet) return false;
    var pot = BM.potionOf(id);
    if (!pot) return false;
    if (p.gold < pot.cost) { toast('金币不足（需 ' + pot.cost + '）', 'bad'); return false; }

    var maxHp = this.maxHp(pet);
    this._recover(pet, nowMs());
    maxHp = this.maxHp(pet);
    if (pet.hp >= maxHp) { toast('血量已满', 'bad'); return false; }

    p.gold -= pot.cost;
    var add = Math.min(maxHp - pet.hp, maxHp * pot.ratio);
    pet.hp = Math.min(maxHp, pet.hp + add);
    pet.tickAt = nowMs();

    this.meta.save();
    global.Bus.emit(EV.PET_HEALED, { pet: pet, amount: Math.round(add), source: id });
    global.Bus.emit(EV.PET_CHANGED, { pet: pet });
    global.Bus.emit(EV.META_CHANGED, { profile: p });
    toast('使用' + pot.name + '，回复 ' + Math.round(pot.ratio * 100) + '% 血量', 'good');
    return true;
  };

  /* ============================================================
   *  基础材料：关卡掉落 → 商店卖钱（1:1）
   * ============================================================ */

  /** @param count 数量，或 'all' / undefined 表示全卖 */
  Pet.prototype.sellBasic = function (count) {
    var p = this.profile();
    var have = Math.floor(p.basic || 0);
    if (have <= 0) { toast('没有基础材料可卖', 'bad'); return false; }
    var r = (count === 'all' || count === undefined || count === null)
      ? BM.sellAll(have) : BM.sell(Math.floor(count), have);
    if (!r || r.used <= 0) { toast('没有基础材料可卖', 'bad'); return false; }
    p.basic = have - r.used;
    p.gold += r.gold;
    this.meta.save();
    global.Bus.emit(EV.META_CHANGED, { profile: p });
    toast('卖出基础材料 ×' + r.used + '，+' + r.gold + ' 金币', 'good');
    return true;
  };

  /* ============================================================
   *  出战
   * ============================================================ */

  /**
   * 战场实例数值。
   * ★ 血量直接用宠物当前的 hp —— 花园血条 = 战场血量，
   *   战斗中挨打会真的扣到宠物身上，死了得回花园慢慢养。
   */
  Pet.prototype.combatStats = function (pet) {
    pet = pet || this.pet();
    if (!pet) return null;
    var def = D.defOf(pet.kind);
    if (!def) return null;
    var maxHp = this.maxHp(pet);
    var hp = Math.max(1, Math.min(maxHp, Math.round(pet.hp)));
    return {
      kind: pet.kind,
      petId: pet.id,
      hp: hp,
      hpMax: maxHp,
      dmg: D.statAt(pet.kind, pet.level, 'dmg'),
      interval: D.statAt(pet.kind, pet.level, 'interval'),
      level: pet.level
    };
  };

  /** 能否出战：有宠物 + 血 > 0 + 未部署 + 有槽位 */
  Pet.prototype.canDeploy = function (pet) {
    pet = pet || this.pet();
    if (!pet) return { ok: false, text: '还没有培育植物' };
    if (!D.isOpen(pet.kind)) return { ok: false, text: '该形态尚未开放' };
    if (pet.hp <= 0) return { ok: false, text: '血量归零，回花园养伤' };
    // ★ 槽位算的是「本局已经派出去几只」，**不是**「编队里有几只」。
    //   petParty 是常驻编队：choose() 首次三选一就写入 [pet.id]，之后再没清过；
    //   slots() 默认 1 → 原先那句 party().length >= slots() 恒为 1>=1，
    //   于是宠物**一次都派不出去**，永远只弹「出战槽位已满」。
    //   局内占用只能由 _battleId 表达（阵亡 / 结算 / 开新局三条路径会清它）。
    var used = this._battleId ? 1 : 0;
    if (used >= this.slots()) return { ok: false, text: '本局已派出培育植物' };
    return { ok: true, text: '' };
  };

  /** 出战登记（由 main.js 在真正种下后调用） */
  Pet.prototype.deploy = function (petId) {
    this.inBattle = true;
    this._battleId = petId || null;
  };

  /** 撤回（关卡结束 / 宠物阵亡后清理） */
  Pet.prototype.undeploy = function () {
    this.inBattle = false;
    this._battleId = null;
  };

  Pet.prototype.battleId = function () { return this._battleId; };
  Pet.prototype.isDeployed = function (id) {
    return !!this._battleId && (id === undefined || id === this._battleId);
  };

  /* ============================================================
   *  事件
   * ============================================================ */

  Pet.prototype._bind = function () {
    var self = this;

    // ---- 培育指令 ----
    global.Bus.on(EV.CMD_PET_CHOOSE, function (p) { self.choose(p.variant); }, this);
    global.Bus.on(EV.CMD_PET_FEED, function (p) { self.feed(p.key); }, this);
    global.Bus.on(EV.CMD_PET_WATER, function () { self.water(); }, this);
    global.Bus.on(EV.CMD_PET_EVOLVE, function (p) { self.evolve(p.to); }, this);
    global.Bus.on(EV.CMD_PET_POTION, function (p) { self.usePotion(p.id); }, this);
    global.Bus.on(EV.CMD_BASIC_SELL, function (p) { self.sellBasic(p && p.count); }, this);

    // ---- 战斗：击杀给经验（主来源，高等级敌人给更多） ----
    global.Bus.on(EV.ENEMY_DEAD, function (e) {
      if (!self._battleId) return;                  // 宠物没上场 → 没经验
      var pet = self.byId(self._battleId);
      if (!pet) return;
      var en = e && e.enemy;
      if (!en) return;
      self.gainExp(pet, D.killExp(en.role, en.hpMax || en.hp));
    }, this);

    // ---- 战斗：宠物受伤 / 阵亡同步回花园血条 ----
    global.Bus.on(EV.PLANT_HIT, function (e) {
      if (!e || !e.plant || !e.plant.petId) return;
      var pet = self.byId(e.plant.petId);
      if (!pet) return;
      pet.hp = Math.max(0, pet.hp - (e.amount || 0));
    }, this);

    global.Bus.on(EV.PLANT_DEAD, function (e) {
      if (!e || !e.plant || !e.plant.petId) return;
      var pet = self.byId(e.plant.petId);
      if (!pet) return;
      pet.hp = 0;
      pet.tickAt = nowMs();
      self._battleId = null;                        // 本局不能再派
      self.meta.save();
      global.Bus.emit(EV.PET_CHANGED, { pet: pet });
      toast('培育植物倒下了，回花园养伤吧', 'bad');
    }, this);

    // ---- 关卡切换：宠物**留在场上**，血量也留着 ----
    // applyLevelContent 不清 plants（普通植物本来就跨关保留），宠物作为「持续存在」的
    // 那一方更没有理由被撤下。登记也必须跟着留 —— 否则下一关 canDeploy 又放行，
    // 场上一只变两只，出战槽位限制形同虚设。
    // 只有三条路径会撤销登记：阵亡（PLANT_DEAD）、一局结束（RUN_GAME_OVER）、
    // 开新局（main.buildWorld 里显式 undeploy —— 新世界的场上一只宠物都没有）。
    global.Bus.on(EV.CMD_NEXT_LEVEL, function () {
      self.meta.save();
    }, this);

    // ---- 关卡结束：退出战斗态并存档 ----
    global.Bus.on(EV.RUN_GAME_OVER, function () {
      self.undeploy();
      self.meta.save();
    }, this);
  };

  /* ---------------- 小工具 ---------------- */

  function fmtSec(s) {
    s = Math.max(0, Math.ceil(s));
    if (s < 60) return s + ' 秒';
    var m = Math.floor(s / 60), r = s % 60;
    if (m < 60) return r ? (m + ' 分 ' + r + ' 秒') : (m + ' 分');
    var h = Math.floor(m / 60);
    return h + ' 小时 ' + (m % 60) + ' 分';
  }
  Pet.fmtSec = fmtSec;

  function toast(text, kind) { global.Bus.emit(EV.TOAST, { text: text, kind: kind }); }

  Pet.WATER = WATER;
  Pet.OFFLINE_CAP_H = OFFLINE_CAP_H;

  global.Pet = Pet;
})(window);
