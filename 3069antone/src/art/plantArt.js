/* ============================================================
 *  plantArt.js —— 三种植物的程序化像素形象
 *   1. 牙苗 Sprout      可进化为任意植物，一切的开始
 *   2. 豌豆射手 Peashooter  炮口发射，带后坐与炮口焰
 *   3. 卷心菜投手 CabbagePult 尾部投射器，抛物线砸落
 *  全部由代码绘制：呼吸摆动为多帧循环，发射时叠加后坐帧 + 炮口焰。
 * ============================================================ */
(function (global) {
  'use strict';
  var P = global.PX;

  /* ---------------- 通用调色 ---------------- */
  var C = {
    line: '#1c3418',
    stemD: '#2c6127', stemM: '#3d8a34', stemL: '#57ab42',
    leafD: '#255c22', leafM: '#3f9a35', leafL: '#66cc50', leafH: '#93e06d',
    bodyD: '#2b6b28', bodyM: '#46a03a', bodyL: '#6ccf52', bodyH: '#9ae872',
    eye: '#ffffff', pupil: '#1b2a16', shine: '#ffffff',
    cheek: '#ff9d86', mouth: '#20301a',
    tubeD: '#1f4d1d', tubeM: '#3a8a33', tubeL: '#68c851',
    cabD: '#4b8f2e', cabM: '#79c04a', cabL: '#a9e077', cabH: '#d6f5ae',
    potD: '#6b4a2c', potM: '#8f6438'
  };

  /* ---------------- 图元：叶片 ---------------- */
  function leaf(g, x, y, len, wid, ang, cD, cM, cL) {
    g.save();
    g.translate(x, y); g.rotate(ang);
    // 叶身：两段椭圆拼出水滴形
    P.ell(g, len * 0.44, 0, len * 0.5, wid, cM || C.leafM);
    g.beginPath();
    g.moveTo(len * 0.1, -wid);
    g.quadraticCurveTo(len * 0.95, -wid * 0.35, len, 0);
    g.quadraticCurveTo(len * 0.95, wid * 0.35, len * 0.1, wid);
    g.closePath();
    g.fillStyle = cM || C.leafM; g.fill();
    // 下半部暗面
    g.beginPath();
    g.moveTo(len * 0.1, 0);
    g.quadraticCurveTo(len * 0.95, wid * 0.35, len, 0);
    g.quadraticCurveTo(len * 0.95, wid * 0.72, len * 0.1, wid * 0.85);
    g.closePath();
    g.fillStyle = cD || C.leafD; g.fill();
    // 叶脉
    P.cap(g, len * 0.08, 0, len * 0.86, 0, 0.7, cL || C.leafL);
    g.restore();
  }

  /* ---------------- 图元：可爱眼睛 ---------------- */
  function eyes(g, lx, ly, rx, ry, px, py, pr, lookX, lookY, blink) {
    if (blink) {
      P.cap(g, lx - rx * 0.8, ly, lx + rx * 0.8, ly, 0.9, C.pupil);
      return;
    }
    P.ell(g, lx, ly, rx, ry, C.eye);
    P.ell(g, lx + rx * 1.9, ly + 0.2, rx * 0.88, ry * 0.9, C.eye);
    P.ell(g, lx + lookX, ly + lookY, pr, pr * 1.12, C.pupil);
    P.ell(g, lx + rx * 1.9 + lookX, ly + 0.2 + lookY, pr * 0.9, pr * 1.02, C.pupil);
    P.circ(g, lx - pr * 0.35, ly - pr * 0.5, pr * 0.36, C.shine);
    P.circ(g, lx + rx * 1.9 - pr * 0.35, ly + 0.2 - pr * 0.5, pr * 0.32, C.shine);
  }

  function cheeks(g, x1, x2, y, r, a) {
    g.save(); g.globalAlpha = a === undefined ? 0.75 : a;
    P.ell(g, x1, y, r, r * 0.62, C.cheek);
    P.ell(g, x2, y, r, r * 0.62, C.cheek);
    g.restore();
  }

  /* ============================================================
   *  1. 牙苗 Sprout —— 22 x 26
   * ============================================================ */
  function drawSprout(g, w, h, f, n) {
    var t = f / n, s = Math.sin(t * Math.PI * 2);
    var cx = w / 2, gy = h - 1.2;
    var br = 1 + s * 0.05;              // 呼吸
    var lf = s * 1.1;                   // 叶片上下浮动

    // 茎
    P.rr(g, cx - 1.8, gy - 11 * br, 3.6, 11, 1.8, C.stemM);
    P.rr(g, cx - 1.8, gy - 11 * br, 1.3, 11, 0.7, C.stemL);

    // 子叶（左右各一）
    leaf(g, cx - 2.2, gy - 9.4 * br + lf * 0.5, 8.4, 3.4, Math.PI * 1.13 - lf * 0.05, C.leafD, C.leafM, C.leafL);
    leaf(g, cx + 2.2, gy - 9.4 * br - lf * 0.5, 8.4, 3.4, -Math.PI * 0.13 + lf * 0.05, C.leafD, C.leafL, C.leafH);

    // 芽体（头）
    var hy = gy - 12.5 * br;
    P.ell(g, cx, hy, 6.4, 6.0 * br, C.bodyM);
    P.ell(g, cx - 1.4, hy + 0.6, 5.0, 4.6 * br, C.bodyL);
    P.ell(g, cx - 2.2, hy - 1.4, 3.0, 2.4, C.bodyH);

    // 顶芽尖
    P.ell(g, cx + 0.4, hy - 6.2 * br, 1.9, 2.4, C.leafL);
    P.ell(g, cx + 0.4, hy - 7.4 * br, 1.0, 1.3, C.leafH);

    // 脸
    cheeks(g, cx - 4.4, cx + 4.6, hy + 2.4, 1.5, 0.6);
    eyes(g, cx - 2.5, hy - 0.4, 1.55, 1.85, 1.0, 0.35, 0.15, 0, false);
    // 小嘴（微笑）
    g.strokeStyle = C.mouth; g.lineWidth = 0.75; g.lineCap = 'round';
    g.beginPath();
    g.arc(cx + 0.35, hy + 2.3, 1.5, 0.15 * Math.PI, 0.85 * Math.PI);
    g.stroke(); g.lineCap = 'butt';
  }

  /* ============================================================
   *  2. 豌豆射手 Peashooter —— 26 x 30
   * ============================================================ */
  function drawPea(g, w, h, f, n, fireT) {
    var t = f / n, s = Math.sin(t * Math.PI * 2);
    var cx = w / 2 - 2.4, gy = h - 1.2;
    var br = 1 + s * 0.042;
    var rec = fireT === undefined ? 0 : fireT;      // 0..1 发射进度
    var kick = rec > 0 ? Math.sin(rec * Math.PI) * 2.0 : 0;   // 后坐位移
    var puff = rec > 0 ? Math.sin(Math.min(1, rec * 1.6) * Math.PI) : 0; // 炮口张开

    // 茎
    P.rr(g, cx - 2.0, gy - 10, 4.0, 10, 2, C.stemM);
    P.rr(g, cx - 2.0, gy - 10, 1.4, 10, 0.7, C.stemL);

    // 底部两片托叶
    leaf(g, cx - 1.0, gy - 1.6, 9.5, 3.2, Math.PI * 1.16 + s * 0.03, C.leafD, C.leafM, C.leafL);
    leaf(g, cx + 1.0, gy - 1.2, 8.0, 2.8, -Math.PI * 0.16 - s * 0.03, C.leafD, C.leafM, C.leafL);

    // 身体（大圆头）
    var hx = cx - kick, hy = gy - 15.5 * br;
    P.ell(g, hx, hy, 8.2, 8.0 * br, C.bodyM);
    P.ell(g, hx - 1.8, hy + 0.8, 6.4, 6.2 * br, C.bodyL);
    P.ell(g, hx - 3.0, hy - 2.0, 3.6, 2.9, C.bodyH);

    // 头顶小叶
    leaf(g, hx - 0.5, hy - 6.6 * br, 6.0, 2.2, -Math.PI * 0.62 - s * 0.05, C.leafD, C.leafM, C.leafH);

    // 炮管（向右）
    var tx = hx + 5.0, ty = hy + 1.2;
    var tubeLen = 9.0 + puff * 1.6;
    P.rr(g, tx, ty - 3.4, tubeLen, 6.8, 3.2, C.tubeM);
    P.rr(g, tx, ty - 3.4, tubeLen, 2.6, 1.6, C.tubeL);
    P.rr(g, tx, ty + 1.4, tubeLen, 2.0, 1.0, C.tubeD);
    // 炮口内壁（暗）
    var mo = tx + tubeLen - 2.0;
    P.ell(g, mo, ty, 2.1, 3.0 + puff * 0.7, C.tubeD);
    P.ell(g, mo - 0.2, ty, 1.2, 1.9 + puff * 0.5, '#0f2a10');
    // 炮口亮环
    g.strokeStyle = C.tubeL; g.lineWidth = 0.8;
    g.beginPath(); g.ellipse(mo, ty, 2.3, 3.2 + puff * 0.7, 0, 0, Math.PI * 2); g.stroke();

    // 脸（朝右看，靠前那只眼更大）
    var ex = hx + 1.3, ey = hy - 0.2;
    P.ell(g, ex, ey, 2.5, 2.9, C.eye);
    P.ell(g, ex - 5.2, ey + 0.5, 2.1, 2.5, C.eye);
    P.ell(g, ex + 0.9, ey + 0.3, 1.45, 1.62, C.pupil);
    P.ell(g, ex - 4.6, ey + 0.7, 1.2, 1.38, C.pupil);
    P.circ(g, ex + 0.1, ey - 0.8, 0.62, C.shine);
    P.circ(g, ex - 5.2, ey - 0.5, 0.5, C.shine);
    cheeks(g, ex - 3.4, ex + 3.6, ey + 3.3, 1.5, 0.55);
    // 嘴（发射时张圆）
    if (rec > 0.05) {
      P.ell(g, ex + 0.6, ey + 4.0, 1.5 + puff * 0.9, 1.3 + puff * 1.0, '#2a1410');
    } else {
      g.strokeStyle = C.mouth; g.lineWidth = 0.8; g.lineCap = 'round';
      g.beginPath(); g.arc(ex + 0.4, ey + 3.6, 1.6, 0.1 * Math.PI, 0.9 * Math.PI); g.stroke();
      g.lineCap = 'butt';
    }
  }

  /* ============================================================
   *  3. 卷心菜投手 CabbagePult —— 28 x 28
   * ============================================================ */
  function drawCabbagePult(g, w, h, f, n, fireT) {
    var t = f / n, s = Math.sin(t * Math.PI * 2);
    var cx = w / 2 + 1.5, gy = h - 1.2;
    var br = 1 + s * 0.04;
    var rec = fireT === undefined ? 0 : fireT;
    var snap = rec > 0 ? Math.sin(Math.min(1, rec * 2.2) * Math.PI) : 0;  // 投射器甩动

    // 茎
    P.rr(g, cx - 2.0, gy - 9, 4.0, 9, 2, C.stemM);
    P.rr(g, cx - 2.0, gy - 9, 1.4, 9, 0.7, C.stemL);
    leaf(g, cx - 1.0, gy - 1.4, 9.0, 3.0, Math.PI * 1.15 + s * 0.03, C.leafD, C.leafM, C.leafL);
    leaf(g, cx + 1.2, gy - 1.0, 7.6, 2.6, -Math.PI * 0.17 - s * 0.03, C.leafD, C.leafM, C.leafL);

    // 身体（略扁）
    var hx = cx, hy = gy - 13.0 * br;
    P.ell(g, hx, hy, 7.8, 7.0 * br, C.bodyM);
    P.ell(g, hx - 1.6, hy + 0.8, 6.2, 5.5 * br, C.bodyL);
    P.ell(g, hx - 2.6, hy - 1.6, 3.4, 2.6, C.bodyH);

    // ---- 尾部投射器（在左侧 = 尾部）----
    var bx = hx - 6.2, by = hy + 1.0;
    // 支撑弧杆
    P.poly(g, [[bx + 3.2, by + 3.4], [bx + 0.6, by - 2.2], [bx - 0.4, by - 6.4 - snap * 1.4]], 2.4, C.stemD);
    P.poly(g, [[bx + 3.2, by + 3.4], [bx + 0.6, by - 2.2], [bx - 0.4, by - 6.4 - snap * 1.4]], 1.0, C.stemL);
    // 托杯
    var cupx = bx - 0.6, cupy = by - 7.2 - snap * 1.6;
    g.save();
    g.translate(cupx, cupy); g.rotate(-0.35 - snap * 0.55);
    P.ell(g, 0, 1.2, 4.4, 3.0, C.leafD);
    P.ell(g, 0, 0.6, 3.6, 2.4, C.leafM);
    g.restore();
    // 杯中卷心菜（未发射时才有）
    if (rec <= 0.02) drawCabbageBall(g, cupx - 0.2, cupy - 2.6, 3.3, 0);

    // 脸
    var ex = hx + 1.6, ey = hy - 0.4;
    P.ell(g, ex, ey, 2.35, 2.7, C.eye);
    P.ell(g, ex - 5.0, ey + 0.4, 2.0, 2.35, C.eye);
    P.ell(g, ex + 0.75, ey + 0.25, 1.35, 1.5, C.pupil);
    P.ell(g, ex - 4.45, ey + 0.65, 1.15, 1.3, C.pupil);
    P.circ(g, ex, ey - 0.75, 0.58, C.shine);
    P.circ(g, ex - 5.0, ey - 0.45, 0.48, C.shine);
    cheeks(g, ex - 3.2, ex + 3.4, ey + 3.1, 1.45, 0.55);
    g.strokeStyle = C.mouth; g.lineWidth = 0.8; g.lineCap = 'round';
    g.beginPath(); g.arc(ex + 0.3, ey + 3.4, 1.5, 0.12 * Math.PI, 0.88 * Math.PI); g.stroke();
    g.lineCap = 'butt';
  }

  /** 卷心菜球体（投射物复用） */
  function drawCabbageBall(g, cx, cy, r, rot) {
    g.save();
    g.translate(cx, cy); g.rotate(rot || 0);
    P.ell(g, 0, 0, r, r * 0.94, C.cabD);
    P.ell(g, -r * 0.15, -r * 0.12, r * 0.8, r * 0.74, C.cabM);
    // 层叠菜叶弧线
    g.strokeStyle = C.cabL; g.lineWidth = 0.7; g.lineCap = 'round';
    g.beginPath(); g.arc(0, 0, r * 0.58, -0.9, 1.5); g.stroke();
    g.beginPath(); g.arc(-r * 0.1, r * 0.1, r * 0.34, 1.2, 3.5); g.stroke();
    P.ell(g, -r * 0.3, -r * 0.34, r * 0.26, r * 0.18, C.cabH);
    // 顶部小叶尖
    g.fillStyle = C.cabL;
    g.beginPath();
    g.moveTo(-r * 0.15, -r * 0.9); g.lineTo(r * 0.35, -r * 1.15); g.lineTo(r * 0.1, -r * 0.62);
    g.closePath(); g.fill();
    g.lineCap = 'butt';
    g.restore();
  }

  /* ============================================================
   *  投射物 / 炮口焰 / 特效精灵
   * ============================================================ */
  function drawPeaBall(g, w, h) {
    var r = w * 0.42, cx = w / 2, cy = h / 2;
    P.ell(g, cx, cy, r, r * 0.96, '#2f7a2a');
    P.ell(g, cx - r * 0.12, cy - r * 0.12, r * 0.78, r * 0.74, '#4fae3c');
    P.ell(g, cx - r * 0.3, cy - r * 0.32, r * 0.34, r * 0.26, '#96e06a');
    P.circ(g, cx - r * 0.32, cy - r * 0.38, r * 0.16, '#e6ffd0');
  }

  function drawMuzzleFlash(g, w, h, f, n) {
    var t = f / (n - 1 || 1);
    var cx = w / 2, cy = h / 2;
    var R = w * 0.5 * (0.45 + t * 0.85);
    var a = 1 - t;
    g.save();
    // 十字星芒
    g.globalAlpha = a;
    g.fillStyle = '#fff6c2';
    var spikes = 4, rot = Math.PI / spikes;
    g.beginPath();
    for (var i = 0; i < spikes * 2; i++) {
      var ang = i * rot, rad = (i % 2 === 0) ? R : R * 0.34;
      var x = cx + Math.cos(ang) * rad, y = cy + Math.sin(ang) * rad * 0.82;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath(); g.fill();
    // 内核
    g.globalAlpha = a;
    P.ell(g, cx, cy, R * 0.42, R * 0.38, '#ffffff');
    g.globalAlpha = a * 0.7;
    P.ell(g, cx, cy, R * 0.62, R * 0.55, '#ffe07a');
    g.restore();
  }

  function drawPuffRing(g, w, h, f, n) {
    var t = f / (n - 1 || 1);
    var cx = w / 2, cy = h / 2, R = w * 0.5 * (0.25 + t * 0.75);
    g.save();
    g.globalAlpha = (1 - t) * 0.9;
    g.strokeStyle = '#ffffff'; g.lineWidth = Math.max(0.7, w * 0.09 * (1 - t));
    g.beginPath(); g.ellipse(cx, cy, R, R * 0.8, 0, 0, Math.PI * 2); g.stroke();
    g.restore();
  }

  /* ============================================================
   *  构建精灵表
   * ============================================================ */
  var IDLE_FRAMES = 16;
  var FIRE_FRAMES = 8;

  var Art = {};

  function build() {
    // 牙苗
    Art.sprout = P.makeSprite(22, 26, IDLE_FRAMES, drawSprout, { outline: '#16300f' });
    Art.sproutFlash = P.makeFlash(Art.sprout, '#d8ffc0');
    Art.sprout._flash = Art.sproutFlash;

    // 豌豆射手：待机 + 发射
    Art.peashooter = P.makeSprite(26, 30, IDLE_FRAMES,
      function (g, w, h, f, n) { drawPea(g, w, h, f, n, 0); }, { outline: '#16300f' });
    Art.peashooterFire = P.makeSprite(26, 30, FIRE_FRAMES,
      function (g, w, h, f, n) { drawPea(g, w, h, 0, 1, (f + 0.5) / n); }, { outline: '#16300f' });
    Art.peashooter._flash = P.makeFlash(Art.peashooter, '#d8ffc0');
    Art.peashooterFire._flash = Art.peashooter._flash;

    // 卷心菜投手
    Art.cabbagepult = P.makeSprite(28, 28, IDLE_FRAMES,
      function (g, w, h, f, n) { drawCabbagePult(g, w, h, f, n, 0); }, { outline: '#16300f' });
    Art.cabbagepultFire = P.makeSprite(28, 28, FIRE_FRAMES,
      function (g, w, h, f, n) { drawCabbagePult(g, w, h, 0, 1, (f + 0.5) / n); }, { outline: '#16300f' });
    Art.cabbagepult._flash = P.makeFlash(Art.cabbagepult, '#d8ffc0');
    Art.cabbagepultFire._flash = Art.cabbagepult._flash;

    // 投射物
    Art.pea = P.makeSprite(8, 8, 1, drawPeaBall, { outline: '#1b3f16' });
    Art.cabbage = P.makeSprite(11, 11, 12,
      function (g, w, h, f, n) { drawCabbageBall(g, w / 2, h / 2, w * 0.42, f / n * Math.PI * 2); },
      { outline: '#2b5518' });

    // 炮口焰 / 冲击环
    Art.muzzle = P.makeSprite(18, 18, 6, drawMuzzleFlash, { outline: null, cut: 0.18 });
    Art.ring = P.makeSprite(20, 20, 7, drawPuffRing, { outline: null, cut: 0.18 });

    // 图标（小头像，用于卡片/商店）
    Art.icon = {};
    Art.icon.sprout = P.makeSprite(22, 26, 1, function (g, w, h) { drawSprout(g, w, h, 0, 1); }, { outline: '#16300f' });
    Art.icon.peashooter = P.makeSprite(26, 30, 1, function (g, w, h) { drawPea(g, w, h, 0, 1, 0); }, { outline: '#16300f' });
    Art.icon.cabbagepult = P.makeSprite(28, 28, 1, function (g, w, h) { drawCabbagePult(g, w, h, 0, 1, 0); }, { outline: '#16300f' });
  }

  /* ---------------- 植物动画控制器 ----------------
   * 统一输出 {frame, sprite, lean, squash, bob, muzzle:{x,y}}
   * 这样视图层不需要知道具体是哪种植物。
   */
  function PlantAnimator(kind, seed) {
    this.kind = kind;
    this.t = (seed || 0) * 1.7;      // 相位错开，避免整排同步
    this.fireT = -1;                  // <0 表示未在发射
    this.fireDur = kind === 'peashooter' ? 0.26 : 0.34;
    this.pendingFire = false;
  }
  PlantAnimator.prototype.triggerFire = function () { this.fireT = 0; };
  PlantAnimator.prototype.update = function (dt) {
    this.t += dt;
    if (this.fireT >= 0) {
      this.fireT += dt;
      if (this.fireT >= this.fireDur) this.fireT = -1;
    }
  };
  PlantAnimator.prototype.isFiring = function () { return this.fireT >= 0; };
  /** 发射动作的“击发瞬间”进度（用于生成子弹/炮口焰） */
  PlantAnimator.prototype.strikeAt = function () {
    return this.kind === 'peashooter' ? 0.18 : 0.34;   // 归一化的击发时刻
  };
  PlantAnimator.prototype.render = function () {
    var idle = Art[this.kind], fire = Art[this.kind + 'Fire'];
    var firing = this.fireT >= 0;
    var spr = firing && fire ? fire : idle;
    var frame;
    if (firing && fire) {
      frame = Math.min(fire.n - 1, Math.floor(this.fireT / this.fireDur * fire.n));
    } else {
      var fps = 8.5;
      frame = Math.floor(this.t * fps) % spr.n;
    }
    // 呼吸带来的轻微上下起伏 + 摆动
    var s = Math.sin(this.t * Math.PI * 2 * 0.42);
    var lean = Math.sin(this.t * Math.PI * 2 * 0.42 - 0.5) * 0.034;
    var bob = s * 0.9;
    var squash = 1 + s * 0.028;
    return { sprite: spr, frame: frame, lean: lean, squash: squash, bob: bob, firing: firing };
  };

  global.PlantArt = {
    build: build, Art: Art, PlantAnimator: PlantAnimator,
    C: C, IDLE_FRAMES: IDLE_FRAMES, FIRE_FRAMES: FIRE_FRAMES,
    KIND: {
      sprout: { name: '牙苗', desc: '一切的开始，可进化为任意植物', w: 22, h: 26, scale: 3 },
      peashooter: { name: '豌豆射手', desc: '炮口直射，单体稳定输出', w: 26, h: 30, scale: 3 },
      cabbagepult: { name: '卷心菜投手', desc: '尾部抛射，落点小范围溅射', w: 28, h: 28, scale: 3 }
    }
  };
})(window);
