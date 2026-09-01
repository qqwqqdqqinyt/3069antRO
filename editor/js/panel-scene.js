/* ============================================================
 *  panel-scene.js —— ② 场景预览 / 模拟
 *
 *  用游戏本体的 Battlefield + BattleView 真实渲染，叠加编辑器自有的
 *  地形层（来自地图编辑器）与 HUD。可选择联动 2048 棋盘 + Director，
 *  把「合成 → 充能 → 附魔 → 伤害池 → 战场」整条链路跑起来。
 * ============================================================ */
(function (ED) {
  'use strict';
  var U = ED.util, G = ED.G, D = ED.Data, S = D.Stats;

  var W = 1040, H = 640;
  var REGION = { x: 14, y: 52, w: 596, h: 576 };
  var BOARD_R = { x: 622, y: 52, w: 404, h: 576 };

  var P = {
    name: 'scene',
    root: null, mounted: false,
    canvas: null, ctx: null,
    running: true, speed: 1,
    showTerrain: true, showGrid: true, showBoard: true,
    autoWave: true, godMode: false, editPlants: false, autoPlay: false,
    brush: 'peashooter',
    hover: null,
    dpsLog: [], dps: 0,
    waves: null, waveIdx: -1, waveRunning: false, waveGap: 0,
    lastCast: null,
    bf: null, bv: null, board: null, boardView: null, dir: null, fx: null
  };

  /* ---------------- 地图数据访问 ---------------- */
  function tileAt(lane, col) {
    var L = D.cur();
    if (!L || !L.map || !L.map.tiles[lane]) return 'grass';
    var v = L.map.tiles[lane][col];
    return D.TILES[v] ? v : 'grass';
  }
  function colOf(x) {
    if (!P.bf) return 0;
    var bf = P.bf;
    var c = Math.floor((x - (bf.cfg.x + bf.cfg.nodeX + 40)) / bf.cellW);
    return Math.max(0, Math.min(bf.cfg.cols - 1, c));
  }
  function laneOf(y) {
    if (!P.bf) return 0;
    var bf = P.bf, best = 0, bd = 1e9;
    for (var i = 0; i < bf.cfg.lanes; i++) {
      var d = Math.abs(y - bf.laneY(i));
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  function cellLeft(col) { return P.bf.slotX(col) - P.bf.cellW / 2; }
  function cellRight(col) { return P.bf.slotX(col) + P.bf.cellW / 2; }
  function spawnCellsForLane(lane) {
    var L = D.cur(), out = [];
    if (!L) return out;
    for (var c = 0; c < L.map.cols; c++) if (tileAt(lane, c) === 'spawn') out.push(c);
    return out;
  }
  function spawnLanes() {
    var L = D.cur(), out = [];
    if (!L) return out;
    for (var l = 0; l < L.map.lanes; l++) if (spawnCellsForLane(l).length) out.push(l);
    return out;
  }

  /* ---------------- 构建 / 重建 ---------------- */
  function dispose() {
    if (!G.Bus) return;
    if (P.bf) G.Bus.offOwner(P.bf);
    if (P.board) G.Bus.offOwner(P.board);
    if (P.dir) G.Bus.offOwner(P.dir);
  }

  function build() {
    if (!G.Battlefield || !G.BattleView) return false;
    dispose();
    var L = D.normalize(D.cur());
    var seed = (Math.random() * 1e9) | 0;

    P.bf = new G.Battlefield({
      x: REGION.x, y: REGION.y, w: REGION.w, h: REGION.h,
      lanes: L.battle.lanes, cols: L.battle.cols, nodeX: L.battle.nodeX, seed: seed,
      obstacles: L.obstacles, display: L.display, map: L.map
    });
    P.bf.level = Math.max(1, D.active + 1);
    P.bf.nodeMax = L.battle.nodeHp;
    P.bf.nodeHp = L.battle.nodeHp;
    P.bv = new G.BattleView(P.bf, REGION);

    if (G.Board2048 && G.BoardView) {
      P.board = new G.Board2048({ n: L.board.n, tier: L.board.tier, seed: (Math.random() * 1e9) | 0 });
      P.boardView = new G.BoardView(P.board, BOARD_R);
    }
    if (G.Director && P.board) {
      P.dir = new G.Director({ board: P.board, battle: P.bf });
      P.dir.roulette = L.roulette.slice();
      if (P.boardView) P.boardView.director = P.dir;
    }
    if (!P.fx && G.FX) P.fx = new G.FX();
    if (P.fx) P.fx.battle = P.bf;

    // 布防：按关卡数据放置植物（地形必须是种植槽）
    (L.plants || []).forEach(function (p) {
      if (tileAt(p.lane, p.col) !== 'slot') return;
      var pl = P.bf.placePlant({ lane: p.lane, col: p.col }, p.kind);
      if (pl) pl.born = 1;
    });

    P.waveIdx = -1; P.waveRunning = false; P.waveGap = 0.8;
    P.queue = []; P.spawnTimer = 0; P.spawnInterval = 1;
    P.dpsLog.length = 0;
    return true;
  }

  /* ---------------- 波次调度（复刻 Battlefield.startNextWave，但用编辑器数据） ---------------- */
  function startWave(i) {
    var L = D.cur();
    if (!L.waves[i]) return;
    var sc = S.levelScale(P.bf.level);
    var q = [];
    L.waves[i].comp.forEach(function (c) {
      var role = c[0], cnt = c[1];
      var n = Math.max(1, Math.round(cnt * (role === 'boss' || role === 'elite' ? 1 : sc.count)));
      for (var k = 0; k < n; k++) q.push(role);
    });
    q.sort(function (a, b) {
      var pa = (a === 'boss' || a === 'elite') ? 1 : 0;
      var pb = (b === 'boss' || b === 'elite') ? 1 : 0;
      return pa - pb;
    });
    P.queue = q;
    P.spawnInterval = L.waves[i].t / Math.max(1, q.length) * 0.82;
    P.spawnTimer = 0.35;
    P.waveIdx = i;
    P.waveRunning = true;
    if (G.Bus) G.Bus.emit(G.Bus.EV.WAVE_START, {
      wave: i + 1, level: P.bf.level, count: q.length, intent: L.waves[i].intent
    });
  }

  function nextWave() {
    var L = D.cur();
    var i = P.waveIdx + 1;
    if (i >= L.waves.length) i = 0;
    startWave(i);
  }

  function spawnOne(role) {
    var bf = P.bf;
    var lanes = spawnLanes();
    if (lanes.length) {
      var lane = lanes[bf.rng.int(0, lanes.length - 1)];
      var cells = spawnCellsForLane(lane);
      var col = cells[cells.length - 1];
      var e = bf._spawnEnemy(role);
      if (!e) return;
      e.lane = lane;
      e.x = bf.slotX(col) + bf.rng.range(-4, 6);
      e.y = bf.laneY(lane) + bf.rng.range(-5, 5);
      return;
    }
    bf._spawnEnemy(role);
  }

  /* ---------------- 更新 ---------------- */
  // 注：地形（减速 / 岩石·空洞阻挡 / 水洼冰系加成）已实现在游戏引擎 Battlefield 内
  // （挂载点⑤，battlefield.js:_terrainApply / _terrainBlock / damageEnemy）。
  // 编辑器预览直接把 map 传给同一个 Battlefield，行为天然与游戏 100% 同源，无需在此重复实现。
  function update(dt) {
    if (!P.running || !P.bf) return;
    var bf = P.bf;

    // 波次调度
    if (P.waveRunning) {
      P.spawnTimer -= dt;
      if (P.spawnTimer <= 0 && P.queue && P.queue.length) {
        spawnOne(P.queue.shift());
        P.spawnTimer = P.spawnInterval * bf.rng.range(0.7, 1.3);
      }
      var alive = bf.enemies.filter(function (e) { return !e.dead; }).length;
      if (!P.queue.length && alive === 0) {
        P.waveRunning = false;
        P.waveGap = 1.6;
        if (G.Bus) G.Bus.emit(G.Bus.EV.WAVE_CLEAR, { wave: P.waveIdx + 1, level: bf.level, kills: bf.stats.kills });
        if (P.waveIdx === D.cur().waves.length - 1 && G.Bus) {
          G.Bus.emit(G.Bus.EV.LEVEL_CLEAR, { level: bf.level });
          P.waveIdx = -1; P.waveGap = 3.2;
        }
      }
    } else if (P.autoWave) {
      P.waveGap -= dt;
      if (P.waveGap <= 0) nextWave();
    }

    bf.update(dt);
    if (P.dir) P.dir.update(dt);
    if (P.bv) P.bv.update(dt);
    if (P.board) P.board.update(dt);
    if (P.boardView) P.boardView.update(dt);
    if (P.fx) P.fx.update(dt);

    if (P.godMode && bf.nodeHp < bf.nodeMax) bf.nodeHp = bf.nodeMax;

    // 自动合成（演示充能 → 附魔链路）
    if (P.autoPlay && P.board) {
      P.autoT = (P.autoT || 0) - dt;
      if (P.autoT <= 0) {
        P.autoT = 0.45;
        var dirs = ['left', 'up', 'right', 'down'];
        if (G.Bus) G.Bus.emit(G.Bus.EV.CMD_MOVE, { dir: dirs[(Math.random() * 4) | 0] });
      }
    }

    // 滚动 DPS
    var now = performance.now() / 1000;
    while (P.dpsLog.length && now - P.dpsLog[0].t > 3) P.dpsLog.shift();
    var sum = 0;
    for (var i = 0; i < P.dpsLog.length; i++) sum += P.dpsLog[i].a;
    P.dps = sum / 3;

    // 检视器 10Hz 刷新即可，避免每帧重建 DOM
    P.inspT = (P.inspT || 0) - dt;
    if (P.inspector && P.inspT <= 0) { P.inspT = 0.1; refreshInspector(); }
  }

  /* ---------------- 绘制 ---------------- */
  function drawTerrain(ctx) {
    var bf = P.bf, L = D.cur();
    ctx.save();
    for (var l = 0; l < L.map.lanes; l++) {
      for (var c = 0; c < L.map.cols; c++) {
        var key = tileAt(l, c), t = D.TILES[key];
        if (key === 'grass') continue;
        var x = cellLeft(c), y = bf.laneY(l) - bf.laneH / 2 + 6, w = bf.cellW, h = bf.laneH - 12;
        ctx.globalAlpha = key === 'slot' ? 0.22 : 0.42;
        ctx.fillStyle = t.color;
        ctx.fillRect(x, y, w, h);
        ctx.globalAlpha = 1;
        if (key === 'slot') {
          ctx.strokeStyle = 'rgba(207,232,176,.55)'; ctx.lineWidth = 1.3;
          ctx.setLineDash([5, 4]);
          ctx.strokeRect(x + 4, y + 4, w - 8, h - 8);
          ctx.setLineDash([]);
        } else if (key === 'spawn') {
          ctx.strokeStyle = 'rgba(255,160,160,.85)'; ctx.lineWidth = 2;
          ctx.strokeRect(x + 3, y + 3, w - 6, h - 6);
          ctx.fillStyle = 'rgba(255,190,190,.9)';
          ctx.font = '800 10px system-ui'; ctx.textAlign = 'center';
          ctx.fillText('出生', x + w / 2, y + h / 2 + 3);
        } else if (key === 'rock' || key === 'hole') {
          ctx.strokeStyle = key === 'rock' ? 'rgba(220,230,245,.5)' : 'rgba(120,140,170,.4)';
          ctx.lineWidth = 1.2;
          for (var k = -h; k < w; k += 9) {
            ctx.beginPath();
            ctx.moveTo(x + k, y + h); ctx.lineTo(x + k + h, y);
            ctx.stroke();
          }
        } else if (key === 'mud' || key === 'water') {
          ctx.fillStyle = key === 'water' ? 'rgba(160,220,255,.35)' : 'rgba(255,220,160,.2)';
          ctx.fillRect(x, y + h - 4, w, 4);
        }
      }
    }
    ctx.restore();
  }

  function drawGrid(ctx) {
    var bf = P.bf, L = D.cur();
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 1;
    for (var l = 0; l < L.map.lanes; l++) {
      for (var c = 0; c < L.map.cols; c++) {
        var x = cellLeft(c), y = bf.laneY(l) - bf.laneH / 2 + 6, w = bf.cellW, h = bf.laneH - 12;
        ctx.strokeRect(x, y, w, h);
        ctx.fillStyle = 'rgba(255,255,255,.28)';
        ctx.font = '600 9px system-ui'; ctx.textAlign = 'left';
        ctx.fillText('L' + l + 'C' + c, x + 3, y + 10);
      }
    }
    ctx.restore();
  }

  function drawBattle(ctx) {
    var bv = P.bv, bf = P.bf, R = REGION;
    var ok = !!(bv && bv._bg && bv._node && bv._enemy && bv._plant && bv._projectiles && bv._topbar);
    ctx.save();
    ctx.beginPath(); ctx.rect(R.x, R.y, R.w, R.h); ctx.clip();
    if (!ok) {
      ctx.restore();
      if (bv) bv.draw(ctx, P.fx);
      return;
    }
    bv._bg(ctx, R);
    if (P.showTerrain) drawTerrain(ctx);
    if (P.showGrid) drawGrid(ctx);
    if (P.bv) P.bv._obstacles(ctx);
    bv._node(ctx);

    var ents = [];
    bf.enemies.forEach(function (e) { ents.push({ y: e.y, o: e, k: 'e' }); });
    bf.plants.forEach(function (p) { ents.push({ y: p.y, o: p, k: 'p' }); });
    ents.sort(function (a, b) { return a.y - b.y; });
    ents.forEach(function (q) { q.k === 'e' ? bv._enemy(ctx, q.o) : bv._plant(ctx, q.o); });

    bv._projectiles(ctx);
    if (P.fx) P.fx.draw(ctx);
    bv._topbar(ctx, R);
    ctx.restore();
  }

  function drawHeader(ctx) {
    var L = D.cur(), bf = P.bf;
    ctx.save();
    ctx.font = '900 17px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = '#eaf3ff'; ctx.textAlign = 'left';
    ctx.fillText('星序防线 · 编辑器预览', 16, 26);
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillStyle = '#7d95b5';
    ctx.fillText(L.name + '（第 ' + bf.level + ' 关 · 缩放 HP ×' + U.num(S.levelScale(bf.level).hp, 2) + '）', 176, 26);

    var items = [['金币', Math.floor(P.dir ? P.dir.currency.gold : 0) + Math.floor(L.battle.gold), '#ffd45e'],
    ['星核', Math.floor(P.dir ? P.dir.currency.star : 0), '#b9a6ff'],
    ['晶核', P.dir ? P.dir.currency.core : 0, '#6fd6ff']];
    var x = W - 16;
    ctx.textAlign = 'right';
    for (var i = items.length - 1; i >= 0; i--) {
      var it = items[i];
      ctx.font = '800 13px system-ui, sans-serif';
      ctx.fillStyle = it[2];
      ctx.fillText(String(it[1]), x, 20);
      ctx.font = '600 10px "Noto Sans SC", system-ui, sans-serif';
      ctx.fillStyle = '#6d819e';
      ctx.fillText(it[0], x, 34);
      x -= 76;
    }
    ctx.restore();
  }

  /** 圆角矩形（游戏侧 boardView 提供，缺失时退化） */
  function rrect(ctx, x, y, w, h, r) {
    if (G.roundRect) { G.roundRect(ctx, x, y, w, h, r); return; }
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.closePath();
  }

  function drawHud(ctx) {
    var L = D.cur(), bf = P.bf;
    var needDps = 0;
    if (P.waveIdx >= 0 && L.waves[P.waveIdx]) needDps = S.wave(L, L.waves[P.waveIdx], bf.level).needDpsArmor;

    ctx.save();
    // 左下状态板
    var x = 16, y = H - 96;
    ctx.globalAlpha = 0.92;
    rrect(ctx, x, y, 300, 78, 10);
    ctx.fillStyle = 'rgba(8,14,24,.86)'; ctx.fill();
    ctx.strokeStyle = 'rgba(120,170,230,.25)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.font = '700 12px "Noto Sans SC", system-ui';
    ctx.fillStyle = '#9fc4e8'; ctx.textAlign = 'left';
    ctx.fillText('波次 ' + (P.waveIdx + 1) + ' / ' + L.waves.length + (P.waveRunning ? ' · 进行中' : ' · 待命'), x + 12, y + 18);
    ctx.fillText('实时 DPS', x + 12, y + 38);
    ctx.fillText('需求 DPS', x + 12, y + 58);
    ctx.fillText('待生成 ' + (P.queue ? P.queue.length : 0), x + 190, y + 18);

    ctx.textAlign = 'right';
    ctx.font = '800 12px system-ui';
    ctx.fillStyle = '#b6ffc8'; ctx.fillText(U.num(P.dps, 1), x + 172, y + 38);
    ctx.fillStyle = '#ffd08a'; ctx.fillText(U.num(needDps, 1), x + 172, y + 58);

    // 对比条（实时 DPS / 需求 DPS，同一刻度 0–2× 需求）
    var bw = 96;
    var scaleDps = Math.max(1, needDps) * 2;
    var r1 = Math.min(1, P.dps / scaleDps), r2 = Math.min(1, needDps / scaleDps);
    rrect(ctx, x + 186, y + 30, bw, 7, 4); ctx.fillStyle = 'rgba(255,255,255,.10)'; ctx.fill();
    rrect(ctx, x + 186, y + 30, bw * r1, 7, 4);
    ctx.fillStyle = P.dps >= needDps ? '#7fe0a0' : '#ff8f8f'; ctx.fill();
    rrect(ctx, x + 186, y + 50, bw, 7, 4); ctx.fillStyle = 'rgba(255,255,255,.10)'; ctx.fill();
    rrect(ctx, x + 186, y + 50, bw * r2, 7, 4); ctx.fillStyle = '#ffd08a'; ctx.fill();

    // 星枢
    ctx.textAlign = 'left';
    ctx.fillStyle = '#9fc4e8'; ctx.font = '700 12px "Noto Sans SC", system-ui';
    ctx.fillText('星枢', x + 12, y + 74);
    ctx.restore();
  }

  function drawHelp(ctx) {
    ctx.save();
    ctx.font = '600 10px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(140,165,195,.8)';
    ctx.textAlign = 'left';
    ctx.fillText('空格 = 下一波　P = 暂停　R = 重建　方向键/WASD = 合成（棋盘开启时）　点击敌人 = 查看实时数值　' +
      (P.editPlants ? '【布防模式】点击种植槽放置/移除植物' : ''), 16, H - 8);
    ctx.restore();
  }

  function drawHover(ctx) {
    if (!P.hover) return;
    var e = P.hover;
    if (e.dead) { P.hover = null; return; }
    ctx.save();
    ctx.strokeStyle = 'rgba(111,214,255,.9)'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(e.x, e.y - 6, 26 * (e.scale || 1), 0, Math.PI * 2); ctx.stroke();
    ctx.font = '700 10px "Noto Sans SC", system-ui';
    ctx.fillStyle = '#eaf7ff'; ctx.textAlign = 'center';
    ctx.fillText(e.name + ' ' + Math.max(0, Math.ceil(e.hp)) + '/' + Math.round(e.maxHp), e.x, e.y - 34 * (e.scale || 1));
    ctx.restore();
  }

  function draw() {
    var ctx = P.ctx;
    ctx.setTransform(P.dpr, 0, 0, P.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0d1522'); g.addColorStop(1, '#070c15');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    if (!P.bf) return;

    if (P.fx) {
      ctx.save();
      ctx.translate(P.fx.shakeX, P.fx.shakeY);
      drawBattle(ctx);
      ctx.restore();
    } else drawBattle(ctx);

    if (P.showBoard && P.boardView) P.boardView.draw(ctx);
    drawHeader(ctx);
    drawHud(ctx);
    drawHover(ctx);
    drawHelp(ctx);
  }

  /* ---------------- 主循环 ---------------- */
  var acc = 0;
  function tick(dt) {
    if (!P.mounted) return;
    var step = 1 / 60;
    acc += dt * P.speed;
    var guard = 0;
    while (acc >= step && guard < 8) { update(step); acc -= step; guard++; }
    if (acc > 0.4) acc = 0;
    draw();
  }

  /* ---------------- 检视器 ---------------- */
  function refreshInspector() {
    var host = P.inspector;
    if (!host) return;
    var bf = P.bf, L = D.cur();
    var alive = bf.enemies.filter(function (e) { return !e.dead; });
    var e = P.hover;

    U.clear(host);

    host.appendChild(U.h('div', { class: 'h' }, [U.h('span', { text: '运行状态' })]));
    var lines = [
      ['关卡 / 波次', bf.level + ' · ' + (P.waveIdx + 1) + '/' + L.waves.length],
      ['存活 / 击杀 / 漏怪', alive.length + ' / ' + bf.stats.kills + ' / ' + bf.stats.leaks],
      ['星枢', Math.ceil(bf.nodeHp) + ' / ' + bf.nodeMax],
      ['实时 DPS / 需求', U.num(P.dps, 1) + ' / ' + (P.waveIdx >= 0 ? U.num(S.wave(L, L.waves[P.waveIdx], bf.level).needDpsArmor, 1) : '-')],
      ['布防 DPS（植物）', U.num(S.defenseDps(L), 1)]
    ];
    lines.forEach(function (r) {
      host.appendChild(U.h('div', { class: 'stat-line' }, [
        U.h('span', { class: 'muted', text: r[0] }), U.h('b', { text: r[1] })
      ]));
    });

    if (P.dir) {
      var pct = Math.min(1, P.dir.charge / G.K.CHARGE_MAX);
      host.appendChild(U.h('div', { class: 'stat-line', style: { marginTop: '6px' } }, [
        U.h('span', { class: 'muted', text: '充能' }),
        U.h('b', { text: Math.floor(pct * 100) + '%' })
      ]));
      host.appendChild(U.h('div', { class: 'bar' }, [U.h('i', { style: { width: (pct * 100) + '%' } })]));
      host.appendChild(U.h('div', { class: 'stat-line' }, [
        U.h('span', { class: 'muted', text: '附魔 小/超载' }),
        U.h('b', { text: P.dir.casts.small + ' / ' + P.dir.casts.overload })
      ]));
      if (P.dir.lastCast) {
        host.appendChild(U.h('div', { class: 'muted' }, [
          U.h('span', { html: '最近：' }),
          U.h('span', { class: 'tag acc', text: (G.ELEMENT_CN[P.dir.lastCast.element] || P.dir.lastCast.element) +
            (P.dir.lastCast.star ? ' ★' + P.dir.lastCast.star : ' 小') +
            ' · ' + Math.round(P.dir.lastCast.pool) })
        ]));
      }
    }

    host.appendChild(U.h('hr', { class: 'sep' }));
    host.appendChild(U.h('div', { class: 'h' }, [U.h('span', { text: '悬停实体' }), U.h('span', { class: 'sub', text: e ? '' : '把鼠标移到敌人上' })]));

    if (e && !e.dead) {
      var R = G.ROLES[e.role] || {};
      var rows = [
        ['名称', e.name + ' (' + e.role + ')'],
        ['HP', '<b style="color:#ff8f8f">' + Math.ceil(e.hp) + '</b> / ' + Math.round(e.maxHp)],
        ['护甲', Math.round((e.armor || 0) * 100) + '%'],
        ['当前速度', U.num(e.baseSpeed * 120, 0) + ' px/s'],
        ['所在格', 'L' + e.lane + 'C' + colOf(e.x) + ' · ' + D.TILES[tileAt(e.lane, colOf(e.x))].name],
        ['状态', [e.slow ? '减速' + Math.round(e.slow * 100) + '%' : '', e.root > 0 ? '定身' : '', e.burnT > 0 ? '灼烧' : ''].filter(Boolean).join(' ') || '正常'],
        ['x / y', Math.round(e.x) + ' / ' + Math.round(e.y)],
        ['穿越剩余', U.num((e.x - (REGION.x + bf.cfg.nodeX)) / Math.max(1, e.baseSpeed * 120), 1) + ' s'],
        ['基准 HP / 赏金', (R.hp || '-') + ' / ' + (R.gold || '-')]
      ];
      host.appendChild(U.h('dl', { class: 'kv' }, rows.reduce(function (acc2, r) {
        acc2.push(U.h('dt', { text: r[0] })); acc2.push(U.h('dd', { html: r[1] })); return acc2;
      }, [])));
    }
  }

  /* ---------------- 交互 ---------------- */
  function toLogical(ev) {
    var r = P.canvas.getBoundingClientRect();
    return { x: (ev.clientX - r.left) * (W / r.width), y: (ev.clientY - r.top) * (H / r.height) };
  }

  function onMove(ev) {
    if (!P.bf) return;
    var p = toLogical(ev);
    var best = null, bd = 1e9;
    for (var i = 0; i < P.bf.enemies.length; i++) {
      var e = P.bf.enemies[i];
      if (e.dead) continue;
      var d = Math.hypot(p.x - e.x, p.y - (e.y - 6));
      if (d < 30 * (e.scale || 1) && d < bd) { bd = d; best = e; }
    }
    P.hover = best;
    if (P.inCanvas && P.hover) P.canvas.style.cursor = 'pointer';
    else P.canvas.style.cursor = P.editPlants ? 'crosshair' : 'default';
  }

  function onClick(ev) {
    if (!P.bf) return;
    var p = toLogical(ev);
    var L = D.cur();

    // 布防编辑
    if (P.editPlants && p.x >= REGION.x && p.x <= REGION.x + REGION.w &&
      p.y >= REGION.y && p.y <= REGION.y + REGION.h) {
      var lane = laneOf(p.y), col = colOf(p.x);
      if (col >= 0 && col < L.map.cols && lane >= 0 && lane < L.map.lanes) {
        if (tileAt(lane, col) !== 'slot') { ED.toast('该格不是种植槽（L' + lane + 'C' + col + '）', 'bad'); return; }
        var idx = -1;
        for (var i = 0; i < L.plants.length; i++) {
          if (L.plants[i].lane === lane && L.plants[i].col === col) { idx = i; break; }
        }
        if (idx >= 0) {
          L.plants.splice(idx, 1);
          var pi = -1;
          for (var j = 0; j < P.bf.plants.length; j++) {
            if (P.bf.plants[j].lane === lane && P.bf.plants[j].col === col) { pi = j; break; }
          }
          if (pi >= 0) P.bf.plants.splice(pi, 1);
          ED.toast('移除植物 L' + lane + 'C' + col);
        } else {
          L.plants.push({ lane: lane, col: col, kind: P.brush });
          var pl = P.bf.placePlant({ lane: lane, col: col }, P.brush);
          if (pl) pl.born = 1;
          ED.toast('放置 ' + (G.PLANTS[P.brush] || {}).name + ' @ L' + lane + 'C' + col, 'good');
        }
        D.emit('plants');
        return;
      }
    }

  }

  /* ---------------- 界面 ---------------- */
  function ctrlBtn(label, fn, cls) {
    return U.h('button', { class: 'btn ' + (cls || ''), text: label, on: { click: fn } });
  }

  P.mount = function (root) {
    P.root = root;
    U.clear(root);

    if (!G.Battlefield || !G.BattleView || !G.PlantArt || !G.InsectArt || !G.PX) {
      root.appendChild(U.h('div', { class: 'banner', html:
        '<b>场景预览不可用</b>：未加载游戏本体的 Battlefield / BattleView / 美术模块。<br>' +
        '请确认编辑器目录与游戏目录的相对位置（<code>editor/index.html</code> → <code>../3069antone/src/</code>）保持不变。' }));
      return;
    }
    P.mounted = true;

    var wrap = U.h('div', { class: 'scene-wrap' });
    var side = U.h('div', { class: 'side' });

    /* 控制条 */
    var lvSel = U.h('select', {
      on: {
        change: function () {
          D.active = +this.value;
          build(); D.emit('switch');
        }
      }
    });

    var speedSel = U.h('select', { on: { change: function () { P.speed = +this.value; } } },
      [0.25, 0.5, 1, 1.5, 2, 3].map(function (s) {
        return U.h('option', { value: s, text: s + '×', selected: s === 1 });
      }));

    var brushSel = U.h('select', { on: { change: function () { P.brush = this.value; } } },
      Object.keys(G.PLANTS).map(function (k) {
        return U.h('option', { value: k, text: (G.PLANT_KIND[k] || {}).name || k, selected: k === 'peashooter' });
      }));

    function chk(label, get, set) {
      var cb = U.h('input', {
        type: 'checkbox', checked: get(),
        on: { change: function () { set(this.checked); } }
      });
      return U.h('label', { class: 'f', style: { cursor: 'pointer' } }, [cb, U.h('span', { text: label, style: { minWidth: '0' } })]);
    }

    var playBtn = U.h('button', { class: 'btn primary', text: '⏸ 暂停', on: { click: function () { toggleRun(); } } });
    function toggleRun() {
      P.running = !P.running;
      playBtn.textContent = P.running ? '⏸ 暂停' : '▶ 播放';
    }

    var bar = U.h('div', { class: 'card', style: { padding: '9px 10px', marginBottom: '10px' } }, [
      U.h('div', { class: 'row wrap' }, [
        playBtn,
        ctrlBtn('⏭ 下一波', function () { nextWave(); }),
        ctrlBtn('⟲ 重建', function () { build(); ED.toast('场景已重建'); }),
        U.h('span', { class: 'muted', text: '速度' }), speedSel,
        U.h('span', { style: { width: '8px' } }),
        U.h('span', { class: 'muted', text: '关卡' }), lvSel,
        U.h('span', { class: 'sp' }),
        chk('自动连波', function () { return P.autoWave; }, function (v) { P.autoWave = v; }),
        chk('星枢无敌', function () { return P.godMode; }, function (v) { P.godMode = v; }),
        chk('地形', function () { return P.showTerrain; }, function (v) { P.showTerrain = v; }),
        chk('网格', function () { return P.showGrid; }, function (v) { P.showGrid = v; }),
        chk('棋盘', function () { return P.showBoard; }, function (v) { P.showBoard = v; }),
        chk('自动合成', function () { return P.autoPlay; }, function (v) { P.autoPlay = v; })
      ]),
      U.h('div', { class: 'row wrap', style: { marginTop: '8px' } }, [
        chk('布防模式（点击种植槽）', function () { return P.editPlants; }, function (v) {
          P.editPlants = v;
          P.canvas.style.cursor = v ? 'crosshair' : 'default';
        }),
        U.h('span', { class: 'muted', text: '笔刷' }), brushSel,
        U.h('span', { class: 'sp' }),
        ctrlBtn('清空敌人', function () { if (P.bf) P.bf.enemies.length = 0; P.queue = []; P.waveRunning = false; }),
        ctrlBtn('回到关卡编辑器', function () { ED.app.go('level'); }, 'good')
      ])
    ]);

    wrap.appendChild(bar);

    /* 画布 */
    var c = U.mkCanvas(W, H);
    P.canvas = c.canvas; P.ctx = c.ctx; P.dpr = c.dpr;
    c.canvas.className = 'game';
    var box = U.h('div', { class: 'scene-canvas-box' }, [c.canvas]);
    wrap.appendChild(box);

    c.canvas.addEventListener('mousemove', function (ev) { P.inCanvas = true; onMove(ev); });
    c.canvas.addEventListener('mouseleave', function () { P.inCanvas = false; P.hover = null; });
    c.canvas.addEventListener('click', onClick);

    root.appendChild(wrap);
    root.appendChild(side);

    /* 侧栏 */
    side.appendChild(U.h('div', { class: 'card' }, [
      U.h('div', { class: 'h' }, [U.h('span', { text: '预览说明' })]),
      U.h('div', { class: 'muted', html:
        '这里跑的是<b>游戏本体</b>的 Battlefield / BattleView / Board2048 / Director，' +
        '叠加编辑器自有的地形层。地形效果（泥地减速、岩石阻挡）目前只在预览里实现，' +
        '导出后由游戏侧按 <code>map.effects</code> 自行解释。' })
    ]));

    P.inspector = U.h('div', { class: 'card' });
    side.appendChild(P.inspector);

    var legend = U.h('div', { class: 'card' }, [
      U.h('div', { class: 'h' }, [U.h('span', { text: '地形图例' })])
    ]);
    D.TILE_KEYS.forEach(function (k) {
      var t = D.TILES[k];
      legend.appendChild(U.h('div', { class: 'row', style: { marginBottom: '4px' } }, [
        U.h('span', { style: { width: '16px', height: '16px', borderRadius: '5px', background: t.color, border: '1px solid rgba(0,0,0,.4)', display: 'inline-block' } }),
        U.h('span', { style: { fontWeight: '700', fontSize: '11.5px', minWidth: '52px' }, text: t.name }),
        U.h('span', { class: 'muted', text: t.desc })
      ]));
    });
    side.appendChild(legend);

    function fillLevels() {
      U.clear(lvSel);
      D.levels.forEach(function (L, i) {
        lvSel.appendChild(U.h('option', { value: i, text: (i + 1) + '. ' + L.name, selected: i === D.active }));
      });
    }
    P.fillLevels = fillLevels;
    fillLevels();

    build();
    refreshInspector();
    ED.ticker.add(tick);

    // 伤害统计（订阅一次即可）
    if (G.Bus && !P.dpsBound) {
      P.dpsBound = true;
      G.Bus.on(G.Bus.EV.ENEMY_HIT, function (p) {
        P.dpsLog.push({ t: performance.now() / 1000, a: p.amount || 0 });
      });
    }

    // 键盘
    P.onKey = function (e) {
      if (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
      var k = e.key;
      var map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right' };
      if (map[k] && P.showBoard && P.board) {
        e.preventDefault();
        G.Bus.emit(G.Bus.EV.CMD_MOVE, { dir: map[k] });
      } else if (k === ' ') { e.preventDefault(); nextWave(); }
      else if (k === 'p' || k === 'P') toggleRun();
      else if (k === 'r' || k === 'R') build();
    };
    window.addEventListener('keydown', P.onKey);

    // 自适应画布尺寸
    P.onResize = function () {
      var bw = box.clientWidth - 18, bh = box.clientHeight - 18;
      var s = Math.min(bw / W, bh / H, 1);
      c.canvas.style.width = (W * s) + 'px';
      c.canvas.style.height = (H * s) + 'px';
    };
    window.addEventListener('resize', P.onResize);
    setTimeout(P.onResize, 0);
  };

  P.unmount = function () {
    P.mounted = false;
    ED.ticker.remove(tick);
    if (P.onKey) window.removeEventListener('keydown', P.onKey);
    if (P.onResize) window.removeEventListener('resize', P.onResize);
    dispose();
    P.bf = P.bv = P.board = P.boardView = P.dir = null;
  };

  P.rebuild = function () { if (P.mounted) { if (P.fillLevels) P.fillLevels(); build(); } };

  ED.Panels = ED.Panels || {};
  ED.Panels.scene = P;
})(window.ED);
