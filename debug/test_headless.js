/* ============================================================
 *  无头集成测试：最小 DOM mock，在 Node 里跑「完整集成后」的游戏循环
 *  覆盖：合成 → 附魔 → 命中 → 清波 → 三选一 → 关卡决策 → 继续/收手 → 结算 → 重开
 *  GDD 集成后所有系统（Board/Battle/Director/Cards/Run/Meta）经 Bus 解耦，
 *  本测试只驱动 Bus 事件，验证整条链不抛异常且关键事件都触发。
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ---------- canvas / DOM mock ---------- */
function makeCtx() {
  const noop = () => {};
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
    addEventListener() {}, removeEventListener() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: this.width, height: this.height }; }
  };
}

/* 可复现的 Math.random —— cards.js 用它给卡牌 RNG 播种，
   不固定下来同一份代码每次跑出的卡组都不一样，600 秒长跑就成了抛硬币。 */
let __rseed = 0x2f6e2b1 >>> 0;
const MathStub = Object.create(Math);
MathStub.random = function () {
  __rseed = (Math.imul(__rseed, 1664525) + 1013904223) >>> 0;
  return __rseed / 4294967296;
};

const sandbox = {
  console,
  performance: { now: () => Number(process.hrtime.bigint() / 1000000n) },
  requestAnimationFrame: (cb) => { sandbox.__raf = cb; return 1; },
  cancelAnimationFrame: () => {},
  setTimeout, clearTimeout, setInterval, clearInterval,
  Math: MathStub, Date, JSON, Object, Array, String, Number, Boolean, Error,
  Uint8Array, Uint8ClampedArray, Float32Array, Int32Array,
  // 内存版 localStorage，模拟元游戏存档
  localStorage: (() => { const m = {}; return {
    getItem: (k) => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: (k) => { delete m[k]; }
  }; })(),
  document: {
    readyState: 'complete',
    createElement: (t) => (t === 'canvas' ? makeCanvas() : { style: {}, addEventListener() {} }),
    getElementById: (id) => {
      if (id === 'game') { sandbox.__canvas = sandbox.__canvas || makeCanvas(); return sandbox.__canvas; }
      return { style: {}, addEventListener() {}, textContent: '' };
    },
    addEventListener: () => {}
  },
  addEventListener: () => {}, removeEventListener: () => {}
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

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

let fail = 0;
for (const f of FILES) {
  const p = path.join(BASE, f);
  try {
    vm.runInContext(fs.readFileSync(p, 'utf8'), sandbox, { filename: f });
    console.log('  loaded  ' + f);
  } catch (e) {
    fail++;
    console.error('  FAILED  ' + f + '\n   ' + e.stack.split('\n').slice(0, 4).join('\n   '));
  }
}
if (fail) { console.error('\n[FAIL] 脚本加载失败'); process.exit(1); }

/* ---------- 自检 + 驱动 ---------- */
const G = sandbox.__GAME;
if (!G) { console.error('[FAIL] main.js 未导出 __GAME'); process.exit(1); }

console.log('\n--- 系统自检 ---');
console.log('  棋盘   ', G.board.n + 'x' + G.board.n, '| T' + G.board.tier, '| E=' + G.board.E(), '| 步数 ' + G.board.steps);
console.log('  战场   ', G.battle.cfg.lanes + ' 道 x ' + G.battle.cfg.cols + ' 列', '| 星枢 ' + G.battle.nodeHp);
console.log('  卡牌池 ', G.cards.constructor.POOL.length, ' 张 | 元养成分支', Object.keys(sandbox.Meta.UPGRADES).length);
console.log('  美术   ', Object.keys(sandbox.PlantArt.Art).length + ' 组植物, ' + Object.keys(sandbox.InsectArt.Art).length + ' 组昆虫');

const EV = sandbox.Bus.EV;
const counts = {};
// 注意：buildWorld 内 Bus.reset() 会清空 onAny 监听，必须在每次 startRun 之后重新挂上
const counter = (t) => { counts[t] = (counts[t] || 0) + 1; };
function watch() { sandbox.Bus.onAny(counter); }

// 开局直接进入战斗（绕过家园屏）
G.startRun();
watch();

// 驱动策略
const CASH_AFTER = 1;            // 第 1 次关卡决策继续，第 2 次收手
let decisions = 0, cashedOut = false, settleFrames = 0, restarts = 0;

const t0 = sandbox.performance.now();
const FRAMES = 60 * 600;         // 600 秒，足够打通多关并触发收手/重开
let err = null;
try {
  for (let i = 0; i < FRAMES; i++) {
    // 模拟玩家操作
    if (i % 30 === 0) {
      const dirs = ['left', 'up', 'right', 'down'];
      sandbox.Bus.emit(EV.CMD_MOVE, { dir: dirs[(i / 30) % 4 | 0] });
    }
    if (i === 200) sandbox.Bus.emit(EV.CMD_PLANT_EVOLVE, { slot: { lane: 0, col: 0 }, target: 'peashooter' });
    if (i === 240) { G.director.currency.gold += 600; sandbox.Bus.emit(EV.CMD_PLANT_EVOLVE, { slot: { lane: 1, col: 0 }, target: 'cabbagepult' }); }
    if (i === 280) { G.director.currency.gold += 600; sandbox.Bus.emit(EV.CMD_PLANT_EVOLVE, { slot: { lane: 2, col: 0 }, target: 'peashooter' }); }

    if (!sandbox.__raf) break;
    sandbox.__raf(t0 + i * 16.667);

    // —— 同屏模态自动处理（替代玩家点击）——
    // 1) 三选一：自动选第一张
    if (G.cards.pending && G.cards.pending.options[0]) {
      sandbox.Bus.emit(EV.CMD_CARD_PICK, { id: G.cards.pending.options[0].id });
    }
    // 2) 关卡决策：前几次继续，之后收手
    const mv = G.metaView;
    if (mv && mv.screen === 'decision') {
      decisions++;
      if (decisions <= CASH_AFTER) {
        sandbox.Bus.emit(EV.CMD_CONTINUE);
        if (mv) mv.hide();
      } else {
        cashedOut = true;
        sandbox.Bus.emit(EV.CMD_CASH_OUT);
        // 保留结算屏若干帧以验证 drawSettle 不抛异常
      }
    }
    // 3) 结算屏停留 30 帧后重开，验证 buildWorld 重新绑定
    if (mv && mv.screen === 'settle') {
      settleFrames++;
      if (settleFrames >= 30) { G.startRun(); watch(); restarts++; settleFrames = 0; }
    }
  }
} catch (e) { err = e; }

if (err) {
  console.error('\n[FAIL] 运行时异常:\n' + err.stack.split('\n').slice(0, 10).join('\n'));
  process.exit(1);
}

console.log('\n--- 600 秒模拟结果 ---');
const order = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
console.log('  事件计数（Top 12）:');
order.slice(0, 12).forEach(k => console.log('    ' + k.padEnd(22) + counts[k]));

console.log('\n  终局状态:');
console.log('    关卡/波次   第 ' + G.battle.level + ' 关 / 第 ' + G.battle.wave + ' 波');
console.log('    击杀/漏怪   ' + G.battle.stats.kills + ' / ' + G.battle.stats.leaks);
console.log('    星枢        ' + Math.ceil(G.battle.nodeHp) + ' / ' + G.battle.nodeMax);
console.log('    附魔次数    小 ' + G.director.casts.small + ' / 超载 ' + G.director.casts.overload);
console.log('    卡牌 PP     ' + G.cards.totalPP().toFixed(1) + '（已拿 ' + Object.keys(G.cards.owned).length + ' 种）');
console.log('    元游戏      星尘 ' + G.meta.profile.stardust + ' | 养成 ' + JSON.stringify(G.meta.profile.upgrades));
console.log('    决策/收手/重开  ' + decisions + ' / ' + (cashedOut ? 1 : 0) + ' / ' + restarts);

const checks = [
  ['合成事件', counts[EV.BOARD_MERGE] > 0],
  ['敌人生成', counts[EV.ENEMY_SPAWN] > 0],
  ['命中事件', counts[EV.ENEMY_HIT] > 0],
  ['清波触发', counts[EV.WAVE_CLEAR] > 0],
  ['三选一弹出', counts[EV.CARD_DRAFT] > 0],
  ['卡牌生效(MOD_CHANGED)', counts[EV.MOD_CHANGED] > 0],
  ['关卡决策弹出', counts[EV.RUN_DECISION] > 0],
  ['结算触发', counts[EV.RUN_GAME_OVER] > 0],
  ['元游戏存档吸收', G.meta.profile.stardust > 0 || G.meta.profile.upgrades.root > 0]
];
let allOk = true;
console.log('\n--- 断言 ---');
for (const [name, ok] of checks) { console.log('  ' + (ok ? '[PASS]' : '[FAIL]') + ' ' + name); if (!ok) allOk = false; }

console.log('\n' + (allOk ? '[PASS] 集成后整条事件链贯通，无异常' : '[FAIL] 部分断言未通过'));
process.exit(allOk ? 0 : 1);
