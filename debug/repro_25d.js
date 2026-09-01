/* ============================================================
 *  复现脚本：2.5D 投影开启后「游戏无法进入」
 *
 *  场景 A：默认关卡（障碍物为空）+ depth25d=true
 *  场景 B：五种障碍物各放一个 + depth25d=true（走到 _obstacle 立体分支）
 *
 *  用法：node debug/repro_25d.js
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
/* --real：用 @napi-rs/canvas 提供真实 2D 上下文。
   noop ctx 会把绘制期的 NaN / 非法颜色 / 抛错全部吞掉，
   而浏览器里这些恰恰是白屏或卡死的真凶。 */
let REAL = null;
if (process.argv.includes('--real')) {
  REAL = require('C:/Users/tabp/.workbuddy-ai/binaries/node/workspace/node_modules/@napi-rs/canvas');
  console.log('[真实 canvas 模式] 绘制调用会真正执行');
}
function makeCanvas(w, h) {
  if (REAL) {
    const c = REAL.createCanvas(w || 300, h || 150);
    if (!c.style) c.style = {};
    c.addEventListener = function () { };
    c.removeEventListener = function () { };
    c.getBoundingClientRect = function () { return { left: 0, top: 0, width: c.width, height: c.height }; };
    return c;
  }
  return {
    width: 300, height: 150, style: {}, _ctx: null,
    getContext() { if (!this._ctx) { this._ctx = makeCtx(); this._ctx.canvas = this; } return this._ctx; },
    addEventListener() { }, removeEventListener() { },
    getBoundingClientRect() { return { left: 0, top: 0, width: this.width, height: this.height }; }
  };
}

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
sandbox.visualViewport = null;
vm.createContext(sandbox);

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
  'src/view/cardView.js', 'src/view/metaView.js'
];
const MAIN = 'src/main.js';

let loadErr = null;
function load(f) {
  try { vm.runInContext(fs.readFileSync(path.join(BASE, f), 'utf8'), sandbox, { filename: f }); return true; }
  catch (e) { loadErr = e; console.error('[加载失败] ' + f + '\n' + e.stack.split('\n').slice(0, 5).join('\n')); return false; }
}
for (const f of FILES) { if (!load(f)) break; }

/* main.js 在加载期就会调 Layout.compute 并 buildWorld()，
   所以 patch 必须插在 main.js 之前 —— 等价于用户把 layout.js:69 改成 true */
const FORCE = process.argv[2] !== 'off';
if (FORCE && sandbox.Layout) {
  const _c = sandbox.Layout.compute;
  sandbox.Layout.compute = function (vw, vh) {
    const L = _c(vw, vh);
    L.depth25d = true;
    return L;
  };
}
if (!loadErr) load(MAIN);

function run(label, obstacleList) {
  console.log('\n=== ' + label + ' ===');
  sandbox.Layout.compute = sandbox.Layout.compute; // noop
  const G = sandbox.__GAME;
  if (!G) { console.log('  [FAIL] __GAME 未导出，main.js 初始化就没跑起来'); return; }

  // 触发一次 relayout 让新的 depth25d 生效
  sandbox.innerWidth = 390; sandbox.innerHeight = 844;
  (listeners['resize'] || []).forEach((cb) => cb());

  const bf = G.battle;
  console.log('  depth25d = ' + bf.cfg.depth25d + '，depthFar = ' + bf.cfg.depthFar +
    '，_cx = ' + (bf._cx === undefined ? 'undefined' : bf._cx.toFixed(1)));

  if (obstacleList) {
    try {
      bf.loadObstacles(obstacleList);
      bf._rebuildObstacleGeom();
      console.log('  已装载 ' + bf.obstacles.length + ' 个障碍物');
      bf.obstacles.forEach(function (o) {
        console.log('    ' + o.kind + ' L' + o.lane + 'C' + o.col +
          ' v=' + (o.v === undefined ? 'undefined' : o.v) +
          ' topZ=' + (o.topZ === undefined ? 'undefined' : o.topZ.toFixed(1)) +
          ' poly=' + (o.poly ? o.poly.length + '点' : 'undefined'));
      });
    } catch (e) {
      console.log('  [FAIL] 装载障碍物抛异常\n   ' + e.stack.split('\n').slice(0, 3).join('\n   '));
      return;
    }
  }

  let err = null;
  try {
    G.startRun();
    tick(60 * 90, function (i) {
      if (i % 24 === 0) sandbox.Bus.emit(sandbox.Bus.EV.CMD_MOVE, { dir: ['left', 'up', 'right', 'down'][(i / 24) % 4 | 0] });
      if (G.cards.pending && G.cards.pending.options[0]) {
        sandbox.Bus.emit(sandbox.Bus.EV.CMD_CARD_PICK, { id: G.cards.pending.options[0].id });
      }
      if (G.metaView.screen === 'decision') G.metaView.onClick(G.layout.W / 2, 0);
    });
  } catch (e) { err = e; }

  if (err) {
    console.log('  [FAIL] 跑帧抛异常：');
    console.log('   ' + err.stack.split('\n').slice(0, 6).join('\n   '));
  } else {
    console.log('  [ok] 跑 90 秒无异常（击杀 ' + bf.stats.kills + '）');
  }
}

if (!loadErr) {
  run('场景 A · 默认关卡（无障碍物）', null);

  const OBS = [
    { id: 'o1', kind: 'rock', lane: 0, col: 1, applied: true, shape: { pts: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] } },
    { id: 'o2', kind: 'boulder', lane: 1, col: 2, applied: true, shape: { pts: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] } },
    { id: 'o3', kind: 'crystal', lane: 2, col: 1, applied: true, shape: { pts: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] } },
    { id: 'o4', kind: 'stump', lane: 0, col: 3, applied: true, shape: { pts: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] } },
    { id: 'o5', kind: 'pillar', lane: 2, col: 3, applied: true, shape: { pts: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }, { x: 0.5, y: 0.5 }] } }
  ];
  run('场景 B · 五种障碍物（走立体分支）', OBS);
}
