/* ============================================================
 *  main.js —— 装配层：建美术、建系统、建视图、接输入、跑主循环
 *  这里也是唯一「知道全部模块」的地方（Director 只认识两个系统）
 *
 *  本次集成新增：Cards / Run / Meta / CardView / MetaView
 *    · 局内系统（Board/Battle/Director）+ 卡牌/经济/元游戏，全部经 Bus 解耦
 *    · 顶层状态：家园(home) → 战斗(play)；选卡/决策/结算为同屏模态层
 * ============================================================ */
(function (global) {
  'use strict';
  var EV = global.Bus.EV, M = global.M;

  var W = 1040, H = 640;
  var canvas, ctx, dpr = 1;
  // 局内系统（每次 buildWorld 重建）
  var board, battle, director, boardView, battleView, fx, loop;
  // 持久系统（跨局保留，buildWorld 仅重置状态）
  var cards, run, meta, cardView, metaView;
  var toasts = [];
  var evolveMenu = null;   // {lane,col,x,y}
  var started = false;
  var autoWaveTimer = 1.2;
  var stats = { merges: 0, best: 0, casts: 0 };

  var PLANT_COST = { sprout: 20, peashooter: 60, cabbagepult: 140 };

  /* ---------------- 启动 ---------------- */
  function boot() {
    canvas = document.getElementById('game');
    setupCanvas();
    window.addEventListener('resize', setupCanvas);

    global.PlantArt.build();
    global.InsectArt.build();

    // 持久系统（跨局保留存档 / 卡牌 / 单局流程）
    meta = new global.Meta();
    cards = new global.Cards();
    run = new global.Run();
    // 把养成树的永久加成注入卡牌 mod（装饰器模式，可追溯）
    cards.addDecorator(meta.decorator());

    buildWorld();
    bindInput();

    loop = new global.Loop({
      step: 1 / 60,
      update: update,
      render: render
    });
    loop.start();

    document.getElementById('loading').style.display = 'none';
    started = true;
    showHome();
  }

  function setupCanvas() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr; canvas.height = H * dpr;
    var maxW = Math.min(window.innerWidth - 24, W);
    canvas.style.width = maxW + 'px';
    canvas.style.height = (maxW * H / W) + 'px';
    ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.textBaseline = 'middle';
  }

  /* ---------------- 顶层流程 ---------------- */

  /** 回到家园（元游戏界面） */
  function showHome() {
    if (metaView) metaView.show('home');
  }

  /** 开始新的一局：重建局内世界并隐藏家园 */
  function startRun() {
    buildWorld();
    if (metaView) metaView.hide();
    toasts.length = 0;
  }

  function buildWorld() {
    global.Bus.reset();

    // 局内系统（每次重建）
    battle = new global.Battlefield({
      x: 14, y: 52, w: 596, h: 576, lanes: 3, cols: 4, nodeX: 58,
      seed: (Math.random() * 1e9) | 0
    });
    board = new global.Board2048({ n: 5, seed: (Math.random() * 1e9) | 0 });
    director = new global.Director({ board: board, battle: battle });

    battleView = new global.BattleView(battle, { x: 14, y: 52, w: 596, h: 576 });
    boardView = new global.BoardView(board, { x: 622, y: 52, w: 404, h: 576 });
    boardView.director = director;

    fx = new global.FX();
    fx.battle = battle;

    // 持久系统：Bus.reset() 已清空它们的监听，必须重新绑定
    meta._bind();
    cards._bind();
    run._bind();

    // 视图（每次重建，构造里重新订阅事件）
    cardView = new global.CardView(cards, { w: W, h: H });
    metaView = new global.MetaView(meta, run, { w: W, h: H, onStart: startRun });

    // 卡牌：重置并让养成装饰器生效 → 广播 MOD_CHANGED 给各系统
    cards.reset();
    run.startNew();

    // 开局送 3 株牙苗
    for (var l = 0; l < 3; l++) {
      var p = battle.placePlant({ lane: l, col: 0 }, 'sprout');
      if (p) p.born = 1;
    }

    // 统计 / 反馈
    global.Bus.on(EV.BOARD_MERGE, function (m) {
      stats.merges++;
      if (m.value > stats.best) stats.best = m.value;
    });
    global.Bus.on(EV.ENCHANT_CAST, function () { stats.casts++; });
    global.Bus.on(EV.TOAST, function (p) { toast(p.text, p.kind); });

    // 波次清空 → 普通池三选一（关卡最后一波不抽，让位给「继续/收手」决策屏）
    global.Bus.on(EV.WAVE_CLEAR, function (p) {
      var lvlDone = (p.wave % 5) === 0;
      if (!lvlDone && cards) {
        var ratio = battle.nodeMax > 0 ? battle.nodeHp / battle.nodeMax : 1;
        cards.openDraft('wave', ratio);
      }
    });

    // 养成变化时，把最新永久加成刷进局内 mod
    global.Bus.on(EV.META_CHANGED, function () { if (cards) cards.recompute(); });

    autoWaveTimer = 1.2;
  }

  /* ---------------- 输入 ---------------- */

  function toLogical(ev) {
    var r = canvas.getBoundingClientRect();
    return {
      x: (ev.clientX - r.left) * (W / r.width),
      y: (ev.clientY - r.top) * (H / r.height)
    };
  }

  /** 是否处于模态层（选卡 / 决策 / 结算 / 家园）—— 此时局内输入冻结 */
  function isModal() {
    return !!cardView && (cardView.visible || (metaView && metaView.screen !== 'none'));
  }

  var KEYMAP = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right',
    W: 'up', S: 'down', A: 'left', D: 'right'
  };

  function bindInput() {
    window.addEventListener('keydown', function (e) {
      if (KEYMAP[e.key]) {
        e.preventDefault();
        if (!isModal()) global.Bus.emit(EV.CMD_MOVE, { dir: KEYMAP[e.key] });
      }
      if (e.key === 'r' || e.key === 'R') { startRun(); return; }
      if (e.key === ' ') {
        e.preventDefault();
        if (!isModal() && !battle.waveRunning) battle.startNextWave();
      }
      // 选卡快捷键 1/2/3
      if (cardView && cardView.visible && (e.key === '1' || e.key === '2' || e.key === '3')) {
        var idx = parseInt(e.key, 10) - 1;
        if (cards.pending && cards.pending.options[idx]) {
          global.Bus.emit(EV.CMD_CARD_PICK, { id: cards.pending.options[idx].id });
        }
      }
    });

    var down = null;
    canvas.addEventListener('pointerdown', function (e) {
      var p = toLogical(e);
      if (isModal()) {
        if (cardView.visible) cardView.onClick(p.x, p.y);
        else if (metaView && metaView.screen !== 'none') metaView.onClick(p.x, p.y);
        down = null;
        return;
      }
      down = p;
      if (handleClick(p)) down = null;
    });
    canvas.addEventListener('pointerup', function (e) {
      if (isModal()) { down = null; return; }
      if (!down) return;
      var p = toLogical(e);
      var dx = p.x - down.x, dy = p.y - down.y;
      var ad = Math.abs(dx), ady = Math.abs(dy);
      if (Math.max(ad, ady) > 26 && !battle.waveRunning) {
        global.Bus.emit(EV.CMD_MOVE, { dir: ad > ady ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up') });
      }
      down = null;
    });
    canvas.addEventListener('pointermove', function (e) {
      var p = toLogical(e);
      if (cardView && cardView.visible) cardView.onMove(p.x, p.y);
      else if (metaView && metaView.screen !== 'none') metaView.onMove(p.x, p.y);
    });
  }

  function handleClick(p) {
    // 进化菜单优先
    if (evolveMenu) {
      var m = evolveMenu, hit = null;
      for (var i = 0; i < m.items.length; i++) {
        var it = m.items[i];
        if (Math.abs(p.x - it.x) < 40 && Math.abs(p.y - it.y) < 40) { hit = it; break; }
      }
      if (hit) {
        if (director.currency.gold >= PLANT_COST[hit.kind]) {
          director.currency.gold -= PLANT_COST[hit.kind];
          director._emitCurrency();
          global.Bus.emit(EV.CMD_PLANT_EVOLVE, { slot: { lane: m.lane, col: m.col }, target: hit.kind });
          toast('牙苗 → ' + global.PlantArt.KIND[hit.kind].name, 'good');
        } else {
          toast('金币不足（需 ' + PLANT_COST[hit.kind] + '）', 'bad');
        }
      }
      evolveMenu = null;
      return true;
    }

    // 点击战场内的植物/空位
    if (p.x >= 14 && p.x <= 610 && p.y >= 52 && p.y <= 628) {
      var best = null, bd = 1e9;
      for (var l = 0; l < battle.cfg.lanes; l++) {
        for (var c = 0; c < battle.cfg.cols; c++) {
          var sx = battle.slotX(c), sy = battle.slotY(l);
          var d = Math.hypot(p.x - sx, p.y - sy);
          if (d < 40 && d < bd) { bd = d; best = { lane: l, col: c, x: sx, y: sy }; }
        }
      }
      if (!best) return false;
      var plant = battle.plants.filter(function (q) { return q.lane === best.lane && q.col === best.col; })[0];
      if (plant && plant.kind === 'sprout') {
        evolveMenu = {
          lane: best.lane, col: best.col, x: best.x, y: best.y, t: 0,
          items: [
            { kind: 'peashooter', x: best.x + 52, y: best.y - 46 },
            { kind: 'cabbagepult', x: best.x + 52, y: best.y + 6 }
          ]
        };
        return true;
      }
      if (!plant) {
        if (director.currency.gold >= PLANT_COST.sprout) {
          director.currency.gold -= PLANT_COST.sprout;
          director._emitCurrency();
          global.Bus.emit(EV.CMD_PLANT_PLACE, { slot: { lane: best.lane, col: best.col }, kind: 'sprout' });
          toast('种下牙苗', 'good');
        } else toast('金币不足（需 ' + PLANT_COST.sprout + '）', 'bad');
        return true;
      }
    }

    // 点击元素轮盘 → 旋转
    if (boardView.wheelRects) {
      for (var k = 0; k < boardView.wheelRects.length; k++) {
        var wr = boardView.wheelRects[k];
        if (Math.hypot(p.x - wr.x, p.y - wr.y) < wr.r) {
          director.rotateWheel(k, 1);
          return true;
        }
      }
    }
    return false;
  }

  /* ---------------- 更新 ---------------- */

  function update(dt) {
    // 模态层（选卡 / 决策 / 结算 / 家园）下，局内逻辑冻结，只跑 UI 动画
    var modal = isModal();
    if (cardView) cardView.update(dt);
    if (metaView) metaView.update(dt);
    for (var i = toasts.length - 1; i >= 0; i--) {
      toasts[i].t += dt;
      if (toasts[i].t > toasts[i].life) toasts.splice(i, 1);
    }
    if (evolveMenu) evolveMenu.t += dt;

    if (modal) { if (fx) fx.update(dt); return; }

    // 波次自动推进
    if (!battle.waveRunning) {
      autoWaveTimer -= dt;
      if (autoWaveTimer <= 0) { battle.startNextWave(); autoWaveTimer = 2.6; }
    }

    // 顿帧：重击时短暂放慢战斗侧，强化打击感（棋盘侧保持真实时间）
    var bdt = dt;
    if (fx.hitStop > 0) bdt = dt * 0.22;

    board.update(dt);
    battle.update(bdt);
    director.update(bdt);
    battleView.update(bdt);
    boardView.update(dt);
    fx.update(bdt);
  }

  /* ---------------- 渲染 ---------------- */

  function render(alpha, rawDt) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawBackground();

    // 家园屏自带背景，跳过底层战斗画面
    if (director && metaView && metaView.screen !== 'home') {
      ctx.save();
      ctx.translate(fx.shakeX, fx.shakeY);
      battleView.draw(ctx, fx);
      ctx.restore();
      boardView.draw(ctx);
      drawWheel();
      drawHeader();
    }

    if (cardView) cardView.draw(ctx);
    if (metaView) metaView.draw(ctx);

    drawToasts();
    if (evolveMenu) drawEvolveMenu();
    drawHelp();
  }

  function drawBackground() {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0d1522');
    g.addColorStop(1, '#070c15');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // 星点
    ctx.save();
    for (var i = 0; i < 46; i++) {
      var x = (i * 137.5) % W, y = (i * 71.3) % H;
      var a = 0.15 + 0.35 * Math.abs(Math.sin(i + performance.now() / 2200));
      ctx.globalAlpha = a * 0.6;
      ctx.fillStyle = '#cfe6ff';
      ctx.fillRect(x, y, 1.6, 1.6);
    }
    ctx.restore();
  }

  function drawHeader() {
    ctx.save();
    ctx.font = '900 17px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = '#eaf3ff'; ctx.textAlign = 'left';
    ctx.fillText('星序防线', 16, 26);
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillStyle = '#7d95b5';
    ctx.fillText('2048 合成 × 塔防 · v0.2 原型', 92, 26);

    // 货币
    var c = director.currency;
    var items = [
      ['星核', Math.floor(c.star), '#b9a6ff'],
      ['金币', Math.floor(c.gold), '#ffd45e'],
      ['碎片', c.shard.toFixed(1), '#7fe0c0'],
      ['晶核', c.core, '#6fd6ff'],
      ['材料', c.material, '#ffb08a']
    ];
    var x = W - 16;
    ctx.textAlign = 'right';
    for (var i = items.length - 1; i >= 0; i--) {
      var it = items[i];
      ctx.font = '800 13px system-ui, sans-serif';
      ctx.fillStyle = it[2];
      ctx.fillText(it[1], x, 20);
      ctx.font = '600 10px "Noto Sans SC", system-ui, sans-serif';
      ctx.fillStyle = '#6d819e';
      ctx.fillText(it[0], x, 34);
      x -= Math.max(62, ctx.measureText(it[1]).width + 46);
    }
    ctx.restore();
  }

  function drawWheel() {
    var R = boardView.region;
    var y = R.y + R.h - 46;
    var cy = y;
    var r = 19, gap = 8;
    var n = director.roulette.length;
    var totalW = n * (r * 2 + gap) - gap;
    var sx = R.x + (R.w - totalW) / 2 + r;
    var rects = [];

    ctx.save();
    ctx.font = '700 11px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = '#7d95b5'; ctx.textAlign = 'center';
    ctx.fillText('元素轮盘（点击更换 · 连续同元素触发共鸣）', R.x + R.w / 2, cy - r - 12);

    var cols = {
      fire: '#ff7a2b', water: '#4aa8ff', wood: '#6cc04a',
      light: '#ffe07a', thunder: '#ffd93c', ice: '#8fd9ff'
    };
    var cn = global.Battlefield.ELEMENT_CN;

    for (var i = 0; i < n; i++) {
      var x = sx + i * (r * 2 + gap);
      var el = director.roulette[i];
      var active = (director.wheelPtr % n) === i;
      ctx.beginPath(); ctx.arc(x, cy, r + (active ? 3 : 0), 0, Math.PI * 2);
      ctx.fillStyle = active ? hexA(cols[el], 0.42) : 'rgba(255,255,255,.06)';
      ctx.fill();
      ctx.lineWidth = active ? 2.4 : 1.2;
      ctx.strokeStyle = active ? cols[el] : 'rgba(255,255,255,.22)';
      ctx.stroke();
      ctx.font = '900 15px "Noto Sans SC", system-ui, sans-serif';
      ctx.fillStyle = active ? '#ffffff' : hexA(cols[el], 0.85);
      ctx.fillText(cn[el], x, cy - 1);
      ctx.font = '600 9px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,.5)';
      ctx.fillText(String(i + 1), x, cy + 12);
      rects.push({ x: x, y: cy, r: r + 4 });
    }
    // 指针
    var pi = director.wheelPtr % n;
    var px = sx + pi * (r * 2 + gap);
    ctx.beginPath();
    ctx.moveTo(px, cy - r - 8); ctx.lineTo(px - 4, cy - r - 15); ctx.lineTo(px + 4, cy - r - 15);
    ctx.closePath();
    ctx.fillStyle = '#ffffff'; ctx.fill();
    ctx.restore();
    boardView.wheelRects = rects;
  }

  function hexA(hex, a) {
    var c = global.PX.hexToRgb(hex);
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }

  function drawToasts() {
    ctx.save();
    ctx.textAlign = 'center';
    for (var i = 0; i < toasts.length; i++) {
      var t = toasts[i];
      var u = t.t / t.life;
      var a = u < 0.1 ? u / 0.1 : (u > 0.8 ? (1 - u) / 0.2 : 1);
      ctx.globalAlpha = a;
      ctx.font = '800 14px "Noto Sans SC", system-ui, sans-serif';
      var col = t.kind === 'bad' ? '#ff8f8f' : t.kind === 'good' ? '#9fe8b0'
        : t.kind === 'jackpot' ? '#ffe45e' : t.kind === 'level' ? '#8fd9ff' : '#dbe8f7';
      var w = ctx.measureText(t.text).width + 26;
      var y = 78 + i * 30;
      global.roundRect(ctx, W / 2 - w / 2, y - 13, w, 26, 13);
      ctx.fillStyle = 'rgba(8,14,24,.82)'; ctx.fill();
      ctx.strokeStyle = hexA(col, 0.5); ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = col;
      ctx.fillText(t.text, W / 2, y);
    }
    ctx.restore();
  }

  function drawEvolveMenu() {
    var m = evolveMenu;
    ctx.save();
    // 连线
    ctx.strokeStyle = 'rgba(216,255,192,.6)'; ctx.lineWidth = 1.5;
    for (var i = 0; i < m.items.length; i++) {
      ctx.beginPath();
      ctx.moveTo(m.x, m.y - 14); ctx.lineTo(m.items[i].x - 34, m.items[i].y);
      ctx.stroke();
    }
    for (var j = 0; j < m.items.length; j++) {
      var it = m.items[j];
      var afford = director.currency.gold >= PLANT_COST[it.kind];
      ctx.globalAlpha = afford ? 1 : 0.45;
      global.roundRect(ctx, it.x - 36, it.y - 36, 72, 72, 12);
      ctx.fillStyle = 'rgba(14,26,18,.94)'; ctx.fill();
      ctx.strokeStyle = afford ? '#9fe8b0' : '#6d819e'; ctx.lineWidth = 2; ctx.stroke();

      var icon = global.PlantArt.Art.icon[it.kind];
      global.PX.draw(ctx, icon, it.x, it.y + 24, { frame: 0, scale: 1.5 });

      ctx.font = '800 10px "Noto Sans SC", system-ui, sans-serif';
      ctx.fillStyle = '#dff3d8'; ctx.textAlign = 'center';
      ctx.fillText(global.PlantArt.KIND[it.kind].name, it.x, it.y + 29);
      ctx.font = '800 10px system-ui, sans-serif';
      ctx.fillStyle = afford ? '#ffd45e' : '#ff8f8f';
      ctx.fillText(PLANT_COST[it.kind] + ' 金', it.x, it.y - 26);
    }
    ctx.restore();
  }

  function drawHelp() {
    ctx.save();
    ctx.font = '600 10px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(140,165,195,.75)';
    ctx.textAlign = 'left';
    ctx.fillText('方向键/滑动 = 合成　空格 = 立即开波　点击牙苗 = 进化　点击空位 = 种牙苗(' + PLANT_COST.sprout + '金)　R = 重开', 16, H - 10);
    ctx.restore();
  }

  function toast(text, kind) {
    toasts.push({ text: text, kind: kind || 'info', t: 0, life: kind === 'jackpot' ? 2.2 : 1.8 });
    if (toasts.length > 5) toasts.shift();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else boot();

  global.__GAME = {
    get board() { return board; },
    get battle() { return battle; },
    get director() { return director; },
    get cards() { return cards; },
    get cardView() { return cardView; },
    get metaView() { return metaView; },
    get run() { return run; },
    get meta() { return meta; },
    startRun: startRun,
    showHome: showHome
  };
})(window);
