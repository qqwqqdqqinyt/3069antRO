/* render_bee.js —— 用真实 Canvas（@napi-rs/canvas）栅格化蜜蜂精灵，
 * 验证：① BeeArt.build() 正常生成 Art.bee / Art.beePoke / Art.beeFlee；
 *       ② BeeAnimator.render() 返回的 sprite+pose 能真正画出像素（非空白）。
 * 若 PNG 里蜜蜂清晰可见 → 精灵本身健康，bug 在「运行时 global.BeeArt 缺失」一侧。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createCanvas } = require('C:/Users/tabp/.workbuddy-ai/binaries/node/workspace/node_modules/@napi-rs/canvas');

const ROOT = path.resolve(__dirname, '..');

// 真实 Canvas 作为 document.createElement('canvas') 的返回，其余元素用假对象
function makeFakeEl(tag) {
  return {
    tagName: String(tag).toUpperCase(),
    style: {}, dataset: {}, children: [],
    appendChild(c) { this.children.push(c); return c; },
    setAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, removeEventListener() {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    getContext() { return null; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 900, height: 600 }; }
  };
}
const DOC = {
  createElement(tag) {
    if (String(tag).toLowerCase() === 'canvas') {
      const c = createCanvas(1, 1);
      return c;
    }
    return makeFakeEl(tag);
  },
  getElementById() { return null; },
  querySelector() { return null; },
  addEventListener() {}, readyState: 'complete'
};

const sandbox = {
  console,
  document: DOC,
  devicePixelRatio: 1,
  Math, Date, JSON, Object, Array, String, Number, Boolean, Error, RegExp,
  Uint8ClampedArray, Uint8Array, Float32Array, Infinity, NaN, isNaN,
  parseInt, parseFloat, Promise,
  setTimeout, clearTimeout
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

function run(file) {
  const p = path.join(ROOT, file);
  const code = fs.readFileSync(p, 'utf8');
  vm.runInContext(code, sandbox, { filename: file });
}

// 只加载像素引擎 + 蜜蜂美术（不依赖游戏其余系统）
run('3069antone/src/core/bus.js');
run('3069antone/src/core/rng.js');
run('3069antone/src/art/pixel.js');
run('3069antone/src/art/beeArt.js');

const BeeArt = sandbox.BeeArt;
if (!BeeArt) { console.error('FAIL: BeeArt 未定义'); process.exit(1); }
BeeArt.build();
console.log('BeeArt.Art 键:', Object.keys(BeeArt.Art));
console.log('Art.bee 是精灵?', !!BeeArt.Art.bee && BeeArt.Art.bee.n, 'frames');

// 主画布
const W = 240, H = 160;
const main = createCanvas(W, H);
const ctx = main.getContext('2d');
ctx.imageSmoothingEnabled = false;
ctx.fillStyle = '#0b1220';
ctx.fillRect(0, 0, W, H);

const P = sandbox.PX;
const anim = new BeeArt.BeeAnimator('bee', 0.62, 0.5);

// 画三态：hover / poke / flee
const states = ['hover', 'poke', 'flee'];
let allPixels = 0;
const tiles = [40, 120, 200];
states.forEach((st, i) => {
  anim.state = st; anim.st = 0.3; anim.t = 0.5;
  const r = anim.render();
  const cx = tiles[i], cy = 80;
  // 复制 battleView 的蜜蜂分支：translate(lunge,bob) + rotate + draw
  ctx.save();
  ctx.translate(cx + (r.lunge || 0), cy + (r.bob || 0));
  if (r.rot) ctx.rotate(r.rot);
  P.draw(ctx, r.sprite, 0, 6, { frame: r.frame, scale: 3, flip: false, squash: 1, lean: 0, flash: 0 });
  ctx.restore();
  // 统计该区域非背景像素
  const im = ctx.getImageData(cx - 50, cy - 50, 100, 100).data;
  let cnt = 0;
  for (let p = 0; p < im.length; p += 4) {
    if (im[p] > 20 || im[p + 1] > 20 || im[p + 2] > 40) cnt++;
  }
  allPixels += cnt;
  console.log('态', st, '| 帧', r.frame, '| 该区非背景像素', cnt);
});

// 另存一张原始帧（Art.bee 第 0 帧）到角落实心验证
const f0 = BeeArt.Art.bee.frames[0];
ctx.drawImage(f0, 10, 10);

fs.writeFileSync(path.join(__dirname, 'bee_render.png'), main.toBuffer('image/png'));
console.log('\n写出 debug/bee_render.png | 总非背景像素', allPixels);
console.log(allPixels > 500 ? 'PASS: 蜜蜂精灵可正常栅格化 ✅' : 'WARN: 蜜蜂几乎不可见 ❌');
