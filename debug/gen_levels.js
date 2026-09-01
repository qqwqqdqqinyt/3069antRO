/* ============================================================
 *  gen_levels.js —— 一键把编辑器当前关卡导出为游戏可加载的 levels.js
 *
 *  与编辑器「下载 levels.js」按钮产出同一份字节（复用 ED.Data.serialize），
 *  因此与 Battlefield 的三个挂载点（waves / obstacles / display）100% 兼容。
 *  写完后就地自校验：读回文件 → new Battlefield({...}) 消费 → 断言关键字段。
 *
 *  用法：node debug/gen_levels.js
 * ============================================================ */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const errors = [];

/* ---------------- 假 Canvas 2D ---------------- */
function makeCtx() {
  const grad = { addColorStop() { } };
  return {
    canvas: null, globalAlpha: 1, globalCompositeOperation: 'source-over',
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
    font: '', textAlign: 'start', textBaseline: 'alphabetic',
    shadowColor: '#000', shadowBlur: 0, imageSmoothingEnabled: true,
    save() { }, restore() { }, translate() { }, scale() { }, rotate() { }, transform() { }, setTransform() { },
    clearRect() { }, fillRect() { }, strokeRect() { }, rect() { }, clip() { },
    beginPath() { }, closePath() { }, moveTo() { }, lineTo() { }, arc() { }, arcTo() { },
    ellipse() { }, quadraticCurveTo() { }, bezierCurveTo() { }, fill() { }, stroke() { },
    fillText() { }, strokeText() { }, setLineDash() { }, drawImage() { },
    measureText(t) { return { width: String(t).length * 6 }; },
    createLinearGradient() { return grad; }, createRadialGradient() { return grad; },
    createPattern() { return null; },
    getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(Math.max(1, (w | 0) * (h | 0) * 4)), width: w | 0, height: h | 0 }; },
    putImageData() { },
    createImageData(w, h) { return { data: new Uint8ClampedArray(Math.max(1, (w | 0) * (h | 0) * 4)), width: w | 0, height: h | 0 }; }
  };
}

/* ---------------- 假 DOM ---------------- */
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = []; this.style = {}; this.dataset = {}; this.attrs = {};
    this.listeners = {}; this.className = ''; this.value = ''; this.checked = false;
    this._text = ''; this._html = ''; this.parentNode = null;
    this.clientWidth = 900; this.clientHeight = 600; this.files = null; this.rows = 2;
    const self = this;
    this.classList = {
      add(c) { if (!self._cls().includes(c)) self.className = (self.className + ' ' + c).trim(); },
      remove(c) { self.className = self._cls().filter(x => x !== c).join(' '); },
      toggle(c, on) { on ? this.add(c) : this.remove(c); },
      contains(c) { return self._cls().includes(c); }
    };
  }
  _cls() { return String(this.className || '').split(/\s+/).filter(Boolean); }
  setAttribute(k, v) { this.attrs[k] = v; if (k === 'class') this.className = v; else if (k === 'value') this.value = v; else if (k === 'checked') this.checked = true; else if (k === 'id') { this.id = v; DOC.__ids[v] = this; } }
  getAttribute(k) { return this.attrs[k]; }
  appendChild(c) { this.children.push(c); c.parentNode = this; return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  removeEventListener(t, f) { const a = this.listeners[t] || []; const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); }
  dispatch(t, ev) { (this.listeners[t] || []).forEach(f => f.call(this, ev || {})); }
  click() { this.dispatch('click', { button: 0 }); }
  getContext() { this._ctx = this._ctx || makeCtx(); return this._ctx; }
  getBoundingClientRect() { const w = parseFloat(this.style.width) || this.width || 900; const h = parseFloat(this.style.height) || this.height || 600; return { left: 0, top: 0, width: w, height: h, right: w, bottom: h }; }
  select() { } focus() { }
  set textContent(v) { this._text = v; this.children = []; }
  get textContent() { return this._text; }
  set innerHTML(v) { this._html = v; this.children = []; }
  get innerHTML() { return this._html; }
  get firstChild() { return this.children[0] || null; }
  querySelectorAll(sel) { return this._find(sel, []); }
  querySelector(sel) { return this._find(sel, [])[0] || null; }
  _find(sel, out) {
    const m = /^([.#]?)([\w-]+)$/.exec(sel.trim()); if (!m) return out;
    for (const c of this.children) {
      const hit = m[1] === '.' ? c._cls().includes(m[2]) : m[1] === '#' ? c.id === m[2] : c.tagName === m[2].toUpperCase();
      if (hit) out.push(c); c._find(sel, out);
    }
    return out;
  }
}
const DOC = {
  __ids: {}, readyState: 'loading',
  createElement(tag) { return new El(tag); },
  getElementById(id) { return DOC.__ids[id] || null; },
  querySelector(s) { return BODY.querySelector(s); }, querySelectorAll(s) { return BODY.querySelectorAll(s); },
  addEventListener() { }, execCommand() { return true; }, activeElement: null
};
const BODY = new El('body'); DOC.body = BODY;

/* ---------------- 沙箱 ---------------- */
const sandbox = {
  console: { log: (...a) => console.log(...a), warn: (...a) => console.warn('[warn]', ...a), error: (...a) => { errors.push(a.map(String).join(' ')); console.error('[error]', ...a); } },
  document: DOC, devicePixelRatio: 1,
  addEventListener() { }, removeEventListener() { },
  performance: { now: () => Date.now() },
  requestAnimationFrame: () => 0, cancelAnimationFrame() { },
  setTimeout, clearTimeout, setInterval, clearInterval,
  navigator: { clipboard: { writeText() { return Promise.resolve(); } } },
  localStorage: { _s: {}, getItem(k) { return Object.prototype.hasOwnProperty.call(this._s, k) ? this._s[k] : null; }, setItem(k, v) { this._s[k] = String(v); }, removeItem(k) { delete this._s[k]; } },
  Blob: class Blob { constructor(p) { this.parts = p; } }, URL: { createObjectURL() { return 'blob:x'; }, revokeObjectURL() { } }, FileReader: class FileReader { readAsText() { } },
  Math, Date, JSON, Object, Array, String, Number, Boolean, Error, RegExp,
  Uint8ClampedArray, Uint8Array, Float32Array, Infinity, NaN, isNaN, parseInt, parseFloat, Promise
};
sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);

function run(file) {
  const p = path.join(ROOT, file);
  const code = fs.readFileSync(p, 'utf8');
  try { vm.runInContext(code, sandbox, { filename: file }); }
  catch (e) { errors.push(file + ' :: ' + e.message); console.error('LOAD FAIL', file, e.message); }
}

const GAME = [
  '3069antone/src/core/bus.js', '3069antone/src/core/rng.js', '3069antone/src/core/loop.js', '3069antone/src/core/layout.js',
  '3069antone/src/art/pixel.js', '3069antone/src/art/plantArt.js', '3069antone/src/art/insectArt.js', '3069antone/src/art/beeArt.js', '3069antone/src/art/fx.js',
  '3069antone/src/systems/board2048.js', '3069antone/src/systems/battlefield.js', '3069antone/src/systems/director.js',
  '3069antone/src/view/battleView.js', '3069antone/src/view/boardView.js',
  '3069antone/src/systems/cards.js', '3069antone/src/systems/run.js', '3069antone/src/systems/meta.js',
  '3069antone/src/view/cardView.js', '3069antone/src/view/metaView.js'
];
const EDITOR = [
  'editor/js/core.js', 'editor/js/data.js',
  'editor/js/panel-assets.js', 'editor/js/panel-scene.js', 'editor/js/panel-level.js',
  'editor/js/panel-map.js', 'editor/js/panel-export.js', 'editor/js/app.js'
];

GAME.forEach(run);
EDITOR.forEach(run);
const ED = sandbox.ED;
if (!ED) { console.error('ED 未创建'); process.exit(1); }

/* ---------------- 生成 levels.js ---------------- */
ED.Data.load();                       // 无本地草稿 → 用默认关卡（= 游戏内建 WAVES）
const pkg = ED.Data.serialize();
const header =
  '/* ============================================================\n' +
  ' *  levels.js —— 由「星序防线 · 编辑器」生成，请勿手改\n' +
  ' *  生成时间：' + pkg.generatedAt + '\n' +
  ' *  数据源：' + pkg.source + '\n' +
  ' *  用法：在 index.html 里 <script src="src/main.js"></script> 之前引入本文件\n' +
  ' * ============================================================ */\n';
const text = header + 'window.LEVEL_DATA = ' + JSON.stringify(pkg, null, 2) + ';\n';

const outDir = path.join(ROOT, '3069antone/src/data');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'levels.js');
fs.writeFileSync(outFile, text);
console.log('已生成', outFile, '(', text.length, '字节 /', pkg.levels.length, '关 )');

/* ---------------- 自校验：文件能被游戏侧挂载点消费 ---------------- */
try {
  vm.runInContext(fs.readFileSync(outFile, 'utf8'), sandbox);
  const LD = sandbox.window.LEVEL_DATA;
  const L = LD.levels[0];
  const bf = new sandbox.Battlefield({
    x: 0, y: 0, w: 600, h: 400, lanes: L.battle.lanes, cols: L.battle.cols, nodeX: L.battle.nodeX,
    waves: L.waves, obstacles: L.obstacles, display: L.display
  });
  console.log('自校验：bf.waves', bf.waves.length, '| obstacles', bf.obstacles.length,
    '| dispGet(plants,sprout):', JSON.stringify(bf.dispGet('plants', 'sprout', null)));
  if (bf.waves.length !== L.waves.length) errors.push('自校验失败：waves 长度不符');
  if (!Array.isArray(bf.obstacles)) errors.push('自校验失败：obstacles 未载入');
} catch (e) {
  errors.push('自校验异常：' + e.message);
}

console.log('\n===== 结果 =====');
if (errors.length) { errors.slice(0, 20).forEach(e => console.log(' - ' + e)); process.exit(1); }
console.log('无错误 ✅');
