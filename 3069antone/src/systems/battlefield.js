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
    boss: { kind: 'beetle', name: 'Boss', hp: 1400, speed: 0.20, dmg: 40, armor: 0.20, scale: 1.52, gold: 90 },
    // 触手蜘蛛：不走路，靠八条触手在锚点间「抛出 → 缠绕 → 牵引」。
    // speed 只是兜底爬行速度；实际位移由打分选出的锚点决定。
    spider: {
      kind: 'spider', name: '触手蛛', hp: 260, speed: 0.30, dmg: 14, armor: 0.10, scale: 1.10, gold: 22,
      rv: 0.34,                 // v 方向半径：让它横跨两道时仍可被命中
      reach: 1.0,               // 触手前向射程，单位为「格宽」（cellW）
      laneSpan: 1.5,            // 触手跨道半径，单位为「车道高」（laneH）。>1 才够得着邻道
      seekInterval: 0.45,       // 重新打分的间隔（秒）
      grappleTime: 0.16,        // 触手伸出并缠住的耗时
      perchTime: 0.30,          // 落地停顿
      biteInterval: 0.85, biteDmg: 16, biteRange: 40
    },
    // 蜜蜂：飞行单位。尾针缓慢戳击，每 2~3 下飞走换目标。
    // 走「air」阻挡层：越过岩石（ground 阻挡对 air 不生效），但被巨石（air=1）拦下。
    bee: { kind: 'bee', name: '蜜蜂', hp: 70, speed: 0.62, dmg: 6, armor: 0, scale: 1.0, gold: 9, flying: true }
  };

  /* ---------------- 植物表 ---------------- */
  /* hp 是植物被啃食时的耐久。牙苗最脆，这也是蜘蛛爱挑它的原因之一。 */
  var PLANTS = {
    sprout: {
      name: '牙苗', dmg: 0, interval: 0, range: 0, proj: null, hp: 40,
      desc: '一切的开始，可进化为任意植物'
    },
    peashooter: {
      name: '豌豆射手', dmg: 11, interval: 1.4, range: 1e9, proj: 'pea', speed: 430, hp: 110,
      muzzle: { dx: 15, dy: -14 }, desc: '炮口直射，单体稳定输出'
    },
    cabbagepult: {
      name: '卷心菜投手', dmg: 24, interval: 2.4, range: 1e9, proj: 'cabbage', speed: 0, hp: 100,
      aoe: 52, aoeRatio: 0.6, muzzle: { dx: -15, dy: -22 },
      desc: '尾部抛射，落点小范围溅射'
    },
    burningpomegranate: {
      name: '燃芯石榴', dmg: 9, interval: 1.1, range: 1e9, proj: 'seed', speed: 460, hp: 120,
      muzzle: { dx: 13, dy: -16 }, burn: 3,
      desc: '吐出石榴籽，附带微弱燃烧'
    }
  };

  /* ---------------- 关卡波次组成（关 1，来自 10_波次预算表） ---------------- */
  var WAVES = [
    { t: 30, comp: [['grunt', 6]], intent: '教学波。不可能失败。' },
    { t: 35, comp: [['grunt', 4], ['swarm', 4], ['swift', 2]], intent: '引入群体压力与时间压力。' },
    { t: 45, comp: [['armor', 2], ['grunt', 6], ['spider', 1]], intent: '引入护甲 + 触手蛛亮相（会跨道绕后啃残血）。' },
    { t: 45, comp: [['swift', 6], ['armor', 2], ['spider', 1]], intent: '时间压力为主，逼玩家加快合成；蜘蛛开始拆前排。' },
    { t: 60, comp: [['elite', 1], ['grunt', 8], ['swarm', 4], ['spider', 2], ['bee', 1]], intent: 'Boss 波。检验轮盘编排与多线兼顾；收尾放 1 只蜜蜂试探空中。' }
  ];

  var ELEMENTS = ['fire', 'water', 'wood', 'light', 'thunder', 'ice'];
  var ELEMENT_CN = { fire: '火', water: '水', wood: '木', light: '光', thunder: '雷', ice: '冰' };

  /* 障碍物碰撞默认（与编辑器 data.js 的 COLLIDE_DEFAULT 保持一致）。
   * 关卡数据里 collide 为 null 时回落到此表 —— 保证游戏能独立消费原始关卡 JSON。 */
  /**
   * 障碍物类型默认。两组独立开关 + 一个高度：
   *   enemy{ground,air,grappler} —— 挡哪类单位
   *   proj{flat,arc}             —— 挡哪类弹道
   *   h                          —— 离地高度（单位：laneH 的比例），弹道 z 低于它才算撞上
   * 实例可用 collide.{enemy,proj} 覆盖开关、用 h 覆盖高度。
   *
   * h 与 proj 开关必须自洽，否则会出现「设定说能挡抛物线，但物理上飞过去了」：
   *   只挡平射（rock/stump）  → h 要低于抛物线弧高 ARC_RATIO
   *   连抛物线也挡（boulder/pillar）→ h 要高于弧高
   * 平射枪口高度约 12px，弧高为 ARC_RATIO×laneH（竖屏 50 / 横屏 86），两种布局都成立。
   */
  var OBSTACLE_DEFAULTS = {
    rock: { h: 0.28, enemy: { ground: 1, air: 0, grappler: 0 }, proj: { flat: 1, arc: 0 } },
    boulder: { h: 0.78, enemy: { ground: 1, air: 1, grappler: 0 }, proj: { flat: 1, arc: 1 } },
    crystal: { h: 0.40, enemy: { ground: 1, air: 0, grappler: 0 }, proj: { flat: 0, arc: 0 } },
    stump: { h: 0.24, enemy: { ground: 1, air: 0, grappler: 0 }, proj: { flat: 1, arc: 0 } },
    pillar: { h: 1.05, enemy: { ground: 0, air: 0, grappler: 0 }, proj: { flat: 1, arc: 1 } }
  };

  /**
   * 抛物线弧高 = ARC_RATIO × laneH。
   * 按车道高走而不是固定重力：竖屏 laneH 只有 112，沿用固定 g=980 会把弹丸抛到战场
   * 上边界之外被 clip 裁掉；按比例则横竖屏观感一致，且永远落在战场内。
   */
  var ARC_RATIO = 0.45;

  /* 地块属性（与编辑器 data.js 的 TILES 保持一致）。
   * slow：移动速度乘子被扣掉的比例（0.30 → ×0.70）；walk=false → 阻挡（贴格右侧停住）。
   * 泥地/水洼的具体系数以关卡 map.effects 为准，这里只放「是否阻挡」「是否为水洼」的定性属性。 */
  var TILE_PROPS = {
    grass: { slow: 0, walk: true, water: false },
    slot: { slow: 0, walk: true, water: false },
    mud: { slow: 0.30, walk: true, water: false },
    water: { slow: 0.15, walk: true, water: true },
    rock: { slow: 0, walk: false, water: false },
    hole: { slow: 0, walk: false, water: false },
    spawn: { slow: 0, walk: true, water: false }
  };
  function tileProp(key) { return TILE_PROPS[key] || TILE_PROPS.grass; }

  /* ============================================================ */

  function Battlefield(opts) {
    opts = opts || {};
    this.cfg = {
      x: opts.x || 0, y: opts.y || 0,
      w: opts.w || 600, h: opts.h || 400,
      lanes: opts.lanes || 3,
      cols: opts.cols || 4,
      nodeX: opts.nodeX || 58,
      // 钩子⑧：2.5D 梯形投影。缺省 false —— 正交外观是回归基线。
      // 注意：必须在构造期就落进 cfg，否则 depthScale/projX 的开关恒为
      // undefined，整个 2.5D 会静默退化成「无效果」。转屏不重建实例，
      // 所以这里设一次就够，relayout() 不需要再同步。
      depth25d: opts.depth25d === true,
      depthFar: (opts.depthFar != null) ? opts.depthFar : 0.72
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
    this.obstacles = [];      // 岩石 / 洞穴等可缠绕地形。目前恒为空，蜘蛛的候选生成已留好接口
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

    // 关卡数值覆盖层（挂载点④）：编辑器/外部可通过 opts.balance 注入全局乘子。
    // 全字段可选；不传则保持默认行为 —— 游戏本体不受影响。
    this.balance = opts.balance || null;

    // 数值表覆盖层（挂载点⑥/⑦）：编辑器/外部可经 opts.tuning 覆盖 ROLES/PLANTS 基础数值。
    // 缺省（无编辑器数据）则为 null —— 与旧版行为完全一致。
    // 合并是「每调用从不可变 base 重算」，不污染全局 ROLES/PLANTS，多关切换也不会叠加。
    this.tuning = opts.tuning || null;
    this._roleDefs = {};
    this._plantDefs = {};

    // 卡牌/养成给出的「基准」修正值副本；乘子层（关卡 balance）只叠在基准上。
    // 这样 MOD_CHANGED 或关卡切换时重算 mod，不会把乘子叠两次（详见 _applyMod）。
    this._modBase = Object.assign({}, this.mod);

    this._layout();
    this._bind();
    this._applyMod();

    // 关卡波次：默认用内置 WAVES；编辑器/外部可通过 opts.waves 注入（挂载点①）
    this.waves = opts.waves ? this._normWaves(opts.waves) : WAVES;

    // 编辑器注入的扩展数据：障碍物（带几何）与显示调整层。
    // 不传则保持默认行为 —— 游戏本体不受影响。
    this.display = opts.display || null;
    this.obstacles = [];
    this.loadObstacles(opts.obstacles);

    // 地形（挂载点⑤）：编辑器导出的 map.tiles / map.effects，由游戏侧解释寻路。
    // 缺省（无编辑器数据）则全草地、无任何修正 —— 与旧版行为完全一致。
    this.map = opts.map || null;
    this.tiles = (this.map && this.map.tiles) || null;
    this.terrainEffects = (this.map && this.map.effects) || { mudSlow: 0.30, waterSlow: 0.15, waterIceTaken: 1.25 };
  }

  Battlefield.ROLES = ROLES;
  Battlefield.PLANTS = PLANTS;
  Battlefield.WAVES = WAVES;
  Battlefield.ELEMENTS = ELEMENTS;
  Battlefield.ELEMENT_CN = ELEMENT_CN;

  /**
   * 角色（敌人）基础数值：base ROLES[key] 叠加 opts.tuning.enemies[key] 的部分字段。
   * 结果按 key 缓存，避免每帧重复合并；base 永远不可变，所以多次调用安全、可跨关。
   */
  Battlefield.prototype.roleDef = function (key) {
    if (this._roleDefs[key]) return this._roleDefs[key];
    var base = ROLES[key] || ROLES.spider;
    var ov = (this.tuning && this.tuning.enemies && this.tuning.enemies[key]) || null;
    var d = (ov && typeof ov === 'object') ? Object.assign({}, base, ov) : base;
    this._roleDefs[key] = d;
    return d;
  };

  /**
   * 植物基础数值：base PLANTS[kind] 叠加 opts.tuning.plants[kind] 的部分字段。
   */
  Battlefield.prototype.plantDef = function (kind) {
    if (this._plantDefs[kind]) return this._plantDefs[kind];
    var base = PLANTS[kind] || {};
    var ov = (this.tuning && this.tuning.plants && this.tuning.plants[kind]) || null;
    var d = (ov && typeof ov === 'object') ? Object.assign({}, base, ov) : base;
    this._plantDefs[kind] = d;
    return d;
  };

  Battlefield.prototype._layout = function () {
    var c = this.cfg;
    this.cellW = (c.w - c.nodeX - 96) / c.cols;
    this.laneH = c.h / c.lanes;
    this._cx = c.x + c.w * 0.5;      // 战场水平中心：梯形透视的收缩中心
    this._laneY = [];
    for (var i = 0; i < c.lanes; i++) {
      this._laneY.push(c.y + this.laneH * (i + 0.5) + 14);
    }
    this.spawnX = c.x + c.w + 26;
  };

  Battlefield.prototype.laneY = function (i) { return this._laneY[i]; };

  /**
   * 分数车道 v 的屏幕 y。整数处与 laneY() 逐位一致（laneYf(2) === laneY(2)），
   * 小数处在相邻两道间线性插值 —— 跨道实体（触手蜘蛛）靠它落位。
   */
  Battlefield.prototype.laneYf = function (v) {
    var n = this.cfg.lanes;
    var c = M.clamp(v, 0, n - 1);
    var i = Math.floor(c), f = c - i;
    if (f < 1e-6 || i >= n - 1) return this.laneY(i);
    return this.laneY(i) + (this.laneY(i + 1) - this.laneY(i)) * f;
  };

  /**
   * 纵向命中容差。以「车道高」为单位而非写死像素，这样横竖屏、不同车道数都自洽。
   * 对 rv=0 的普通敌人：tol = laneH/2 + 14，邻道间距是 laneH-20，
   * 只要 laneH > 68 就一定不会误伤邻道 —— 横屏 192 / 竖屏 112 都满足。
   */
  Battlefield.prototype.hitTol = function (e) {
    return this.laneH * (0.5 + (e.rv || 0)) + 14;
  };

  Battlefield.prototype.slotX = function (col) { return this.cfg.x + this.cfg.nodeX + 40 + this.cellW * (col + 0.5); };
  Battlefield.prototype.slotY = function (lane) { return this.laneY(lane); };

  /**
   * 屏幕形状变化（横竖屏切换 / 窗口缩放）时重新落位。
   * 不重建世界 —— 波次、血量、冷却全部保留，只把几何映射过去。
   * @param {{x,y,w,h}} rect 新的战场矩形
   * @param {number} [nodeX] 星枢距左边界的距离
   */
  Battlefield.prototype.relayout = function (rect, nodeX) {
    var old = { x: this.cfg.x, w: this.cfg.w };
    this.cfg.x = rect.x; this.cfg.y = rect.y;
    this.cfg.w = rect.w; this.cfg.h = rect.h;
    if (nodeX !== undefined && nodeX !== null) this.cfg.nodeX = nodeX;
    this._layout();

    // 植物：格子坐标是逻辑的（lane/col），直接按新几何重算即可
    for (var i = 0; i < this.plants.length; i++) {
      var p = this.plants[i];
      p.x = this.slotX(p.col);
      p.y = this.slotY(p.lane);
    }

    // 敌人：y 用出生时的车道内偏移还原；x 按新旧宽度等比映射，保证「走到哪了」的比例不变
    var k = old.w > 0 ? (this.cfg.w / old.w) : 1;
    for (var j = 0; j < this.enemies.length; j++) {
      var e = this.enemies[j];
      e.x = this.cfg.x + (e.x - old.x) * k;
      e.y = this.laneY(e.lane) + (e._yOff || 0);
    }

    // 飞行中的投射物：坐标系已变，直接丢弃（视觉上一帧的损失，不影响任何状态）
    this.projectiles.length = 0;

    // 障碍物几何依赖 cellW/laneH，转屏后重算
    this._rebuildObstacleGeom();
  };

  /* ---------------- 编辑器扩展：障碍物 + 显示调整层 ----------------
   * 这三个方法是「钩子」：编辑器把数据塞进 Battlefield，游戏照常跑。
   * 不依赖编辑器模块 —— 任何符合 FORMAT 的关卡 JSON 都能被独立消费。
   */

  /** 像素列（与编辑器 panel-scene 的 colOf 同式） */
  Battlefield.prototype.colAt = function (x) {
    var c = Math.floor((x - (this.cfg.x + this.cfg.nodeX + 40)) / this.cellW);
    return M.clamp(c, 0, this.cfg.cols - 1);
  };

  /** 计算单个障碍物的屏幕几何（依赖 _layout 后的 cellW / laneH / slotX） */
  Battlefield.prototype._obstacleGeom = function (o) {
    var cl = this.slotX(o.col) - this.cellW / 2;
    var top = this.laneY(o.lane) - this.laneH / 2 + 6;
    var bandH = this.laneH - 12;
    var bandW = this.cellW;
    var pts = (o.shape && o.shape.pts && o.shape.pts.length >= 3)
      ? o.shape.pts
      : [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    var poly = pts.map(function (p) {
      return { x: cl + p.x * bandW, y: top + p.y * bandH };
    });
    var maxX = 0;
    for (var i = 0; i < pts.length; i++) if (pts[i].x > maxX) maxX = pts[i].x;
    o.cellLeft = cl; o.cellRight = cl + bandW;
    o.topPx = top; o.botPx = top + bandH;
    o.stopX = cl + maxX * bandW;     // 敌人向左推进时停在此处右侧
    o.poly = poly;
    o.cx = this.slotX(o.col); o.cy = this.laneY(o.lane); o.v = o.lane;
    // 离地高度：实例 h > 类型默认 h > 兜底 0.3，单位换算成 px 供弹道 z 判定
    var _hd = (OBSTACLE_DEFAULTS[o.kind] || {}).h;
    o.topZ = this.laneH * (o.h != null ? o.h : (_hd != null ? _hd : 0.3));
  };

  /** 从编辑器数据装载障碍物（collide 为 null = 用类型默认，见 obsBlocks） */
  Battlefield.prototype.loadObstacles = function (list) {
    this.obstacles = [];
    if (!list) return;
    var self = this;
    list.forEach(function (o) {
      if (!o || o.lane === undefined || o.col === undefined) return;
      if (o.applied === false) return;     // 未「应用」的障碍物不进游戏
      var ob = {
        lane: o.lane, col: o.col, kind: o.kind || 'rock',
        applied: true,
        collide: o.collide || null,
        shape: o.shape || null,
        note: o.note || ''
      };
      self._obstacleGeom(ob);
      self.obstacles.push(ob);
    });
  };

  /** 转屏后按新几何重算所有障碍物 */
  Battlefield.prototype._rebuildObstacleGeom = function () {
    for (var i = 0; i < this.obstacles.length; i++) this._obstacleGeom(this.obstacles[i]);
  };

  /** 该障碍物是否阻挡某一层（applied 为假 → 永不阻挡） */
  Battlefield.prototype.obsBlocks = function (o, layer, sub) {
    if (!o || o.applied === false) return false;
    var def = (OBSTACLE_DEFAULTS[o.kind] || {})[layer] || {};
    var own = (o.collide || {})[layer] || {};
    var v = (sub in own) ? own[sub] : def[sub];
    return !!v;
  };

  /** 显示调整层：两级合并（byType → byInst 覆盖），逐字段合并 */
  Battlefield.prototype.dispGet = function (group, key, instKey) {
    var d = this.display;
    if (!d) return { scale: null, ox: 0, oy: 0 };
    var t = (d.byType && d.byType[group]) ? d.byType[group][key] : null;
    var i = (instKey && d.byInst && d.byInst[group]) ? d.byInst[group][instKey] : null;
    return {
      scale: (i && i.scale != null) ? i.scale : ((t && t.scale != null) ? t.scale : null),
      ox: (i && i.ox) || (t && t.ox) || 0,
      oy: (i && i.oy) || (t && t.oy) || 0
    };
  };

  /** 敌人被障碍物挡住时允许的最左 x（低于此值不允许）。-Infinity = 不挡 */
  Battlefield.prototype._enemyBlockX = function (e) {
    if (e.grappler) return -Infinity;        // 触手蜘蛛靠跳跃越障，不受此钳制
    var cls = e.flying ? 'air' : 'ground';    // 飞行单位走 air 层（越过岩石，被巨石拦）
    var lim = -Infinity;
    for (var i = 0; i < this.obstacles.length; i++) {
      var o = this.obstacles[i];
      if (o.lane !== e.lane) continue;
      if (!this.obsBlocks(o, 'enemy', cls)) continue;
      if (e.x > o.cellLeft - 2) lim = Math.max(lim, o.stopX + 1);
    }
    return lim;
  };

  /**
   * 投射物是否撞上阻挡其类型的障碍物。
   * 判定放在 (v, z) 空间做，不再拿屏幕 y 凑合：
   *   v —— 弹道当前深度。跨道弹丸按飞行进度连续变化，所以飞到中途时会去检查
   *       中间那条道的障碍物（旧的 Math.round(发射道) 只看发射格，答不上这个问题）。
   *   z —— 离地高度。低于障碍高度才算撞上，于是「抛物线飞越岩石」自动成立，
   *       不需要给每条弹道单独配一张越障表。
   */
  Battlefield.prototype._projBlocked = function (pr, ptype) {
    for (var i = 0; i < this.obstacles.length; i++) {
      var o = this.obstacles[i];
      if (Math.abs(o.v - pr.v) > 0.5) continue;
      if (!this.obsBlocks(o, 'proj', ptype)) continue;
      if (pr.x >= o.cellLeft && pr.x <= o.cellRight && pr.z < o.topZ) return true;
    }
    return false;
  };

  /* ---------------- 地形（挂载点⑤）：map.tiles 解释寻路 ----------------
   * 与编辑器预览（panel-scene.applyTerrain）同源逻辑：
   *   · 泥地/水洼按 map.effects 的 mudSlow/waterSlow 减速；
   *   · 岩石/空洞（walk=false）贴格右侧钳制，敌人停在该格外；
   *   · 水洼标记 _onWater，冰系伤害在 damageEnemy 里 ×waterIceTaken。
   * 数据缺省（this.tiles 为 null）时全部回落草地，行为不变。
   */

  /** 取某格地块键；越界或缺失回落 grass */
  Battlefield.prototype.tileAt = function (lane, col) {
    if (!this.tiles) return 'grass';
    if (lane < 0 || lane >= this.cfg.lanes) return 'grass';
    var row = this.tiles[lane];
    if (!row) return 'grass';
    return row[col] || 'grass';
  };

  /** 带 spawn 格的车道；无地形或无限定则空数组 */
  Battlefield.prototype._spawnLanes = function () {
    var out = [];
    if (!this.tiles) return out;
    for (var l = 0; l < this.cfg.lanes; l++) {
      var has = false;
      for (var c = 0; c < this.cfg.cols; c++) if (this.tileAt(l, c) === 'spawn') { has = true; break; }
      if (has) out.push(l);
    }
    return out;
  };
  /** 某车道最靠右的 spawn 格（缺则返回 null） */
  Battlefield.prototype._spawnCellForLane = function (lane) {
    if (!this.tiles) return null;
    var best = null;
    for (var c = 0; c < this.cfg.cols; c++) if (this.tileAt(lane, c) === 'spawn') best = c;
    return best;
  };

  /** 每帧重算敌人速度（地形减速）与 _onWater 标记 */
  Battlefield.prototype._terrainApply = function (e) {
    if (!this.tiles) { e.baseSpeed = e._baseSpeed; e._onWater = false; return; }
    var col = this.colAt(e.x);
    var tk = this.tileAt(e.lane, col);
    var eff = this.terrainEffects;
    var tf = 1;
    if (tk === 'mud') tf = 1 - (eff.mudSlow != null ? eff.mudSlow : 0.30);
    else if (tk === 'water') tf = 1 - (eff.waterSlow != null ? eff.waterSlow : 0.15);
    e.baseSpeed = e._baseSpeed * tf;
    e._onWater = (tk === 'water');
  };

  /** 地形阻挡（岩石/空洞）：把越界的敌人钳制在该格右侧之外 */
  Battlefield.prototype._terrainBlock = function (e) {
    if (e.grappler) return;                 // 触手蜘蛛靠跳跃越障，不受此钳制
    if (!this.tiles) return;
    var col = this.colAt(e.x);
    var p = tileProp(this.tileAt(e.lane, col));
    if (!p.walk) {
      var cr = this.slotX(col) + this.cellW / 2;   // 该格右边缘
      if (e.x < cr + 1) e.x = cr + 1;
    }
  };

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
    // 先把卡牌/养成给的「基准」存下来（MOD_CHANGED 时刷新），后续乘子层只叠在基准上
    if (src) {
      for (var i = 0; i < keys.length; i++) this._modBase[keys[i]] = src[keys[i]];
      this._modBase.elemPower = src.elemPower;
    }
    // 每次都从基准重算：保证「基准 × 关卡乘子」恒成立，且可重复调用
    // （关卡切换时重算不会把乘子再叠一遍）。
    for (var j = 0; j < keys.length; j++) m[keys[j]] = this._modBase[keys[j]];
    m.elemPower = this._modBase.elemPower;
    // 关卡数值覆盖层（挂载点④）：植物伤害/攻速乘子叠在基准之上
    if (this.balance) {
      m.plantDmg *= (this.balance.plantDmg != null) ? this.balance.plantDmg : 1;
      m.plantAspd *= (this.balance.plantAspd != null) ? this.balance.plantAspd : 1;
    }
    // 星枢上限随「壁垒」提升；关卡亦可绝对覆盖（挂载点④ nodeHp）。下限保护 1
    var newMax = 100 + (m.nodeMaxAdd || 0);
    if (this.balance && this.balance.nodeHp != null && isFinite(this.balance.nodeHp)) {
      newMax = Math.max(1, this.balance.nodeHp);
    }
    if (newMax !== this.nodeMax) {
      var ratio = this.nodeMax > 0 ? this.nodeHp / this.nodeMax : 1;
      this.nodeMax = newMax;
      this.nodeHp = Math.min(newMax, Math.max(1, ratio * newMax));
    }
  };

  /**
   * 关卡内容切换（多关流程 #19 / 挂载点④延伸）：把某一关的
   * 波次 / 障碍物 / 显示层 / 数值覆盖 整体换上，并重置波次计数。
   * 由 main.js 在收到 CMD_NEXT_LEVEL 时，按「当前关卡序号 → levels[i]」调用。
   * 不把星枢血量回满（沿用 _applyMod 的比例换算）—— 通常切关时星枢是满的。
   */
  Battlefield.prototype.applyLevelContent = function (L) {
    if (L && Array.isArray(L.waves) && L.waves.length) this.waves = this._normWaves(L.waves);
    this.loadObstacles(L ? L.obstacles : []);
    this.display = (L && L.display) ? L.display : null;
    this.balance = (L && L.balance) ? L.balance : null;
    // 数值表（挂载点⑥/⑦）：换关时整体换上 tuning（无则沿用构造时设定）
    this.tuning = (L && L.tuning) ? L.tuning : this.tuning;
    this._roleDefs = {}; this._plantDefs = {};   // 缓存随 tuning 失效
    // 地形（挂载点⑤）：换关时整体换上 map.tiles / map.effects
    this.map = (L && L.map) ? L.map : null;
    this.tiles = (this.map && this.map.tiles) || null;
    this.terrainEffects = (this.map && this.map.effects) || { mudSlow: 0.30, waterSlow: 0.15, waterIceTaken: 1.25 };
    // 重新折算 mod（含植物乘子与星枢覆盖），波次从头开始
    this._applyMod();
    this.wave = 0; this.waveIdx = 0; this.waveRunning = false;
    this.spawnQueue = []; this.spawnTimer = 0; this.waveClock = 0;
  };

  /** 植物实际伤害倍率：基础 × 卡牌 × 共生（每株植物 +5% × 层数） */
  Battlefield.prototype.plantDmgMult = function () {
    var s = 1 + (this.mod.symbiosis || 0) * 0.05 * this.plants.length;
    return this.mod.plantDmg * s;
  };

  /* ---------------- 编队 ---------------- */

  Battlefield.prototype.placePlant = function (slot, kind) {
    if (!this.plantDef(kind)) return null;
    if (slot.lane < 0 || slot.lane >= this.cfg.lanes) return null;
    if (slot.col < 0 || slot.col >= this.cfg.cols) return null;
    // 同格替换
    for (var i = 0; i < this.plants.length; i++) {
      if (this.plants[i].lane === slot.lane && this.plants[i].col === slot.col) {
        this.plants.splice(i, 1); break;
      }
    }
    var hp = this.plantDef(kind).hp || 100;
    var p = {
      id: this._uid++, kind: kind, lane: slot.lane, col: slot.col,
      v: slot.lane,                    // 分数车道坐标；植物恒为整数
      x: this.slotX(slot.col), y: this.slotY(slot.lane),
      hp: hp, maxHp: hp,
      cd: this.rng.range(0, 0.4),
      anim: new global.PlantArt.PlantAnimator(kind, this.rng.next() * 10),
      fired: false, born: 0, evolving: 0, hitT: 0
    };
    this.plants.push(p);
    return p;
  };

  /** 植物受击。返回实际伤害；致死则移除并让出格子。 */
  Battlefield.prototype.damagePlant = function (p, amount, source) {
    if (!p || p.dead) return 0;
    p.hp -= amount;
    p.hitT = 0.18;
    global.Bus.emit(EV.PLANT_HIT, { plant: p, amount: amount, source: source || 'unknown' });
    if (p.hp <= 0) {
      p.hp = 0; p.dead = true;
      var i = this.plants.indexOf(p);
      if (i >= 0) this.plants.splice(i, 1);
      global.Bus.emit(EV.PLANT_DEAD, { plant: p, source: source || 'unknown' });
    }
    return amount;
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

  /** 外部波次数据归一化为内部格式：{ t, intent, comp:[[role,count]] } */
  Battlefield.prototype._normWaves = function (list) {
    return (list || []).map(function (w) {
      return {
        t: Math.max(4, +w.t || 30),
        intent: w.intent || '',
        comp: (w.comp || []).map(function (c) { return [c[0], c[1]]; })
      };
    });
  };

  Battlefield.prototype.startNextWave = function () {
    if (this.waveRunning) return;
    this.wave++;
    this.waveIdx = (this.wave - 1) % this.waves.length;
    var w = this.waves[this.waveIdx];
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
    var R = this.roleDef(role);
    if (!R) return;
    var sc = this.levelScale();
    var b = this.balance;
    var hpMul = (b && b.enemyHp != null) ? b.enemyHp : 1;
    var dmgMul = (b && b.enemyDmg != null) ? b.enemyDmg : 1;
    var spdMul = (b && b.enemySpd != null) ? b.enemySpd : 1;
    // 出生车道：优先取带 spawn 格的车道（地形指定进场点），否则随机
    var sLanes = this._spawnLanes();
    var lane = sLanes.length ? sLanes[this.rng.int(0, sLanes.length - 1)] : this.rng.int(0, this.cfg.lanes - 1);
    var hp = Math.round(R.hp * sc.hp * hpMul);
    // 车道内的垂直抖动单独存一份：relayout 时要用它把 y 还原回去
    var yOff = this.rng.range(-6, 6);
    var baseSpeed = R.speed * sc.spd * spdMul;
    var e = {
      id: this._uid++, role: role, kind: R.kind, name: R.name,
      lane: lane, v: lane,                     // v 是分数车道；普通敌人恒为整数，与 lane 同步
      x: this.spawnX + this.rng.range(0, 40), y: this.laneY(lane) + yOff, _yOff: yOff,
      hp: hp, maxHp: hp, baseSpeed: baseSpeed, _baseSpeed: baseSpeed, _onWater: false, dmg: R.dmg * sc.dmg * dmgMul,
      armor: R.armor, scale: R.scale, gold: R.gold,
      rv: R.rv || 0,                           // v 方向命中半径，默认 0 → 行为与旧版逐位一致
      flying: !!R.flying,                      // 飞行单位：越过地面障碍（air 层不阻挡）
      anim: (R.kind === 'bee' && global.BeeArt)
        ? new global.BeeArt.BeeAnimator(R.kind, R.speed, this.rng.next() * 10)
        : new global.InsectArt.InsectAnimator(R.kind, R.speed, this.rng.next() * 10),
      slow: 0, slowT: 0, root: 0, burn: 0, burnT: 0, burnDps: 0,
      knock: 0, hitT: 0, dead: false, deathT: 0, spawnT: 0, walking: 1
    };
    if (R.reach) {
      // 触手蜘蛛：靠锚点牵引移动，状态机 seek → grapple → pull → perch
      e.grappler = true;
      e.state = 'seek';
      e.stateT = 0;
      e.seekT = 0;
      e.anchor = null;                          // {x, y, v, kind, ref}
      e.gx0 = e.x; e.gy0 = e.y;                 // 牵引起点
      e.gp = 0;                                 // 牵引进度 0..1
      e.biteCd = R.biteInterval || 0.85;
      // 触手射程是「椭圆」不是圆 —— 前向与跨道的量纲根本不同
      // （横屏 cellW 110 / laneH 192）。用同一个半径会让纵向够不着邻道，
      // 蜘蛛就永远换不了道。跨道半径 > 1 条道，一跳最多换一条，手感可控。
      e.reachPx = R.reach * this.cellW;                  // 向前抛出多远
      e.reachPy = this.laneH * (R.laneSpan || 1.5);      // 能横跨几条道
    }
    // 地形 spawn 格：有则把敌人摆到该格（最靠右的 spawn 格），与编辑器预览表现一致
    var sc2 = this._spawnCellForLane(lane);
    if (sc2 !== null) {
      e.x = this.slotX(sc2) + this.rng.range(-4, 6);
      e.y = this.laneY(lane) + yOff;
    }
    this.enemies.push(e);
    global.Bus.emit(EV.ENEMY_SPAWN, { enemy: e });
    return e;
  };

  /* ---------------- 伤害 ---------------- */

  /** 只有植物来源的子弹参与暴击；附魔走伤害池，不参与 */
  var PLANT_SRC = { pea: 1, cabbage: 1, 'cabbage:aoe': 1, 'pea:extra': 1, seed: 1 };

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

    // 地形：水洼上的敌人受冰系额外加成（系数取自 map.effects.waterIceTaken）
    if (element === 'ice' && e._onWater) {
      eff *= (this.terrainEffects.waterIceTaken != null ? this.terrainEffects.waterIceTaken : 1.25);
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
    var def = this.plantDef(plant.kind);
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
    var pv = (plant.v === undefined ? plant.lane : plant.v);
    // 枪口离地高度。弹道此后只在 (x, v, z) 里跑，屏幕 y 由 laneYf(v) - z 反推，
    // 不再是独立状态 —— 这是「落地判定错用发射道地面线」的根因所在。
    var z0 = this.laneYf(pv) - sy;
    var pr = {
      id: this._uid++, type: def.proj, x: sx, y: sy, z: z0,
      dmg: dmg, owner: plant.id, lane: plant.lane,
      v: pv, vFrom: pv, vTo: pv,   // 分数车道：跨道弹道按飞行进度从 vFrom 滑到 vTo
      aoe: aoe, aoeRatio: aoeRatio,
      t: 0, T: 0, dead: false, rot: 0, spin: 0, arc: false,
      burn: def.burn || 0
    };
    if (def.proj === 'pea' || def.proj === 'seed') {
      // 平射：贴枪口高度直飞，深度与高度全程不变
      pr.vx = def.speed; pr.vy = 0; pr.g = 0;
    } else {
      // 抛物线：参数化弹道。z 在 T 秒内由 z0 落到 0，中途抬高 hArc。
      // 不再积分重力 —— 弧高直接给定，横竖屏观感一致且不会飞出战场上边界。
      var tv = target ? (target.v === undefined ? target.lane : target.v) : pv;
      var tx = target ? target.x : sx + 260;
      var dx = Math.max(40, tx - sx);
      var T = M.clamp(dx / 300, 0.55, 1.25);
      pr.vx = dx / T;
      pr.g = 1; pr.arc = true;      // g 退化为「是否抛射」的标记，不再参与积分
      pr.T = T; pr.zFrom = z0; pr.zTo = 0;
      pr.hArc = this.laneH * ARC_RATIO;
      pr.vTo = tv;
      pr.landY = this.laneYf(tv);   // 落点（渲染层的落点预告圈用）
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
          z: z0 - (q + 1) * 5,          // 往下错开 5px = 离地高度减 5
          dmg: dmg * this.mod.extraPeaRatio, owner: plant.id, lane: plant.lane,
          v: pv, vFrom: pv, vTo: pv, arc: false, T: 0,
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
    var pv = (plant.v === undefined ? plant.lane : plant.v);
    for (var i = 0; i < this.enemies.length; i++) {
      var e = this.enemies[i];
      if (e.dead) continue;
      // v 区间判定：普通敌人 v 为整数、rv=0，等价于旧的 e.lane === plant.lane；
      // 跨道实体（蜘蛛）凭 rv 在两道之间时仍会被任一邻道纳入候选。
      if (Math.abs(e.v - pv) > 0.5 + (e.rv || 0)) continue;
      if (e.x < plant.x - 8) continue;          // 已经越过
      if (e.x < bestX) { bestX = e.x; best = e; }
    }
    return best;
  };

  /* ============================================================
   *  触手蜘蛛 —— 落脚点打分 + 触手牵引（基础贪心 AI，只看一跳）
   *
   *  每 seekInterval 秒重新评估一次「下一步踩哪」：
   *    生成候选锚点 → 逐项打分 → 取最高分 → 抛触手缠住 → 把自己拉过去。
   *  不做多步搜索 —— 看起来会挑路就够了，手机上也不该跑搜索。
   * ============================================================ */

  // 权重表。各项都归一化到同量纲（0~1 上下）才适合直接相加。想调手感只改这里。
  var SPIDER_W = {
    progress: 1.00,   // 朝星枢推进的收益（星枢在左，x 变小即前进）
    cost: 0.45,       // 距离代价，越远越亏，抑制无意义的长距离摆荡
    prey: 0.90,       // 落点附近的猎物价值：残血 > 满血，会开火的额外加权
    anchor: 0.35,     // 锚点质量：岩石最稳，植物次之，空地最差
    threat: 0.70,     // 该点暴露在多强火力下
    crowd: 0.55,      // 同伴扎堆惩罚，避免整群叠在同一个点
    noise: 0.18       // 随机扰动，防止每次都走同一条线显得机械
  };
  Battlefield.SPIDER_W = SPIDER_W;

  /* ---------------- 2.5D 投影（只作用于绘制） ----------------
   *
   * 逻辑世界是正交的：地面坐标 (x, v, z)，x 是横向像素、v 是分数车道、z 是离地高度。
   * 所有玩法判定（索敌、命中、阻挡、地形）都吃这套坐标，与屏幕形状无关。
   *
   * 投影只做两件事：
   *   projX      —— 横向按深度收缩（远窄近宽），做出梯形地面
   *   depthScale —— 单位与精灵的深度缩放（远小近大）
   * 纵向不压缩，所以 laneYf 保持线性，逻辑层的 laneH / hitTol 等全部不变。
   * 开关关闭时两者都是恒等（原值 / 1），绘制结果与正交逐位一致 —— 这是回退的保证。
   */

  /**
   * 深度缩放：v=0（最远）→ depthFar，v=lanes-1（最近）→ 1。
   * 允许 v 越界外推：车道带边界在 [-0.5, lanes-0.5]，需要比端点更窄/更宽一点。
   */
  Battlefield.prototype.depthScale = function (v) {
    if (!this.cfg.depth25d) return 1;
    var n = this.cfg.lanes;
    if (n <= 1) return 1;
    var k = (this.cfg.depthFar != null) ? this.cfg.depthFar : 0.72;
    return k + (1 - k) * (v / (n - 1));
  };

  /** 地面横向坐标 → 屏幕 x（以战场水平中心为收缩中心） */
  Battlefield.prototype.projX = function (x, v) {
    if (!this.cfg.depth25d) return x;
    return this._cx + (x - this._cx) * this.depthScale(v);
  };

  /** 地面坐标 → 屏幕 y。z 为离地高度，向上为正。 */
  Battlefield.prototype.projY = function (v, z) {
    return this.laneYf(v) - (z || 0);
  };

  /** laneYf 的反函数：屏幕 y → 分数车道 v。落在战场外返回 null。 */
  Battlefield.prototype._vOfY = function (y) {
    var n = this.cfg.lanes;
    if (n < 2) return 0;
    var step = this.laneY(1) - this.laneY(0);
    if (Math.abs(step) < 1e-6) return 0;
    var v = (y - this.laneY(0)) / step;
    if (v < -0.35 || v > n - 1 + 0.35) return null;
    return M.clamp(v, 0, n - 1);
  };

  /**
   * 收集候选落脚点。三类可缠绕物：
   *   植物 —— 能缠，且本身就是猎物
   *   障碍 —— 岩石等，锚点最稳（this.obstacles 目前为空，接口先留好）
   *   空地 —— 射程内随机撒点，保证永远有得选、不会卡死
   */
  Battlefield.prototype._spiderCandidates = function (e) {
    var out = [], i;
    var rx = e.reachPx, ry = e.reachPy || e.reachPx;

    // 归一化椭圆距离：1.0 恰好落在触手极限上。前向用 rx、跨道用 ry 分别归一，
    // 这样「换一条道」和「前进一格」才是可比价的，而不是被 cellW/laneH 的差值吃掉。
    function inReach(dx, dy) {
      var nx = dx / rx, ny = dy / ry;
      return Math.sqrt(nx * nx + ny * ny) <= 1;
    }

    for (i = 0; i < this.plants.length; i++) {
      var p = this.plants[i];
      if (p.dead) continue;
      if (!inReach(p.x - e.x, p.y - e.y)) continue;
      out.push({ x: p.x, y: p.y, v: p.v, kind: 'plant', ref: p, prey: p });
    }

    for (i = 0; i < this.obstacles.length; i++) {
      var o = this.obstacles[i];
      if (!inReach(o.x - e.x, o.y - e.y)) continue;
      if (this.obsBlocks(o, 'enemy', 'grappler')) continue;   // 阻挡触手的障碍不可作锚点
      out.push({ x: o.x, y: o.y, v: o.v, kind: 'rock', ref: o, prey: null });
    }

    // 空地兜底：以「正左方」为中心左右各张 1.1 弧度撒点。
    // 张角比原来的 0.85 大，是为了让纵向分量够得着一整条道 ——
    // 代价是横向前进变少，正好构成「换道要付出推进代价」的取舍。
    for (i = 0; i < 7; i++) {
      var ang = Math.PI + (this.rng.next() - 0.5) * 2.2;
      var rr = 0.45 + this.rng.next() * 0.5;             // 归一化半径，落在椭圆内
      var gy = e.y + Math.sin(ang) * rr * ry;
      var gv = this._vOfY(gy);
      if (gv === null) continue;
      var gx = e.x + Math.cos(ang) * rr * rx;
      out.push({ x: gx, y: this.laneYf(gv), v: gv, kind: 'ground', ref: null, prey: null });
    }
    return out;
  };

  /** 咬程内最「香」的植物的价值（0 ~ 1.35），没有则 0 */
  Battlefield.prototype._preyNear = function (c, range) {
    var best = 0;
    for (var i = 0; i < this.plants.length; i++) {
      var p = this.plants[i];
      if (p.dead) continue;
      var dx = p.x - c.x, dy = p.y - c.y;
      if (dx * dx + dy * dy > range * range) continue;
      var hurt = 1 - M.clamp(p.hp / p.maxHp, 0, 1);
      var armed = (this.plantDef(p.kind).dmg > 0) ? 0.35 : 0;
      if (hurt + armed > best) best = hurt + armed;
    }
    return best;
  };

  /** 落点的火力暴露度（0~1 量级）：覆盖它的植物越多、DPS 越高，值越大 */
  Battlefield.prototype._threatAt = function (c) {
    var t = 0;
    for (var i = 0; i < this.plants.length; i++) {
      var p = this.plants[i];
      if (p.dead) continue;
      var def = this.plantDef(p.kind);
      if (!def || !def.interval) continue;      // 牙苗不还手，不构成威胁
      if (Math.abs(p.v - c.v) > 0.5) continue;  // 植物只打自己那条道
      if (c.x < p.x - 8) continue;              // 只打身前
      t += (def.dmg / def.interval) / 20;       // 归一化：DPS 20 记为 1.0
    }
    return M.clamp(t / 1.5, 0, 1);
  };

  /** 同伴扎堆惩罚（0~1） */
  Battlefield.prototype._crowdAt = function (e, c) {
    var n = 0;
    for (var i = 0; i < this.enemies.length; i++) {
      var o = this.enemies[i];
      if (o === e || o.dead) continue;
      var dx = o.x - c.x, dy = o.y - c.y;
      if (dx * dx + dy * dy < 46 * 46) n++;
    }
    return M.clamp(n / 3, 0, 1);
  };

  /** 给一个落脚点打分，越高越想去。 */
  Battlefield.prototype._spiderScore = function (e, c) {
    var W = SPIDER_W;
    var rx = Math.max(1, e.reachPx), ry = Math.max(1, e.reachPy || e.reachPx);
    var nx = (c.x - e.x) / rx, ny = (c.y - e.y) / ry;
    var dist = Math.sqrt(nx * nx + ny * ny);      // 归一化，1.0 = 触手极限

    var progress = -nx;                           // 向左即前进
    var cost = dist;
    var prey = c.prey ? this._preyNear(c, 40) : this._preyNear(c, 40) * 0.6;
    var anchor = c.kind === 'rock' ? 1.0 : (c.kind === 'plant' ? 0.7 : 0.35);

    return W.progress * progress
      - W.cost * cost
      + W.prey * prey
      + W.anchor * anchor
      - W.threat * this._threatAt(c)
      - W.crowd * this._crowdAt(e, c)
      + this.rng.range(-W.noise, W.noise);
  };

  /** 啃咬：咬程内挑「血量比例最低」的植物下手 —— 优先补刀残血 */
  Battlefield.prototype._spiderBite = function (e, R) {
    var best = null, bestRatio = Infinity;
    for (var i = 0; i < this.plants.length; i++) {
      var p = this.plants[i];
      if (p.dead) continue;
      var dx = p.x - e.x, dy = p.y - e.y;
      if (dx * dx + dy * dy > R.biteRange * R.biteRange) continue;
      var ratio = p.hp / p.maxHp;
      if (ratio < bestRatio) { bestRatio = ratio; best = p; }
    }
    if (best) this.damagePlant(best, R.biteDmg * this.levelScale().dmg, 'spider:bite');
    return !!best;
  };

  /** 蜘蛛每帧更新：seek → grapple → pull → perch */
  Battlefield.prototype._updateSpider = function (e, dt, moveRatio) {
    var R = this.roleDef(e.role) || this.roleDef('spider');
    e.stateT += dt;
    e.biteCd -= dt;

    if (e.state === 'seek') {
      e.seekT -= dt;
      if (e.seekT <= 0) {
        e.seekT = R.seekInterval;
        var best = null, bestS = -Infinity;
        var cands = this._spiderCandidates(e);
        for (var i = 0; i < cands.length; i++) {
          var s = this._spiderScore(e, cands[i]);
          if (s > bestS) { bestS = s; best = cands[i]; }
        }
        if (best) {
          e.anchor = best;
          e.gx0 = e.x; e.gy0 = e.y; e.gp = 0;
          e.state = 'grapple'; e.stateT = 0;
          global.Bus.emit(EV.SPIDER_GRAPPLE, { enemy: e, anchor: best });
        } else {
          e.state = 'perch'; e.stateT = 0; e.anchor = null;
        }
      }
      e.anim.update(dt, 0);
      return;
    }

    if (e.state === 'grapple') {
      // 触手伸出中：身体不动，只把这一帧留给触手动画
      e.anim.update(dt, 0);
      if (e.stateT >= R.grappleTime) { e.state = 'pull'; e.stateT = 0; }
      return;
    }

    if (e.state === 'pull') {
      var a = e.anchor;
      if (!a || (a.ref && a.ref.dead)) { e.anchor = null; e.state = 'seek'; e.stateT = 0; e.seekT = 0; return; }
      var dx0 = a.x - e.gx0, dy0 = a.y - e.gy0;
      var dist = Math.sqrt(dx0 * dx0 + dy0 * dy0);
      var dur = M.clamp(dist / 260, 0.28, 0.75);
      e.gp = Math.min(1, e.gp + dt * moveRatio / dur);
      var t = e.gp, sm = t * t * (3 - 2 * t);          // 缓入缓出，像被拽过去
      e.x = e.gx0 + dx0 * sm;
      // 中途被吊起来一点，做出「荡」的感觉；落地时归零
      e.y = e.gy0 + dy0 * sm - Math.sin(t * Math.PI) * 14;
      var nv = this._vOfY(e.y);
      if (nv !== null) {
        e.v = nv;
        e.lane = Math.round(nv);
        e._yOff = e.y - this.laneYf(nv);
      }
      e.anim.update(dt, moveRatio);
      if (e.gp >= 1) { e.state = 'perch'; e.stateT = 0; e.anchor = null; }
      return;
    }

    // perch：落地停顿，顺手啃一口
    e.anim.update(dt, 0);
    if (e.biteCd <= 0) {
      e.biteCd = this._spiderBite(e, R) ? R.biteInterval : 0.25;
    }
    if (e.stateT >= R.perchTime) { e.state = 'seek'; e.stateT = 0; e.seekT = 0; }
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
        var lvlDone = (this.wave % this.waves.length) === 0;
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
      // 地形（挂载点⑤）：每帧按所在格重算速度 / 水洼标记（在慢速·定身之前）
      this._terrainApply(e);
      var sp = e.baseSpeed;
      if (e.slow) sp *= (1 - e.slow);
      if (e.root > 0) sp = 0;
      var moveRatio = e.baseSpeed > 0 ? sp / e.baseSpeed : 0;

      if (e.grappler) {
        // 触手蜘蛛：位移由打分选出的锚点牵引决定，不走匀速直线。
        // 减速/定身通过 moveRatio 传进去，牵引进度会跟着慢下来或冻结。
        this._updateSpider(e, dt, moveRatio);
      } else {
        // 速度基准 120px/s：0.35 格/秒 的小兵约 13s 走完全场，0.22 的天牛约 21s
        e.x = e.x - sp * 120 * dt * (this.cfg.w / 600);
        var blockLim = this._enemyBlockX(e);
        if (blockLim > -Infinity && e.x < blockLim) e.x = blockLim;
        this._terrainBlock(e);          // 地形阻挡（岩石/空洞）：贴格右侧钳制
        e.anim.update(dt, moveRatio);
      }

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
      var def = this.plantDef(p.kind);
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
      if (pr.arc) {
        // 参数化弹道：s 为飞行进度，z 抬高后落回地面，v 从发射道滑向目标道
        var s = Math.min(1, pr.t / pr.T);
        pr.z = pr.zFrom + (pr.zTo - pr.zFrom) * s + pr.hArc * 4 * s * (1 - s);
        pr.v = pr.vFrom + (pr.vTo - pr.vFrom) * s;
        pr.rot += pr.spin * dt;
      }
      // 屏幕 y 永远是 (v, z) 的投影结果，不再单独积分
      pr.y = this.laneYf(pr.v) - pr.z;

      // 障碍物拦截：平射 / 抛射各按 collide 判定（被挡 = 弹道截断，无伤害）
      if (this._projBlocked(pr, pr.arc ? 'arc' : 'flat')) {
        global.Bus.emit('battle:obstacleBlock', { x: pr.x, y: pr.y, type: pr.type });
        this.projectiles.splice(i, 1);
        continue;
      }
      if (pr.arc) {
        var hit = null;
        for (var j = 0; j < this.enemies.length; j++) {
          var ee = this.enemies[j];
          if (ee.dead) continue;
          // v 区间 + 按车道高换算的容差：普通敌人行为不变，
          // 跨道的蜘蛛停留在两道之间时，两侧邻道都还有机会打中它。
          if (Math.abs(ee.v - pr.v) > 0.5 + (ee.rv || 0)) continue;
          if (Math.abs(ee.x - pr.x) < 26 && Math.abs(ee.y - pr.y) < this.hitTol(ee)) { hit = ee; break; }
        }
        // 落地判定：z 回落到地面即结算，与车道无关。
        // 旧实现用 laneY(发射道)+4 当整条弹道的地面，跨道弹丸会在飞到目标之前
        // 就「落地」，落点预告圈画在另一条道上，玩家看到弹丸凭空炸掉。
        if (hit || pr.z <= 0) {
          this._impact(pr, hit);
          this.projectiles.splice(i, 1);
          continue;
        }
      } else {
        pr.rot += dt * 6;
        var h2 = null;
        for (var j2 = 0; j2 < this.enemies.length; j2++) {
          var e2 = this.enemies[j2];
          if (e2.dead) continue;
          if (Math.abs(e2.v - pr.v) > 0.5 + (e2.rv || 0)) continue;
          if (Math.abs(e2.x - pr.x) < 20 && Math.abs(e2.y - pr.y) < this.hitTol(e2)) { h2 = e2; break; }
        }
        if (h2) { this._impact(pr, h2); this.projectiles.splice(i, 1); continue; }
      }
      if (pr.x > this.spawnX + 60 || pr.t > 4) this.projectiles.splice(i, 1);
    }

    if (this.nodeHitT > 0) this.nodeHitT -= dt;
  };

  Battlefield.prototype._impact = function (pr, hit) {
    var src = pr.type === 'cabbage' ? 'cabbage' : (pr.extra ? 'pea:extra' : (pr.type === 'seed' ? 'seed' : 'pea'));
    if (hit) {
      this.damageEnemy(hit, pr.dmg, src, null);
      hit.knock = Math.max(hit.knock, pr.type === 'cabbage' ? 16 : (pr.extra ? 3 : 6));
      if (pr.burn) { hit.burnT = 3.0; hit.burnDps = Math.max(hit.burnDps || 0, pr.burn); }
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
