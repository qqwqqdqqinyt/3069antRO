/* ============================================================
 *  data.js —— 关卡数据模型 / 本地草稿 / 统计计算
 *
 *  数据契约（导出即此结构，游戏按同一结构读取）：
 *    {
 *      id, name, board{n,tier,stepMax,stepRegen},
 *      battle{lanes,cols,nodeX,nodeHp,gold},
 *      roulette[6], map{version,lanes,cols,tiles[][],effects},
 *      plants[{lane,col,kind}],
 *      obstacles[{id,lane,col,kind,applied,collide,shape{pts[]},note}],
 *      display{byType:{plants,enemies,obstacles}, byInst:{plants,obstacles}},
 *      waves[{t,intent,comp[[role,count]]}], notes
 *    }
 *
 *  obstacle.applied = false 的项不进导出包、不参与预览（实验用）。
 *  display 的 scale 为 null 表示沿用游戏本体值；byInst 按实例覆盖 byType。
 * ============================================================ */
(function (ED) {
  'use strict';
  var U = ED.util, G = ED.G;

  /* ---------------- 地形定义 ---------------- */
  var TILES = {
    grass: { name: '草地', color: '#3c6440', desc: '默认地形，无修正', slow: 0, walk: true, plantable: false },
    slot: { name: '种植槽', color: '#4c7a4e', desc: '可种植植物的格子', slow: 0, walk: true, plantable: true },
    mud: { name: '泥地', color: '#6b5334', desc: '敌人移动速度 ×0.70', slow: 0.30, walk: true, plantable: false },
    water: { name: '水洼', color: '#2f6b86', desc: '速度 ×0.85，冰系伤害 ×1.25', slow: 0.15, walk: true, plantable: false },
    rock: { name: '岩石', color: '#5a6478', desc: '阻挡：敌人被挡在此格外（预览行为）', slow: 0, walk: false, plantable: false },
    hole: { name: '空洞', color: '#161d2b', desc: '不可通行、不可种植', slow: 0, walk: false, plantable: false },
    spawn: { name: '出生点', color: '#a33b3b', desc: '敌人由此格进入战场（缺省则从右边缘进场）', slow: 0, walk: true, plantable: false }
  };

  /* ============================================================
   *  障碍物（独立于地块的一层「物件」）
   *
   *  与地块的差别：地块是「脚下踩的是什么」，障碍物是「这里立着什么」。
   *  每个障碍物自带 applied 开关，未勾选的不进导出包、不参与预览，
   *  方便摆一堆做实验但只让其中几块真正生效。
   * ============================================================ */
  var OBSTACLES = {
    rock: { name: '岩石', color: '#5a6478', edge: '#c8d4e8', desc: '标准阻挡物，挡地面与平射' },
    boulder: { name: '巨岩', color: '#4a5466', edge: '#b8c4da', desc: '大体积，默认什么都挡' },
    crystal: { name: '晶簇', color: '#6d7fa8', edge: '#cfe0ff', desc: '只挡地面，不挡弹道' },
    stump: { name: '树桩', color: '#6b5334', edge: '#d8b98a', desc: '矮桩：平射被挡，抛物线越过' },
    pillar: { name: '石柱', color: '#59617a', edge: '#d0d8ec', desc: '细高：挡弹道，不挡移动' }
  };
  var OBSTACLE_KEYS = Object.keys(OBSTACLES);

  /**
   * 碰撞层。两个维度各自独立勾选：
   *   enemy —— 谁走不过去（地面 / 飞行 / 触手蜘蛛）
   *   proj  —— 谁的弹道被截断（平射 / 抛射）
   * 于是「挡地面不挡飞行」「挡平射不挡抛射」这类组合都是直接勾出来的。
   */
  var COLLIDE_DEFAULT = {
    rock: { enemy: { ground: 1, air: 0, grappler: 0 }, proj: { flat: 1, arc: 0 } },
    boulder: { enemy: { ground: 1, air: 1, grappler: 0 }, proj: { flat: 1, arc: 1 } },
    crystal: { enemy: { ground: 1, air: 0, grappler: 0 }, proj: { flat: 0, arc: 0 } },
    stump: { enemy: { ground: 1, air: 0, grappler: 0 }, proj: { flat: 1, arc: 0 } },
    pillar: { enemy: { ground: 0, air: 0, grappler: 0 }, proj: { flat: 1, arc: 1 } }
  };

  var LAYER_META = {
    enemy: { name: '敌人移动', hint: '勾选被挡住的单位类别', items: [['ground', '地面单位'], ['air', '飞行单位'], ['grappler', '触手蜘蛛']] },
    proj: { name: '植物攻击', hint: '勾选被截断的弹道类型', items: [['flat', '平射（豌豆 / 石榴籽）'], ['arc', '抛射（卷心菜）']] }
  };

  /** 形状 = 格内归一化多边形。默认四个角铺满整格，等价于矩形；手动布点即拖顶点。 */
  var RECT_PTS = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];

  function shapeNorm(s) {
    var pts = null;
    if (s && Array.isArray(s.pts)) {
      pts = s.pts.filter(function (p) { return p && isFinite(p.x) && isFinite(p.y); })
        .map(function (p) { return { x: Math.max(0, Math.min(1, +p.x)), y: Math.max(0, Math.min(1, +p.y)) }; });
      if (pts.length < 3) pts = null;
    }
    return { pts: pts ? pts : RECT_PTS.map(function (p) { return { x: p.x, y: p.y }; }) };
  }
  /** 复制一份顶点，避免多处引用同一数组导致改一处动全身 */
  function shapeClone(s) {
    return { pts: shapeNorm(s).pts.map(function (p) { return { x: p.x, y: p.y }; }) };
  }

  /* ============================================================
   *  显示参数（缩放 / 偏移）
   *  两级：byType 按类型统一 → byInst 按实例覆盖，实例优先。
   *  scale 为 null 表示「沿用游戏本体的值」，这样未配置的项不会把数值写死。
   * ============================================================ */
  var DISP_GROUPS = ['plants', 'enemies', 'obstacles'];

  function dispBlank() { return { scale: null, ox: 0, oy: 0 }; }

  /** 空的 display 骨架（三个组都建好，避免各处补字段） */
  function blankDisplay() {
    var o = { byType: {}, byInst: {} };
    DISP_GROUPS.forEach(function (g) { o.byType[g] = {}; o.byInst[g] = {}; });
    return o;
  }

  /* ---------------- 数值覆盖层 ----------------
   * 关卡级的全局乘子：敌人/植物的某些数值乘以统一系数，星枢血量可绝对覆盖。
   * 全字段可选；编辑器这边始终补全成完整对象（缺失=乘子 1.0 / 星枢 100），
   * 这样导出给游戏的 JSON 永远结构完整、可直接被 Battlefield 消费。
   */
  function balanceBlank() {
    return { enemyHp: 1.0, enemyDmg: 1.0, enemySpd: 1.0, plantDmg: 1.0, plantAspd: 1.0, nodeHp: 100 };
  }
  function balanceNorm(b) {
    var d = balanceBlank();
    if (!b || typeof b !== 'object') return d;
    ['enemyHp', 'enemyDmg', 'enemySpd', 'plantDmg', 'plantAspd'].forEach(function (k) {
      if (isFinite(b[k]) && b[k] > 0) d[k] = +b[k];
    });
    if (isFinite(b.nodeHp) && +b.nodeHp > 0) d.nodeHp = +b.nodeHp;
    return d;
  }

  /* ---------------- 数值表覆盖层（tuning，整包级） ----------------
   * 与游戏侧统一契约：LEVEL_DATA.tuning = { enemies, plants, cards, economy }，
   * 四子对象全可选。编辑器只产出这一份全局 tuning，main.js 的 pkgTuning() 统一喂给
   * Meta / Cards / Director / Battlefield。缺省（全空）时游戏行为完全不变。
   *
   * 与经济常量键（挂载点⑦）：
   *   EP_BASE, CHARGE_MAX, CHARGE_K, ELEM_CAP, STEP_GIFT, STAR_POW,
   *   K_STAR, K_GOLD, K_SHARD, RES2, RES3, upgradeCostBase, upgradeCostPow
   *   plantCost: { sprout, peashooter, cabbagepult, burningpomegranate }
   */
  var ECON_KEYS = ['EP_BASE', 'CHARGE_MAX', 'CHARGE_K', 'ELEM_CAP', 'STEP_GIFT',
    'STAR_POW', 'K_STAR', 'K_GOLD', 'K_SHARD', 'RES2', 'RES3',
    'upgradeCostBase', 'upgradeCostPow'];
  var PLANT_COST_KEYS = ['sprout', 'peashooter', 'cabbagepult', 'burningpomegranate'];

  function tuningBlank() {
    return { enemies: {}, plants: {}, cards: {}, economy: {} };
  }
  function tuningNorm(t) {
    var d = tuningBlank();
    if (!t || typeof t !== 'object') return d;
    ['enemies', 'plants', 'cards'].forEach(function (g) {
      if (t[g] && typeof t[g] === 'object') {
        Object.keys(t[g]).forEach(function (k) {
          var ov = t[g][k];
          if (ov && typeof ov === 'object') d[g][k] = Object.assign({}, ov);
        });
      }
    });
    if (t.economy && typeof t.economy === 'object') {
      ECON_KEYS.forEach(function (k) {
        if (t.economy[k] !== undefined && t.economy[k] !== null) d.economy[k] = t.economy[k];
      });
      if (t.economy.plantCost && typeof t.economy.plantCost === 'object') {
        PLANT_COST_KEYS.forEach(function (k) {
          if (t.economy.plantCost[k] !== undefined && t.economy.plantCost[k] !== null)
            d.economy.plantCost[k] = t.economy.plantCost[k];
        });
      }
    }
    return d;
  }
  /** 清空某个子对象里「没有任何覆盖」的空壳，保持导出干净 */
  function pruneTuning(t) {
    ['enemies', 'plants', 'cards'].forEach(function (g) {
      Object.keys(t[g]).forEach(function (k) {
        if (!t[g][k] || Object.keys(t[g][k]).length === 0) delete t[g][k];
      });
      if (Object.keys(t[g]).length === 0) delete t[g];
    });
    if (t.economy && Object.keys(t.economy).length === 0) delete t.economy;
    return t;
  }

  function dispNormSet(src) {
    var out = {};
    DISP_GROUPS.forEach(function (g) {
      out[g] = {};
      var s = (src && src[g]) || {};
      Object.keys(s).forEach(function (k) {
        var v = s[k] || {};
        out[g][k] = {
          scale: (isFinite(v.scale) && v.scale > 0) ? +v.scale : null,
          ox: +v.ox || 0,
          oy: +v.oy || 0
        };
      });
    });
    return out;
  }

  var D = {
    TILES: TILES,
    TILE_KEYS: ['grass', 'slot', 'mud', 'water', 'rock', 'hole', 'spawn'],
    OBSTACLES: OBSTACLES,
    OBSTACLE_KEYS: OBSTACLE_KEYS,
    COLLIDE_DEFAULT: COLLIDE_DEFAULT,
    LAYER_META: LAYER_META,
    DISP_GROUPS: DISP_GROUPS,

    KEY: 'xxline.editor.draft.v1',
    tuning: null,            // 整包级数值表覆盖层（挂载点⑥/⑦），结构见 tuningBlank()
    levels: [],
    active: 0,
    listeners: []
  };

  /* ---------------- 变更通知 ---------------- */
  D.onChange = function (fn) { D.listeners.push(fn); };
  D.emit = function (what) {
    for (var i = 0; i < D.listeners.length; i++) {
      try { D.listeners[i](what); } catch (e) { console.error(e); }
    }
    D.saveSoon();
  };

  var saveTimer = 0;
  D.saveSoon = function () {
    var el = document.getElementById('saveState');
    if (el) { el.textContent = '编辑中…'; el.className = 'pill warn'; }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      D.save();
      if (el) { el.textContent = '草稿已同步'; el.className = 'pill ghost'; }
    }, 500);
  };

  /* ---------------- 默认地形 ---------------- */
  function blankTiles(lanes, cols, fill) {
    var t = [];
    for (var l = 0; l < lanes; l++) {
      var row = [];
      for (var c = 0; c < cols; c++) row.push(fill || 'grass');
      t.push(row);
    }
    return t;
  }

  /** 与游戏当前行为一致：4 列全为种植槽，敌人从右边缘进场 */
  function defaultTiles(lanes, cols) {
    var t = blankTiles(lanes, cols, 'slot');
    return t;
  }

  /* ---------------- 默认关卡（从游戏本体 WAVES 生成） ---------------- */
  D.defaultLevel = function (idx) {
    idx = idx || 0;
    var waves = (G.WAVES || []).map(function (w) {
      return {
        t: w.t,
        intent: w.intent || '',
        comp: w.comp.map(function (c) { return [c[0], c[1]]; })
      };
    });
    if (!waves.length) waves = [{ t: 30, intent: '空关卡', comp: [['grunt', 4]] }];

    var lanes = 3, cols = 4;
    var plants = [];
    for (var l = 0; l < lanes; l++) plants.push({ lane: l, col: 0, kind: 'sprout' });

    return {
      id: 'L' + (idx + 1),
      name: idx === 0 ? '第一关 · 苗圃' : ('第 ' + (idx + 1) + ' 关'),
      board: { n: 5, tier: Math.min(5, idx + 1), stepMax: 5, stepRegen: 1.5 },
      battle: { lanes: lanes, cols: cols, nodeX: 58, nodeHp: 100, gold: 60 },
      roulette: G.DEFAULT_ROULETTE.slice(),
      map: {
        version: 1,
        lanes: lanes,
        cols: cols,
        tiles: defaultTiles(lanes, cols),
        effects: { mudSlow: 0.30, waterSlow: 0.15, waterIceTaken: 1.25 }
      },
      plants: plants,
      obstacles: [],
      display: blankDisplay(),
      waves: waves,
      balance: balanceBlank(),
      notes: idx === 0 ? '源自游戏本体 Battlefield.WAVES（关 1 基准）' : ''
    };
  };

  /* ---------------- 归一化（补字段 / 修非法值） ---------------- */
  D.normalize = function (L) {
    var d = D.defaultLevel(0);
    L = L || {};
    L.id = L.id || d.id;
    L.name = L.name || d.name;
    L.board = Object.assign({}, d.board, L.board || {});
    L.battle = Object.assign({}, d.battle, L.battle || {});
    L.roulette = (L.roulette && L.roulette.length === 6) ? L.roulette.slice() : d.roulette.slice();
    L.map = Object.assign({}, d.map, L.map || {});
    L.map.lanes = L.battle.lanes;
    L.map.cols = L.battle.cols;
    var tiles = L.map.tiles;
    if (!tiles || !tiles.length) tiles = defaultTiles(L.map.lanes, L.map.cols);
    // 尺寸校正（增删行列时保留已画内容）
    var fixed = [];
    for (var l = 0; l < L.map.lanes; l++) {
      var row = tiles[l] || [];
      var nr = [];
      for (var c = 0; c < L.map.cols; c++) {
        var v = row[c];
        nr.push(TILES[v] ? v : 'grass');
      }
      fixed.push(nr);
    }
    L.map.tiles = fixed;
    // 障碍物：尺寸校正 + 形状/碰撞层归一化
    var seenCell = {};
    // 两趟：先过滤出合法项并写回，再生成 id —— 否则 map 里读到的还是旧数组，会撞 id
    L.obstacles = (L.obstacles || []).filter(function (o) {
      if (!o || !(o.lane >= 0 && o.lane < L.map.lanes && o.col >= 0 && o.col < L.map.cols)) return false;
      var ck = o.lane + ':' + o.col;
      if (seenCell[ck]) return false;          // 一格最多一个
      seenCell[ck] = 1;
      return true;
    });
    L.obstacles = L.obstacles.map(function (o) {
      o.id = o.id || D.obsNewId(L);
      o.kind = OBSTACLES[o.kind] ? o.kind : 'rock';
      o.applied = o.applied !== false;
      o.shape = shapeNorm(o.shape);
      o.note = o.note || '';
      if (o.collide) {
        var c = {};
        Object.keys(LAYER_META).forEach(function (layer) {
          if (!o.collide[layer]) return;
          c[layer] = {};
          LAYER_META[layer].items.forEach(function (it) {
            if (it[0] in o.collide[layer]) c[layer][it[0]] = o.collide[layer][it[0]] ? 1 : 0;
          });
        });
        o.collide = Object.keys(c).length ? c : null;
      } else o.collide = null;
      return o;
    });

    // 显示参数：补结构、剔除非法值
    var disp = L.display || {};
    L.display = {
      byType: dispNormSet(disp.byType),
      byInst: dispNormSet(disp.byInst)
    };

    // 障碍物占位后，同格植物作废
    L.plants = (L.plants || []).filter(function (p) {
      return p && p.lane >= 0 && p.lane < L.map.lanes && p.col >= 0 && p.col < L.map.cols
        && !seenCell[p.lane + ':' + p.col];
    });
    L.waves = (L.waves || []).map(function (w) {
      return {
        t: Math.max(4, +w.t || 30),
        intent: w.intent || '',
        comp: (w.comp || []).filter(function (c) { return c && G.ROLES[c[0]]; })
          .map(function (c) { return [c[0], Math.max(1, Math.round(+c[1] || 1))]; })
      };
    });
    L.notes = L.notes || '';

    // 数值覆盖层：全字段可选，缺失回落到乘子 1.0 / 星枢 100
    L.balance = balanceNorm(L.balance);

    return L;
  };

  /* ---------------- 存取 ---------------- */
  D.load = function () {
    var raw = null;
    try { raw = localStorage.getItem(D.KEY); } catch (e) { }
    if (raw) {
      try {
        var pkg = JSON.parse(raw);
        if (pkg && pkg.levels && pkg.levels.length) {
          D.levels = pkg.levels.map(D.normalize);
          D.active = Math.min(pkg.active || 0, D.levels.length - 1);
          D.tuning = tuningNorm(pkg.tuning);
          return true;
        }
      } catch (e) { console.warn('[draft] 解析失败，回退默认', e); }
    }
    D.levels = [D.normalize(D.defaultLevel(0))];
    D.active = 0;
    D.tuning = tuningBlank();
    return false;
  };

  D.save = function () {
    try {
      localStorage.setItem(D.KEY, JSON.stringify({ v: 1, active: D.active, levels: D.levels, tuning: D.tuningEnsure() }));
      return true;
    } catch (e) { return false; }
  };

  D.resetToDefault = function () {
    D.levels = [D.normalize(D.defaultLevel(0))];
    D.active = 0;
    D.save();
    D.emit('reset');
  };

  D.cur = function () { return D.levels[D.active]; };

  /* ============================================================
   *  数值表覆盖层（整包级 tuning）读写
   *  覆盖语义：只存「与游戏本体不同」的字段，全空则等价于不覆盖。
   * ============================================================ */
  D.tuningEnsure = function () {
    if (!D.tuning || typeof D.tuning !== 'object') D.tuning = tuningBlank();
    ['enemies', 'plants', 'cards', 'economy'].forEach(function (g) {
      if (!D.tuning[g] || typeof D.tuning[g] !== 'object') D.tuning[g] = (g === 'economy' ? {} : {});
    });
    if (!D.tuning.economy.plantCost) D.tuning.economy.plantCost = {};
    return D.tuning;
  };

  /** 取某条覆盖字段（敌人/植物/卡牌）。缺省返回 undefined（表示用游戏本体值） */
  D.getTuning = function (group, key, field) {
    var t = D.tuningEnsure();
    return (t[group] && t[group][key]) ? t[group][key][field] : undefined;
  };

  /** 写一条覆盖字段。value 为 null/''/undefined 表示清除该字段（回落本体值） */
  D.setTuning = function (group, key, field, value) {
    var t = D.tuningEnsure();
    if (!t[group][key]) t[group][key] = {};
    if (value === null || value === undefined || value === '') delete t[group][key][field];
    else t[group][key][field] = value;
    if (Object.keys(t[group][key]).length === 0) delete t[group][key];
    D.emit('tuning');
  };

  /** 整条覆盖是否存在（UI 显示「已覆盖」标记用） */
  D.hasTuning = function (group, key) {
    var t = D.tuningEnsure();
    return !!(t[group] && t[group][key] && Object.keys(t[group][key]).length);
  };

  /** 经济常量（挂载点⑦）：直接读写 tuning.economy 上的标量键 */
  D.econGet = function (field) { return D.tuningEnsure().economy[field]; };
  D.econSet = function (field, value) {
    var eco = D.tuningEnsure().economy;
    if (value === null || value === undefined || value === '') delete eco[field];
    else eco[field] = value;
    D.emit('tuning');
  };

  /** 植物造价覆盖（挂载点⑦） */
  D.plantCostGet = function (kind) { return D.tuningEnsure().economy.plantCost[kind]; };
  D.plantCostSet = function (kind, value) {
    var pc = D.tuningEnsure().economy.plantCost;
    if (value === null || value === undefined || value === '') delete pc[kind];
    else pc[kind] = value;
    D.emit('tuning');
  };

  /** 当前 tuning 是否「全空」（用于 UI 提示「未做任何数值覆盖」） */
  D.tuningEmpty = function () {
    var t = D.tuning || {};
    if (t.enemies && Object.keys(t.enemies).length) return false;
    if (t.plants && Object.keys(t.plants).length) return false;
    if (t.cards && Object.keys(t.cards).length) return false;
    if (t.economy) {
      if (Object.keys(t.economy).length > 1) return false;
      if (Object.keys(t.economy).length === 1 && !t.economy.plantCost) return false;
      if (t.economy.plantCost && Object.keys(t.economy.plantCost).length) return false;
    }
    return true;
  };

  /* ============================================================
   *  显示参数读写
   * ============================================================ */

  /** 取生效值：类型默认打底，实例覆盖优先（逐字段合并，只改 ox 不会丢掉 scale） */
  D.dispGet = function (group, key, instKey, L) {
    L = L || D.cur();
    var d = (L && L.display) || {};
    var t = (d.byType && d.byType[group]) ? d.byType[group][key] : null;
    var i = (instKey && d.byInst && d.byInst[group]) ? d.byInst[group][instKey] : null;
    return {
      scale: (i && i.scale != null) ? i.scale : ((t && t.scale != null) ? t.scale : null),
      ox: (i && i.ox) || (t && t.ox) || 0,
      oy: (i && i.oy) || (t && t.oy) || 0
    };
  };

  /**
   * 定位一条显示参数的槽位。
   * 注意键的选取：byType 用类型 key，byInst 用实例 key —— 两者不是同一个东西。
   */
  function dispSlot(L, group, key, instKey, create) {
    if (!L.display) L.display = blankDisplay();
    var host = instKey ? L.display.byInst : L.display.byType;
    if (!host[group]) host[group] = {};
    var k = instKey || key;
    if (create && !host[group][k]) host[group][k] = dispBlank();
    return { bucket: host[group], k: k };
  }

  /** 写显示参数。instKey 省略时写类型默认 */
  D.dispSet = function (group, key, instKey, patch) {
    var L = D.cur();
    var s = dispSlot(L, group, key, instKey, true);
    Object.assign(s.bucket[s.k], patch);
    D.emit('display');
  };

  /** 清掉一条显示参数（类型默认 / 实例覆盖） */
  D.dispClear = function (group, key, instKey) {
    var L = D.cur();
    if (!L.display) return;
    var s = dispSlot(L, group, key, instKey, false);
    if (s.bucket[s.k]) delete s.bucket[s.k];
    D.emit('display');
  };

  /** 该条是否「非空」（用于 UI 显示「已覆盖」标记） */
  D.dispDirty = function (group, key, instKey) {
    var L = D.cur();
    if (!L.display) return false;
    var s = dispSlot(L, group, key, instKey, false);
    var v = s.bucket[s.k];
    return !!(v && (v.scale != null || v.ox || v.oy));
  };

  /* ============================================================
   *  障碍物读写
   * ============================================================ */

  /** 该格的障碍物（一格最多一个） */
  D.obsAt = function (lane, col, L) {
    L = L || D.cur();
    var list = L.obstacles || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].lane === lane && list[i].col === col) return list[i];
    }
    return null;
  };

  /** 已勾选「应用于游戏」的障碍物 */
  D.obsApplied = function (L) {
    return ((L || D.cur()).obstacles || []).filter(function (o) { return o.applied !== false; });
  };

  /**
   * 该障碍物是否阻挡某一层。
   * 实例 collide 里没写的子项，回落到类型默认值 —— 这样改类型默认会联动所有未单独覆盖的实例。
   */
  D.obsBlocks = function (o, layer, sub) {
    if (!o || o.applied === false) return false;
    var def = (COLLIDE_DEFAULT[o.kind] || {})[layer] || {};
    var own = (o.collide || {})[layer] || {};
    var v = (sub in own) ? own[sub] : def[sub];
    return !!v;
  };

  /** 取某层的三个子项开关（已合并实例覆盖），用于渲染勾选框 */
  D.obsLayer = function (o, layer) {
    var def = (COLLIDE_DEFAULT[o.kind] || {})[layer] || {};
    var own = (o.collide || {})[layer] || {};
    var out = {};
    LAYER_META[layer].items.forEach(function (it) {
      out[it[0]] = (it[0] in own) ? !!own[it[0]] : !!def[it[0]];
    });
    return out;
  };

  /** 写一个子项开关。value 传 null 表示「跟随类型默认」 */
  D.obsSetBlock = function (o, layer, sub, value) {
    if (!o.collide) o.collide = {};
    if (!o.collide[layer]) o.collide[layer] = {};
    if (value === null) delete o.collide[layer][sub];
    else o.collide[layer][sub] = value ? 1 : 0;
    D.emit('obstacles');
  };

  /** 实例是否偏离了类型默认（UI 用来提示「已自定义」） */
  D.obsCustom = function (o) {
    return !!(o.collide && Object.keys(o.collide).length);
  };

  /** 新建障碍物。同格已有则替换 */
  D.obsAdd = function (lane, col, kind) {
    var L = D.cur();
    if (!L.obstacles) L.obstacles = [];
    var old = D.obsAt(lane, col, L);
    if (old) { old.kind = kind; D.emit('obstacles'); return old; }
    var o = {
      id: D.obsNewId(L),
      lane: lane, col: col,
      kind: OBSTACLES[kind] ? kind : 'rock',
      applied: true,
      collide: null,
      shape: shapeClone(null),
      note: ''
    };
    L.obstacles.push(o);
    // 障碍物占了格子，植物不能同格
    L.plants = L.plants.filter(function (p) { return !(p.lane === lane && p.col === col); });
    D.emit('obstacles');
    return o;
  };

  D.obsNewId = function (L) {
    var used = {};
    (L.obstacles || []).forEach(function (o) { used[o.id] = 1; });
    for (var i = 1; i < 9999; i++) { var s = 'O' + i; if (!used[s]) return s; }
    return 'O' + Math.random().toString(36).slice(2, 7);
  };

  D.obsRemove = function (o) {
    var L = D.cur();
    var i = (L.obstacles || []).indexOf(o);
    if (i >= 0) { L.obstacles.splice(i, 1); D.emit('obstacles'); }
  };

  /** 障碍物的形状顶点（格内归一化） */
  D.obsShape = function (o) { return shapeClone(o && o.shape); };
  D.obsSetPts = function (o, pts) { o.shape = shapeNorm({ pts: pts }); D.emit('obstacles'); };
  D.obsResetShape = function (o) { o.shape = shapeClone(null); D.emit('obstacles'); };

  /* ---------------- 关卡集合操作 ---------------- */
  D.addLevel = function (copyFrom) {
    var L = copyFrom ? U.clone(D.normalize(copyFrom)) : D.defaultLevel(D.levels.length);
    if (copyFrom) {
      L.id = 'L' + (D.levels.length + 1);
      L.name = copyFrom.name + ' 副本';
    }
    D.levels.push(D.normalize(L));
    D.active = D.levels.length - 1;
    D.emit('levels');
    return L;
  };
  D.removeLevel = function (i) {
    if (D.levels.length <= 1) { ED.toast('至少保留一个关卡', 'bad'); return; }
    D.levels.splice(i, 1);
    if (D.active >= D.levels.length) D.active = D.levels.length - 1;
    D.emit('levels');
  };
  D.moveLevel = function (i, dir) {
    var j = i + dir;
    if (j < 0 || j >= D.levels.length) return;
    var t = D.levels[i]; D.levels[i] = D.levels[j]; D.levels[j] = t;
    D.active = j;
    D.emit('levels');
  };

  /* ---------------- 波次操作 ---------------- */
  D.waveAdd = function () {
    var L = D.cur();
    L.waves.push({ t: 40, intent: '', comp: [['grunt', 6]] });
    D.emit('waves');
  };
  D.waveDup = function (i) {
    var L = D.cur();
    L.waves.splice(i + 1, 0, U.clone(L.waves[i]));
    D.emit('waves');
  };
  D.waveDel = function (i) {
    var L = D.cur();
    if (L.waves.length <= 1) { ED.toast('至少保留一波', 'bad'); return; }
    L.waves.splice(i, 1);
    D.emit('waves');
  };
  D.waveMove = function (i, dir) {
    var L = D.cur(), j = i + dir;
    if (j < 0 || j >= L.waves.length) return;
    var t = L.waves[i]; L.waves[i] = L.waves[j]; L.waves[j] = t;
    D.emit('waves');
  };

  /* ---------------- 数值统计 ---------------- */
  var Stats = {};

  /** 关卡缩放（与 Battlefield.levelScale 同式） */
  Stats.levelScale = function (levelNo) {
    var n = Math.max(1, levelNo | 0);
    return {
      hp: Math.pow(1.55, n - 1) * (1 + 0.05 * (n - 1)),
      dmg: Math.pow(1.25, n - 1),
      spd: 1 + 0.04 * (n - 1),
      count: 1 + 0.12 * (n - 1)
    };
  };

  /** 单株植物 DPS（理论值） */
  Stats.plantDps = function (kind) {
    var p = G.PLANTS[kind];
    if (!p || !p.interval) return 0;
    return p.dmg / p.interval;
  };

  /** 布防可用 DPS（植物合计） */
  Stats.defenseDps = function (L) {
    var s = 0;
    (L.plants || []).forEach(function (p) { s += Stats.plantDps(p.kind); });
    return s;
  };

  /** 附魔期望 DPS：EP_BASE × ELEM_CAP × 1.5 次/波 ÷ 波时长 */
  Stats.enchantDps = function (waveT) {
    var K = G.K;
    return K.EP_BASE * K.ELEM_CAP * 1.5 / Math.max(1, waveT || 30);
  };

  /** 单波统计 */
  Stats.wave = function (L, w, levelNo) {
    var sc = Stats.levelScale(levelNo || 1);
    var hp = 0, count = 0, gold = 0, dmgOnLeak = 0, byRole = {};
    (w.comp || []).forEach(function (c) {
      var R = G.ROLES[c[0]];
      if (!R) return;
      var n = Math.max(1, Math.round(c[1] * (c[0] === 'boss' || c[0] === 'elite' ? 1 : sc.count)));
      count += n;
      hp += n * R.hp * sc.hp;
      gold += n * R.gold;
      dmgOnLeak += n * R.dmg * sc.dmg;
      byRole[c[0]] = (byRole[c[0]] || 0) + n;
    });
    var t = Math.max(1, w.t || 30);
    var needDps = hp / t;                    // 需在波时长内清完
    var ehp = 0;                             // 计入护甲的有效 HP
    (w.comp || []).forEach(function (c) {
      var R = G.ROLES[c[0]];
      if (!R) return;
      var n = Math.max(1, Math.round(c[1] * (c[0] === 'boss' || c[0] === 'elite' ? 1 : sc.count)));
      ehp += n * R.hp * sc.hp / Math.max(0.05, 1 - (R.armor || 0));
    });
    return {
      count: count, hp: hp, ehp: ehp, gold: gold, leakDmg: dmgOnLeak,
      t: t, needDps: needDps, needDpsArmor: ehp / t,
      density: count / t, byRole: byRole
    };
  };

  /** 关卡汇总 */
  Stats.level = function (L, levelNo) {
    var rows = L.waves.map(function (w, i) { return Stats.wave(L, w, levelNo); });
    var total = { t: 0, count: 0, hp: 0, ehp: 0, gold: 0, peak: 0, peakIdx: 0 };
    rows.forEach(function (r, i) {
      total.t += r.t; total.count += r.count; total.hp += r.hp;
      total.ehp += r.ehp; total.gold += r.gold;
      if (r.needDpsArmor > total.peak) { total.peak = r.needDpsArmor; total.peakIdx = i; }
    });
    total.avgDps = total.ehp / Math.max(1, total.t);
    var avail = Stats.defenseDps(L);
    rows.forEach(function (r) {
      r.availDps = avail + Stats.enchantDps(r.t);
      r.ratio = r.availDps > 0 ? r.needDpsArmor / r.availDps : 0;   // >1 表示扛不住
    });
    total.availDps = avail;
    return { rows: rows, total: total };
  };

  /** 敌人穿越全场所需时间（秒），基于战场宽 596 / nodeX 58 */
  Stats.crossTime = function (roleKey, nodeX) {
    var R = G.ROLES[roleKey];
    if (!R) return 0;
    var dist = 596 - (nodeX === undefined ? 58 : nodeX) + 26;
    var pxs = R.speed * 120 * (596 / 600);
    return pxs > 0 ? dist / pxs : Infinity;
  };

  D.Stats = Stats;

  /* ---------------- 导出序列化 ---------------- */
  /* ============================================================
   *  关卡数据契约（统一格式，v2）
   *
   *  任何独立网页编辑器只要产出符合此结构的 JSON，
   *  就能被本编辑器与游戏本体读取 —— 这是格式一致性的唯一真相来源。
   *   顶层包：  { version, generator, generatedAt, source?, tuning?, levels: [Level] }
   *   数值表覆盖层（挂载点⑥/⑦）是「整包级」配置：tuning = { enemies, plants, cards, economy }，
   *   四子对象全可选，全空等价于不覆盖。main.js 的 pkgTuning() 统一喂给 Meta/Cards/Director/Battlefield。
   *   单关 Level 字段见 FORMAT.level；枚举与引用表见 FORMAT.tables。
   *  normalize() 始终按「缺失即补默认」容忍旧版本/残缺数据，
   *  migrate() 负责把导入包显式对齐到当前版本。
   * ============================================================ */
  var FORMAT = {
    version: 2,
    level: {
      id: 'string，关卡标识（如 L1）',
      name: 'string，显示名',
      board: '{ n, tier, stepMax, stepRegen }',
      battle: '{ lanes, cols, nodeX, nodeHp, gold }',
      roulette: 'string[6]，元素轮盘，对应 Director.roulette',
      map: '{ version, lanes, cols, tiles[lane][col], effects }',
      plants: '[{ lane, col, kind }]，只在种植槽上的才生效',
      obstacles: '[{ id, lane, col, kind, applied, collide?, shape, note? }]',
      display: '{ byType, byInst }，显示缩放/偏移，scale=null 表示沿用游戏本体；byInst 键：植物为 "L{lane}C{col}"（如 "L0C0"）',
      waves: '[{ t, intent, comp: [[role, count]] }]',
      balance: '可选。关卡数值覆盖层（挂载点④）：{ enemyHp, enemyDmg, enemySpd, plantDmg, plantAspd, nodeHp }，全字段可选，缺失=用游戏本体默认值（乘子 1.0 / 星枢 100）',
      notes: 'string? 备注'
    },
    enums: {
      tile: D.TILE_KEYS,
      obstacle: D.OBSTACLE_KEYS,
      collideLayer: ['enemy.ground', 'enemy.air', 'enemy.grappler', 'proj.flat', 'proj.arc']
    },
    tables: {
      TILES: D.TILES,
      OBSTACLES: D.OBSTACLES,
      COLLIDE_DEFAULT: D.COLLIDE_DEFAULT
    },
    obstacle: {
      id: 'string，关卡内唯一',
      lane: 'int ≥0',
      col: 'int ≥0',
      kind: '枚举 obstacle',
      applied: 'bool，false 不进游戏、不参与预览',
      collide: '{ enemy:{ground,air,grappler}, proj:{flat,arc} }，省略=用类型默认',
      shape: '{ pts:[{x,y},...] }，格内归一化多边形；默认满格矩形',
      note: 'string?'
    }
  };
  D.FORMAT = FORMAT;

  /** 把任意导入包对齐到当前格式版本（幂等，不改已存在的字段语义） */
  D.migrate = function (pkg) {
    if (!pkg || !pkg.levels) return pkg;
    pkg.version = FORMAT.version;
    pkg.levels = pkg.levels.map(function (L) {
      L = L || {};
      if (!L.obstacles) L.obstacles = [];
      if (!L.display) L.display = blankDisplay();
      return L;
    });
    return pkg;
  };

  D.serialize = function () {
    return {
      version: FORMAT.version,
      generator: '星序防线编辑器',
      generatedAt: new Date().toISOString(),
      source: ED.G.linked ? '3069antone/src (live)' : 'snapshot',
      tuning: pruneTuning(U.clone(D.tuningEnsure())),
      levels: U.clone(D.levels)
    };
  };

  D.importJSON = function (text) {
    var pkg = JSON.parse(text);
    pkg = D.migrate(pkg);
    var lv = null;
    if (pkg && Array.isArray(pkg.levels)) lv = pkg.levels;
    else if (Array.isArray(pkg)) lv = pkg;
    else if (pkg && pkg.battle) lv = [pkg];
    if (!lv || !lv.length) throw new Error('文件里没有找到关卡数据');
    D.levels = lv.map(D.normalize);
    D.active = 0;
    D.tuning = tuningNorm(pkg.tuning);
    D.save();
    D.emit('import');
    return D.levels.length;
  };

  ED.Data = D;
})(window.ED);
