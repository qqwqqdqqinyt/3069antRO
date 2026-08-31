/* ============================================================
 *  data.js —— 关卡数据模型 / 本地草稿 / 统计计算
 *
 *  数据契约（导出即此结构，游戏按同一结构读取）：
 *    {
 *      id, name, board{n,tier,stepMax,stepRegen},
 *      battle{lanes,cols,nodeX,nodeHp,gold},
 *      roulette[6], map{version,lanes,cols,tiles[][],effects},
 *      plants[{lane,col,kind}], waves[{t,intent,comp[[role,count]]}], notes
 *    }
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

  var D = {
    TILES: TILES,
    TILE_KEYS: ['grass', 'slot', 'mud', 'water', 'rock', 'hole', 'spawn'],

    KEY: 'xxline.editor.draft.v1',
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
      waves: waves,
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
    L.plants = (L.plants || []).filter(function (p) {
      return p && p.lane >= 0 && p.lane < L.map.lanes && p.col >= 0 && p.col < L.map.cols;
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
          return true;
        }
      } catch (e) { console.warn('[draft] 解析失败，回退默认', e); }
    }
    D.levels = [D.defaultLevel(0)];
    D.active = 0;
    return false;
  };

  D.save = function () {
    try {
      localStorage.setItem(D.KEY, JSON.stringify({ v: 1, active: D.active, levels: D.levels }));
      return true;
    } catch (e) { return false; }
  };

  D.resetToDefault = function () {
    D.levels = [D.defaultLevel(0)];
    D.active = 0;
    D.save();
    D.emit('reset');
  };

  D.cur = function () { return D.levels[D.active]; };

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
  D.serialize = function () {
    return {
      version: 1,
      generator: '星序防线编辑器',
      generatedAt: new Date().toISOString(),
      source: ED.G.linked ? '3069antone/src (live)' : 'snapshot',
      levels: U.clone(D.levels)
    };
  };

  D.importJSON = function (text) {
    var pkg = JSON.parse(text);
    var lv = null;
    if (pkg && Array.isArray(pkg.levels)) lv = pkg.levels;
    else if (Array.isArray(pkg)) lv = pkg;
    else if (pkg && pkg.battle) lv = [pkg];
    if (!lv || !lv.length) throw new Error('文件里没有找到关卡数据');
    D.levels = lv.map(D.normalize);
    D.active = 0;
    D.save();
    D.emit('import');
    return D.levels.length;
  };

  ED.Data = D;
})(window.ED);
