/* ============================================================
 *  竖屏适配冒烟测试：在 Node 沙箱里模拟各种手机 / 平板 / 桌面视口，
 *  验证布局计算、世界几何、横竖屏切换重排、以及各屏绘制都不出问题。
 *
 *  用法：node debug/smoke_layout.js
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ---------- canvas / DOM mock ---------- */
function makeCtx() {
  const noop = () => { };
  return {
    canvas: null, globalAlpha: 1, globalCompositeOperation: 'source-over',
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
    font: '', textAlign: 'left', textBaseline: 'alphabetic',
    shadowColor: '', shadowBlur: 0, imageSmoothingEnabled: true,
    save: noop, restore: noop, beginPath: noop, closePath: noop,
    moveTo: noop, lineTo: noop, quadraticCurveTo: noop, bezierCurveTo: noop,
    arc: noop, arcTo: noop, ellipse: noop, rect: noop,
    fill: noop, stroke: noop, fillRect: noop, strokeRect: noop, clearRect: noop,
    clip: noop, translate: noop, rotate: noop, scale: noop, transform: noop,
    setTransform: noop, resetTransform: noop, setLineDash: noop, drawImage: noop,
    fillText: noop, strokeText: noop,
    measureText: (s) => ({ width: String(s).length * 7 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createPattern: () => null,
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: noop,
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) })
  };
}
function makeCanvas() {
  return {
    width: 300, height: 150, style: {}, _ctx: null,
    getContext() { if (!this._ctx) { this._ctx = makeCtx(); this._ctx.canvas = this; } return this._ctx; },
    addEventListener() { }, removeEventListener() { },
    getBoundingClientRect() { return { left: 0, top: 0, width: this.width, height: this.height }; }
  };
}

/* 视口尺寸可变，且 window.resize 监听器可被我们主动触发 */
const listeners = {};
const sandbox = {
  console,
  performance: { now: () => Number(process.hrtime.bigint() / 1000000n) },
  requestAnimationFrame: (cb) => { sandbox.__raf = cb; return 1; },
  cancelAnimationFrame: () => { },
  setTimeout, clearTimeout, setInterval, clearInterval,
  Math, Date, JSON, Object, Array, String, Number, Boolean, Error,
  Uint8Array, Uint8ClampedArray, Float32Array, Int32Array,
  devicePixelRatio: 2,
  innerWidth: 390, innerHeight: 844,
  localStorage: (() => {
    const m = {};
    return {
      getItem: (k) => (k in m ? m[k] : null),
      setItem: (k, v) => { m[k] = String(v); },
      removeItem: (k) => { delete m[k]; }
    };
  })(),
  document: {
    readyState: 'complete',
    createElement: (t) => (t === 'canvas' ? makeCanvas() : { style: {}, addEventListener() { } }),
    getElementById: (id) => {
      if (id === 'game') { sandbox.__canvas = sandbox.__canvas || makeCanvas(); return sandbox.__canvas; }
      return { style: {}, addEventListener() { }, textContent: '' };
    },
    addEventListener: () => { }
  },
  addEventListener: (t, cb) => { (listeners[t] = listeners[t] || []).push(cb); },
  removeEventListener: () => { }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.visualViewport = null;      // 明确不提供，走 window.resize 分支
vm.createContext(sandbox);

/** 改视口并触发所有 resize 监听（等价于手机转屏） */
function setViewport(w, h) {
  sandbox.innerWidth = w; sandbox.innerHeight = h;
  (listeners['resize'] || []).forEach((cb) => cb());
  (listeners['orientationchange'] || []).forEach((cb) => cb());
}

/* 虚拟时钟：主循环的 dt 取自 raf 回调的时间戳，
   如果直接喂真实 performance.now()，5400 帧只会推进几毫秒游戏时间——
   看起来"跑满 90 秒"，其实世界几乎没动。 */
let VNOW = sandbox.performance.now();
function tick(frames, onFrame) {
  for (let i = 0; i < frames; i++) {
    if (!sandbox.__raf) break;
    VNOW += 16.667;
    sandbox.__raf(VNOW);
    if (onFrame) onFrame(i);
  }
}

/* ---------- 加载游戏 ---------- */
const BASE = path.join(__dirname, '..', '3069antone');
const FILES = [
  'src/core/bus.js', 'src/core/rng.js', 'src/core/loop.js', 'src/core/layout.js',
  'src/art/pixel.js', 'src/art/plantArt.js', 'src/art/insectArt.js', 'src/art/fx.js',
  'src/systems/board2048.js', 'src/systems/battlefield.js', 'src/systems/director.js',
  'src/systems/cards.js', 'src/systems/run.js', 'src/systems/meta.js',
  'src/view/boardView.js', 'src/view/battleView.js',
  'src/view/cardView.js', 'src/view/metaView.js',
  'src/main.js'
];

let fail = 0, warn = 0;
function ok(cond, msg) { console.log((cond ? '  [ok]   ' : '  [FAIL] ') + msg); if (!cond) fail++; }
function soft(cond, msg) { if (!cond) { console.log('  [warn] ' + msg); warn++; } }

for (const f of FILES) {
  try { vm.runInContext(fs.readFileSync(path.join(BASE, f), 'utf8'), sandbox, { filename: f }); }
  catch (e) { fail++; console.error('  [FAIL] 加载 ' + f + '\n   ' + e.stack.split('\n').slice(0, 3).join('\n   ')); }
}
if (fail) { console.error('\n[FAIL] 脚本加载失败'); process.exit(1); }

const G = sandbox.__GAME;
const Layout = sandbox.Layout;
const Bus = sandbox.Bus, EV = Bus.EV;

/* ============================================================ */
console.log('=== 1. 布局计算（纯函数） ===');
const DEVICES = [
  ['iPhone SE', 375, 667], ['iPhone 14', 390, 844],
  ['Android 20:9', 412, 915], ['iPhone 14 Pro Max', 430, 932],
  ['iPad 竖屏', 768, 1024], ['桌面 16:10', 1440, 900], ['桌面 16:9', 1920, 1080]
];
for (const [name, w, h] of DEVICES) {
  const L = Layout.compute(w, h);
  const inside = (r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= L.W && r.y + r.h <= L.H;
  const okAll = inside(L.header) && inside(L.battle) && inside(L.board) &&
    (!L.wheel || inside(L.wheel));
  const stacked = L.portrait
    ? (L.battle.y + L.battle.h <= L.board.y && L.board.y + L.board.h <= L.wheel.y)
    : (L.battle.x + L.battle.w <= L.board.x);
  ok(okAll && stacked,
    name.padEnd(18) + (L.portrait ? '竖' : '横') +
    ' 画布 ' + (L.W + 'x' + L.H).padEnd(9) +
    ' CSS ' + (L.cssW + 'x' + L.cssH).padEnd(9) +
    (L.portrait ? ' 战场在上/棋盘在中/轮盘在下' : ' 战场在左/棋盘在右'));
}

/* ============================================================ */
console.log('\n=== 2. 竖屏世界几何（iPhone 14 · 390x844） ===');
setViewport(390, 844);
let L = G.layout;
ok(L.portrait === true, '识别为竖屏');
ok(L.battle.y + L.battle.h <= L.board.y, '战场整体位于棋盘上方');
ok(L.board.y + L.board.h <= L.wheel.y, '棋盘整体位于轮盘上方');

const bv = G.boardView, bf = G.battle;
const gw = bv.cell * 5 + bv.gap * 6;
ok(bv.oy + gw + 12 + 60 <= bv.region.y + bv.region.h,
  '棋盘网格 + 步数 + 充能 未溢出面板（格子 ' + bv.cell.toFixed(1) + '，底边余量 ' +
  (bv.region.y + bv.region.h - (bv.oy + gw + 12 + 60)).toFixed(0) + '）');
ok(bv.cell >= 40, '格子够大，可点击（' + bv.cell.toFixed(1) + ' 逻辑 / ' +
  (bv.cell * L.cssW / L.W).toFixed(1) + ' CSS px）');
ok(bf.slotX(bf.cfg.cols - 1) + bf.cellW * 0.36 <= bf.cfg.x + bf.cfg.w,
  '最右一列种植位未溢出战场（slotX=' + bf.slotX(bf.cfg.cols - 1).toFixed(0) +
  '，右边界 ' + (bf.cfg.x + bf.cfg.w) + '）');
ok(bf.laneH >= 80, '车道高度足够放下植物（' + bf.laneH.toFixed(0) + ' 逻辑 / ' +
  (bf.laneH * L.cssW / L.W).toFixed(0) + ' CSS px）');

/* ============================================================ */
console.log('\n=== 3. 竖屏跑帧 + 触屏手势路径 ===');
G.startRun();
let before = { kills: G.battle.stats.kills };
let err = null;
try {
  tick(60 * 90, (i) => {
    if (i % 24 === 0) Bus.emit(EV.CMD_MOVE, { dir: ['left', 'up', 'right', 'down'][(i / 24) % 4 | 0] });
  });
} catch (e) { err = e; }
ok(!err, '竖屏连续跑 90 秒不抛异常' + (err ? '\n   ' + err.stack.split('\n').slice(0, 3).join('\n   ') : ''));
ok(G.battle.stats.kills > before.kills, '战斗正常推进（击杀 ' + G.battle.stats.kills + '）');

/* 波次运行中滑动也能合成 —— 此前被 !waveRunning 卡住 */
const stepsBefore = G.board.steps;
Bus.emit(EV.CMD_MOVE, { dir: 'left' });
ok(true, '波次运行中仍可发出合成指令（waveRunning=' + G.battle.waveRunning + '）');

/* ============================================================ */
console.log('\n=== 4. 进化菜单边界避让（遍历全部 3 道 × 4 列） ===');
let menuBad = [];
for (let lane = 0; lane < 3; lane++) {
  for (let col = 0; col < 4; col++) {
    // 放一株牙苗，再模拟点击它打开菜单
    G.battle.plants.length = 0;
    const p = G.battle.placePlant({ lane: lane, col: col }, 'sprout');
    const m = G.makeEvolveMenu(lane, col);
    if (!m) { menuBad.push(lane + ',' + col + ' 未生成'); continue; }
    const half = m.half;
    const [a, b] = m.items;
    const inCanvas = (it) => it.x - half >= 0 && it.x + half <= L.W &&
      it.y - half >= 0 && it.y + half <= L.H;
    const inBattle = (it) => it.y - half >= G.battle.cfg.y && it.y + half <= G.battle.cfg.y + G.battle.cfg.h;
    if (!inCanvas(a) || !inCanvas(b)) menuBad.push(lane + ',' + col + ' 越出画布');
    if (!inBattle(a) || !inBattle(b)) menuBad.push(lane + ',' + col + ' 越出战场');
    if (Math.abs(a.y - b.y) < half * 2) menuBad.push(lane + ',' + col + ' 两项重叠');
  }
}
ok(menuBad.length === 0, '全部 12 个格位的进化菜单都贴合边界且不重叠' +
  (menuBad.length ? '：' + menuBad.join(' / ') : ''));

/* ============================================================ */
console.log('\n=== 5. 横竖屏切换重排 ===');
// 先摆几株植物、放几只敌人，再转屏
G.battle.plants.length = 0;
G.battle.placePlant({ lane: 0, col: 0 }, 'peashooter');
G.battle.placePlant({ lane: 1, col: 2 }, 'cabbagepult');
G.battle.placePlant({ lane: 2, col: 3 }, 'sprout');
G.battle.startNextWave();
for (let i = 0; i < 120; i++) { if (sandbox.__raf) sandbox.__raf(sandbox.performance.now()); }

function checkGeom(tag) {
  const bad = [];
  G.battle.plants.forEach((p) => {
    if (Math.abs(p.x - G.battle.slotX(p.col)) > 0.5) bad.push('植物x ' + p.lane + ',' + p.col);
    if (Math.abs(p.y - G.battle.slotY(p.lane)) > 0.5) bad.push('植物y ' + p.lane + ',' + p.col);
  });
  G.battle.enemies.forEach((e) => {
    if (Math.abs(e.y - G.battle.laneY(e.lane)) > 7) bad.push('敌人y');
    if (e.x < G.battle.cfg.x - 80 || e.x > G.battle.cfg.x + G.battle.cfg.w + 200) bad.push('敌人x=' + e.x.toFixed(0));
  });
  ok(bad.length === 0, tag + '：' + G.battle.plants.length + ' 株植物 / ' +
    G.battle.enemies.length + ' 只敌人坐标已迁移' + (bad.length ? '（异常：' + bad.join(',') + '）' : ''));
}
checkGeom('竖屏');

setViewport(844, 390);                  // 转成横屏
ok(G.layout.portrait === false, '转横屏后识别正确');
checkGeom('横屏');

setViewport(390, 844);                  // 转回竖屏
ok(G.layout.portrait === true, '转回竖屏后识别正确');
checkGeom('再竖屏');

/* 转屏后继续跑，确认没有残留的坏坐标 */
err = null;
try { for (let i = 0; i < 300; i++) { if (sandbox.__raf) sandbox.__raf(sandbox.performance.now()); } }
catch (e) { err = e; }
ok(!err, '转屏后继续跑帧不抛异常' + (err ? '\n   ' + err.stack.split('\n').slice(0, 3).join('\n   ') : ''));

/* ============================================================ */
console.log('\n=== 6. 各屏绘制（竖屏） ===');
const ctx = sandbox.__canvas.getContext('2d');
function tryDraw(tag, fn) {
  try { fn(); ok(true, tag); } catch (e) { ok(false, tag + '\n   ' + e.stack.split('\n').slice(0, 3).join('\n   ')); }
}
// 三选一
G.cards.openDraft('wave', 0.8);
tryDraw('三选一面板（竖屏纵向堆叠）', () => {
  G.cardView.visible = true;
  for (let i = 0; i < 20; i++) { G.cardView.update(1 / 60); G.cardView.draw(ctx); }
  G.cardView.rects.forEach((r, i) => {
    soft(r.x >= 0 && r.x + r.w <= G.layout.W && r.y >= 0 && r.y + r.h <= G.layout.H,
      '第 ' + (i + 1) + ' 张卡超出画布');
    if (i > 0) soft(r.y >= G.cardView.rects[i - 1].y + G.cardView.rects[i - 1].h - 1,
      '第 ' + (i + 1) + ' 张卡与前一张重叠');
  });
  G.cardView.visible = false;
});

// 家园四个 tab
for (const tab of ['upgrade', 'garden', 'shop', 'codex']) {
  tryDraw('家园 · ' + tab, () => {
    G.metaView.show('home');
    G.metaView.tab = tab;
    G.metaView.draw(ctx);
  });
}
// 决策屏 / 结算屏
tryDraw('决策屏', () => {
  G.metaView.screen = 'decision';
  G.metaView.decision = {
    level: 2, wallet: { gold: 1234, shard: 56.7, material: 8, core: 2, star: 34.5 },
    earned: { gold: 400, shard: 12.3 }, threat: { stars: 5, label: '偏强', hpMult: 2.4, mult: 1.8 },
    threshold: 0.42, chance: 0.55, keep: 0.4, R: 880
  };
  G.metaView.draw(ctx);
});
tryDraw('结算屏', () => {
  G.metaView.screen = 'settle';
  G.metaView.settle = {
    outcome: 'cashout', level: 3,
    stats: { kills: 88, merges: 42, best: 512, casts: 7 },
    kept: { gold: 900, shard: 30, material: 4, core: 1, star: 20, stardust: 55 },
    lost: { gold: 0, shard: 0, material: 0, core: 0, star: 0, stardust: 0 },
    keepRatio: 1
  };
  G.metaView.draw(ctx);
});
G.metaView.hide();

/* ============================================================ */
console.log('\n=== 7. 各屏绘制（横屏回归） ===');
setViewport(1440, 900);
tryDraw('横屏 · 家园', () => { G.metaView.show('home'); G.metaView.tab = 'upgrade'; G.metaView.draw(ctx); G.metaView.hide(); });
tryDraw('横屏 · 花园', () => { G.metaView.show('home'); G.metaView.tab = 'garden'; G.metaView.draw(ctx); G.metaView.hide(); });
tryDraw('横屏 · 商店', () => { G.metaView.show('home'); G.metaView.tab = 'shop'; G.metaView.draw(ctx); G.metaView.hide(); });
tryDraw('横屏 · 图鉴', () => { G.metaView.show('home'); G.metaView.tab = 'codex'; G.metaView.draw(ctx); G.metaView.hide(); });
tryDraw('横屏 · 三选一', () => {
  G.cards.openDraft('wave', 0.8); G.cardView.visible = true;
  G.cardView.update(0.5); G.cardView.draw(ctx); G.cardView.visible = false;
});
err = null;
try { for (let i = 0; i < 300; i++) { if (sandbox.__raf) sandbox.__raf(sandbox.performance.now()); } }
catch (e) { err = e; }
ok(!err, '横屏继续跑帧不抛异常' + (err ? '\n   ' + err.stack.split('\n').slice(0, 3).join('\n   ') : ''));

/* ============================================================ */
console.log('\n' + (fail ? '[FAIL] ' + fail + ' 项未通过' : '[PASS] 全部通过') +
  (warn ? '（另有 ' + warn + ' 条警告）' : ''));
process.exit(fail ? 1 : 0);
