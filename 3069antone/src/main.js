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

  var L = null;                 // 当前布局（由 Layout.compute 产出）
  var W = 1040, H = 640;        // 当前逻辑画布尺寸 —— 由 L 决定，不再是常量
  var canvas, ctx, dpr = 1;
  // 局内系统（每次 buildWorld 重建）
  var board, battle, director, boardView, battleView, fx, loop;
  // 持久系统（跨局保留，buildWorld 仅重置状态）
  var cards, run, meta, cardView, metaView;
  // 宠物（培育植物）：独立于战场的养成系统，跨局保留
  var pet, forge, petPanel, forgeView, petChoose;
  var toasts = [];
  var evolveMenu = null;   // {lane,col,x,y}
  var started = false;
  var autoWaveTimer = 1.2;
  var stats = { merges: 0, best: 0, casts: 0 };
  // 多关流程（#19）：编辑器导出的全部关卡；appliedLevelIdx 记录已应用的关卡序号，避免重复重载
  var LEVELS = [];
  var appliedLevelIdx = -1;

  var PLANT_COST = { sprout: 20, peashooter: 60, cabbagepult: 140, burningpomegranate: 100 };

  /** 读编辑器导出的 tuning 包（关卡级数值表覆盖）。无则返回 null。 */
  function pkgTuning() {
    var ld = (typeof window !== 'undefined' && window.LEVEL_DATA) ? window.LEVEL_DATA : null;
    return (ld && ld.tuning) ? ld.tuning : null;
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    canvas = document.getElementById('game');
    setupCanvas();
    window.addEventListener('resize', setupCanvas);
    window.addEventListener('orientationchange', setupCanvas);
    // 手机地址栏收起/展开、软键盘弹出时 innerHeight 会变，也要跟着重排
    if (window.visualViewport) window.visualViewport.addEventListener('resize', setupCanvas);

    global.PlantArt.build();
    global.InsectArt.build();
    if (global.BeeArt) global.BeeArt.build();   // 蜜蜂（独立美术模块，简单挂载）
    if (global.PetArt) global.PetArt.build();           // 培育植物（Q 版精灵）
    if (global.MaterialArt) global.MaterialArt.build(); // 材料（纯形状，无表情）

    // 持久系统（跨局保留存档 / 卡牌 / 单局流程）
    meta = new global.Meta({ tuning: pkgTuning() });
    cards = new global.Cards({ tuning: pkgTuning() });
    run = new global.Run();
    // 把养成树的永久加成注入卡牌 mod（装饰器模式，可追溯）
    cards.addDecorator(meta.decorator());

    // 宠物（培育植物）：系统 + 门面 + 三个视图，全部跨局保留
    pet = new global.Pet(meta);
    forge = new global.Forge(meta, pet);
    petPanel = new global.PetPanel({ pet: pet, battle: null });
    forgeView = new global.ForgeView(forge, { w: W, h: H, portrait: L.portrait });
    petChoose = new global.PetChoose({ w: W, h: H, portrait: L.portrait });

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

    // 第一次进游戏：弹「初次异变」三选一。选完永不可改，所以是强制模态 ——
    // 点空白不穿透，必须选一株才能进家园（后期接背景剧情就替换这一屏的文案）。
    if (pet && !pet.chosen()) petChoose.show();
  }

  /**
   * 按当前视口算出逻辑画布尺寸，并贴到 canvas 上。
   * 只有「形状真的变了」（横竖屏切换 / 逻辑尺寸变化）才重排世界 ——
   * 手机地址栏收放会疯狂触发 resize，不能每次都重建几何。
   */
  function setupCanvas() {
    var prev = L ? { portrait: L.portrait, W: L.W, H: L.H } : null;
    L = global.Layout.compute(window.innerWidth, window.innerHeight);
    W = L.W; H = L.H;

    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = L.cssW + 'px';
    canvas.style.height = L.cssH + 'px';

    // 改过 canvas.width 后 2D 上下文状态会重置，这几项必须重设
    ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.textBaseline = 'middle';

    if (prev && (prev.portrait !== L.portrait || prev.W !== L.W || prev.H !== L.H)) {
      relayoutWorld();
    }
  }

  /** 屏幕形状变了：把各系统几何迁到新布局，不重建世界（波次 / 血量 / 冷却全部保留） */
  function relayoutWorld() {
    if (!battle) return;
    battle.relayout(rectOf(L.battle), L.battleCfg.nodeX);
    if (battleView) battleView.relayout(rectOf(L.battle));
    if (boardView) boardView.relayout(rectOf(L.board));
    if (cardView) cardView.resize(W, H, L.portrait);
    if (metaView) metaView.resize(W, H, L.portrait);
    if (forgeView) forgeView.resize(W, H, L.portrait);
    if (petChoose) petChoose.resize(W, H, L.portrait);
    if (petPanel) petPanel.cancel();   // 按钮位置随战场几何变，收起种植模式免得点歪
    evolveMenu = null;             // 旧坐标已失效，直接收起
  }

  function rectOf(r) { return { x: r.x, y: r.y, w: r.w, h: r.h }; }

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

    // 关卡数据接入层（编辑器挂载点①：启动期常量覆盖）
    // 编辑器导出的 levels.js 挂在 window.LEVEL_DATA；缺失时全部走游戏内默认值，
    // 行为与旧版完全一致。lanes/cols/nodeX 由响应式 Layout 决定，此处不覆盖。
    var _ld = (typeof window !== 'undefined' && window.LEVEL_DATA) ? window.LEVEL_DATA : null;
    var _lv = (_ld && _ld.levels && _ld.levels[0]) ? _ld.levels[0] : null;
    // 数值表覆盖层（挂载点⑦）：植物造价可由 tuning.economy.plantCost 覆盖（缺省回落默认）。
    // 注意：tuning 是「整包级」配置（window.LEVEL_DATA.tuning），统一驱动 Meta/Cards/Director/Battlefield。
    PLANT_COST = Object.assign(
      { sprout: 20, peashooter: 60, cabbagepult: 140, burningpomegranate: 100 },
      (_ld && _ld.tuning && _ld.tuning.economy && _ld.tuning.economy.plantCost) || {}
    );
    // 多关流程（#19）：记住编辑器导出的全部关卡；首关内容已在上面随 Battlefield 构造注入。
    // 关卡序号超出手工关卡数时固守最后一关、继续靠 levelScale 递增难度（无尽模式）。
    LEVELS = (_ld && _ld.levels && _ld.levels.length) ? _ld.levels : [];
    appliedLevelIdx = LEVELS.length ? 0 : -1;

    // 局内系统（每次重建）
    var battleOpts = {
      x: L.battle.x, y: L.battle.y, w: L.battle.w, h: L.battle.h,
      lanes: L.battleCfg.lanes, cols: L.battleCfg.cols, nodeX: L.battleCfg.nodeX,
      depth25d: L.depth25d, depthFar: L.depthFar,      // 钩子⑧：2.5D 梯形投影（默认关）
      seed: (Math.random() * 1e9) | 0
    };
    if (_lv) {
      if (Array.isArray(_lv.waves) && _lv.waves.length) battleOpts.waves = _lv.waves;        // 钩子①：波次表
      battleOpts.obstacles = (_lv.obstacles || []);                                          // 钩子②：障碍物几何
      battleOpts.display = _lv.display || null;                                              // 钩子③：显示缩放/偏移
      battleOpts.balance = _lv.balance || null;                                              // 钩子④：数值覆盖层（全局乘子/星枢血量）
      battleOpts.map = (_lv && _lv.map) ? _lv.map : null;                                    // 钩子⑤：地形（map.tiles / map.effects）
      battleOpts.tuning = (_ld && _ld.tuning) ? _ld.tuning : null;                           // 钩子⑥/⑦：数值表覆盖（敌人/植物/卡牌/经济常量）
    }
    battle = new global.Battlefield(battleOpts);
    var _boardT = (_lv && _lv.board) || {};
    board = new global.Board2048({ n: _boardT.n || 5, stepMax: _boardT.stepMax, stepRegen: _boardT.stepRegen, seed: (Math.random() * 1e9) | 0 });
    director = new global.Director({ board: board, battle: battle, tuning: (_ld && _ld.tuning) ? _ld.tuning : null });
    if (_lv && Array.isArray(_lv.roulette) && _lv.roulette.length === 6) director.roulette = _lv.roulette.slice();

    // 多关流程（#19 / 挂载点④延伸）：推进时按关卡序号把对应关卡内容（波次/障碍/显示/数值/轮盘）整体换上。
    // 关卡序号超出手工关卡数则固守最后一关（无尽递增难度）；同一关内容不重复重载。
    global.Bus.on(EV.CMD_NEXT_LEVEL, function (p) {
      var lv = (p && p.level) ? p.level : 1;
      if (!LEVELS.length) return;                       // 无外部关卡数据：行为与旧版一致（只升难度）
      var ai = Math.min(lv - 1, LEVELS.length - 1);
      if (ai < 0 || ai >= LEVELS.length) return;
      if (ai === appliedLevelIdx) return;               // 仍在最后一关无尽递增：只升难度，不改内容
      appliedLevelIdx = ai;
      var L = LEVELS[ai];
      battle.applyLevelContent(L);
      if (L && Array.isArray(L.roulette) && L.roulette.length === 6) director.roulette = L.roulette.slice();
    });

    battleView = new global.BattleView(battle, rectOf(L.battle));
    boardView = new global.BoardView(board, rectOf(L.board));
    boardView.director = director;

    fx = new global.FX();
    fx.battle = battle;

    // 持久系统：Bus.reset() 已清空它们的监听，必须重新绑定
    meta._bind();
    cards._bind();
    run._bind();
    pet._bind();
    forge._bind();

    // ★ 新世界 = 新的一局：场上没有培育植物，必须把出战登记清掉。
    //   不清的话，上一局中途刷新页面 / 直接换局，_battleId 会一直留着，
    //   结果整局都派不出宠物（canDeploy 恒返回「本局已派出」）。
    //   注意：**跨关**（CMD_NEXT_LEVEL）不重建世界，所以宠物会一直留在场上。
    pet.undeploy();

    // 视图（每次重建，构造里重新订阅事件）
    cardView = new global.CardView(cards, { w: W, h: H, portrait: L.portrait });
    metaView = new global.MetaView(meta, run, {
      w: W, h: H, portrait: L.portrait, onStart: startRun, pet: pet, forge: forge
    });

    // 宠物面板挂在战场左上角，战场换了要跟着换引用
    if (petPanel) { petPanel.setBattle(battle); petPanel.cancel(); }

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

  /** 是否处于模态层（选卡 / 决策 / 结算 / 家园 / 异变工坊 / 初次异变）—— 此时局内输入冻结 */
  function isModal() {
    if (petChoose && petChoose.visible) return true;      // 初次三选一：强制模态
    if (forge && forge.isOpen()) return true;             // 异变工坊
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
      if (e.key === 'Escape') {
        if (petPanel) petPanel.cancel();
        if (forge && forge.isOpen()) global.Bus.emit(EV.CMD_FORGE_CLOSE);
        evolveMenu = null;
        return;
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

    var down = null, downId = null;

    canvas.addEventListener('pointerdown', function (e) {
      var p = toLogical(e);
      if (isModal()) {
        // 模态层（选卡 / 家园 / 结算 / 异变工坊 / 初次异变）：按下即响应，手感更跟手
        if (petChoose && petChoose.visible) petChoose.onClick(p.x, p.y);
        else if (forge && forge.isOpen()) forgeView.onClick(p.x, p.y);
        else if (cardView.visible) cardView.onClick(p.x, p.y);
        else if (metaView && metaView.screen !== 'none') metaView.onClick(p.x, p.y);
        down = null;
        return;
      }
      down = p; downId = e.pointerId;
      // 捕获指针：手指滑出 canvas 也收得到 pointerup，不会「卡住」一次按下
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { }
    });

    canvas.addEventListener('pointerup', function (e) {
      if (isModal()) { down = null; downId = null; return; }
      if (!down || (downId !== null && e.pointerId !== downId)) return;
      var p = toLogical(e);
      var dx = p.x - down.x, dy = p.y - down.y;
      var ad = Math.abs(dx), ady = Math.abs(dy);
      var far = Math.max(ad, ady) > (L ? L.swipe : 26);

      if (far) {
        // 滑动 = 合成。
        // 原代码这里多挂了一个 !battle.waveRunning 的门槛：波次一开就滑不动，
        // 而波次是自动推进的（间隔仅 2.6s），等于绝大多数时间无法合成。已去掉。
        global.Bus.emit(EV.CMD_MOVE, { dir: ad > ady ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up') });
      } else {
        // 局内点击一律等到抬手再判定，且位移足够小才算点击 ——
        // 否则在战场上滑动合成时，起点落在植物上就会顺手种一棵。
        handleClick(p);
      }
      down = null; downId = null;
    });

    canvas.addEventListener('pointercancel', function () { down = null; downId = null; });
    canvas.addEventListener('pointermove', function (e) {
      var p = toLogical(e);
      if (petChoose && petChoose.visible) { petChoose.onMove(p.x, p.y); return; }
      if (forge && forge.isOpen()) { forgeView.onMove(p.x, p.y); return; }
      if (cardView && cardView.visible) cardView.onMove(p.x, p.y);
      else if (metaView && metaView.screen !== 'none') metaView.onMove(p.x, p.y);
      else if (petPanel) petPanel.onMove(p.x, p.y);
    });
  }

  /**
   * 生成进化菜单两项的位置。
   *
   * 关键取舍：菜单既要贴着被点的植物，又不能越出屏幕 / 被战场边缘切掉。
   * 这里用「整体平移」而不是逐项 clamp —— 逐项 clamp 会把两项朝中间挤，
   * 在竖屏（车道只有 ~102 高，而两张卡片就要 64×2）会直接叠在一起。
   */
  function makeEvolveMenu(best) {
    var bc = battle.cfg;
    var half = (L && L.small) ? 32 : 36;     // 卡片半高，竖屏小一号
    var span = half * 2 + 2;                 // 两项中心间距：刚好不重叠
    var pad = (L ? L.pad : 14) + 2;

    // 横向：默认挂植物右侧，右边放不下就翻到左侧
    var mx = best.x + half + 16;
    if (mx + half > W - pad) mx = best.x - half - 16;
    mx = Math.max(pad + half, Math.min(W - pad - half, mx));

    // 纵向：以植物为中心分布 N 项（当前 3 项：豌豆 / 卷心菜 / 燃芯石榴），越界则整体平移（保住间距）
    var EVOLVE_KINDS = ['peashooter', 'cabbagepult', 'burningpomegranate'];
    var n = EVOLVE_KINDS.length;
    var top = best.y - span * (n - 1) / 2, bot = top + span * (n - 1);
    var minY = bc.y + half + 2, maxY = bc.y + bc.h - half - 2;
    if (top < minY) { bot += minY - top; top = minY; }
    if (bot > maxY) { top -= bot - maxY; bot = maxY; }
    top = Math.max(minY, top);

    var items = [];
    for (var k = 0; k < n; k++) items.push({ kind: EVOLVE_KINDS[k], x: mx, y: top + span * k });

    return {
      lane: best.lane, col: best.col, x: best.x, y: best.y, t: 0, half: half,
      items: items
    };
  }

  function handleClick(p) {
    // 培育植物面板（战场左上角）：展开列表 / 点开「选点种植」模式
    if (petPanel && petPanel.onClick(p.x, p.y)) { evolveMenu = null; return true; }

    // 进化菜单优先
    if (evolveMenu) {
      var m = evolveMenu, hit = null;
      var hh = (m.half || 36) + 4;
      for (var i = 0; i < m.items.length; i++) {
        var it = m.items[i];
        if (Math.abs(p.x - it.x) < hh && Math.abs(p.y - it.y) < hh) { hit = it; break; }
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

    // 点击战场内的植物/空位（边界取自战场自己的 cfg，不再写死 14/610/52/628）
    var bc = battle.cfg;
    if (p.x >= bc.x && p.x <= bc.x + bc.w && p.y >= bc.y && p.y <= bc.y + bc.h) {
      var best = null, bd = 1e9;
      for (var l = 0; l < battle.cfg.lanes; l++) {
        for (var c = 0; c < battle.cfg.cols; c++) {
          // 命中判定要用投影后的坐标 —— 玩家看到的是投影画面，逻辑坐标会对不上
          var sx = battle.projX(battle.slotX(c), l), sy = battle.slotY(l);
          var d = Math.hypot(p.x - sx, p.y - sy);
          if (d < 40 && d < bd) { bd = d; best = { lane: l, col: c, x: sx, y: sy }; }
        }
      }
      if (!best) {
        // 种植模式下点到了战场空处 → 当作放弃（不取消的话，玩家会卡在这个模式里出不去）
        if (petPanel && petPanel.isPicking()) { petPanel.cancel(); return true; }
        return false;
      }
      // 培育植物「选点种植」模式：点哪格种哪格（与种牙苗共用同一套命中判定）
      if (petPanel && petPanel.isPicking()) return petPanel.plantAt(best);

      var plant = battle.plants.filter(function (q) { return q.lane === best.lane && q.col === best.col; })[0];
      if (plant && plant.kind === 'sprout') {
        evolveMenu = makeEvolveMenu(best);
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
    // 宠物：自然恢复（战斗中由 tick 自己冻结）+ 各视图动画
    if (pet) pet.tick();
    if (petPanel) petPanel.update(dt);
    if (forgeView) forgeView.update(dt);
    if (petChoose) petChoose.update(dt);
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

    // 培育植物面板画在战场层（modal 时不画）；异变工坊 / 初次异变是顶层模态
    if (petPanel && !isModal()) petPanel.draw(ctx);
    if (forge && forge.isOpen() && forgeView) forgeView.draw(ctx);
    if (petChoose && petChoose.visible) petChoose.draw(ctx);

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
    var c = director.currency;
    var items = [
      ['星核', Math.floor(c.star), '#b9a6ff'],
      ['金币', Math.floor(c.gold), '#ffd45e'],
      ['碎片', c.shard.toFixed(1), '#7fe0c0'],
      ['晶核', c.core, '#6fd6ff'],
      ['材料', c.material, '#ffb08a']
    ];
    var hx = (L && L.header) ? L.header : { x: 16, y: 0, w: W - 32, h: 44 };
    ctx.save();

    if (L && L.portrait) {
      // 竖屏只有 540 宽：副标题让位，货币从「数值 / 名字」两行压成「名字 数值」一行，
      // 从右往左排，能排下 5 项且不撞到标题
      ctx.font = '900 15px "Noto Sans SC", system-ui, sans-serif';
      ctx.fillStyle = '#eaf3ff'; ctx.textAlign = 'left';
      ctx.fillText('星序防线', hx.x, 24);

      var x = hx.x + hx.w;
      ctx.textAlign = 'right';
      for (var k = items.length - 1; k >= 0; k--) {
        var o = items[k];
        var label = o[0] + ' ' + o[1];
        ctx.font = '800 12px "Noto Sans SC", system-ui, sans-serif';
        var lw = ctx.measureText(label).width;
        ctx.fillStyle = o[2];
        ctx.fillText(label, x, 24);
        x -= lw + 13;
      }
    } else {
      ctx.font = '900 17px "Noto Sans SC", system-ui, sans-serif';
      ctx.fillStyle = '#eaf3ff'; ctx.textAlign = 'left';
      ctx.fillText('星序防线', hx.x, 26);
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.fillStyle = '#7d95b5';
      ctx.fillText('2048 合成 × 塔防 · v0.2 原型', hx.x + 76, 26);

      var x2 = hx.x + hx.w;
      ctx.textAlign = 'right';
      for (var i = items.length - 1; i >= 0; i--) {
        var it = items[i];
        ctx.font = '800 13px system-ui, sans-serif';
        ctx.fillStyle = it[2];
        ctx.fillText(it[1], x2, 20);
        ctx.font = '600 10px "Noto Sans SC", system-ui, sans-serif';
        ctx.fillStyle = '#6d819e';
        ctx.fillText(it[0], x2, 34);
        x2 -= Math.max(62, ctx.measureText(it[1]).width + 46);
      }
    }
    ctx.restore();
  }

  function drawWheel() {
    // 竖屏：轮盘独占屏幕底部一块「控制台」；横屏：沿用原版，画在棋盘面板内的底部
    var wheel = (L && L.portrait) ? L.wheel : null;
    var R = wheel || boardView.region;
    var cy = wheel ? (wheel.y + 34) : (R.y + R.h - 46);
    var r = 19, gap = 8;
    var n = director.roulette.length;
    var totalW = n * (r * 2 + gap) - gap;
    var sx = R.x + (R.w - totalW) / 2 + r;
    var rects = [];

    ctx.save();
    if (wheel) {
      global.roundRect(ctx, wheel.x, wheel.y, wheel.w, wheel.h, 14);
      ctx.fillStyle = 'rgba(20,32,52,.88)'; ctx.fill();
      ctx.strokeStyle = 'rgba(120,170,230,.22)'; ctx.lineWidth = 1.5; ctx.stroke();
    }
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
    var half = m.half || 36;
    ctx.save();
    // 连线
    ctx.strokeStyle = 'rgba(216,255,192,.6)'; ctx.lineWidth = 1.5;
    for (var i = 0; i < m.items.length; i++) {
      ctx.beginPath();
      ctx.moveTo(m.x, m.y - 14); ctx.lineTo(m.items[i].x - half, m.items[i].y);
      ctx.stroke();
    }
    for (var j = 0; j < m.items.length; j++) {
      var it = m.items[j];
      var afford = director.currency.gold >= PLANT_COST[it.kind];
      ctx.globalAlpha = afford ? 1 : 0.45;
      global.roundRect(ctx, it.x - half, it.y - half, half * 2, half * 2, 12);
      ctx.fillStyle = 'rgba(14,26,18,.94)'; ctx.fill();
      ctx.strokeStyle = afford ? '#9fe8b0' : '#6d819e'; ctx.lineWidth = 2; ctx.stroke();

      var icon = global.PlantArt.Art.icon[it.kind];
      global.PX.draw(ctx, icon, it.x, it.y + half * 0.56, { frame: 0, scale: half / 24 });

      ctx.font = '800 10px "Noto Sans SC", system-ui, sans-serif';
      ctx.fillStyle = '#dff3d8'; ctx.textAlign = 'center';
      ctx.fillText(global.PlantArt.KIND[it.kind].name, it.x, it.y + half * 0.81);
      ctx.font = '800 10px system-ui, sans-serif';
      ctx.fillStyle = afford ? '#ffd45e' : '#ff8f8f';
      ctx.fillText(PLANT_COST[it.kind] + ' 金', it.x, it.y - half * 0.66);
    }
    ctx.restore();
  }

  function drawHelp() {
    ctx.save();
    ctx.fillStyle = 'rgba(140,165,195,.75)';
    if (L && L.portrait) {
      // 竖屏底部空白没了（那里是轮盘控制台），提示压进控制台下方的空档；
      // 同时砍掉键盘说明 —— 手机上既没有方向键也没有 R 键
      ctx.font = '600 10px "Noto Sans SC", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('滑动 = 合成　点空位 = 种牙苗(' + PLANT_COST.sprout + '金)　点牙苗 = 进化',
        W / 2, L.wheel.y + 64);
      ctx.restore();
      return;
    }
    ctx.font = '600 10px "Noto Sans SC", system-ui, sans-serif';
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
    get boardView() { return boardView; },
    get battleView() { return battleView; },
    get layout() { return L; },
    get cards() { return cards; },
    get cardView() { return cardView; },
    get metaView() { return metaView; },
    get run() { return run; },
    get meta() { return meta; },
    startRun: startRun,
    showHome: showHome,
    // 给测试/编辑器用：算出指定格位上进化菜单的落点（不产生副作用）
    makeEvolveMenu: function (lane, col) {
      return makeEvolveMenu({ lane: lane, col: col, x: battle.projX(battle.slotX(col), lane), y: battle.slotY(lane) });
    }
  };
})(window);
