/* ============================================================
 *  smoke_editor.js —— 编辑器冒烟测试（Node + 假 DOM/Canvas）
 *
 *  目的：在不开浏览器的情况下把 editor/ 的脚本全部加载、挂载每个面板、
 *        跑若干帧，捕获运行时异常。
 *  用法：node debug/smoke_editor.js
 * ============================================================ */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const errors = [];

/* ---------------- 假 Canvas 2D ---------------- */
function makeCtx(canvas) {
  const grad = { addColorStop() { } };
  const ctx = {
    canvas,
    globalAlpha: 1, globalCompositeOperation: 'source-over',
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
    font: '', textAlign: 'start', textBaseline: 'alphabetic',
    shadowColor: '#000', shadowBlur: 0, imageSmoothingEnabled: true,
    save() { }, restore() { }, translate() { }, scale() { }, rotate() { }, transform() { }, setTransform() { },
    clearRect() { }, fillRect() { }, strokeRect() { }, rect() { }, clip() { },
    beginPath() { }, closePath() { }, moveTo() { }, lineTo() { }, arc() { }, arcTo() { },
    ellipse() { }, quadraticCurveTo() { }, bezierCurveTo() { }, fill() { }, stroke() { },
    fillText() { }, strokeText() { }, setLineDash() { }, drawImage() { },
    measureText(t) { return { width: String(t).length * 6 }; },
    createLinearGradient() { return grad; },
    createRadialGradient() { return grad; },
    createPattern() { return null; },
    getImageData(x, y, w, h) {
      const n = Math.max(1, (w | 0) * (h | 0) * 4);
      return { data: new Uint8ClampedArray(n), width: w | 0, height: h | 0 };
    },
    putImageData() { },
    createImageData(w, h) {
      return { data: new Uint8ClampedArray(Math.max(1, (w | 0) * (h | 0) * 4)), width: w | 0, height: h | 0 };
    }
  };
  return ctx;
}

/* ---------------- 假 DOM ---------------- */
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.attrs = {};
    this.listeners = {};
    this.className = '';
    this.value = '';
    this.checked = false;
    this._text = '';
    this._html = '';
    this.parentNode = null;
    this.clientWidth = 900;
    this.clientHeight = 600;
    this.files = null;
    this.rows = 2;
    const self = this;
    this.classList = {
      add(c) { if (!self._cls().includes(c)) self.className = (self.className + ' ' + c).trim(); },
      remove(c) { self.className = self._cls().filter(x => x !== c).join(' '); },
      toggle(c, on) { on ? this.add(c) : this.remove(c); },
      contains(c) { return self._cls().includes(c); }
    };
  }
  _cls() { return String(this.className || '').split(/\s+/).filter(Boolean); }
  setAttribute(k, v) {
    this.attrs[k] = v;
    if (k === 'class') this.className = v;
    else if (k === 'value') this.value = v;
    else if (k === 'checked') this.checked = true;
    else if (k === 'id') { this.id = v; DOC.__ids[v] = this; }
  }
  getAttribute(k) { return this.attrs[k]; }
  appendChild(c) { this.children.push(c); c.parentNode = this; return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  removeEventListener(t, f) {
    const a = this.listeners[t] || [];
    const i = a.indexOf(f); if (i >= 0) a.splice(i, 1);
  }
  dispatch(t, ev) { (this.listeners[t] || []).forEach(f => f.call(this, ev || {})); }
  click() { this.dispatch('click', { button: 0 }); }
  getContext() { this._ctx = this._ctx || makeCtx(this); return this._ctx; }
  getBoundingClientRect() {
    const w = parseFloat(this.style.width) || this.width || 900;
    const h = parseFloat(this.style.height) || this.height || 600;
    return { left: 0, top: 0, width: w, height: h, right: w, bottom: h };
  }
  select() { }
  focus() { }
  set textContent(v) { this._text = v; this.children = []; }
  get textContent() { return this._text; }
  set innerHTML(v) { this._html = v; this.children = []; }
  get innerHTML() { return this._html; }
  get firstChild() { return this.children[0] || null; }
  querySelectorAll(sel) { return this._find(sel, []); }
  querySelector(sel) { return this._find(sel, [])[0] || null; }
  _find(sel, out) {
    const m = /^([.#]?)([\w-]+)$/.exec(sel.trim());
    if (!m) return out;
    for (const c of this.children) {
      const hit = m[1] === '.' ? c._cls().includes(m[2]) :
        m[1] === '#' ? c.id === m[2] :
          c.tagName === m[2].toUpperCase();
      if (hit) out.push(c);
      c._find(sel, out);
    }
    return out;
  }
}

const DOC = {
  __ids: {},
  readyState: 'complete',
  createElement(tag) { return new El(tag); },
  getElementById(id) { return DOC.__ids[id] || null; },
  querySelector(s) { return BODY.querySelector(s); },
  querySelectorAll(s) { return BODY.querySelectorAll(s); },
  addEventListener(t, f) { (DOC.__ev = DOC.__ev || {})[t] = f; },
  execCommand() { return true; },
  activeElement: null
};
const BODY = new El('body');
DOC.body = BODY;

/* ---------------- 沙箱 ---------------- */
const rafs = [];
const sandbox = {
  console: {
    log: (...a) => console.log(...a),
    warn: (...a) => console.warn('[warn]', ...a),
    error: (...a) => { errors.push(a.map(String).join(' ')); console.error('[error]', ...a); }
  },
  document: DOC,
  devicePixelRatio: 1,
  addEventListener(t, f) { (sandbox.__wev = sandbox.__wev || {}), (sandbox.__wev[t] = sandbox.__wev[t] || []).push(f); },
  removeEventListener(t, f) {
    const a = (sandbox.__wev || {})[t] || [];
    const i = a.indexOf(f); if (i >= 0) a.splice(i, 1);
  },
  performance: { now: () => Date.now() },
  requestAnimationFrame: (fn) => { rafs.push(fn); return rafs.length; },
  cancelAnimationFrame: () => { },
  setTimeout, clearTimeout, setInterval, clearInterval,
  navigator: { clipboard: { writeText() { return Promise.resolve(); } } },
  localStorage: {
    _s: {},
    getItem(k) { return Object.prototype.hasOwnProperty.call(this._s, k) ? this._s[k] : null; },
    setItem(k, v) { this._s[k] = String(v); },
    removeItem(k) { delete this._s[k]; }
  },
  Blob: class Blob { constructor(p) { this.parts = p; } },
  URL: { createObjectURL() { return 'blob:x'; }, revokeObjectURL() { } },
  FileReader: class FileReader { readAsText() { } },
  Math, Date, JSON, Object, Array, String, Number, Boolean, Error, RegExp,
  Uint8ClampedArray, Uint8Array, Float32Array, Infinity, NaN, isNaN, parseInt, parseFloat, Promise
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

function run(file) {
  const p = path.join(ROOT, file);
  const code = fs.readFileSync(p, 'utf8');
  try {
    vm.runInContext(code, sandbox, { filename: file });
  } catch (e) {
    errors.push(file + ' :: ' + e.message);
    console.error('LOAD FAIL', file, e.message);
  }
}

function frames(n) {
  let t = 0;
  for (let i = 0; i < n; i++) {
    const cbs = rafs.splice(0);
    t += 16.7;
    cbs.forEach(fn => { try { fn(t); } catch (e) { errors.push('frame: ' + e.message); } });
  }
}

/* ---------------- 执行 ---------------- */
const GAME = [
  '3069antone/src/core/bus.js',
  '3069antone/src/core/rng.js',
  '3069antone/src/art/pixel.js',
  '3069antone/src/art/plantArt.js',
  '3069antone/src/art/insectArt.js',
  '3069antone/src/art/fx.js',
  '3069antone/src/systems/board2048.js',
  '3069antone/src/systems/battlefield.js',
  '3069antone/src/systems/director.js',
  '3069antone/src/view/battleView.js',
  '3069antone/src/view/boardView.js'
];
const EDITOR = [
  'editor/js/core.js', 'editor/js/data.js',
  'editor/js/panel-assets.js', 'editor/js/panel-scene.js', 'editor/js/panel-level.js',
  'editor/js/panel-map.js', 'editor/js/panel-export.js', 'editor/js/app.js'
];

// 预建 index.html 里的固定节点
['toasts', 'stage', 'linkState', 'saveState'].forEach(id => {
  const e = new El(id === 'stage' ? 'main' : 'div');
  e.setAttribute('id', id);
  BODY.appendChild(e);
});
const tabsHost = new El('div');
tabsHost.setAttribute('id', 'tabs');
BODY.appendChild(tabsHost);
['assets', 'scene', 'level', 'map', 'export'].forEach(k => {
  const b = new El('button');
  b.className = 'tab';
  b.dataset.panel = k;
  tabsHost.appendChild(b);
});

GAME.forEach(run);
console.log('游戏模块：', !!sandbox.Battlefield, !!sandbox.PlantArt, !!sandbox.BattleView);
EDITOR.forEach(run);

const ED = sandbox.ED;
if (!ED) { console.error('ED 未创建'); process.exit(1); }

// 触发 boot（DOMContentLoaded 已注册，readyState=complete 时 app.js 直接 boot）
setTimeout(() => {
  try {
    ED.app.go('assets'); frames(4);
    console.log('图鉴面板：ok');

    ED.app.go('scene'); frames(30);
    const sc = ED.Panels.scene;
    console.log('场景面板：', sc.mounted ? 'mounted' : 'SKIPPED',
      '| bf:', !!sc.bf, '| 敌人', sc.bf ? sc.bf.enemies.length : 0,
      '| 植物', sc.bf ? sc.bf.plants.length : 0);

    ED.app.go('level'); frames(2);
    console.log('关面板：ok | 关卡数', ED.Data.levels.length, '| 波数', ED.Data.cur().waves.length);

    ED.app.go('map'); frames(2);
    console.log('地图面板：ok |', ED.Data.cur().map.lanes + '×' + ED.Data.cur().map.cols);

    ED.app.go('export'); frames(2);
    const pkg = ED.Data.serialize();
    console.log('导出：', pkg.levels.length, '关 /', JSON.stringify(pkg).length, '字节');

    // 数据操作
    ED.Data.waveAdd();
    ED.Data.cur().waves[0].comp.push(['beetle', 2]);
    ED.Data.addLevel(ED.Data.cur());
    ED.app.go('level'); frames(2);
    console.log('新增关卡后：', ED.Data.levels.length);

    // 地图改动
    const L = ED.Data.cur();
    L.map.tiles[0][0] = 'mud';
    L.map.tiles[1][L.map.cols - 1] = 'spawn';
    ED.app.go('map'); frames(2);

    // 导入/导出往返
    const round = JSON.stringify(ED.Data.serialize());
    const n = ED.Data.importJSON(round);
    console.log('导入往返：', n, '关');

    // 场景重建 + 长跑：换成射手阵 + 打开自动合成，验证「合成→充能→附魔→击杀」全链路
    ED.Data.active = 0;
    ED.Data.cur().plants = [
      { lane: 0, col: 0, kind: 'peashooter' },
      { lane: 1, col: 0, kind: 'peashooter' },
      { lane: 2, col: 1, kind: 'cabbagepult' }
    ];
    ED.Panels.scene.rebuild();      // 强制按新布防重建战场
    ED.Panels.scene.autoPlay = true;
    ED.Panels.scene.godMode = true; // 只看输出链路，别让星枢先死
    frames(3600);   // ≈ 60 秒
    const bf = ED.Panels.scene.bf, dr = ED.Panels.scene.dir;
    console.log('模拟 30s 后：波次', ED.Panels.scene.waveIdx + 1,
      '| 存活', bf ? bf.enemies.length : 0,
      '| 击杀', bf ? bf.stats.kills : 0,
      '| 漏怪', bf ? bf.stats.leaks : 0,
      '| 星枢', bf ? Math.ceil(bf.nodeHp) : 0,
      '| 附魔 小/超载', dr ? dr.casts.small + '/' + dr.casts.overload : '-',
      '| 充能', dr ? Math.round(dr.charge) : '-');
    if (bf && bf.stats.kills === 0) errors.push('模拟 30s 后击杀数为 0 —— 战斗链路可能未跑通');

    // 再来一次所有面板，验证重复挂载
    ['assets', 'scene', 'level', 'map', 'export'].forEach(k => { ED.app.go(k); frames(6); });
    console.log('重复挂载：ok');

  } catch (e) {
    errors.push('主流程：' + e.stack);
    console.error(e);
  }

  console.log('\n===== 结果 =====');
  if (errors.length) {
    console.log('发现 ' + errors.length + ' 个错误：');
    errors.slice(0, 20).forEach(e => console.log(' - ' + e));
    process.exit(1);
  } else {
    console.log('无错误 ✅');
  }
}, 60);
