/* ============================================================
 *  src/art/beeArt.js
 *  程序化像素敌人：蜜蜂 Bee（飞行单位）
 *
 *  风格对齐 insectArt.js（Q版像素、矢量图元→阈值→描边）。
 *  · 形象：毛绒黄黑条纹腹 + 琥珀色尾针 + 半透明蓝翅 + 萌脸触角；朝左。
 *  · 飞行：悬停上下浮动 + 翅膀快速扇动 + 轻微倾角摆动。
 *  · 攻击：用屁股尾针进行「缓慢戳击」——腹部后仰蓄力，再缓慢前送尾针扎向目标。
 *  · 换目标：每戳 2~3 下后进入「飞走」姿态（上扬、翅膀模糊、速度线），离场再重新锁定。
 *
 *  精灵集：Art.bee（悬停/扇翅）· Art.beePoke（尾针戳击）· Art.beeFlee（飞走）
 *  动画：BeeAnimator（自包含演示状态机，也暴露 beginPoke/beginFlee 供游戏调用）
 * ============================================================ */
(function (global) {
  'use strict';
  var P = global.PX;

  /* ---------------- 调色 ---------------- */
  var B = {
    outline: '#241a05',
    fuzzD: '#caa018', fuzz: '#e8c33a', fuzzL: '#ffe07a',   // 黄绒
    stripe: '#2a2118', stripeD: '#18120a',                 // 黑纹
    stingD: '#3a3320', stingM: '#6b5d2e', stingT: '#e8d68a', // 尾针（琥珀）
    stingGlow: '#fff0a0',
    headD: '#2a2118', headM: '#463826',
    eye: '#ffffff', pupil: '#1a1408',
    wing: '#bfe6ff', wingD: '#8fc4ee', wingEdge: 'rgba(120,170,210,0.85)',
    cheek: '#ff9d86',
    trail: '#bfe6ff'
  };

  /* ---------------- 工具 ---------------- */
  function easeInOut(x) { x = Math.max(0, Math.min(1, x)); return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; }

  /* ---------------- 翅膀（半透明，快速扇动） ---------------- */
  function drawWings(g, wx, wy, lift, blur) {
    g.save();
    g.globalAlpha = 0.60;
    // 后翅（暗）
    P.ell(g, wx + 1.4, wy - lift, 6.8, 3.2, B.wingD);
    // 前翅
    P.ell(g, wx - 0.6, wy - lift * 0.7, 7.6, 3.8, B.wing);
    if (blur) {                                   // 飞走时叠加模糊残影
      g.globalAlpha = 0.28;
      P.ell(g, wx - 4.5, wy - lift, 7.6, 3.8, B.wing);
      P.ell(g, wx + 5.0, wy - lift, 6.8, 3.2, B.wingD);
    }
    // 翅脉
    g.globalAlpha = 0.7;
    g.strokeStyle = B.wingEdge; g.lineWidth = 0.5;
    g.beginPath(); g.ellipse(wx, wy - lift * 0.8, 6.8, 3.0, 0, 0, Math.PI * 2); g.stroke();
    g.restore();
  }

  /* ---------------- 腹部 + 尾针（可旋转，尾针在 +x 末端） ---------------- */
  function drawAbdomen(g, px, py, angle, stingExt, glow) {
    g.save();
    g.translate(px, py); g.rotate(angle);
    // 腹身（向 +x 延伸）
    P.ell(g, 5.4, 0, 5.4, 3.7, B.fuzzD);
    P.ell(g, 5.0, -0.35, 4.7, 3.05, B.fuzz);
    P.ell(g, 4.2, -1.3, 2.7, 1.6, B.fuzzL);
    // 黑黄条纹
    g.fillStyle = B.stripe;
    for (var i = 0; i < 3; i++) {
      var sx = 3.0 + i * 2.3;
      g.beginPath(); g.ellipse(sx, 0, 0.9, 3.2 - i * 0.15, 0, 0, Math.PI * 2); g.fill();
    }
    // 尾针
    var tip = 9.6 + stingExt;
    P.poly(g, [[9.2, -1.5], [tip + 1.6, 0], [9.2, 1.5]], 1.7, B.stingM);
    P.poly(g, [[9.6, -0.7], [tip + 2.4, 0], [9.6, 0.7]], 0.7, B.stingT);
    if (glow > 0) {                 // 戳击瞬间的针尖微光
      g.save(); g.globalAlpha = glow;
      P.circ(g, tip + 1.8, 0, 1.4, B.stingGlow);
      g.restore();
    }
    g.restore();
  }

  /* ---------------- 头 + 触角 + 眼 ---------------- */
  function drawHead(g, hx, hy, t, look) {
    P.ell(g, hx, hy, 3.6, 3.4, B.headD);
    P.ell(g, hx + 0.5, hy - 0.3, 2.7, 2.5, B.headM);
    P.ell(g, hx + 1.0, hy - 1.2, 1.4, 1.0, B.fuzz);
    // 大萌眼（朝左）
    P.ell(g, hx - 0.6, hy - 0.4, 1.5, 1.7, B.eye);
    P.ell(g, hx - 0.6 + (look || 0), hy - 0.2, 0.95, 1.1, B.pupil);
    P.circ(g, hx - 1.0, hy - 1.0, 0.45, '#ffffff');
    cheeks(g, hx + 0.4, hx - 2.6, hy + 1.8, 1.1, 0.55);
    // 触角（晃动）
    var w = Math.sin(t * Math.PI * 2 * 1.5) * 1.0;
    P.poly(g, [[hx - 1.2, hy - 1.8], [hx - 3.0, hy - 3.4 + w], [hx - 4.2, hy - 4.2 + w * 1.4]], 0.9, B.headD);
    P.poly(g, [[hx - 0.8, hy - 2.0], [hx - 2.4, hy - 3.8 - w], [hx - 3.4, hy - 4.8 - w * 1.4]], 0.9, B.headD);
    P.circ(g, hx - 4.2, hy - 4.2 + w * 1.4, 0.7, B.headM);
    P.circ(g, hx - 3.4, hy - 4.8 - w * 1.4, 0.7, B.headM);
  }
  function cheeks(g, x1, x2, y, r, a) {
    g.save(); g.globalAlpha = a === undefined ? 0.75 : a;
    P.ell(g, x1, y, r, r * 0.62, B.cheek);
    P.ell(g, x2, y, r, r * 0.62, B.cheek);
    g.restore();
  }

  /* ---------------- 小足 ---------------- */
  function drawLegs(g, cx, cy, phase) {
    var s = Math.sin(phase) * 0.8;
    g.strokeStyle = B.headD; g.lineWidth = 0.9; g.lineCap = 'round';
    g.beginPath();
    g.moveTo(cx - 1.5, cy + 2.6); g.lineTo(cx - 2.6, cy + 5.2 + s);
    g.moveTo(cx + 0.5, cy + 2.8); g.lineTo(cx + 0.6, cy + 5.4 - s);
    g.moveTo(cx + 2.2, cy + 2.6); g.lineTo(cx + 3.4, cy + 5.0 + s * 0.6);
    g.stroke(); g.lineCap = 'butt';
  }

  /* ============================================================
   *  悬停 / 扇翅帧 —— 30 x 22
   * ============================================================ */
  function drawHover(g, w, h, f, n) {
    var t = f / n, phase = t * Math.PI * 2;
    var cx = w / 2, cy = h / 2 + 1.5;  // 悬停微浮由 BeeAnimator.render().bob 提供
    var lift = Math.sin(t * Math.PI * 2 * 3) * 3.0;            // 翅膀快扇
    drawWings(g, cx + 0.5, cy - 3.6, lift, false);
    drawLegs(g, cx, cy, phase * 2);
    drawAbdomen(g, cx + 1.2, cy, 0, 0, 0);
    P.ell(g, cx - 1.0, cy - 0.2, 4.2, 3.9, B.fuzzD);           // 胸部绒球
    P.ell(g, cx - 1.4, cy - 0.6, 3.3, 3.0, B.fuzz);
    P.ell(g, cx - 2.2, cy - 1.4, 1.8, 1.3, B.fuzzL);
    drawHead(g, cx - 5.6, cy, t, 0);
  }

  /* ============================================================
   *  戳击帧 —— 腹部后仰蓄力→缓慢前送尾针（朝向目标=左下方）
   * ============================================================ */
  function drawPoke(g, w, h, f, n) {
    var pokeT = (f + 0.5) / n;
    var t = f / n;
    var cx = w / 2 + 1.0, cy = h / 2 + 1.5;

    // 蓄力(前段)后仰、中段前送：尾针朝向 左下方（angle 由 0 转到约 1.7）
    var swing = easeInOut(Math.min(1, Math.max(0, (pokeT - 0.06) / 0.7))); // 0→1
    var angle = swing * 1.75;                       // 腹部摆向左下
    var stab = Math.sin(Math.min(1, pokeT * 1.05) * Math.PI);  // 0→1→0 尾针伸缩
    var stingExt = stab * 3.6;
    var lungeX = -stab * 2.2;                       // 整体朝目标(左)探身
    var look = -stab * 0.6;

    var bob = Math.sin(pokeT * Math.PI) * 1.0;
    drawWings(g, cx + 0.5 + lungeX, cy - 3.6, 1.5, false);   // 戳击时翅膀半收
    drawLegs(g, cx + lungeX, cy, t * 6);

    // 腹部（绕胸部右缘为轴旋转）
    drawAbdomen(g, cx + 1.2 + lungeX, cy + bob * 0.3, angle, stingExt, stab * 0.7);

    P.ell(g, cx - 1.0 + lungeX, cy - 0.2, 4.2, 3.9, B.fuzzD);
    P.ell(g, cx - 1.4 + lungeX, cy - 0.6, 3.3, 3.0, B.fuzz);
    P.ell(g, cx - 2.2 + lungeX, cy - 1.4, 1.8, 1.3, B.fuzzL);
    drawHead(g, cx - 5.6 + lungeX, cy, t, look);
  }

  /* ============================================================
   *  飞走帧 —— 上扬、翅膀模糊、速度线（离场换目标）
   * ============================================================ */
  function drawFlee(g, w, h, f, n) {
    var ft = f / n;
    var cx = w / 2, cy = h / 2 + 1.5;   // 飞离上升由 render().bob 提供
    var lift = 4.5;
    // 速度线（左后方）
    g.save(); g.globalAlpha = 0.5 * (1 - ft * 0.4);
    g.strokeStyle = B.trail; g.lineWidth = 1.0; g.lineCap = 'round';
    for (var i = 0; i < 3; i++) {
      var yy = cy - 2 + i * 3.0;
      g.beginPath(); g.moveTo(cx - 8 - i * 1.5, yy); g.lineTo(cx - 16 - i * 2.0, yy); g.stroke();
    }
    g.restore(); g.lineCap = 'butt';

    drawWings(g, cx + 0.5, cy - 3.6, lift, true);
    drawLegs(g, cx, cy, ft * 10);
    drawAbdomen(g, cx + 1.2, cy, -0.25, 0, 0);       // 尾针略收
    P.ell(g, cx - 1.0, cy - 0.2, 4.2, 3.9, B.fuzzD);
    P.ell(g, cx - 1.4, cy - 0.6, 3.3, 3.0, B.fuzz);
    P.ell(g, cx - 2.2, cy - 1.4, 1.8, 1.3, B.fuzzL);
    drawHead(g, cx - 5.6, cy, ft, 0.3);
  }

  /* ============================================================
   *  构建
   * ============================================================ */
  var WING = 8;       // 悬停/扇翅帧
  var POKE = 12;      // 戳击帧（慢）
  var FLEE = 6;       // 飞走帧

  var Art = {};
  function build() {
    Art.bee = P.makeSprite(30, 22, WING, drawHover, { outline: '#241a05' });
    Art.beePoke = P.makeSprite(30, 22, POKE, drawPoke, { outline: '#241a05' });
    Art.beeFlee = P.makeSprite(30, 22, FLEE, drawFlee, { outline: '#241a05' });

    Art.bee._flash = P.makeFlash(Art.bee, '#fff6d0');
    Art.beePoke._flash = Art.bee._flash;
    Art.beeFlee._flash = Art.bee._flash;
  }

  /* ---------------- 蜜蜂动画控制器 ----------------
   *  自包含演示状态机：hover → poke(×2~3) → flee → hover …
   *  也暴露 beginPoke / beginFlee 供游戏逻辑直接驱动。
   */
  function BeeAnimator(kind, speed, seed) {
    this.kind = kind || 'bee';
    this.t = (seed || 0) * 0.9;
    this.speed = speed || 1;
    this.state = 'hover';
    this.st = 0;                       // 当前状态计时
    this.pokes = 0;                    // 本目标已戳次数
    this.pokesPerTarget = 2 + (Math.floor((seed || 0) * 7) % 2); // 2 或 3
    this.hoverDur = 0.9;
    this.pokeDur = 0.62;               // 缓慢戳击
    this.fleeDur = 0.7;
  }
  BeeAnimator.prototype.beginPoke = function () {
    if (this.state === 'poke') return;
    this.state = 'poke'; this.st = 0;
  };
  BeeAnimator.prototype.beginFlee = function () {
    if (this.state === 'flee') return;
    this.state = 'flee'; this.st = 0;
  };
  BeeAnimator.prototype.update = function (dt) {
    this.t += dt;
    this.st += dt;
    var sp = 0.8 + this.speed * 0.55;
    if (this.state === 'hover') {
      if (this.st >= this.hoverDur / sp) this.beginPoke();
    } else if (this.state === 'poke') {
      if (this.st >= this.pokeDur / sp) {
        this.pokes++;
        if (this.pokes >= this.pokesPerTarget) { this.beginFlee(); }
        else { this.state = 'hover'; this.st = 0; this.hoverDur = 0.28; }
      }
    } else if (this.state === 'flee') {
      if (this.st >= this.fleeDur / sp) {
        this.pokes = 0;
        this.pokesPerTarget = 2 + (Math.floor(this.t * 13) % 2);
        this.state = 'hover'; this.st = 0; this.hoverDur = 0.9;
      }
    }
  };
  BeeAnimator.prototype.frame = function () {
    var spr = Art[this.state === 'poke' ? 'beePoke' : this.state === 'flee' ? 'beeFlee' : 'bee'];
    if (!spr) spr = Art.bee;
    var fr = this.state === 'hover'
      ? Math.floor(this.t * 11) % spr.n
      : Math.min(spr.n - 1, Math.floor(this.st / (this.pokeDur) * spr.n));
    if (this.state === 'flee') fr = Math.min(spr.n - 1, Math.floor(this.st / this.fleeDur * spr.n));
    return fr;
  };
  BeeAnimator.prototype.render = function () {
    var spr = Art[this.state === 'poke' ? 'beePoke' : this.state === 'flee' ? 'beeFlee' : 'bee'];
    if (!spr) spr = Art.bee;
    var fr = this.frame();
    var bob = 0, rot = 0, alpha = 1, lunge = 0, state = this.state;

    if (state === 'hover') {
      bob = Math.sin(this.t * Math.PI * 2) * 1.6;          // 悬停浮沉
      rot = Math.sin(this.t * Math.PI * 2 * 0.6) * 0.05;   // 倾角轻摆
    } else if (state === 'poke') {
      var p = Math.min(1, this.st / this.pokeDur);
      var stab = Math.sin(Math.min(1, p * 1.05) * Math.PI);
      bob = Math.sin(p * Math.PI) * 1.4;
      lunge = -stab * 2.2;
    } else if (state === 'flee') {
      var q = Math.min(1, this.st / this.fleeDur);
      bob = -q * 10;                                       // 向上飞离
      rot = -0.42;                                         // 机头上扬
      alpha = 1 - Math.max(0, (q - 0.6) / 0.4) * 0.35;     // 末段淡出
    }
    return { sprite: spr, frame: fr, bob: bob, rot: rot, alpha: alpha, lunge: lunge, state: state };
  };

  global.BeeArt = {
    build: build, Art: Art, BeeAnimator: BeeAnimator,
    WING: WING, POKE: POKE, FLEE: FLEE,
    KIND: {
      bee: {
        name: '蜜蜂', scale: 3, hp: 70, speed: 0.62, dmg: 6, armor: 0, gold: 9,
        w: 30, h: 22, flying: true, pokesPerTarget: [2, 3],
        desc: '飞行单位，尾针缓慢戳击，每 2~3 下飞走换目标'
      }
    }
  };
})(window);
