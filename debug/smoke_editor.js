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
  '3069antone/src/art/beeArt.js',
  '3069antone/src/art/fx.js',
  '3069antone/src/systems/board2048.js',
  '3069antone/src/systems/battlefield.js',
  '3069antone/src/systems/director.js',
  '3069antone/src/systems/cards.js',
  '3069antone/src/systems/meta.js',
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
if (sandbox.BeeArt && sandbox.BeeArt.build) sandbox.BeeArt.build();
console.log('游戏模块：', !!sandbox.Battlefield, !!sandbox.PlantArt, !!sandbox.BattleView);
EDITOR.forEach(run);

const ED = sandbox.ED;
if (!ED) { console.error('ED 未创建'); process.exit(1); }

// 防回归：编辑器入口 index.html 的 <script> 列表必须显式带上每个美术模块，
// 否则 window.BeeArt / window.Fx 等全局缺失 → 场景预览中「单位存在但看不见」。
// 注意：下面的 GAME 数组是手动按需喂入的，绕过了 <script> 链路 —— 这里专门盯 index.html。
const EDITOR_INDEX = path.join(ROOT, 'editor/index.html');
const editorHTML = fs.readFileSync(EDITOR_INDEX, 'utf8');
const requiredScripts = [
  'src/art/insectArt.js', 'src/art/beeArt.js', 'src/art/fx.js'
];
requiredScripts.forEach(rel => {
  if (!editorHTML.includes(rel)) {
    errors.push('editor/index.html 缺少 <script src="../3069antone/' + rel + '">');
  }
});
console.log('编辑器 index.html 脚本覆盖：', requiredScripts.every(r => editorHTML.includes(r)) ? 'ok' : '缺项');

// 触发 boot（DOMContentLoaded 已注册，readyState=complete 时 app.js 直接 boot）
setTimeout(() => {
  try {
    ED.app.go('assets'); frames(4);
    const aRoot = ED.Panels.assets.root;
    const dispCtls = aRoot.querySelectorAll('.disp-ctl');
    console.log('图鉴面板：ok | disp-ctl', dispCtls.length);
    if (!aRoot || !aRoot.children.length) errors.push('图鉴面板挂载失败（root 为空/未挂载）');
    if (dispCtls.length < 3) errors.push('显示参数控件未渲染（expect≥3，got ' + dispCtls.length + '）');

    // 端到端：改第一个显示控件（缩放）应写入 D.dispGet
    const dc = dispCtls[0];
    const inps = dc.querySelectorAll('input');
    if (inps.length) {
      inps[0].value = '5.5';
      inps[0].dispatch('change');
      const sv = ED.Data.dispGet('plants', 'sprout', null).scale;
      console.log('显示控件写入：', sv);
      if (sv !== 5.5) errors.push('显示控件改动未落到 D.dispGet（got ' + sv + '）');
      inps[0].value = '';
      inps[0].dispatch('change'); // 清除覆盖
    }

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

    // 新功能：障碍物 + 碰撞层 + 显示参数（走真实 UI 渲染路径）
    const mp = ED.Panels.map;
    ED.Data.active = 0;
    const o1 = ED.Data.obsAdd(0, 2, 'rock');
    const o2 = ED.Data.obsAdd(1, 3, 'boulder');
    o1.applied = false;                                   // 测试「未应用」开关
    ED.Data.obsSetBlock(o1, 'enemy', 'air', 1);
    ED.Data.obsSetBlock(o1, 'proj', 'arc', 1);
    ED.Data.dispSet('plants', 'peashooter', null, { scale: 3.4, oy: -6 });
    ED.Data.dispSet('plants', 'peashooter', 'L0C0', { ox: 12 });
    mp.selObs = o1;
    mp.renderObsPanel();                                  // 真实 DOM 构建路径
    ED.app.go('map'); frames(2);
    const pkg2 = ED.Data.serialize();
    const applied = ED.Data.obsApplied(ED.Data.cur());
    console.log('障碍物：', ED.Data.cur().obstacles.length, '个 | 已应用', applied.length,
      '| o1 挡 air/arc:', ED.Data.obsBlocks(o1, 'enemy', 'air'), ED.Data.obsBlocks(o1, 'proj', 'arc'),
      '| 实例 ox:', ED.Data.dispGet('plants', 'peashooter', 'L0C0').ox);
    if (ED.Data.cur().obstacles.length < 2) errors.push('障碍物未写入关卡数据');
    if (applied.length !== 1) errors.push('applied 过滤错误（应为 1）');
    if (!JSON.stringify(pkg2).includes('"obstacles"')) errors.push('导出缺少 obstacles 字段');
    if (!JSON.stringify(pkg2).includes('"display"')) errors.push('导出缺少 display 字段');

    // 验证游戏侧钩子（blocksAt + 几何 + 显示层合并）
    ED.app.go('scene');
    ED.Panels.scene.rebuild();
    ED.Data.obsAdd(0, 1, 'rock');   // rock 挡 ground、不挡 arc
    ED.Panels.scene.rebuild();
    var bfH = ED.Panels.scene.bf;
    var rockObs = bfH.obstacles.filter(function (o) { return o.kind === 'rock'; })[0];
    console.log('场景钩子：障碍物', bfH.obstacles.length,
      '| rock 挡 ground/arc:', rockObs ? bfH.obsBlocks(rockObs, 'enemy', 'ground') : '?', rockObs ? bfH.obsBlocks(rockObs, 'proj', 'arc') : '?',
      '| stopX:', rockObs ? Math.round(rockObs.stopX) : '-');
    if (!rockObs) errors.push('场景未载入 rock 障碍物');
    else {
      if (!bfH.obsBlocks(rockObs, 'enemy', 'ground')) errors.push('游戏侧 rock 应挡 ground');
      if (bfH.obsBlocks(rockObs, 'proj', 'arc')) errors.push('游戏侧 rock 不应挡 arc');
      if (rockObs.stopX === undefined) errors.push('障碍物几何未计算（缺 stopX）');
      // 敌人钳制：放在障碍右侧应被钳制，侵入后应被推回
      var e2 = bfH._spawnEnemy('grunt');
      e2.lane = 0; e2.v = 0; e2.x = rockObs.stopX + 40; e2.baseSpeed = 0.35; e2.y = bfH.laneY(0);
      var lim = bfH._enemyBlockX(e2);
      e2.x = rockObs.stopX - 5;          // 模拟已侵入障碍
      bfH.update(0.5);
      console.log('敌人钳制：lim', Math.round(lim), '| 推后 x', Math.round(e2.x));
      if (lim === -Infinity) errors.push('ground 敌人在 rock 列未被钳制');
      else if (e2.x < lim - 1) errors.push('敌人越过了障碍物（钳制失效）');
    }
    var dv = bfH.dispGet('plants', 'peashooter', 'L0C0');
    console.log('场景 dispGet L0C0:', JSON.stringify(dv));
    if (dv.ox !== 12) errors.push('场景未继承编辑器实例显示参数（ox 应为 12）');

    // 验证挂载点①：波次注入（opts.waves 归一化 + startNextWave 使用注入值）
    var bfW = new sandbox.Battlefield({
      x: 0, y: 0, w: 600, h: 400, lanes: 3, cols: 4, nodeX: 58,
      waves: [
        { t: 20, intent: 'i1', comp: [['grunt', 3]] },
        { t: 25, intent: 'i2', comp: [['swarm', 5]] }
      ]
    });
    console.log('波次注入：bf.waves', bfW.waves.length, '| 首波 t', bfW.waves[0].t);
    if (bfW.waves.length !== 2) errors.push('挂载点①：波次注入长度错误（应为 2）');
    else if (bfW.waves[0].t !== 20) errors.push('挂载点①：波次注入未归一化');
    bfW.startNextWave();
    console.log('首波出队：', bfW.spawnQueue.length, '| 累计波号', bfW.wave);
    if (bfW.wave !== 1 || bfW.spawnQueue.length !== 3) errors.push('挂载点①：startNextWave 未使用注入的波次');

    // 验证挂载点④：数值覆盖层（敌人乘子 + 植物乘子 + 星枢覆盖）
    var bfB = new sandbox.Battlefield({
      x: 0, y: 0, w: 600, h: 400, lanes: 3, cols: 4, nodeX: 58,
      balance: { enemyHp: 2.0, enemyDmg: 1.5, enemySpd: 0.5, plantDmg: 1.25, plantAspd: 2.0, nodeHp: 250 }
    });
    var gr = bfB._spawnEnemy('grunt');
    // grunt 关1基准：hp 95 / dmg 5 / speed 0.35；levelScale 关1 底数均为 1
    var expectHp = Math.round(95 * 2.0);
    console.log('数值覆盖：grunt hp', gr.hp, '| dmg', gr.dmg, '| spd', gr.baseSpeed.toFixed(3),
      '| mod.plantDmg', bfB.mod.plantDmg, '| mod.plantAspd', bfB.mod.plantAspd, '| nodeMax', bfB.nodeMax);
    if (gr.hp !== expectHp) errors.push('挂载点④：敌人 hp 未乘 enemyHp（got ' + gr.hp + '，应为 ' + expectHp + '）');
    if (Math.abs(gr.dmg - 5 * 1.5) > 1e-6) errors.push('挂载点④：敌人 dmg 未乘 enemyDmg');
    if (Math.abs(gr.baseSpeed - 0.35 * 0.5) > 1e-6) errors.push('挂载点④：敌人 spd 未乘 enemySpd');
    if (bfB.mod.plantDmg !== 1.25) errors.push('挂载点④：植物伤害乘子未生效（应为 1.25）');
    if (bfB.mod.plantAspd !== 2.0) errors.push('挂载点④：植物攻速乘子未生效（应为 2.0）');
    if (bfB.nodeMax !== 250 || bfB.nodeHp !== 250) errors.push('挂载点④：星枢血量未覆盖为 250');

    // 验证 #19：关卡内容切换（波次/障碍/数值/显示整体换上，波次计数重置）
    var L1 = { waves: [{ t: 20, intent: 'a', comp: [['grunt', 2]] }], obstacles: [], display: null,
               balance: { enemyHp: 1, enemyDmg: 1, enemySpd: 1, plantDmg: 1, plantAspd: 1, nodeHp: 100 } };
    var L2 = { waves: [{ t: 30, intent: 'b', comp: [['swarm', 4]] }],
               obstacles: [{ id: 'O1', lane: 0, col: 1, kind: 'rock', applied: true, collide: null, shape: null, note: '' }],
               display: null, balance: { enemyHp: 3, enemyDmg: 1, enemySpd: 1, plantDmg: 1, plantAspd: 1, nodeHp: 200 } };
    var bfC = new sandbox.Battlefield({ x: 0, y: 0, w: 600, h: 400, lanes: 3, cols: 4, nodeX: 58 });
    bfC.applyLevelContent(L1);
    var hp1 = bfC.nodeMax;
    bfC.applyLevelContent(L2);
    console.log('关卡切换：波次首 t', bfC.waves[0].t, '| 障碍', bfC.obstacles.length,
      '| nodeMax', hp1, '→', bfC.nodeMax, '| enemyHp 乘子', bfC.balance.enemyHp, '| 波次计数', bfC.wave);
    if (bfC.waves[0].t !== 30) errors.push('#19：切换后波次未更新');
    if (bfC.obstacles.length !== 1) errors.push('#19：切换后障碍物未载入');
    if (bfC.nodeMax !== 200) errors.push('#19：切换后星枢血量未覆盖为 200');
    if (bfC.balance.enemyHp !== 3) errors.push('#19：切换后数值覆盖层未更新');
    if (bfC.wave !== 0) errors.push('#19：切换后波次计数未重置');

    // 验证 #24：游戏侧统一数值表覆盖层（挂载点⑥/⑦）
    // tuning.enemies / tuning.plants / tuning.cards / tuning.economy 四路覆盖，
    // 缺省（无 tuning）须与硬编码默认值逐位一致 —— 编辑器缺席时游戏行为不变。
    var bfTune = new sandbox.Battlefield({
      x: 0, y: 0, w: 600, h: 400, lanes: 3, cols: 4, nodeX: 58,
      tuning: { enemies: { grunt: { hp: 200, dmg: 9 } }, plants: { peashooter: { dmg: 50 } } }
    });
    var rd = bfTune.roleDef('grunt'), pd = bfTune.plantDef('peashooter');
    console.log('#24 数值覆盖：grunt.hp', rd.hp, '| grunt.dmg', rd.dmg, '| peashooter.dmg', pd.dmg);
    if (rd.hp !== 200) errors.push('#24：tuning.enemies.grunt.hp 未生效（got ' + rd.hp + '）');
    if (rd.dmg !== 9) errors.push('#24：tuning.enemies.grunt.dmg 未生效（got ' + rd.dmg + '）');
    if (pd.dmg !== 50) errors.push('#24：tuning.plants.peashooter.dmg 未生效（got ' + pd.dmg + '）');
    // 缺省回落：不带 tuning 的实例应保留 ROLES/PLANTS 原值（grunt 基准 hp 95）
    var bfBase = new sandbox.Battlefield({ x: 0, y: 0, w: 600, h: 400, lanes: 3, cols: 4, nodeX: 58 });
    var rdBase = bfBase.roleDef('grunt');
    console.log('#24 缺省回落：grunt.hp', rdBase.hp, '（期望 95）');
    if (rdBase.hp !== 95) errors.push('#24：缺省未回落到 ROLES.grunt.hp=95（got ' + rdBase.hp + '）');

    // 卡牌覆盖：tuning.cards 改数值/展示字段，不改 apply() 与元素变体
    var cardsTune = new sandbox.Cards({ tuning: { cards: { sharp: { pp: 9, max: 5, name: '锋锐X' } } } });
    var sharp = sandbox.Cards.BY_ID.sharp;
    console.log('#24 卡牌覆盖：sharp.pp', sharp.pp, '| max', sharp.max, '| name', sharp.name);
    if (sharp.pp !== 9) errors.push('#24：tuning.cards.sharp.pp 未生效（got ' + sharp.pp + '）');
    if (sharp.max !== 5) errors.push('#24：tuning.cards.sharp.max 未生效（got ' + sharp.max + '）');
    if (sharp.name !== '锋锐X') errors.push('#24：tuning.cards.sharp.name 未生效（got ' + sharp.name + '）');

    // 经济常量覆盖（Director.K 实例副本）
    var dirTune = new sandbox.Director({ tuning: { economy: { EP_BASE: 999, CHARGE_MAX: 250 } } });
    console.log('#24 经济覆盖：Director.K.EP_BASE', dirTune.K.EP_BASE, '| CHARGE_MAX', dirTune.K.CHARGE_MAX);
    if (dirTune.K.EP_BASE !== 999) errors.push('#24：tuning.economy.EP_BASE 未生效（got ' + dirTune.K.EP_BASE + '）');
    if (dirTune.K.CHARGE_MAX !== 250) errors.push('#24：tuning.economy.CHARGE_MAX 未生效（got ' + dirTune.K.CHARGE_MAX + '）');
    var dirBase = new sandbox.Director({});
    if (dirBase.K.EP_BASE !== sandbox.Director.K.EP_BASE)
      errors.push('#24：缺省 Director.K.EP_BASE 未与模块默认一致');

    // 养成成本曲线覆盖（Meta.upgradeCost.base/pow）
    var metaTune = new sandbox.Meta({ tuning: { economy: { upgradeCostBase: 40, upgradeCostPow: 2 } } });
    var metaBase = new sandbox.Meta({});
    var costTune = metaTune.upCost(2);     // 40 * 2^1 = 80
    var costBase = metaBase.upCost(2);     // 40 * 1.3^1 ≈ 52
    console.log('#24 养成覆盖：upCost(2) 默认', costBase, '| 覆盖后', costTune);
    if (costTune !== 80) errors.push('#24：tuning.economy.upgradeCostPow 未生效（upCost(2)=' + costTune + '）');
    if (costBase !== Math.round(40 * Math.pow(1.30, 1))) errors.push('#24：缺省养成成本曲线异常（upCost(2)=' + costBase + '）');

    // 多关序号 → 关卡索引映射（超出手工关卡数则固守最后一关，无尽递增难度）
    var _map = function (level, n) { return Math.min(level - 1, n - 1); };
    var seq = [_map(1, 3), _map(2, 3), _map(3, 3), _map(4, 3), _map(5, 3)].join(',');
    console.log('关卡序号映射（3 关）：', seq);
    if (seq !== '0,1,2,2,2') errors.push('#19：关卡序号→索引映射错误（应为 0,1,2,2,2）');

    // 验证「蜜蜂」接入：可生成、飞行标记、动画器、越障、登场波次、编辑器图鉴
    var bfBee = new sandbox.Battlefield({ x: 0, y: 0, w: 600, h: 400, lanes: 3, cols: 4, nodeX: 58 });
    var bee = bfBee._spawnEnemy('bee');
    var beeOk = !!(bee && bee.kind === 'bee');
    var beeAnimOk = !!(bee && bee.anim && typeof bee.anim.render === 'function' && typeof bee.anim.beginPoke === 'function');
    var beeFlyOk = !!(bee && bee.flying === true);
    console.log('蜜蜂接入：生成', beeOk, '| 动画器', beeAnimOk, '| 飞行标记', beeFlyOk);
    if (!beeOk) errors.push('蜜蜂：_spawnEnemy("bee") 未产出 kind=bee');
    if (!beeAnimOk) errors.push('蜜蜂：未使用 BeeAnimator（缺少 render/beginPoke）');
    if (!beeFlyOk) errors.push('蜜蜂：未标记为飞行单位（flying）');

    // 飞行单位：岩石(air=0)不挡，巨石(air=1)挡（岩石 col1、巨石 col3，中间留空列）
    var bfF = new sandbox.Battlefield({ x: 0, y: 0, w: 600, h: 400, lanes: 1, cols: 4, nodeX: 58,
      obstacles: [
        { id: 'r', lane: 0, col: 1, kind: 'rock', applied: true, collide: null, shape: null, note: '' },
        { id: 'b', lane: 0, col: 3, kind: 'boulder', applied: true, collide: null, shape: null, note: '' }
      ] });
    var beeF = bfF._spawnEnemy('bee');
    var _rock = bfF.obstacles.filter(function (o) { return o.kind === 'rock'; })[0];
    var _boulder = bfF.obstacles.filter(function (o) { return o.kind === 'boulder'; })[0];
    beeF.x = _rock.cellRight + 5;                                // 两障碍之间的空列
    var limRock = bfF._enemyBlockX(beeF);
    beeF.x = bfF.cfg.x + bfF.cfg.w - 2;                         // 越过巨石
    var limBoulder = bfF._enemyBlockX(beeF);
    console.log('蜜蜂越障：岩石处限', limRock === -Infinity ? '∞(无)' : limRock.toFixed(1), '| 巨石处限', limBoulder === -Infinity ? '∞(无)' : limBoulder.toFixed(1));
    if (limRock !== -Infinity) errors.push('蜜蜂：岩石(air=0)不应阻挡飞行单位');
    if (limBoulder === -Infinity) errors.push('蜜蜂：巨石(air=1)应拦下飞行单位');

    // 登场：第 1 关最后一波
    var lastWave = sandbox.Battlefield.WAVES[sandbox.Battlefield.WAVES.length - 1];
    var hasBee = !!(lastWave && lastWave.comp.some(function (c) { return c[0] === 'bee' && c[1] >= 1; }));
    console.log('第 1 关最后一波含蜜蜂：', hasBee);
    if (!hasBee) errors.push('蜜蜂：未进入第一关最后一波');

    // 编辑器图鉴可见
    var edBeeOk = !!(ED.G.ROLES.bee && ED.G.INSECT_KIND.bee && ED.G.BeeArt && ED.G.BeeArt.Art.bee);
    console.log('编辑器图鉴：ROLES.bee', !!ED.G.ROLES.bee, '| INSECT_KIND.bee', !!ED.G.INSECT_KIND.bee, '| BeeArt 已构建', !!(ED.G.BeeArt && ED.G.BeeArt.Art.bee));
    if (!edBeeOk) errors.push('蜜蜂：编辑器未识别 bee（ROLES/INSECT_KIND/BeeArt 缺失）');

    // 地形（挂载点⑤）：让 map.tiles 真正影响游戏侧寻路
    // 单车道 4 列：grass / mud / hole / grass
    var tf = { mudSlow: 0.30, waterSlow: 0.15, waterIceTaken: 1.25 };
    var bfT = new sandbox.Battlefield({ x: 0, y: 0, w: 600, h: 400, lanes: 1, cols: 4, nodeX: 58,
      map: { version: 1, lanes: 1, cols: 4, tiles: [['grass', 'mud', 'hole', 'grass']], effects: tf } });
    var mudE = bfT._spawnEnemy('grunt');
    mudE.x = bfT.slotX(1); bfT.update(0.001);          // 摆到 mud 格，走一帧地形
    var mudRatio = mudE.baseSpeed / mudE._baseSpeed;
    console.log('地形·泥地减速：baseSpeed×', mudRatio.toFixed(3), '（期望 ≈0.70）');
    if (Math.abs(mudRatio - 0.70) > 1e-3) errors.push('地形：泥地未把速度降到 0.70（got ' + mudRatio.toFixed(3) + '）');

    var holeE = bfT._spawnEnemy('grunt');
    var holeCol = 2, holeCr = bfT.slotX(holeCol) + bfT.cellW / 2;
    holeE.x = bfT.slotX(holeCol); bfT.update(0.001);    // 摆到 hole 格，应被钳制在格右侧
    console.log('地形·空洞阻挡：钳制 x=', holeE.x.toFixed(1), '| 期望 ≥', (holeCr + 1).toFixed(1));
    if (holeE.x < holeCr + 1 - 1e-6) errors.push('地形：空洞未把敌人钳制在格右侧（got ' + holeE.x.toFixed(1) + '）');

    // 水洼冰系加成：同场建一个含 water 的棋盘，冰伤 ×1.25
    var bfW = new sandbox.Battlefield({ x: 0, y: 0, w: 600, h: 400, lanes: 1, cols: 3, nodeX: 58,
      map: { version: 1, lanes: 1, cols: 3, tiles: [['grass', 'water', 'grass']], effects: tf } });
    var wE = bfW._spawnEnemy('grunt'); wE.x = bfW.slotX(1); bfW.update(0.001);  // 站上水洼，_onWater=true
    var gE = bfW._spawnEnemy('grunt'); gE.x = bfW.slotX(0); bfW.update(0.001);  // 站草地上
    var wHp0 = wE.hp, gHp0 = gE.hp;
    bfW.damageEnemy(wE, 100, 'enchant:ice', 'ice');
    bfW.damageEnemy(gE, 100, 'enchant:ice', 'ice');
    var wLoss = wHp0 - wE.hp, gLoss = gHp0 - gE.hp;
    console.log('地形·水洼冰系：水面伤害', wLoss, '| 草地伤害', gLoss, '（期望 125 / 100）');
    if (Math.abs(wLoss - 125) > 1e-6) errors.push('地形：水洼上冰系未 ×1.25（got ' + wLoss + '）');
    if (Math.abs(gLoss - 100) > 1e-6) errors.push('地形：草地上冰系不应加成（got ' + gLoss + '）');

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
