/* ============================================================
 *  battleView.js —— 战场渲染（只读 Battlefield 状态）
 * ============================================================ */
(function (global) {
  'use strict';
  var P = global.PX, M = global.M;

  var OBST_COLORS = {
    rock: { color: '#5a6478', edge: '#c8d4e8' },
    boulder: { color: '#4a5466', edge: '#b8c4da' },
    crystal: { color: '#6d7fa8', edge: '#cfe0ff' },
    stump: { color: '#6b5334', edge: '#d8b98a' },
    pillar: { color: '#59617a', edge: '#d0d8ec' }
  };

  function BattleView(bf, region) {
    this.bf = bf;
    this.region = region;
    this.t = 0;
    this.laneGrass = [];
    for (var i = 0; i < 40; i++) {
      this.laneGrass.push({ x: Math.random(), y: Math.random(), s: 0.6 + Math.random() * 0.8 });
    }
  }

  BattleView.prototype.update = function (dt) { this.t += dt; };

  /** 屏幕形状变化：整个渲染都基于 region，换掉即可（无敌方状态需要迁移） */
  BattleView.prototype.relayout = function (region) { this.region = region; };

  /* ---------------- 障碍物（编辑器注入，已带地面几何） ---------------- */

  /** 走一遍多边形路径 */
  function polyPath(ctx, pts, dy) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y - (dy || 0));
    for (var k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y - (dy || 0));
    ctx.closePath();
  }

  /** 提亮（amt > 0）或压暗（amt < 0）一个 #rrggbb */
  function shade(hex, amt) {
    var n = parseInt(hex.slice(1), 16);
    var f = function (v) {
      return Math.max(0, Math.min(255, Math.round(amt > 0 ? v + (255 - v) * amt : v * (1 + amt))));
    };
    return 'rgb(' + f((n >> 16) & 255) + ',' + f((n >> 8) & 255) + ',' + f(n & 255) + ')';
  }

  /**
   * 画一个障碍物。
   * 2.5D 关闭时走正交分支（与历史逐位一致）；开启时按 o.topZ 挤出立体：
   * 地面落影 → 朝向观察者的侧面 → 顶面。侧面只画质心下方那些边，
   * 背面的挤出体天然被顶面盖住，不需要真正的隐藏面消除。
   */
  BattleView.prototype._obstacle = function (ctx, o) {
    var bf = this.bf;
    if (o.applied === false) return;
    var meta = OBST_COLORS[o.kind] || OBST_COLORS.rock;
    var poly = o.poly;
    if (!poly || poly.length < 3) return;

    // 地面轮廓：过一遍深度投影（开关关闭时是恒等）
    var base = [], k;
    for (k = 0; k < poly.length; k++) base.push({ x: bf.projX(poly[k].x, o.v), y: poly[k].y });

    ctx.save();
    if (!bf.cfg.depth25d) {
      ctx.globalAlpha = 0.94;
      polyPath(ctx, base);
      ctx.fillStyle = meta.color; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = meta.edge; ctx.stroke();
      // 顶面高光（取前两个顶点构成的边，向中心收一点）
      ctx.globalAlpha = 0.22;
      ctx.beginPath();
      ctx.moveTo(base[0].x, base[0].y);
      ctx.lineTo(base[1].x, base[1].y);
      ctx.lineTo((base[1].x + base[2].x) / 2, (base[1].y + base[2].y) / 2);
      ctx.lineTo((base[0].x + base[3].x) / 2, (base[0].y + base[3].y) / 2);
      ctx.closePath();
      ctx.fillStyle = '#ffffff'; ctx.fill();
      ctx.restore();
      return;
    }

    var hz = o.topZ || 0;
    var cy = 0;
    for (k = 0; k < base.length; k++) cy += base[k].y;
    cy /= base.length;

    // 落影：随高度往右下偏，越高影子越远，这是高度感的主要来源
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    for (k = 0; k < base.length; k++) {
      var sx = base[k].x + hz * 0.20, sy = base[k].y + hz * 0.05;
      if (k === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    }
    ctx.closePath(); ctx.fill();

    // 侧面：只画质心下方的边（朝向观察者）
    ctx.globalAlpha = 1;
    for (k = 0; k < base.length; k++) {
      var a = base[k], b = base[(k + 1) % base.length];
      if ((a.y + b.y) / 2 < cy) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(b.x, b.y - hz);
      ctx.lineTo(a.x, a.y - hz);
      ctx.closePath();
      ctx.fillStyle = shade(meta.color, -0.34);
      ctx.fill();
    }

    // 顶面
    polyPath(ctx, base, hz);
    ctx.fillStyle = shade(meta.color, 0.20);
    ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = meta.edge; ctx.stroke();
    ctx.restore();
  };

  /** 批量绘制全部障碍物（独立调用用，如编辑器预览） */
  BattleView.prototype._obstacles = function (ctx) {
    var bf = this.bf;
    if (!bf.obstacles || !bf.obstacles.length) return;
    for (var i = 0; i < bf.obstacles.length; i++) this._obstacle(ctx, bf.obstacles[i]);
  };

  /** 车道带的梯形路径。返回 false 表示开关关闭，调用方退回矩形。 */
  BattleView.prototype._trap = function (ctx, bf, yT, yB, vTop, vBot) {
    if (!bf.cfg.depth25d) return false;
    var wT = bf.cfg.w * bf.depthScale(vTop);
    var wB = bf.cfg.w * bf.depthScale(vBot);
    var cx = bf._cx;
    ctx.beginPath();
    ctx.moveTo(cx - wT / 2, yT);
    ctx.lineTo(cx + wT / 2, yT);
    ctx.lineTo(cx + wB / 2, yB);
    ctx.lineTo(cx - wB / 2, yB);
    ctx.closePath();
    return true;
  };

  BattleView.prototype.draw = function (ctx, fx) {
    var bf = this.bf, R = this.region;
    ctx.save();
    ctx.beginPath(); ctx.rect(R.x, R.y, R.w, R.h); ctx.clip();

    this._bg(ctx, R);
    this._slots(ctx);
    this._node(ctx);

    // 按 y 排序，保证前后遮挡正确。障碍物也入列 —— 它有高度，
    // 应该挡住它后面的单位，否则会出现敌人「穿过」岩石的穿帮。
    var ents = [];
    for (var i = 0; i < bf.enemies.length; i++) ents.push({ y: bf.enemies[i].y, o: bf.enemies[i], k: 'e' });
    for (var j = 0; j < bf.plants.length; j++) ents.push({ y: bf.plants[j].y, o: bf.plants[j], k: 'p' });
    for (var m = 0; m < bf.obstacles.length; m++) {
      var ob = bf.obstacles[m];
      if (ob.applied === false) continue;
      ents.push({ y: ob.cy, o: ob, k: 'o' });
    }
    ents.sort(function (a, b) { return a.y - b.y; });
    for (var q = 0; q < ents.length; q++) {
      var it = ents[q];
      if (it.k === 'e') this._enemy(ctx, it.o);
      else if (it.k === 'o') this._obstacle(ctx, it.o);
      else this._plant(ctx, it.o);
    }

    this._projectiles(ctx);
    if (fx) fx.draw(ctx);
    this._topbar(ctx, R);
    ctx.restore();
  };

  /* ---------------- 背景与地块 ---------------- */
  BattleView.prototype._bg = function (ctx, R) {
    var bf = this.bf;
    var g = ctx.createLinearGradient(0, R.y, 0, R.y + R.h);
    g.addColorStop(0, '#2c4a34');
    g.addColorStop(0.45, '#3c6440');
    g.addColorStop(1, '#2a4630');
    ctx.fillStyle = g;
    ctx.fillRect(R.x, R.y, R.w, R.h);

    // 三条行进道。2.5D 开启时是梯形（远窄近宽），越出战场的部分由外层 clip 裁掉 ——
    // 近处地面延伸出视野本就是正确的透视表现。
    for (var i = 0; i < bf.cfg.lanes; i++) {
      var y = bf.laneY(i);
      var h = bf.laneH;
      var yT = y - h / 2 + 6, yB = y + h / 2 - 6;
      ctx.save();
      var lg = ctx.createLinearGradient(0, yT, 0, yB);
      lg.addColorStop(0, 'rgba(255,255,255,.045)');
      lg.addColorStop(0.5, 'rgba(255,255,255,.10)');
      lg.addColorStop(1, 'rgba(0,0,0,.16)');
      ctx.fillStyle = lg;
      if (this._trap(ctx, bf, yT, yB, i - 0.5, i + 0.5)) ctx.fill();
      else ctx.fillRect(R.x, yT, R.w, yB - yT);
      // 边缘线
      ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 1;
      ctx.beginPath();
      var wT = R.w * bf.depthScale(i - 0.5);
      ctx.moveTo(bf._cx - wT / 2, yT); ctx.lineTo(bf._cx + wT / 2, yT);
      ctx.stroke();
      ctx.restore();
    }

    // 草丛点缀
    ctx.save();
    for (var k = 0; k < this.laneGrass.length; k++) {
      var gr = this.laneGrass[k];
      var gy = R.y + 18 + gr.y * (R.h - 34);
      var gv = bf._vOfY(gy);
      var gx = bf.projX(R.x + gr.x * R.w, (gv == null ? (bf.cfg.lanes - 1) / 2 : gv));
      var sway = Math.sin(this.t * 1.4 + k) * 1.6;
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = '#a8e87a';
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.quadraticCurveTo(gx + 2 * gr.s, gy - 7 * gr.s, gx + sway, gy - 12 * gr.s);
      ctx.quadraticCurveTo(gx + 4 * gr.s, gy - 6 * gr.s, gx + 3 * gr.s, gy);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();

    // 右侧来敌方向的暗角
    var vg = ctx.createLinearGradient(R.x + R.w - 120, 0, R.x + R.w, 0);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,.30)');
    ctx.fillStyle = vg;
    ctx.fillRect(R.x + R.w - 120, R.y, 120, R.h);
  };

  BattleView.prototype._slots = function (ctx) {
    var bf = this.bf;
    for (var l = 0; l < bf.cfg.lanes; l++) {
      var lds = bf.depthScale(l);
      var lhw = bf.cellW * 0.36 * lds;
      for (var c = 0; c < bf.cfg.cols; c++) {
        var x = bf.projX(bf.slotX(c), l), y = bf.slotY(l);
        var occupied = bf.plants.some(function (p) { return p.lane === l && p.col === c; });
        ctx.save();
        ctx.globalAlpha = occupied ? 0.10 : 0.22;
        ctx.strokeStyle = '#cfe8b0'; ctx.lineWidth = 1.4;
        ctx.setLineDash([4, 4]);
        global.roundRect(ctx, x - lhw, y - 16, lhw * 2, 34, 8);
        ctx.stroke();
        ctx.restore();
      }
    }
  };

  /* ---------------- 星枢 ---------------- */
  BattleView.prototype._node = function (ctx) {
    var bf = this.bf, R = this.region;
    // 星枢横跨所有车道，取中间车道做横向投影；大小不随深度缩 —— 它是关键 UI，要始终醒目
    var x = bf.projX(R.x + bf.cfg.nodeX, (bf.cfg.lanes - 1) / 2), y = R.y + R.h / 2;
    var pulse = 0.5 + 0.5 * Math.sin(this.t * 2.2);
    var hpR = M.clamp(bf.nodeHp / bf.nodeMax, 0, 1);
    var hit = bf.nodeHitT > 0 ? bf.nodeHitT / 0.4 : 0;

    ctx.save();
    // 底座
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.beginPath(); ctx.ellipse(x, y + 52, 34, 11, 0, 0, Math.PI * 2); ctx.fill();

    // 光晕
    var gl = ctx.createRadialGradient(x, y - 6, 4, x, y - 6, 74);
    gl.addColorStop(0, 'rgba(150,220,255,' + (0.55 + pulse * 0.25) + ')');
    gl.addColorStop(0.5, 'rgba(90,160,255,.22)');
    gl.addColorStop(1, 'rgba(90,160,255,0)');
    ctx.fillStyle = gl;
    ctx.beginPath(); ctx.arc(x, y - 6, 74, 0, Math.PI * 2); ctx.fill();

    // 水晶主体
    ctx.translate(x, y - 6);
    if (hit > 0) { ctx.translate((Math.random() - 0.5) * hit * 8, (Math.random() - 0.5) * hit * 8); }
    var r = 26 + pulse * 2.4;
    ctx.beginPath();
    for (var i = 0; i < 6; i++) {
      var a = -Math.PI / 2 + i * Math.PI / 3;
      var rr = i % 2 === 0 ? r : r * 0.74;
      var px = Math.cos(a) * rr, py = Math.sin(a) * rr * 1.22;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    var cg = ctx.createLinearGradient(0, -r, 0, r);
    cg.addColorStop(0, '#cdefff'); cg.addColorStop(0.55, '#6fb6f5'); cg.addColorStop(1, '#2f6ec0');
    ctx.fillStyle = cg; ctx.fill();
    ctx.strokeStyle = hit > 0 ? '#ff8f8f' : 'rgba(255,255,255,.75)';
    ctx.lineWidth = hit > 0 ? 3 : 2; ctx.stroke();
    // 内核
    ctx.beginPath(); ctx.arc(0, 0, r * 0.34 * (1 + pulse * 0.12), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,' + (0.7 + pulse * 0.3) + ')'; ctx.fill();
    ctx.restore();

    // HP 条
    ctx.save();
    var bw = 76, bx = x - bw / 2, by = y + 60;
    global.roundRect(ctx, bx, by, bw, 9, 4);
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fill();
    global.roundRect(ctx, bx, by, bw * hpR, 9, 4);
    var hg = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    hg.addColorStop(0, '#7fe0a0'); hg.addColorStop(0.6, '#5ec8ff'); hg.addColorStop(1, '#8f9dff');
    ctx.fillStyle = hg; ctx.fill();
    ctx.font = '800 10px system-ui, sans-serif';
    ctx.fillStyle = '#eaf7ff'; ctx.textAlign = 'center';
    ctx.fillText('星枢 ' + Math.ceil(bf.nodeHp) + '/' + bf.nodeMax, x, by + 22);
    ctx.restore();
  };

  /* ---------------- 植物 ---------------- */
  BattleView.prototype._plant = function (ctx, p) {
    var Art = global.PlantArt.Art;
    var def = global.Battlefield.PLANTS[p.kind];
    var r = p.anim.render();
    var baseSc = (global.PlantArt.KIND[p.kind].scale || 3);
    // 显示调整层（编辑器注入）：覆盖缩放、加偏移
    var disp = (this.bf && this.bf.dispGet) ? this.bf.dispGet('plants', p.kind, 'L' + p.lane + 'C' + p.col) : null;
    var sc = (disp && disp.scale != null) ? disp.scale : baseSc;
    var ox = disp ? (disp.ox || 0) : 0, oy = disp ? (disp.oy || 0) : 0;
    // 2.5D：横向按深度收缩 + 精灵按深度缩放（开关关闭时 ds = 1，与正交逐位一致）
    var pv = (p.v === undefined ? p.lane : p.v);
    var ds = this.bf.depthScale(pv);
    var sc2 = sc * ds;
    var dx = this.bf.projX(p.x + ox, pv), dy = p.y + oy;

    ctx.save();
    // 落地阴影
    P.shadow(ctx, dx, dy + 4, 16 * sc2 / 3 * 0.9, 5 * sc2 / 3 * 0.9, 0.24);

    // 出生弹出
    var born = M.ease.outBack(M.clamp(p.born, 0, 1));
    ctx.translate(dx, dy);
    ctx.scale(born, born);
    ctx.translate(-dx, -dy);

    var lean = r.lean + (p.anim.isFiring() && p.kind === 'peashooter' ? -0.05 : 0);
    P.draw(ctx, r.sprite, dx, dy + r.bob, {
      frame: r.frame, scale: sc2, lean: lean, squash: r.squash,
      flash: p.evolving > 0 ? p.evolving * 0.8 : 0
    });

    // 进化光环
    if (p.evolving > 0) {
      ctx.globalAlpha = p.evolving;
      ctx.strokeStyle = '#d8ffc0'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(dx, dy - 18, 30 * ds * (1.2 - p.evolving * 0.4), 14 * ds * (1.2 - p.evolving * 0.4), 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  };

  /* ---------------- 敌人 ---------------- */
  BattleView.prototype._enemy = function (ctx, e) {
    var isBee = (e.kind === 'bee' && global.BeeArt);
    var Art = isBee ? global.BeeArt.Art : global.InsectArt.Art;
    var KIND = isBee ? global.BeeArt.KIND : global.InsectArt.KIND;
    var spr = Art[e.kind];
    if (!spr) return;
    var baseSc = (KIND[e.kind].scale || 3) * (e.scale || 1);
    // 显示调整层（编辑器注入）：覆盖缩放、加偏移（e.scale 角色倍率仍保留）
    var disp = (this.bf && this.bf.dispGet) ? this.bf.dispGet('enemies', e.kind, null) : null;
    var sc = (disp && disp.scale != null) ? disp.scale * (e.scale || 1) : baseSc;
    var ox = disp ? (disp.ox || 0) : 0, oy = disp ? (disp.oy || 0) : 0;

    var flash = e.hitT > 0 ? M.clamp(e.hitT / 0.14, 0, 1) : 0;
    var born = M.ease.outBack(M.clamp(e.spawnT, 0, 1));
    // 2.5D：同植物，横向收缩 + 精灵深度缩放
    var ev = (e.v === undefined ? e.lane : e.v);
    var ds = this.bf.depthScale(ev);
    var sc2 = sc * ds;
    var ex = this.bf.projX(e.x + ox, ev), ey = e.y + oy;

    if (e.dead) {
      var u = M.clamp(e.deathT / 0.75, 0, 1);
      ctx.save();
      ctx.globalAlpha = 1 - u;
      ctx.translate(ex, ey);
      ctx.rotate(u * Math.PI * 0.9);
      ctx.scale(1 - u * 0.35, 1 - u * 0.35);
      P.draw(ctx, spr, 0, 8, { frame: e.anim.frame(), scale: sc2, flip: false, squash: 1 - u * 0.3 });
      ctx.restore();
      return;
    }

    // 阴影
    P.shadow(ctx, ex, ey + 5, 13 * sc2 / 3 * (e.scale || 1), 4 * sc2 / 3, 0.26);

    // 红火蚁：附加发光（非像素，柔光叠加）
    if (e.kind === 'fireant') {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      var pu = 0.5 + 0.5 * Math.sin(this.t * 6 + e.id);
      var g2 = ctx.createRadialGradient(ex + 6, ey - 6, 1, ex + 6, ey - 6, 26 * ds * (0.8 + pu * 0.3));
      g2.addColorStop(0, 'rgba(255,150,50,' + (0.42 + pu * 0.2) + ')');
      g2.addColorStop(1, 'rgba(255,90,20,0)');
      ctx.fillStyle = g2;
      ctx.beginPath(); ctx.arc(ex + 6, ey - 6, 26 * ds * (0.8 + pu * 0.3), 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(ex, ey);
    ctx.scale(born, born);

    // 受击压扁 + 击退倾斜
    var sq = 1 - flash * 0.16;
    var lean = flash * 0.12;
    // 状态染色
    var tint = null;
    if (e.slow) tint = '#8fd9ff';
    if (e.root > 0) tint = '#8ee06a';
    if (e.burnT > 0) tint = '#ff9a3c';

    if (isBee) {
      // 蜜蜂：BeeAnimator.render() 驱动悬停浮沉 / 尾针戳击 / 飞走姿态
      var r = e.anim.render();
      ctx.save();
      ctx.globalAlpha = (r.alpha != null) ? r.alpha : 1;
      ctx.translate(r.lunge || 0, r.bob || 0);
      if (r.rot) ctx.rotate(r.rot);
      P.draw(ctx, r.sprite, 0, 6, { frame: r.frame, scale: sc2, flip: false, squash: 1, lean: 0, flash: flash });
      ctx.restore();
    } else {
      P.draw(ctx, spr, 0, 6, {
        frame: e.anim.frame(), scale: sc2, flip: false,
        squash: sq, lean: lean, flash: flash
      });
    }

    // 状态色罩
    if (tint) {
      ctx.save();
      ctx.globalAlpha = 0.32;
      ctx.globalCompositeOperation = 'lighter';
      ctx.translate(0, 6);
      ctx.scale(sc2, sc2 * sq);
      ctx.fillStyle = tint;
      ctx.fillRect(-spr.anchorX, -spr.h, spr.w, spr.h);
      ctx.restore();
    }
    ctx.restore();

    // 血条
    if (e.hp < e.maxHp) {
      var w = 30 * (e.scale || 1) * ds, h = 4;
      var x = ex - w / 2, y = ey - 26 * sc2 / 3 - 4;
      ctx.save();
      global.roundRect(ctx, x, y, w, h, 2);
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fill();
      global.roundRect(ctx, x, y, w * M.clamp(e.hp / e.maxHp, 0, 1), h, 2);
      ctx.fillStyle = e.armor >= 0.2 ? '#ffd06a' : '#ff7d6a'; ctx.fill();
      if (e.armor >= 0.2) {
        ctx.strokeStyle = 'rgba(255,220,140,.9)'; ctx.lineWidth = 1;
        global.roundRect(ctx, x - 0.5, y - 0.5, w + 1, h + 1, 2); ctx.stroke();
      }
      ctx.restore();
    }
  };

  /* ---------------- 投射物 ---------------- */
  BattleView.prototype._projectiles = function (ctx) {
    var bf = this.bf, Art = global.PlantArt.Art;
    for (var i = 0; i < bf.projectiles.length; i++) {
      var pr = bf.projectiles[i];
      // 2.5D：弹丸按当前深度收缩与缩放（开关关闭时恒等）
      var ds = bf.depthScale(pr.v);
      var px = bf.projX(pr.x, pr.v), py = pr.y;
      if (pr.type === 'pea') {
        // 拖尾
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = '#8fe06a'; ctx.lineWidth = 3; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(bf.projX(pr.x - pr.vx * 0.03, pr.v), py - 3); ctx.lineTo(px, py - 3); ctx.stroke();
        ctx.lineCap = 'butt';
        ctx.restore();
        P.draw(ctx, Art.pea, px, py, { frame: 0, scale: 3 * ds, squash: 1 });
      } else if (pr.type === 'seed') {
        // 石榴籽：带余烬微光的小红籽，直线飞行
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = '#ff9a82'; ctx.lineWidth = 2; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(bf.projX(pr.x - pr.vx * 0.03, pr.v), py); ctx.lineTo(px, py); ctx.stroke();
        ctx.lineCap = 'butt';
        ctx.restore();
        P.draw(ctx, Art.seed, px, py, { frame: 0, scale: 3 * ds, squash: 1 });
      } else {
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(pr.rot);
        ctx.scale(3 * ds, 3 * ds);
        ctx.imageSmoothingEnabled = false;
        var fr = Math.floor(Math.abs(pr.rot) * 2) % Art.cabbage.n;
        ctx.drawImage(Art.cabbage.frames[fr], -Art.cabbage.anchorX, -Art.cabbage.h);
        ctx.restore();
        // 落点指示：越过弹道顶点后才显示。
        // 旧实现靠 pr.vy > 0 判断「正在下落」，z 化后 vy 不再积分，改用飞行进度。
        if (pr.arc && pr.t > pr.T * 0.5) {
          ctx.save();
          ctx.globalAlpha = 0.18 + 0.1 * Math.sin(this.t * 12);
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
          ctx.beginPath();
          // 落点在目标车道上，横向也要按目标车道的深度投影，否则圈会和弹丸错开
          ctx.ellipse(bf.projX(pr.x + pr.vx * 0.12, pr.vTo), pr.landY || (py + 20), 20 * ds, 6 * ds, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }
    }
  };

  /* ---------------- 顶部信息 ---------------- */
  BattleView.prototype._topbar = function (ctx, R) {
    var bf = this.bf;
    ctx.save();
    ctx.font = '800 13px "Noto Sans SC", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,.92)';
    ctx.fillText('第 ' + bf.level + ' 关 · 第 ' + bf.wave + ' 波', R.x + 14, R.y + 22);
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,.62)';
    var w = global.Battlefield.WAVES[bf.waveIdx];
    ctx.fillText(w ? w.intent : '准备中…', R.x + 14, R.y + 38);

    ctx.textAlign = 'right';
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,.72)';
    ctx.fillText('存活 ' + bf.enemies.filter(function (e) { return !e.dead; }).length +
      ' · 击杀 ' + bf.stats.kills + ' · 漏怪 ' + bf.stats.leaks, R.x + R.w - 14, R.y + 22);
    ctx.restore();
  };

  global.BattleView = BattleView;
})(window);
