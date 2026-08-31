/* ============================================================
 *  insectArt.js —— 三种昆虫敌人的程序化像素形象（朝左行进）
 *   1. 普通蚂蚁 Ant       三节体 + 三足步态摆动 + 触角晃动
 *   2. 红火蚁 FireAnt     同构红色版，腹部蓄光脉动 + 怒眼 + 更快步频
 *   3. 天牛 Longhorn      重装甲鞘翅 + 白斑 + 超长分节触角横扫
 *  行走为多帧循环；受击/死亡由视图层叠加闪白、压扁、旋转与粒子。
 * ============================================================ */
(function (global) {
  'use strict';
  var P = global.PX;

  var WALK = 10;

  /* ---------------- 步足：三足步态 ---------------- */
  function legs(g, att, ground, phase, near, far, wid) {
    var off = [0, Math.PI, 0];      // 三足步态：前/后同相，中足反相
    // 远侧足（先画，暗）
    for (var i = 0; i < 3; i++) {
      var s2 = Math.sin(phase + off[i] + Math.PI);
      var fx2 = att[i][0] + s2 * 2.0;
      var ly2 = Math.max(0, s2) * 1.6;
      P.poly(g, [[att[i][0] + 1.0, att[i][1]],
      [att[i][0] + 0.4, att[i][1] - 1.6 - ly2 * 0.5],
      [fx2, ground - ly2]], wid * 0.85, far);
    }
    // 近侧足
    for (var j = 0; j < 3; j++) {
      var s = Math.sin(phase + off[j]);
      var fx = att[j][0] - s * 2.3;
      var ly = Math.max(0, s) * 1.9;
      P.poly(g, [[att[j][0], att[j][1]],
      [(att[j][0] + fx) / 2 - 0.9, att[j][1] - 2.4 - ly * 0.55],
      [fx, ground - ly]], wid, near);
    }
  }

  /* ---------------- 触角 ---------------- */
  function antennae(g, hx, hy, len, phase, col, wid, sweep) {
    for (var i = 0; i < 2; i++) {
      var w = Math.sin(phase * 1.5 + i * 1.9) * (sweep || 0.9);
      P.poly(g, [
        [hx, hy],
        [hx - len * 0.4, hy - len * 0.55 + w * 0.5],
        [hx - len * 0.82, hy - len * 0.72 + w],
        [hx - len * 1.05, hy - len * 0.5 + w * 1.5]
      ], wid, col);
    }
  }

  function eyeDot(g, x, y, r, angry) {
    P.ell(g, x, y, r, r * 1.1, '#ffffff');
    P.ell(g, x - r * 0.18, y + r * 0.1, r * 0.58, r * 0.66, '#101418');
    P.circ(g, x - r * 0.45, y - r * 0.45, r * 0.3, '#ffffff');
    if (angry) {
      g.strokeStyle = '#2a0d08'; g.lineWidth = 0.8; g.lineCap = 'round';
      g.beginPath();
      g.moveTo(x - r * 1.3, y - r * 1.9); g.lineTo(x + r * 0.9, y - r * 0.95);
      g.stroke(); g.lineCap = 'butt';
    }
  }

  /* ============================================================
   *  1 / 2. 蚂蚁（普通 / 红火蚁）—— 22 x 17
   * ============================================================ */
  function makeAntDrawer(cfg) {
    return function (g, w, h, f, n) {
      var t = f / n, phase = t * Math.PI * 2;
      var ground = h - 1.0;
      var bob = Math.sin(phase * 2) * 0.5;
      var cy = h * 0.55 + bob;

      // 腿（着地点）
      var att = [[9.5, cy + 0.5], [11.5, cy + 0.8], [13.2, cy + 0.5]];
      legs(g, att, ground, phase * cfg.gait, cfg.leg, cfg.legFar, 1.15);

      // 腹部（后，大）
      var ax = 16.4, ay = cy - 0.2;
      P.ell(g, ax, ay, 4.8, 3.9, cfg.abdD);
      P.ell(g, ax - 0.7, ay - 0.5, 3.9, 3.1, cfg.abdM);
      P.ell(g, ax - 1.6, ay - 1.4, 2.1, 1.5, cfg.abdH);

      // 胸部
      P.ell(g, 11.3, cy + 0.2, 3.0, 2.7, cfg.thxD);
      P.ell(g, 10.9, cy - 0.1, 2.1, 1.9, cfg.thxM);

      // 头
      var hx = 5.4, hy = cy - 0.3;
      P.ell(g, hx, hy, 3.7, 3.5, cfg.headD);
      P.ell(g, hx + 0.4, hy - 0.3, 2.8, 2.6, cfg.headM);
      P.ell(g, hx + 1.0, hy - 1.1, 1.5, 1.1, cfg.headH);

      // 触角
      antennae(g, hx - 1.2, hy - 1.6, 5.4, phase * cfg.gait, cfg.leg, 0.85, 1.0);

      // 上颚（朝左，随步态开合）
      var b = Math.sin(phase * cfg.gait * 2) * 0.7;
      P.poly(g, [[hx - 2.6, hy + 0.6], [hx - 4.6, hy - 0.1 + b]], 1.0, cfg.jaw);
      P.poly(g, [[hx - 2.6, hy + 1.4], [hx - 4.4, hy + 1.9 - b]], 1.0, cfg.jaw);

      // 眼
      eyeDot(g, hx - 0.4, hy - 0.5, 1.25, cfg.angry);

      // 红火蚁：腹部内的蓄光核（脉动）
      if (cfg.core) {
        var pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 4);
        var r = 1.5 + pulse * 1.25;
        P.ell(g, ax - 0.4, ay - 0.3, r, r * 0.92, cfg.core);
        P.ell(g, ax - 0.8, ay - 0.6, r * 0.45, r * 0.4, cfg.coreHi);
        // 背刺火焰
        g.save();
        g.translate(ax + 2.2, ay - 4.0 - pulse * 0.8);
        P.ell(g, 0, 0, 1.5, 2.3 + pulse * 0.7, '#ff8a2b');
        P.ell(g, 0, 0.6, 0.9, 1.4 + pulse * 0.5, '#ffd75e');
        g.restore();
      }
    };
  }

  /* ============================================================
   *  3. 天牛 Longhorn —— 30 x 21
   * ============================================================ */
  function drawBeetle(g, w, h, f, n) {
    var t = f / n, phase = t * Math.PI * 2;
    var ground = h - 1.0;
    var bob = Math.sin(phase * 2) * 0.7;
    var cy = h * 0.56 + bob;

    var S = {
      shellD: '#1a2136', shellM: '#33456e', shellL: '#4f6ba6', shellH: '#7d97cc',
      spot: '#e9e4d2', seam: '#101725',
      bodyD: '#141a2a', bodyM: '#2a3550',
      leg: '#1b2233', legFar: '#121826',
      headD: '#161c2c', headM: '#2c3852'
    };

    // 腿
    var att = [[11.5, cy + 1.4], [14.5, cy + 1.8], [17.5, cy + 1.4]];
    legs(g, att, ground, phase * 1.0, S.leg, S.legFar, 1.7);

    // 腹部下缘
    P.ell(g, 18.5, cy + 1.6, 6.2, 3.0, S.bodyM);
    P.ell(g, 18.5, cy + 2.4, 5.0, 1.9, S.bodyD);

    // 鞘翅（大甲壳）
    var sx = 17.5, sy = cy - 0.6;
    P.ell(g, sx, sy, 8.2, 5.6, S.shellD);
    P.ell(g, sx - 0.6, sy - 0.5, 7.2, 4.7, S.shellM);
    P.ell(g, sx - 1.6, sy - 1.5, 5.2, 3.0, S.shellL);
    P.ell(g, sx - 2.6, sy - 2.2, 2.8, 1.4, S.shellH);
    // 中缝
    g.strokeStyle = S.seam; g.lineWidth = 0.9;
    g.beginPath(); g.moveTo(sx - 7.4, sy + 1.0); g.lineTo(sx + 7.4, sy + 0.2); g.stroke();
    // 白斑
    var spots = [[-4.2, -1.2, 1.25], [-1.6, -2.6, 1.05], [1.4, -1.0, 1.35],
    [4.2, -2.2, 1.0], [-2.6, 1.6, 0.95], [2.2, 1.8, 0.9], [6.0, 0.2, 0.8]];
    for (var i = 0; i < spots.length; i++) {
      P.ell(g, sx + spots[i][0], sy + spots[i][1], spots[i][2], spots[i][2] * 0.82, S.spot);
    }

    // 前胸背板
    P.ell(g, 9.6, cy + 0.2, 3.6, 3.4, S.shellD);
    P.ell(g, 9.4, cy - 0.2, 2.8, 2.6, S.shellM);
    P.ell(g, 9.0, cy - 0.9, 1.6, 1.2, S.shellH);
    // 背板上的两个黑点（天牛标志性“眼斑”）
    P.ell(g, 9.2, cy - 0.4, 1.0, 0.9, '#0d1220');
    P.ell(g, 11.0, cy - 0.2, 0.8, 0.75, '#0d1220');

    // 头
    var hx = 5.2, hy = cy + 0.2;
    P.ell(g, hx, hy, 3.2, 3.0, S.headD);
    P.ell(g, hx + 0.5, hy - 0.3, 2.4, 2.2, S.headM);
    eyeDot(g, hx - 0.6, hy - 0.3, 1.1, true);

    // 大颚（钳）
    var b = Math.sin(phase * 2) * 0.8;
    P.poly(g, [[hx - 2.2, hy - 0.2], [hx - 4.6, hy - 1.3 - b], [hx - 5.6, hy + 0.2 - b]], 1.5, '#0f1524');
    P.poly(g, [[hx - 2.2, hy + 1.0], [hx - 4.4, hy + 1.6 + b], [hx - 5.4, hy + 0.4 + b]], 1.5, '#0f1524');
    P.poly(g, [[hx - 2.2, hy - 0.2], [hx - 4.6, hy - 1.3 - b]], 0.6, '#5a6d99');

    // ★ 标志性长触角（分节，向后横扫）
    var sweep = Math.sin(phase) * 2.6;
    for (var k = 0; k < 2; k++) {
      var side = k === 0 ? -0.9 : 0.5;
      var pts = [[hx - 1.0, hy - 1.4]];
      var segs = 5, a0 = -0.75 + side * 0.16;
      for (var s = 1; s <= segs; s++) {
        var u = s / segs;
        var bend = a0 + u * 1.55 + Math.sin(u * 3.0 + phase) * 0.16;
        pts.push([
          hx - 1.0 + Math.cos(bend) * (3.0 + u * 15.0),
          hy - 1.4 + Math.sin(bend) * (3.2 + u * 8.0) - u * 3.4 + sweep * u * 0.5
        ]);
      }
      P.poly(g, pts, 1.25, '#0f1524');
      P.poly(g, pts, 0.55, '#6d82b4');
      // 分节节点
      for (var q = 1; q < pts.length - 1; q++) P.circ(g, pts[q][0], pts[q][1], 0.85, '#9fb2dd');
    }
  }

  /* ============================================================
   *  命中 / 死亡特效精灵
   * ============================================================ */
  function drawSplat(g, w, h, f, n, big) {
    var t = f / (n - 1 || 1);
    var cx = w / 2, cy = h / 2;
    var R = w * 0.5 * (0.25 + t * 0.85);
    g.save();
    g.globalAlpha = t < 0.7 ? 1 : (1 - (t - 0.7) / 0.3);
    // 主体不规则溅射
    P.ell(g, cx, cy, R, R * 0.82, big ? '#3f8f2e' : '#4fae3c');
    P.ell(g, cx - R * 0.15, cy - R * 0.15, R * 0.62, R * 0.5, big ? '#79c04a' : '#96e06a');
    // 飞溅小滴
    var dirs = big ? 8 : 5;
    for (var i = 0; i < dirs; i++) {
      var a = (i / dirs) * Math.PI * 2 + 0.4;
      var d = R * (0.95 + t * 0.9);
      P.ell(g, cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.8,
        R * 0.22 * (1 - t * 0.4), R * 0.19 * (1 - t * 0.4), big ? '#66a83f' : '#76cf55');
    }
    if (big) {
      // 卷心菜残叶
      g.fillStyle = '#a9e077';
      for (var j = 0; j < 5; j++) {
        var a2 = (j / 5) * Math.PI * 2 + 1.1;
        var d2 = R * (0.8 + t * 1.1);
        g.save();
        g.translate(cx + Math.cos(a2) * d2, cy + Math.sin(a2) * d2 * 0.75);
        g.rotate(a2);
        P.ell(g, 0, 0, R * 0.3, R * 0.13, '#a9e077');
        g.restore();
      }
    }
    g.restore();
  }

  function drawSpark(g, w, h, f, n) {
    var t = f / (n - 1 || 1);
    var cx = w / 2, cy = h / 2;
    g.save();
    g.globalAlpha = 1 - t;
    g.strokeStyle = '#fff3b0'; g.lineCap = 'round';
    for (var i = 0; i < 6; i++) {
      var a = (i / 6) * Math.PI * 2 + t * 1.2;
      var d0 = w * 0.12, d1 = w * 0.5 * (0.3 + t);
      g.lineWidth = Math.max(0.6, w * 0.07 * (1 - t));
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * d0, cy + Math.sin(a) * d0);
      g.lineTo(cx + Math.cos(a) * d1, cy + Math.sin(a) * d1);
      g.stroke();
    }
    P.ell(g, cx, cy, w * 0.16 * (1 - t), w * 0.16 * (1 - t), '#ffffff');
    g.restore();
    g.lineCap = 'butt';
  }

  function drawFlame(g, w, h, f, n) {
    var t = f / n;
    var cx = w / 2, base = h - 1;
    var sway = Math.sin(t * Math.PI * 2) * w * 0.09;
    var H = h * (0.62 + 0.34 * Math.sin(t * Math.PI * 2 * 1.7 + 1));
    g.save();
    g.fillStyle = '#ff5a1f';
    g.beginPath();
    g.moveTo(cx - w * 0.26, base);
    g.quadraticCurveTo(cx - w * 0.30, base - H * 0.55, cx + sway, base - H);
    g.quadraticCurveTo(cx + w * 0.30, base - H * 0.55, cx + w * 0.26, base);
    g.closePath(); g.fill();
    g.fillStyle = '#ffa22b';
    g.beginPath();
    g.moveTo(cx - w * 0.17, base);
    g.quadraticCurveTo(cx - w * 0.19, base - H * 0.48, cx + sway * 0.8, base - H * 0.78);
    g.quadraticCurveTo(cx + w * 0.19, base - H * 0.48, cx + w * 0.17, base);
    g.closePath(); g.fill();
    g.fillStyle = '#ffe06a';
    g.beginPath();
    g.moveTo(cx - w * 0.08, base);
    g.quadraticCurveTo(cx - w * 0.09, base - H * 0.34, cx + sway * 0.6, base - H * 0.5);
    g.quadraticCurveTo(cx + w * 0.09, base - H * 0.34, cx + w * 0.08, base);
    g.closePath(); g.fill();
    g.restore();
  }

  function drawDust(g, w, h, f, n) {
    var t = f / (n - 1 || 1);
    var cx = w / 2, cy = h - h * 0.18;
    g.save();
    g.globalAlpha = (1 - t) * 0.85;
    g.strokeStyle = '#d9cba8';
    g.lineWidth = Math.max(0.7, h * 0.14 * (1 - t));
    var R = w * 0.5 * (0.2 + t * 0.9);
    g.beginPath(); g.ellipse(cx, cy, R, R * 0.34, 0, 0, Math.PI * 2); g.stroke();
    g.globalAlpha = (1 - t) * 0.5;
    g.fillStyle = '#c9b892';
    for (var i = 0; i < 5; i++) {
      var a = -Math.PI + (i / 4) * Math.PI;
      P.ell(g, cx + Math.cos(a) * R * 0.95, cy + Math.sin(a) * R * 0.34, w * 0.07, w * 0.05, '#c9b892');
    }
    g.restore();
  }

  /* ============================================================
   *  构建
   * ============================================================ */
  var Art = {};
  function build() {
    Art.ant = P.makeSprite(22, 17, WALK, makeAntDrawer({
      abdD: '#3b2a1c', abdM: '#5c4028', abdH: '#8a6440',
      thxD: '#33241a', thxM: '#4e3826',
      headD: '#3b2a1c', headM: '#5c4028', headH: '#8a6440',
      leg: '#2a1d13', legFar: '#1c130c', jaw: '#241809',
      gait: 1.0, angry: false, core: null
    }), { outline: '#150e08' });

    Art.fireant = P.makeSprite(22, 17, WALK, makeAntDrawer({
      abdD: '#7d1c10', abdM: '#c4382a', abdH: '#f0703a',
      thxD: '#5e160c', thxM: '#8f2417',
      headD: '#6b1a0e', headM: '#a52d1d', headH: '#e0603a',
      leg: '#4a1008', legFar: '#2e0b06', jaw: '#380c05',
      gait: 1.7, angry: true, core: '#ffcf4d', coreHi: '#fff6c8'
    }), { outline: '#2b0a04' });

    Art.beetle = P.makeSprite(30, 21, WALK, drawBeetle, { outline: '#0a0e18' });

    Art.ant._flash = P.makeFlash(Art.ant, '#ffe9e0');
    Art.fireant._flash = P.makeFlash(Art.fireant, '#fff0c8');
    Art.beetle._flash = P.makeFlash(Art.beetle, '#dfe8ff');

    // 特效
    Art.splatPea = P.makeSprite(12, 12, 6, function (g, w, h, f, n) { drawSplat(g, w, h, f, n, false); }, { outline: '#1e4a17', cut: 0.3 });
    Art.splatCabbage = P.makeSprite(20, 20, 7, function (g, w, h, f, n) { drawSplat(g, w, h, f, n, true); }, { outline: '#1e4a17', cut: 0.3 });
    Art.spark = P.makeSprite(14, 14, 5, drawSpark, { outline: false, cut: 0.22 });
    Art.flame = P.makeSprite(12, 16, 8, drawFlame, { outline: false, cut: 0.3 });
    Art.dust = P.makeSprite(22, 12, 7, drawDust, { outline: false, cut: 0.25 });
  }

  /* ---------------- 昆虫动画控制器 ---------------- */
  function InsectAnimator(kind, speed, seed) {
    this.kind = kind;
    this.t = (seed || 0) * 0.9;
    this.speed = speed || 1;
  }
  InsectAnimator.prototype.update = function (dt, moveRatio) {
    // 步频随实际移动速度变化；被定身/减速时腿也慢下来
    this.t += dt * (0.6 + (moveRatio === undefined ? 1 : moveRatio) * 1.5) * (0.8 + this.speed * 0.55);
  };
  InsectAnimator.prototype.frame = function () {
    var spr = Art[this.kind];
    return Math.floor(this.t * 9) % spr.n;
  };

  global.InsectArt = {
    build: build, Art: Art, InsectAnimator: InsectAnimator, WALK: WALK,
    KIND: {
      ant: { name: '普通蚂蚁', scale: 3, hp: 95, speed: 0.35, dmg: 5, armor: 0, gold: 4, w: 22, h: 17 },
      fireant: { name: '红火蚁', scale: 3, hp: 85, speed: 0.75, dmg: 3, armor: 0, gold: 6, w: 22, h: 17 },
      beetle: { name: '天牛', scale: 3, hp: 190, speed: 0.22, dmg: 12, armor: 0.3, gold: 12, w: 30, h: 21 }
    }
  };
})(window);
