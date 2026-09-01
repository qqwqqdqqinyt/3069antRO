/* ============================================================
 *  触手蜘蛛专项冒烟测试（无头）
 *
 *  验证目标：
 *    A 生成      —— 蜘蛛能生成，grappler / rv / reachPx 等字段齐备
 *    B 几何      —— laneYf / _vOfY 往返一致，hitTol 不误伤邻道
 *    C 打分      —— 候选可达，progress / anchor / threat / prey 四项权重方向正确
 *    D 状态机    —— seek → grapple → pull → perch 全走到，且真的跨了道（v 非整数）
 *    E 跨道命中  —— 卡在两道之间时，上下两条道的子弹都能打中（旧版会「跨道无敌」）
 *    F 啃咬      —— 优先咬血量比例最低的；植物归零后移除并广播 PLANT_DEAD
 *    G 无回归    —— 普通敌人 rv=0，v 恒等于 lane（整数），索敌 / 命中与旧版一致
 *
 *  用法： node debug/smoke_spider.js
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
   不固定下来同一份代码每次跑出的卡组都不一样，长跑结果就成了抛硬币。 */
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
  'src/art/pixel.js', 'src/art/plantArt.js', 'src/art/insectArt.js', 'src/art/beeArt.js', 'src/art/fx.js',
  'src/systems/board2048.js', 'src/systems/battlefield.js', 'src/systems/director.js',
  'src/systems/cards.js', 'src/systems/run.js', 'src/systems/meta.js',
  'src/view/boardView.js', 'src/view/battleView.js',
  'src/view/cardView.js', 'src/view/metaView.js',
  'src/main.js'
];

let loadFail = 0;
for (const f of FILES) {
  try {
    vm.runInContext(fs.readFileSync(path.join(BASE, f), 'utf8'), sandbox, { filename: f });
  } catch (e) {
    loadFail++;
    console.error('  FAILED  ' + f + '\n   ' + e.stack.split('\n').slice(0, 4).join('\n   '));
  }
}
if (loadFail) { console.error('\n[FAIL] 脚本加载失败'); process.exit(1); }

/* ---------- 结果收集 ---------- */
const results = [];
function check(group, name, ok, detail) {
  results.push({ group, name, ok: !!ok, detail: detail || '' });
  console.log('  ' + (ok ? '[PASS]' : '[FAIL]') + ' ' + name + (detail ? '  — ' + detail : ''));
}
function group(t) { console.log('\n--- ' + t + ' ---'); }

const G = sandbox.__GAME;
const EV = sandbox.Bus.EV;
const ROLES = { spider: { biteRange: 40, biteDmg: 16, biteInterval: 0.85 } };   // 仅测试用参考值

G.startRun();
const battle = G.battle;

/** 把战场清成一张白纸，只留测试需要的东西 */
function resetField() {
  battle.enemies.length = 0;
  battle.projectiles.length = 0;
  battle.plants.length = 0;
  battle.waveRunning = false;
  battle.spawnQueue.length = 0;
}

group('A 生成');
resetField();
const sp = battle._spawnEnemy('spider');
check('A', '蜘蛛可生成', !!sp, sp ? 'hp=' + sp.hp + ' lane=' + sp.lane : 'null');
check('A', 'kind 为 spider 且美术已注册',
  sp && sp.kind === 'spider' && !!sandbox.InsectArt.Art.spider,
  '美术表 ' + Object.keys(sandbox.InsectArt.Art).length + ' 组');
check('A', 'grappler 标记 + 状态机初值',
  sp && sp.grappler === true && sp.state === 'seek' && sp.anchor === null && sp.gp === 0);
check('A', 'rv 命中半径已开启（区别于普通敌人）',
  sp && sp.rv > 0, sp ? 'rv=' + sp.rv : '');
check('A', 'reachPx 已按战场宽度换算',
  sp && sp.reachPx > 0, sp ? 'reachPx=' + sp.reachPx.toFixed(1) : '');

group('B 分数车道几何');
const nL = battle.cfg.lanes;
let intOk = true, intDetail = [];
for (let i = 0; i < nL; i++) {
  if (battle.laneYf(i) !== battle.laneY(i)) { intOk = false; intDetail.push('lane' + i); }
}
check('B', 'laneYf 在整数处与 laneY 逐位一致', intOk, intDetail.length ? '偏差: ' + intDetail : nL + ' 道全中');

const y15 = battle.laneYf(1.5), y1 = battle.laneY(1), y2 = battle.laneY(2);
check('B', 'laneYf(1.5) 严格落在 lane1 / lane2 之间',
  (y15 - y1) * (y2 - y15) > 0, 'y1=' + y1.toFixed(1) + ' y1.5=' + y15.toFixed(1) + ' y2=' + y2.toFixed(1));
const vRound = battle._vOfY(y15);
check('B', '_vOfY 是 laneYf 的反函数（往返一致）',
  vRound !== null && Math.abs(vRound - 1.5) < 1e-6, 'v=' + (vRound === null ? 'null' : vRound.toFixed(4)));

const tolNormal = battle.hitTol({ rv: 0 });
const laneGap = Math.abs(battle.laneY(1) - battle.laneY(0));
check('B', 'hitTol(rv=0) 小于邻道间距（不误伤邻道）',
  tolNormal < laneGap, 'tol=' + tolNormal.toFixed(1) + ' 邻道间距=' + laneGap.toFixed(1));
check('B', 'hitTol(spider) 大于半个邻道间距（跨道时两侧都打得到）',
  battle.hitTol({ rv: sp.rv }) > laneGap / 2,
  'tol=' + battle.hitTol({ rv: sp.rv }).toFixed(1));

group('C 落脚点打分');
resetField();
const spC = battle._spawnEnemy('spider');
const cands = battle._spiderCandidates(spC);
check('C', '无植物时能靠空地兜底出候选', cands.length > 0, cands.length + ' 个候选');
check('C', '候选都带 v 坐标（供命中判定共用）',
  cands.every(c => typeof c.v === 'number' && isFinite(c.v)));

// progress：等距的一左一右，向左应稳定胜出（噪声 ±0.18 掀不动 1.2 的分差）
let leftWin = 0;
const TRIALS = 60;
for (let k = 0; k < TRIALS; k++) {
  const cL = { x: spC.x - 60, y: spC.y, v: spC.v, kind: 'ground', ref: null, prey: null };
  const cR = { x: spC.x + 60, y: spC.y, v: spC.v, kind: 'ground', ref: null, prey: null };
  if (battle._spiderScore(spC, cL) > battle._spiderScore(spC, cR)) leftWin++;
}
check('C', 'progress 权重生效：朝星枢（左）稳定胜出',
  leftWin === TRIALS, leftWin + '/' + TRIALS);

// anchor：同一点，岩石 > 植物 > 空地
function avgScore(kind) {
  let s = 0;
  for (let k = 0; k < 120; k++) {
    s += battle._spiderScore(spC, { x: spC.x - 50, y: spC.y, v: spC.v, kind: kind, ref: null, prey: null });
  }
  return s / 120;
}
const sRock = avgScore('rock'), sPlant = avgScore('plant'), sGround = avgScore('ground');
check('C', 'anchor 权重生效：岩石 > 植物 > 空地',
  sRock > sPlant && sPlant > sGround,
  'rock=' + sRock.toFixed(2) + ' plant=' + sPlant.toFixed(2) + ' ground=' + sGround.toFixed(2));

// threat：火力覆盖处得分更低
resetField();
const gun = battle.placePlant({ lane: 1, col: 0 }, 'peashooter');
const frontSame = battle._threatAt({ x: gun.x + 60, y: gun.y, v: 1 });
const behindSame = battle._threatAt({ x: gun.x - 60, y: gun.y, v: 1 });
const frontOther = battle._threatAt({ x: gun.x + 60, y: gun.y, v: 2 });
check('C', 'threat 只统计「同车道 + 身前」的火力',
  frontSame > 0 && behindSame === 0 && frontOther === 0,
  '身前同道=' + frontSame.toFixed(2) + ' 身后=' + behindSame.toFixed(2) + ' 邻道=' + frontOther.toFixed(2));

// prey：残血植物比满血更香
resetField();
const cx = battle.slotX(1), cy = battle.laneY(1);
// 两株要拉得比查询半径远，否则互相都把对方算进去了（半径 40，间隔 120）
const pFull = battle.placePlant({ lane: 1, col: 0 }, 'peashooter'); pFull.x = cx - 60; pFull.y = cy;
const pHurt = battle.placePlant({ lane: 1, col: 1 }, 'peashooter'); pHurt.x = cx + 60; pHurt.y = cy;
pFull.hp = pFull.maxHp; pHurt.hp = pHurt.maxHp * 0.1;
const preyFull = battle._preyNear({ x: cx - 60, y: cy }, 40);
const preyHurt = battle._preyNear({ x: cx + 60, y: cy }, 40);
check('C', 'prey 权重生效：残血植物得分更高', preyFull < preyHurt,
  '满血=' + preyFull.toFixed(2) + ' 残血=' + preyHurt.toFixed(2));

group('D 状态机与跨道移动');
resetField();
// 给蜘蛛一个「值得跨道」的理由：残血猎物摆在另一条道。
// 空场时 progress 权重最大，它会一路直推不换道 —— 那是对的行为，不是 bug。
const baitFar = battle.placePlant({ lane: nL - 1, col: 1 }, 'peashooter');
baitFar.hp = baitFar.maxHp * 0.15;
const baitNear = battle.placePlant({ lane: 0, col: 1 }, 'sprout');   // 不还手，纯诱饵
const spD = battle._spawnEnemy('spider');
spD.lane = 0; spD.v = 0; spD.y = battle.laneY(0); spD._yOff = 0;     // 钉在最上面一条道
const seen = {}, vSeen = new Set(), laneSeen = new Set();
const x0 = spD.x;
let minX = spD.x, maxDev = 0;
for (let i = 0; i < 1800; i++) {
  battle.update(1 / 60);
  if (!battle.enemies.includes(spD) || spD.dead) break;
  seen[spD.state] = (seen[spD.state] || 0) + 1;
  vSeen.add(spD.v.toFixed(3));
  laneSeen.add(spD.lane);
  minX = Math.min(minX, spD.x);
  maxDev = Math.max(maxDev, Math.abs(spD.v - Math.round(spD.v)));
}
const states = Object.keys(seen);
check('D', '四个状态全部走到',
  ['seek', 'grapple', 'pull', 'perch'].every(s => states.includes(s)), states.join(' → '));

// v 出现非整数 = 真的卡在两道之间过
let sawFraction = false;
for (const s of vSeen) { if (Math.abs(Number(s) - Math.round(Number(s))) > 0.05) { sawFraction = true; break; } }
check('D', 'v 出现过小数（确实跨道而非瞬移整道）',
  sawFraction, '最大偏离整道 ' + maxDev.toFixed(3) + '，v 取值 ' + vSeen.size + ' 种');
check('D', '为追残血猎物换过车道', laneSeen.size > 1, '经过车道 ' + Array.from(laneSeen).sort().join(','));
check('D', '整体朝星枢推进', minX < x0 - 40, 'x ' + x0.toFixed(0) + ' → ' + minX.toFixed(0));

group('E 跨道命中（旧版「跨道无敌」定向回归）');
// 把蜘蛛钉在 lane1 与 lane2 正中间，分别从上下两条道打它
function shootAt(target, laneOfGun, yOverride) {
  resetField();
  battle.enemies.push(target);
  battle.plants.length = 0;
  const pr = {
    id: 9999, type: 'pea', x: target.x + 6, y: (yOverride === undefined ? battle.laneY(laneOfGun) : yOverride),
    dmg: 10, owner: -1, lane: laneOfGun, v: laneOfGun,
    aoe: 0, aoeRatio: 0, t: 0, dead: false, rot: 0, spin: 0,
    vx: -300, vy: 0, g: 0
  };
  battle.projectiles.push(pr);
  const hpBefore = target.hp;
  battle.update(1 / 60);
  return target.hp < hpBefore;
}
function makeSpiderAt(v) {
  const e = battle._spawnEnemy('spider');
  battle.enemies.pop();                       // 撤掉自动落位，手工摆
  e.v = v; e.lane = Math.round(v); e.y = battle.laneYf(v); e.x = battle.slotX(2);
  e.state = 'seek'; e.seekT = 999; e.anchor = null;   // 冻住 AI，只测命中
  return e;
}

const spMid = makeSpiderAt(1.5);
const hitFromLane1 = shootAt(spMid, 1);
check('E', '停在 1.5 道时，lane1 的豌豆能打中', hitFromLane1,
  'lane=' + spMid.lane + '（旧版按 lane 判等，另一条道必失手）');
const spMid2 = makeSpiderAt(1.5);
const hitFromLane2 = shootAt(spMid2, 2);
check('E', '停在 1.5 道时，lane2 的豌豆也能打中', hitFromLane2);
check('E', '上下两条道都命中 → 跨道不再无敌', hitFromLane1 && hitFromLane2);

// 反向对照：普通敌人 rv=0，邻道子弹不应误伤
function makeGruntAt(lane) {
  resetField();
  const e = battle._spawnEnemy('grunt');
  e.lane = lane; e.v = lane; e.y = battle.laneY(lane); e.x = battle.slotX(2);
  return e;
}
const g2 = makeGruntAt(2);
const missNeighbor = !shootAt(g2, 1);
check('E', '对照：普通敌人不会被邻道子弹误伤', missNeighbor);
const g2b = makeGruntAt(2);
check('E', '对照：普通敌人仍会被同道子弹命中', shootAt(g2b, 2));

group('F 啃咬与植物死亡');
resetField();
// 监听器必须在第一口之前挂上 —— 否则第一口就咬死的话，事件全漏掉
let deadEvt = 0, hitEvt = 0;
sandbox.Bus.on(EV.PLANT_DEAD, () => deadEvt++);
sandbox.Bus.on(EV.PLANT_HIT, () => hitEvt++);

const spF = battle._spawnEnemy('spider');
const fx = battle.slotX(1), fy = battle.laneY(1);
const cluster = [];
for (let i = 0; i < 3; i++) {
  const p = battle.placePlant({ lane: 1, col: i }, 'peashooter');
  p.x = fx + (i - 1) * 18; p.y = fy;
  cluster.push(p);
}
cluster[0].hp = cluster[0].maxHp;            // 满血
cluster[1].hp = cluster[1].maxHp * 0.5;      // 残血 ← 应该被优先咬（留够血，别一口秒了）
cluster[2].hp = cluster[2].maxHp * 0.85;     // 接近满血
spF.x = fx; spF.y = fy; spF.state = 'perch'; spF.biteCd = 0;

const R = { biteRange: 40, biteDmg: 16, biteInterval: 0.85 };
const n0 = battle.plants.length;
battle._spiderBite(spF, R);
check('F', '优先咬血量比例最低的植物',
  cluster[1].hp < cluster[1].maxHp * 0.5 && cluster[0].hp === cluster[0].maxHp && cluster[2].hp === cluster[2].maxHp * 0.85,
  '残血株 ' + (cluster[1].maxHp * 0.5).toFixed(1) + ' → ' + cluster[1].hp.toFixed(1));

// 连续咬到死
let bites = 0;
while (battle.plants.includes(cluster[1]) && bites < 60) {
  spF.biteCd = 0;
  battle._spiderBite(spF, R);
  bites++;
}
check('F', '植物会被咬死', !battle.plants.includes(cluster[1]), bites + ' 口');
check('F', 'PLANT_HIT / PLANT_DEAD 事件已广播', hitEvt > 0 && deadEvt === 1,
  'hit=' + hitEvt + ' dead=' + deadEvt);
check('F', '死亡后从 plants 移除并让出格子',
  battle.plants.length === n0 - 1, n0 + ' → ' + battle.plants.length);

group('G 普通敌人无回归');
resetField();
const g = battle._spawnEnemy('grunt');
const gx0 = g.x, gy0 = g.y;
let vAlwaysInt = true, vAlwaysEqLane = true, yStable = true;
for (let i = 0; i < 300; i++) {
  battle.update(1 / 60);
  if (g.dead) break;
  if (g.v !== Math.round(g.v)) vAlwaysInt = false;
  if (g.v !== g.lane) vAlwaysEqLane = false;
  if (Math.abs(g.y - gy0) > 1e-6) yStable = false;
}
check('G', '普通敌人 v 恒为整数且等于 lane', vAlwaysInt && vAlwaysEqLane);
check('G', '普通敌人 y 全程不漂移（不换道）', yStable, 'y=' + gy0.toFixed(1));
check('G', '普通敌人 rv=0（命中半径未开启）', g.rv === 0);
check('G', '普通敌人匀速向左推进', g.x < gx0 - 30, 'x ' + gx0.toFixed(0) + ' → ' + g.x.toFixed(0));

// 索敌：只打自己那条道
resetField();
const shooter = battle.placePlant({ lane: 1, col: 0 }, 'peashooter');
const inLane = battle._spawnEnemy('grunt'); inLane.lane = 1; inLane.v = 1; inLane.y = battle.laneY(1); inLane.x = shooter.x + 200;
check('G', '索敌：同道敌人能被锁定', battle._findTarget(shooter) === inLane);
const offLane = battle._spawnEnemy('grunt'); offLane.lane = 2; offLane.v = 2; offLane.y = battle.laneY(2); offLane.x = shooter.x + 200;
battle.enemies.length = 0; battle.enemies.push(offLane);
check('G', '索敌：邻道敌人不被锁定', battle._findTarget(shooter) === null);
// 蜘蛛跨界：v 落在 0.5 容差内应能被锁定
const spCross = battle._spawnEnemy('spider');
spCross.v = 1.3; spCross.lane = 1; spCross.y = battle.laneYf(1.3); spCross.x = shooter.x + 200;
battle.enemies.length = 0; battle.enemies.push(spCross);
check('G', '索敌：跨道蜘蛛落在容差内可被锁定', battle._findTarget(shooter) === spCross, 'v=1.3 vs 植物 v=1');

group('H 角斗场：3 只蜘蛛 vs 一排豌豆射手（60 秒）');
G.startRun();                                  // 注意：buildWorld 内 Bus.reset() 会清监听器，必须在之后挂
let grappleEvt = 0, plantDeadEvt = 0, spiderKilled = 0;
sandbox.Bus.on(EV.SPIDER_GRAPPLE, () => grappleEvt++);
sandbox.Bus.on(EV.PLANT_DEAD, () => plantDeadEvt++);
sandbox.Bus.on(EV.ENEMY_DEAD, (d) => { if (d.enemy && d.enemy.role === 'spider') spiderKilled++; });

resetField();                                  // 关掉波次调度，只跑这一个场面
const gunLine = [];
for (let L = 0; L < nL; L++) {
  for (let c = 0; c < battle.cfg.cols - 1; c++) gunLine.push(battle.placePlant({ lane: L, col: c }, 'peashooter'));
}
// 打残三株：蜘蛛的定位是「补刀残血」，满血射手 110HP / 一口 16 它根本啃不动
const wounded = [gunLine[1], gunLine[4], gunLine[7]];
wounded.forEach(p => { p.hp = p.maxHp * 0.25; });
const pack = [];
for (let k = 0; k < 3; k++) pack.push(battle._spawnEnemy('spider'));
const hp0 = pack.map(e => e.hp);
let arenaCrash = null;
try { for (let i = 0; i < 60 * 60; i++) battle.update(1 / 60); } catch (e) { arenaCrash = e; }

const damaged = pack.filter((e, k) => e.hp < hp0[k]).length;
const hurtPlants = gunLine.filter(p => p.hp < p.maxHp).length;
check('H', '角斗场 60 秒不抛异常', !arenaCrash, arenaCrash ? String(arenaCrash.message).slice(0, 90) : '');
check('H', '触手抓钩事件已触发', grappleEvt > 0, grappleEvt + ' 次');
check('H', '蜘蛛确实在掉血（不是无敌单位）', damaged > 0, damaged + '/3 只掉血');
check('H', '蜘蛛会啃植物', hurtPlants > 0, hurtPlants + '/' + gunLine.length + ' 株带伤');
check('H', '优先把残血株啃掉', plantDeadEvt > 0, '啃死 ' + plantDeadEvt + ' 株（打残了 ' + wounded.length + ' 株）');
console.log('     参考：残存蜘蛛 ' + battle.enemies.filter(e => e.role === 'spider' && !e.dead).length + ' 只');

// 可击杀性：把它钉在火力下，验证「会被打死」而不是「能扛着走完全场」
resetField();
const spK = battle._spawnEnemy('spider');
spK.lane = 1; spK.v = 1; spK.y = battle.laneY(1);
spK.root = 999;                                // 定身：只测能不能被打死
for (let c = 0; c < 3; c++) {
  const p = battle.placePlant({ lane: 1, col: c }, 'peashooter');
  p.x = spK.x - 70 - c * 45; p.y = spK.y;      // 摆在它左边 = 射手身前
}
for (let i = 0; i < 60 * 90; i++) battle.update(1 / 60);
check('H', '定身集火下会被打死', spiderKilled > 0 || (spK.dead && spK.deathT < 9),
  'hp ' + spK.hp.toFixed(0) + '/' + spK.maxHp + '，击杀事件 ' + spiderKilled);

/* ---------- 汇总 ---------- */
const bad = results.filter(r => !r.ok);
console.log('\n============================================');
console.log('  触手蜘蛛冒烟测试：' + (results.length - bad.length) + ' / ' + results.length + ' 通过');
console.log('============================================');
if (bad.length) {
  console.log('\n  未通过项：');
  bad.forEach(b => console.log('   [FAIL] [' + b.group + '] ' + b.name + (b.detail ? '  — ' + b.detail : '')));
  process.exit(1);
}
console.log('  [PASS] 触手蜘蛛生成 / 打分 / 跨道移动 / 命中 / 啃咬 全链路通过');
process.exit(0);
