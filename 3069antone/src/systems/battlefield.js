/* ============================================================
 *  Battlefield —— 战场系统（塔防侧：编队 / 波次 / 伤害 / 星枢）
 *
 *  独立契约：
 *    · 不认识 Board2048、不认识充能、不认识经济
 *    · 只通过 Bus 发事件 / 收命令
 *    · 对外暴露：placePlant / evolvePlant / applyDamagePool / update
 *
 *  与 GDD v0.2 数值对齐：
 *    敌人基准 HP 95/25/85/190/450/1400（关 1）
 *    HP 缩放底数 1.55 + 超线性 0.05；伤害缩放 1.25；速度缩放 1.04
 *    植物 DPS 7 基准（含命中率 0.75），星枢 HP 100
 * ============================================================ */
(function (global) {
  'use strict';
  var EV = global.Bus.EV, M = global.M;

  /* ---------------- 敌人角色表 ---------------- */
  var ROLES = {
    grunt: { kind: 'ant', name: '小兵', hp: 95, speed: 0.35, dmg: 5, armor: 0.0, scale: 1.00, gold: 4 },
    swarm: { kind: 'ant', name: '群聚', hp: 25, speed: 0.50, dmg: 2, armor: 0.0, scale: 0.66, gold: 2 },
    swift: { kind: 'fireant', name: '迅捷', hp: 85, speed: 0.75, dmg: 3, armor: 0.0, scale: 0.92, gold: 6 },
    armor: { kind: 'beetle', name: '重甲', hp: 190, speed: 0.22, dmg: 12, armor: 0.30, scale: 1.00, gold: 12 },
    elite: { kind: 'beetle', name: '精英', hp: 450, speed: 0.28, dmg: 25, armor: 0.15, scale: 1.26, gold: 30 },
    boss: { kind: 'beetle', name: 'Boss', hp: 1400, speed: 0.20, dmg: 40, armor: 0.20, scale: 1.52, gold: 90 }
  };

  /* ---------------- 植物表 ---------------- */
  var PLANTS = {
    sprout: {
      name: '牙苗', dmg: 0, interval: 0, range: 0, proj: null,
      desc: '一切的开始，可进化为任意植物'
    },
    peashooter: {
      name: '豌豆射手', dmg: 11, interval: 1.4, range: 1e9, proj: 'pea', speed: 430,
      muzzle: { dx: 15, dy: -14 }, desc: '炮口直射，单体稳定输出'
    },
    cabbagepult: {
      name: '卷心菜投手', dmg: 24, interval: 2.4, range: 1e9, proj: 'cabbage', speed: 0,
      aoe: 52, aoeRatio: 0.6, muzzle: { dx: -15, dy: -22 },
      desc: '尾部抛射，落点小范围溅射'
    }
  };

  /* ---------------- 关卡波次组成（关 1，来自 10_波次预算表） ---------------- */
  var WAVES = [
    { t: 30, comp: [['grunt', 6]], intent: '教学波。不可能失败。' },
    { t: 35, comp: [['grunt', 4], ['swarm', 4], ['swift', 2]], intent: '引入群体压力与时间压力。' },
    { t: 45, comp: [['armor', 2], ['grunt', 6]], intent: '引入护甲，制造第一次「打不动」。' },
    { t: 45, comp: [['swift', 6], ['armor', 2]], intent: '时间压力为主，逼玩家加快合成。' },
    { t: 60, comp: [['elite', 1], ['grunt', 8], ['swarm', 4]], intent: 'Boss 波。检验轮盘编排。' }
  ];

  var ELEMENTS = ['fire', 'water', 'wood', 'light', 'thunder', 'ice'];
  var ELEMENT_CN = { fire: '火', water: '水', wood: '木', light: '光', thunder: '雷', ice: '冰' };

  /* ============================================================ */

  function Battlefield(opts) {
    opts = opts || {};
    this.cfg = {
      x: opts.x || 0, y: opts.y || 0,
      w: opts.w || 600, h: opts.h || 400,
      lanes: opts.lanes || 3,
      cols: opts.cols || 4,
      nodeX: opts.nodeX || 58
    };
    this.rng = new global.RNG(opts.seed || 12345);

    this.level = 1;
    this.wave = 0;
    this.waveIdx = 0;
    this.spawnQueue = [];
    this.spawnTimer = 0;
    this.waveRunning = false;
    this.waveClock = 0;

    this.plants = [];
    this.enemies = [];
    this.projectiles = [];
    this.slotsUnlocked = 3;

    this.nodeMax = 100;
    this.nodeHp = 100;
    this.nodeHitT = 0;

    this.stats = { kills: 0, leaks: 0, dmgDealt: 0 };
    this._uid = 1;
    this._laneY = [];

    // 卡牌修正值副本。只取 Battle 关心的字段；
    // Cards 系统不存在时 MOD_CHANGED 永不触发，这里保持默认，行为与无卡版一致。
    this.mod = {
      plantDmg: 1, plantAspd: 1, critRate: 0, critMult: 2.0, pierce: 0,
      symbiosis: 0, cabbageDmg: 1, cabbageR: 1, cabbageAoe: 0,
      extraPea: 0, extraPeaRatio: 0,
      poolMult: 1, twinCast: 0, elemPower: null,
      iceSlowAdd: 0, iceDurAdd: 0,
      nodeMaxAdd: 0, leakDmgMult: 1, waveHeal: 0,
      stepGiftAdd: 0
    };

    this._layout();
    this._bind();
    this._applyMod();
  }

  Battlefield.ROLES = ROLES;
  Battlefield.PLANTS = PLANTS;
  Battlefield.WAVES = WAVES;
  Battlefield.ELEMENTS = ELEMENTS;
  Battlefield.ELEMENT_CN = ELEMENT_CN;

  Battlefield.prototype._layout = function () {
    var c = this.cfg;
    this.cellW = (c.w - c.nodeX - 96) / c.cols;
    this.laneH = c.h / c.lanes;
    this._laneY = [];
    for (var i = 0; i < c.lanes; i++) {
      this._laneY.push(c.y + this.laneH * (i + 0.5) + 14);
    }
    this.spawnX = c.x + c.w + 26;
  };

  Battlefield.prototype.laneY = function (i) { return this._laneY[i]; };
  Battlefield.prototype.slotX = function (col) { return this.cfg.x + this.cfg.nodeX + 40 + this.cellW * (col + 0.5); };
  Battlefield.prototype.slotY = function (lane) { return this.laneY(lane); };

  Battlefield.prototype._bind = function () {
    var self = this;
    global.Bus.on(EV.CMD_DAMAGE_POOL, function (p) { self.applyDamagePool(p); }, this);
    global.Bus.on(EV.CMD_PLANT_PLACE, function (p) { self.placePlant(p.slot, p.kind); }, this);
    global.Bus.on(EV.CMD_PLANT_EVOLVE, function (p) { self.evolvePlant(p.slot, p.target); }, this);
    global.Bus.on(EV.CMD_WAVE_START, function () { self.startNextWave(); }, this);
    global.Bus.on(EV.CMD_HEAL_NODE, function (p) { self.healNode(p.amount); }, this);
    // 关卡推进：Run 的「继续冲关」会带上新关卡号，星枢/敌人缩放随之升级
    global.Bus.on(EV.CMD_NEXT_LEVEL, function (p) { if (p && p.level) self.level = p.level; }, this);

    // 卡牌修正：按字段取值，不依赖 Cards 的实现
    global.Bus.on(EV.MOD_CHANGED, function (p) { self._applyMod(p.mod); }, this);
  };

  /** 从 MOD_CHANGED 里挑 Battle 用得到的字段 */
  Battlefield.prototype._applyMod = function (src) {
    src = src || null;
    var m = this.mod, keys = [
      'plantDmg', 'plantAspd', 'critRate', 'critMult', 'pierce', 'symbiosis',
      'cabbageDmg', 'cabbageR', 'cabbageAoe', 'extraPea', 'extraPeaRatio',
      'poolMult', 'twinCast', 'iceSlowAdd', 'iceDurAdd',
      'nodeMaxAdd', 'leakDmgMult', 'waveHeal', 'stepGiftAdd'
    ];
    if (src) {
      for (var i = 0; i < keys.length; i++) m[keys[i]] = src[keys[i]];
      m.elemPower = src.elemPower;
    }
    // 星枢上限随「壁垒」提升；下限保护 1
    var newMax = 100 + (m.nodeMaxAdd || 0);
    if (newMax !== this.nodeMax) {
      var ratio = this.nodeMax > 0 ? this.nodeHp / this.nodeMax : 1;
      this.nodeMax = newMax;
      this.nodeHp = Math.min(newMax, Math.max(1, ratio * newMax));
    }
  };

  /** 植物实际伤害倍率：基础 × 卡牌 × 共生（每株植物 +5% × 层数） */
  Battlefield.prototype.plantDmgMult = function () {
    var s = 1 + (this.mod.symbiosis || 0) * 0.05 * this.plants.length;
    return this.mod.plantDmg * s;
  };

  /* ---------------- 编队 ---------------- */

  Battlefield.prototype.placePlant = function (slot, kind) {
    if (!PLANTS[kind]) return null;
    if (slot.lane < 0 || slot.lane >= this.cfg.lanes) return null;
    if (slot.col < 0 || slot.col >= this.cfg.cols) return null;
    // 同格替换
    for (var i = 0; i < this.plants.length; i++) {
      if (this.plants[i].lane === slot.lane && this.plants[i].col === slot.col) {
        this.plants.splice(i, 1); break;
      }
    }
    var p = {
      id: this._uid++, kind: kind, lane: slot.lane, col: slot.col,
      x: this.slotX(slot.col), y: this.slotY(slot.lane),
      cd: this.rng.range(0, 0.4),
      anim: new global.PlantArt.PlantAnimator(kind, this.rng.next() * 10),
      fired: false, born: 0, evolving: 0
    };
    this.plants.push(p);
    return p;
  };

  /** 牙苗进化：原地替换为目标植物，保留位置 */
  Battlefield.prototype.evolvePlant = function (slot, target) {
    for (var i = 0; i < this.plants.length; i++) {
      var p = this.plants[i];
      if (p.lane === slot.lane && p.col === slot.col) {
        if (p.kind !== 'sprout') return null;
        var np = this.placePlant(slot, target);
        if (np) { np.born = 0; np.evolving = 1; }
        return np;
      }
    }
    return null;
  };

  /* ---------------- 波次 ---------------- */

  Battlefield.prototype.levelScale = function () {
    var n = this.level;
    return {
      hp: Math.pow(1.55, n - 1) * (1 + 0.05 * (n - 1)),
      dmg: Math.pow(1.25, n - 1),
      spd: 1 + 0.04 * (n - 1),
      count: 1 + 0.12 * (n - 1)
    };
  };

  Battlefield.prototype.startNextWave = function () {
    if (this.waveRunning) return;
    this.wave++;
    this.waveIdx = (this.wave - 1) % WAVES.length;
    var w = WAVES[this.waveIdx];
    var sc = this.levelScale();
    var q = [];
    for (var i = 0; i < w.comp.length; i++) {
      var role = w.comp[i][0], cnt = w.comp[i][1];
      var n = Math.max(1, Math.round(cnt * (role === 'boss' || role === 'elite' ? 1 : sc.count)));
      for (var k = 0; k < n; k++) q.push(role);
    }
    // 打散出场顺序，但 Boss/精英压后
    q.sort(function (a, b) {
      var pa = (a === 'boss' || a === 'elite') ? 1 : 0;
      var pb = (b === 'boss' || b === 'elite') ? 1 : 0;
      return pa - pb;
    });
    this.spawnQueue = q;
    var dur = w.t;
    this.spawnInterval = dur / Math.max(1, q.length) * 0.82;
    this.spawnTimer = 0.35;
    this.waveRunning = true;
    this.waveClock = 0;
    global.Bus.emit(EV.WAVE_START, { wave: this.wave, level: this.level, count: q.length, intent: w.intent });
  };

  Battlefield.prototype._spawnEnemy = function (role) {
    var R = ROLES[role];
    if (!R) return;
    var sc = this.levelScale();
    var lane = this.rng.int(0, this.cfg.lanes - 1);
    var hp = Math.round(R.hp * sc.hp);
    var e = {
      id: this._uid++, role: role, kind: R.kind, name: R.name,
      lane: lane, x: this.spawnX + this.rng.range(0, 40), y: this.laneY(lane) + this.rng.range(-6, 6),
      hp: hp, maxHp: hp, baseSpeed: R.speed * sc.spd, dmg: R.dmg * sc.dmg,
      armor: R.armor, scale: R.scale, gold: R.gold,
      anim: new global.InsectArt.InsectAnimator(R.kind, R.speed, this.rng.next() * 10),
      slow: 0, slowT: 0, root: 0, burn: 0, burnT: 0, burnDps: 0,
      knock: 0, hitT: 0, dead: false, deathT: 0, spawnT: 0, walking: 1
    };
    this.enemies.push(e);
    global.Bus.emit(EV.ENEMY_SPAWN, { enemy: e });
    return e;
  };

  /* ---------------- 伤害 ---------------- */

  /** 只有植物来源的子弹参与暴击；附魔走伤害池，不参与 */
  var PLANT_SRC = { pea: 1, cabbage: 1, 'cabbage:aoe': 1, 'pea:extra': 1 };

  Battlefield.prototype.damageEnemy = function (e, amount, source, element) {
    if (!e || e.dead) return 0;
    // 破甲：按卡牌比例无视目标护甲（对无甲目标无收益 —— 这就是情境卡的代价）
    var armor = (e.armor || 0) * (1 - (this.mod.pierce || 0));
    var eff = amount * (1 - armor);

    var crit = false;
    if (PLANT_SRC[source] && this.rng.next() < (this.mod.critRate || 0)) {
      eff *= (this.mod.critMult || 2.0);
      crit = true;
    }

    e.hp -= eff;
    e.hitT = 0.14;
    if (crit) e.hitT = 0.22;          // 暴击的顿帧更明显
    this.stats.dmgDealt += eff;
    global.Bus.emit(EV.ENEMY_HIT, {
      enemy: e, amount: eff, raw: amount, armor: armor, crit: crit,
      source: source || 'unknown', element: element || null
    });
    if (e.hp <= 0) {
      e.dead = true; e.deathT = 0;
      this.stats.kills++;
      global.Bus.emit(EV.ENEMY_DEAD, { enemy: e, source: source || 'unknown', crit: crit });
    }
    return eff;
  };

  /** 附魔伤害池 —— 由 Director 调用，元素决定分配方式 */
  Battlefield.prototype.applyDamagePool = function (p) {
    // poolMult 在 Director 侧已计入（ENCHANT_CAST 报出去的数必须是真值），
    // 这里只补元素亲和 —— 避免同一份加成被乘两次。
    var pool = p.pool || 0;
    var el = p.element || 'thunder';
    // 元素亲和：指定元素威力加成
    if (this.mod.elemPower) pool *= (this.mod.elemPower[el] || 1);
    var alive = this.enemies.filter(function (e) { return !e.dead; });
    if (!alive.length) return { dealt: 0, targets: 0 };
    // 按「最靠近星枢」排序
    var byFront = alive.slice().sort(function (a, b) { return a.x - b.x; });
    var dealt = 0, i;

    if (el === 'fire') {
      var each = pool / alive.length;
      for (i = 0; i < alive.length; i++) {
        dealt += this.damageEnemy(alive[i], each, 'enchant:fire', el);
        alive[i].burnT = 3.0; alive[i].burnDps = Math.max(alive[i].burnDps, pool * 0.30 / 3.0);
      }
    } else if (el === 'thunder') {
      var hits = Math.min(5, byFront.length);
      for (i = 0; i < hits; i++) dealt += this.damageEnemy(byFront[i], pool / hits, 'enchant:thunder', el);
    } else if (el === 'ice') {
      var n4 = Math.min(4, byFront.length);
      for (i = 0; i < n4; i++) {
        dealt += this.damageEnemy(byFront[i], pool / n4, 'enchant:ice', el);
        byFront[i].slowT = 3.0 + this.mod.iceDurAdd;
        byFront[i].slow = Math.max(byFront[i].slow, M.clamp(0.5 + this.mod.iceSlowAdd, 0, 0.85));
      }
    } else if (el === 'water') {
      dealt += this.damageEnemy(byFront[0], pool, 'enchant:water', el);
      for (i = 0; i < byFront.length; i++) {
        byFront[i].knock = 46; byFront[i].slowT = 2.0; byFront[i].slow = Math.max(byFront[i].slow, 0.3);
      }
    } else if (el === 'wood') {
      var n3 = Math.min(3, byFront.length);
      for (i = 0; i < n3; i++) {
        dealt += this.damageEnemy(byFront[i], pool / n3, 'enchant:wood', el);
        byFront[i].root = Math.max(byFront[i].root, 1.2);
      }
    } else { // light
      dealt += this.damageEnemy(byFront[0], pool, 'enchant:light', el);
      this.healNode(pool * 0.05);
    }

    // 双生：追加一次随机元素的打击（独立事件，便于 FX 分别表现）
    if (this.mod.twinCast > 0) {
      var el2 = ELEMENTS[this.rng.int(0, ELEMENTS.length - 1)];
      var sub = pool * this.mod.twinCast;
      if (this.mod.elemPower) sub *= (this.mod.elemPower[el2] || 1);
      var t2 = byFront[0];
      if (t2) {
        dealt += this.damageEnemy(t2, sub, 'enchant:twin', el2);
        global.Bus.emit(EV.ENCHANT_CAST, {
          element: el2, pool: sub, base: sub, mult: 1,
          star: p.star || 0, source: 'twin', merge: null
        });
      }
    }
    return { dealt: dealt, targets: alive.length };
  };

  Battlefield.prototype.healNode = function (a) {
    this.nodeHp = Math.min(this.nodeMax, this.nodeHp + a);
  };

  Battlefield.prototype.damageNode = function (amount) {
    this.nodeHp -= amount * (this.mod.leakDmgMult || 1);
    this.nodeHitT = 0.4;
    global.Bus.emit(EV.NODE_DAMAGE, { amount: amount, hp: Math.max(0, this.nodeHp), max: this.nodeMax });
    if (this.nodeHp <= 0) {
      this.nodeHp = 0;
      global.Bus.emit(EV.NODE_DEAD, { level: this.level });
    }
  };

  /* ---------------- 投射物 ---------------- */

  Battlefield.prototype._fire = function (plant, target) {
    var def = PLANTS[plant.kind];
    if (!def || !def.proj) return;
    var sx = plant.x + (def.muzzle ? def.muzzle.dx : 10);
    var sy = plant.y + (def.muzzle ? def.muzzle.dy : -12);

    // 实际伤害：基础 × 植物倍率（含共生）；卷心菜再乘「巨弹」
    var dmg = def.dmg * this.plantDmgMult();
    var aoe = def.aoe || 0, aoeRatio = def.aoeRatio || 0;
    if (def.proj === 'cabbage') {
      dmg *= this.mod.cabbageDmg;
      aoe *= this.mod.cabbageR;
      aoeRatio += this.mod.cabbageAoe;
    }

    var self = this;
    var pr = {
      id: this._uid++, type: def.proj, x: sx, y: sy,
      dmg: dmg, owner: plant.id, lane: plant.lane,
      aoe: aoe, aoeRatio: aoeRatio,
      t: 0, dead: false, rot: 0, spin: 0
    };
    if (def.proj === 'pea') {
      pr.vx = def.speed; pr.vy = 0; pr.g = 0;
    } else {
      // 抛物线：解出初速，飞行时间随距离
      var tx = target ? target.x : sx + 260;
      var ty = target ? target.y : sy;
      var dx = Math.max(40, tx - sx);
      var T = M.clamp(dx / 300, 0.55, 1.25);
      var g = 980;
      pr.vx = dx / T;
      pr.vy = (ty - sy - 0.5 * g * T * T) / T;
      pr.g = g;
      pr.targetY = ty;
      pr.spin = (this.rng.next() < 0.5 ? -1 : 1) * this.rng.range(5, 9);
      pr.targetId = target ? target.id : null;
    }
    this.projectiles.push(pr);
    plant.anim.triggerFire();
    global.Bus.emit(EV.PLANT_FIRE, { plant: plant, projectile: pr, target: target });

    // 双管：额外发射的豌豆（伤害按卡牌比例折算，source 区分以便 FX 表现）
    if (def.proj === 'pea' && this.mod.extraPea > 0) {
      for (var q = 0; q < this.mod.extraPea; q++) {
        var extra = {
          id: this._uid++, type: 'pea', x: sx - 2, y: sy + (q + 1) * 5,
          dmg: dmg * this.mod.extraPeaRatio, owner: plant.id, lane: plant.lane,
          aoe: 0, aoeRatio: 0, t: 0, dead: false, rot: 0, spin: 0,
          vx: pr.vx * this.rng.range(0.93, 1.07), vy: 0, g: 0, extra: true
        };
        this.projectiles.push(extra);
        global.Bus.emit(EV.PLANT_FIRE, { plant: plant, projectile: extra, target: target, extra: true });
      }
    }
  };

  Battlefield.prototype._findTarget = function (plant) {
    var best = null, bestX = Infinity;
    for (var i = 0; i < this.enemies.length; i++) {
      var e = this.enemies[i];
      if (e.dead || e.lane !== plant.lane) continue;
      if (e.x < plant.x - 8) continue;          // 已经越过
      if (e.x < bestX) { bestX = e.x; best = e; }
    }
    return best;
  };

  /* ---------------- 主更新 ---------------- */

  Battlefield.prototype.update = function (dt) {
    var i, e, p;

    // 波次调度
    if (this.waveRunning) {
      this.waveClock += dt;
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0 && this.spawnQueue.length) {
        this._spawnEnemy(this.spawnQueue.shift());
        this.spawnTimer = this.spawnInterval * this.rng.range(0.7, 1.3);
      }
      if (!this.spawnQueue.length && !this.enemies.some(function (x) { return !x.dead; })) {
        this.waveRunning = false;
        var lvlDone = (this.wave % WAVES.length) === 0;
        // 修补：每清一波回一点星枢
        if (this.mod.waveHeal > 0 && !lvlDone) this.healNode(this.mod.waveHeal);
        global.Bus.emit(EV.WAVE_CLEAR, { wave: this.wave, level: this.level, kills: this.stats.kills });
        if (lvlDone) global.Bus.emit(EV.LEVEL_CLEAR, { level: this.level });
      }
    }

    // 敌人
    for (i = this.enemies.length - 1; i >= 0; i--) {
      e = this.enemies[i];
      if (e.spawnT < 1) e.spawnT = Math.min(1, e.spawnT + dt * 3);
      if (e.dead) {
        e.deathT += dt;
        if (e.deathT > 0.75) this.enemies.splice(i, 1);
        continue;
      }
      if (e.hitT > 0) e.hitT -= dt;
      if (e.root > 0) e.root -= dt;
      if (e.slowT > 0) { e.slowT -= dt; if (e.slowT <= 0) e.slow = 0; }
      if (e.burnT > 0) {
        e.burnT -= dt;
        this.damageEnemy(e, e.burnDps * dt, 'burn', 'fire');
        if (e.dead) continue;
      }
      if (e.knock > 0) {
        var kd = Math.min(e.knock, 260 * dt);
        e.x += kd; e.knock -= kd;
      }
      var sp = e.baseSpeed;
      if (e.slow) sp *= (1 - e.slow);
      if (e.root > 0) sp = 0;
      var moveRatio = e.baseSpeed > 0 ? sp / e.baseSpeed : 0;
      // 速度基准 120px/s：0.35 格/秒 的小兵约 13s 走完全场，0.22 的天牛约 21s
      var px = e.x - sp * 120 * dt * (this.cfg.w / 600);
      e.x = px;
      e.anim.update(dt, moveRatio);

      if (e.x <= this.cfg.x + this.cfg.nodeX) {
        e.dead = true; e.deathT = 9;      // 立刻从可打击列表移除
        this.enemies.splice(i, 1);
        this.stats.leaks++;
        this.damageNode(e.dmg);
        global.Bus.emit(EV.ENEMY_LEAK, { enemy: e, damage: e.dmg });
      }
    }

    // 植物
    for (i = 0; i < this.plants.length; i++) {
      p = this.plants[i];
      p.born = Math.min(1, p.born + dt * 3);
      if (p.evolving > 0) p.evolving = Math.max(0, p.evolving - dt * 2);
      p.anim.update(dt);
      var def = PLANTS[p.kind];
      if (!def || !def.interval) continue;
      p.cd -= dt;
      if (p.cd <= 0) {
        var tgt = this._findTarget(p);
        if (tgt) {
          // 攻速：卡牌倍率越高，间隔越短；±8% 抖动避免整齐划一的机械感
          p.cd = def.interval * this.rng.range(0.92, 1.08) / (this.mod.plantAspd || 1);
          this._fire(p, tgt);
        } else {
          p.cd = 0.1;   // 无目标时不空转冷却
        }
      }
    }

    // 投射物
    for (i = this.projectiles.length - 1; i >= 0; i--) {
      var pr = this.projectiles[i];
      pr.t += dt;
      pr.x += pr.vx * dt;
      if (pr.g) {
        pr.vy += pr.g * dt;
        pr.y += pr.vy * dt;
        pr.rot += pr.spin * dt;
        // 落地判定
        var hit = null;
        for (var j = 0; j < this.enemies.length; j++) {
          var ee = this.enemies[j];
          if (ee.dead || ee.lane !== pr.lane) continue;
          if (Math.abs(ee.x - pr.x) < 26 && Math.abs(ee.y - pr.y) < 30) { hit = ee; break; }
        }
        var groundY = this.laneY(pr.lane) + 4;
        if (hit || pr.y >= groundY) {
          this._impact(pr, hit);
          this.projectiles.splice(i, 1);
          continue;
        }
      } else {
        pr.rot += dt * 6;
        var h2 = null;
        for (var j2 = 0; j2 < this.enemies.length; j2++) {
          var e2 = this.enemies[j2];
          if (e2.dead || e2.lane !== pr.lane) continue;
          if (Math.abs(e2.x - pr.x) < 20 && Math.abs(e2.y - pr.y) < 26) { h2 = e2; break; }
        }
        if (h2) { this._impact(pr, h2); this.projectiles.splice(i, 1); continue; }
      }
      if (pr.x > this.spawnX + 60 || pr.t > 4) this.projectiles.splice(i, 1);
    }

    if (this.nodeHitT > 0) this.nodeHitT -= dt;
  };

  Battlefield.prototype._impact = function (pr, hit) {
    var src = pr.type === 'cabbage' ? 'cabbage' : (pr.extra ? 'pea:extra' : 'pea');
    if (hit) {
      this.damageEnemy(hit, pr.dmg, src, null);
      hit.knock = Math.max(hit.knock, pr.type === 'cabbage' ? 16 : (pr.extra ? 3 : 6));
    }
    if (pr.aoe) {
      for (var i = 0; i < this.enemies.length; i++) {
        var e = this.enemies[i];
        if (e.dead || e === hit) continue;
        if (Math.abs(e.x - pr.x) <= pr.aoe && Math.abs(e.y - pr.y) < this.laneH * 0.6) {
          this.damageEnemy(e, pr.dmg * pr.aoeRatio, 'cabbage:aoe', null);
        }
      }
    }
    global.Bus.emit('battle:impact', {
      x: pr.x, y: pr.y, type: pr.type, hit: !!hit, aoe: pr.aoe, extra: !!pr.extra
    });
  };

  global.Battlefield = Battlefield;
})(window);
