/* ============================================================
 *  fx.js —— 命中 / 发射 / 附魔 / 死亡 的特效层
 *  纯表现，不参与任何逻辑判定。订阅 Bus 上的战斗事件自行演出。
 * ============================================================ */
(function (global) {
  'use strict';
  var P = global.PX, EV = global.Bus.EV, M = global.M;

  function FX() {
    this.list = [];
    this.shake = 0;
    this.shakeX = 0; this.shakeY = 0;
    this.hitStop = 0;
    this._bind();
  }

  FX.prototype._bind = function () {
    var self = this;

    global.Bus.on(EV.ENEMY_HIT, function (p) {
      var e = p.enemy;
      var armored = (e.armor || 0) >= 0.2;
      if (p.source === 'burn') return;                 // 灼烧不刷屏
      var sx = e.x + (Math.random() - 0.5) * 8;
      var sy = e.y - 10 * e.scale + (Math.random() - 0.5) * 8;

      if (p.source === 'cabbage' || p.source === 'cabbage:aoe') {
        self.splat(sx, sy, true);
        self.dust(e.x, e.y + 4);
        self.shakeIt(2.6);
        self.hitStopIt(0.045);
        self.chunks(sx, sy, 7, '#79c04a');
      } else if (armored) {
        self.spark(sx, sy);
        self.chunks(sx, sy, 3, '#c9d6f2');
      } else if (p.source === 'pea') {
        self.splat(sx, sy, false);
        self.chunks(sx, sy, 4, '#76cf55');
      } else {
        self.spark(sx, sy, p.element);
      }
      if (p.amount >= 20) self.number(sx, sy - 12, Math.round(p.amount), p.element, p.source);
    });

    global.Bus.on(EV.ENEMY_DEAD, function (p) {
      var e = p.enemy, x = e.x, y = e.y;
      if (e.kind === 'fireant') {
        for (var i = 0; i < 7; i++) self.flame(x + (Math.random() - 0.5) * 20, y + (Math.random() - 0.5) * 10, 0.9);
        self.ring(x, y, '#ff8a2b', 46);
        self.shakeIt(2.2);
      } else if (e.kind === 'beetle') {
        self.spark(x, y - 6);
        self.chunks(x, y - 6, 9, '#9fb2dd');
        self.dust(x, y + 4);
        self.shakeIt(3.2);
      } else {
        self.splat(x, y - 4, false);
        self.chunks(x, y - 4, 5, '#8a6440');
      }
      self.coin(x, y - 20, e.gold);
    });

    global.Bus.on('battle:impact', function (p) {
      if (p.type === 'cabbage' && !p.hit) self.dust(p.x, p.y + 4);
    });

    global.Bus.on(EV.PLANT_FIRE, function (p) {
      var def = global.Battlefield.PLANTS[p.plant.kind];
      if (!def || !def.muzzle) return;
      var mx = p.plant.x + def.muzzle.dx, my = p.plant.y + def.muzzle.dy;
      if (p.plant.kind === 'peashooter') {
        self.muzzle(mx, my);
        self.puff(mx + 4, my);
      } else {
        self.puff(mx - 4, my + 2);
      }
    });

    global.Bus.on(EV.ENCHANT_CAST, function (p) { self.enchant(p); });
    global.Bus.on(EV.NODE_DAMAGE, function (p) { self.shakeIt(6); self.number(70, 150, '-' + Math.round(p.amount), null, 'node'); });
    global.Bus.on(EV.BOARD_MERGE, function (m) { self.mergePop(m); });
  };

  /* ---------------- 生成器 ---------------- */

  function base(o) { o.t = 0; return o; }

  FX.prototype.splat = function (x, y, big) {
    var A = global.InsectArt.Art;
    this.list.push(base({ kind: 'spr', spr: big ? A.splatCabbage : A.splatPea, x: x, y: y, life: big ? 0.42 : 0.3, fps: big ? 22 : 26, scale: big ? 1.5 : 1.2 }));
  };
  FX.prototype.spark = function (x, y, el) {
    var A = global.InsectArt.Art;
    this.list.push(base({ kind: 'spr', spr: A.spark, x: x, y: y, life: 0.24, fps: 26, scale: 1.1, tint: el }));
  };
  FX.prototype.dust = function (x, y) {
    var A = global.InsectArt.Art;
    this.list.push(base({ kind: 'spr', spr: A.dust, x: x, y: y, life: 0.4, fps: 20, scale: 1.3 }));
  };
  FX.prototype.flame = function (x, y, s) {
    var A = global.InsectArt.Art;
    this.list.push(base({ kind: 'spr', spr: A.flame, x: x, y: y, life: 0.7, fps: 14, scale: 1.2 * (s || 1), vy: -26 }));
  };
  FX.prototype.muzzle = function (x, y) {
    var A = global.PlantArt.Art;
    this.list.push(base({ kind: 'spr', spr: A.muzzle, x: x, y: y, life: 0.16, fps: 40, scale: 1.25 }));
  };
  FX.prototype.puff = function (x, y) {
    var A = global.PlantArt.Art;
    this.list.push(base({ kind: 'spr', spr: A.ring, x: x, y: y, life: 0.26, fps: 30, scale: 0.85 }));
  };
  FX.prototype.ring = function (x, y, color, r) {
    this.list.push(base({ kind: 'ring', x: x, y: y, life: 0.5, color: color, r: r || 40 }));
  };
  FX.prototype.chunks = function (x, y, n, color) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var sp = 60 + Math.random() * 130;
      this.list.push(base({
        kind: 'chunk', x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60,
        life: 0.42 + Math.random() * 0.3, size: 1.6 + Math.random() * 2.4, color: color, g: 520
      }));
    }
  };
  FX.prototype.number = function (x, y, v, el, src) {
    var col = '#fff';
    if (el === 'fire') col = '#ff9a3c';
    else if (el === 'thunder') col = '#ffe45e';
    else if (el === 'ice') col = '#8fd9ff';
    else if (el === 'wood') col = '#8ee06a';
    else if (el === 'water') col = '#6fb6ff';
    else if (el === 'light') col = '#fff2b0';
    else if (src === 'node') col = '#ff6b6b';
    else if (src === 'cabbage' || src === 'cabbage:aoe') col = '#b6f08a';
    else col = '#eaf7d8';
    this.list.push(base({ kind: 'num', x: x, y: y, life: 0.8, vy: -46, text: String(v), color: col, size: src === 'node' ? 18 : 13 }));
  };
  FX.prototype.coin = function (x, y, gold) {
    if (!gold) return;
    this.list.push(base({ kind: 'coin', x: x, y: y, life: 0.8, vy: -70, gold: gold }));
  };
  FX.prototype.mergePop = function (m) {
    if (m.value < 256) return;
    this.list.push(base({ kind: 'shock', x: m.x, y: m.y, life: 0.6, value: m.value }));
  };

  /* ---------------- 附魔演出 ---------------- */
  FX.prototype.enchant = function (p) {
    var el = p.element, bf = this.battle;
    var self = this;
    if (!bf) return;
    var alive = bf.enemies.filter(function (e) { return !e.dead; });
    var byFront = alive.slice().sort(function (a, b) { return a.x - b.x; });

    if (el === 'fire') {
      this.list.push(base({ kind: 'sweep', x: bf.cfg.x, y: bf.cfg.y, w: bf.cfg.w, h: bf.cfg.h, life: 0.55, color: '#ff7a2b' }));
      for (var i = 0; i < alive.length; i++) this.flame(alive[i].x, alive[i].y - 8, 1.1);
      this.shakeIt(3);
    } else if (el === 'thunder') {
      var hits = Math.min(5, byFront.length);
      for (var k = 0; k < hits; k++) {
        this.list.push(base({ kind: 'bolt', x: byFront[k].x, y0: bf.cfg.y - 30, y1: byFront[k].y - 12, life: 0.28, delay: k * 0.045 }));
      }
      this.shakeIt(4);
    } else if (el === 'ice') {
      for (var j = 0; j < Math.min(4, byFront.length); j++) {
        this.list.push(base({ kind: 'crystal', x: byFront[j].x, y: byFront[j].y, life: 0.55, delay: j * 0.04 }));
      }
    } else if (el === 'wood') {
      for (var w = 0; w < Math.min(3, byFront.length); w++) {
        this.list.push(base({ kind: 'root', x: byFront[w].x, y: byFront[w].y + 4, life: 0.6, delay: w * 0.05 }));
      }
    } else if (el === 'water') {
      this.list.push(base({ kind: 'sweep', x: bf.cfg.x, y: bf.cfg.y, w: bf.cfg.w, h: bf.cfg.h, life: 0.5, color: '#4aa8ff' }));
    } else { // light
      this.list.push(base({ kind: 'beam', x: bf.cfg.x + bf.cfg.nodeX, y: bf.cfg.y + bf.cfg.h / 2, life: 0.6 }));
    }

    if (p.star >= 2) {
      this.shakeIt(3 + p.star);
      this.hitStopIt(0.03 * p.star);
    }
    var cn = global.Battlefield.ELEMENT_CN[el] || el;
    var label = (p.source === 'overload' ? '★' + p.star + ' 超载 ' : '小附魔 ') + cn + (p.mult > 1 ? ' ×' + p.mult : '');
    this.list.push(base({
      kind: 'banner', x: bf.cfg.x + bf.cfg.w / 2, y: bf.cfg.y + 42, life: 1.0,
      text: label, el: el
    }));
  };

  FX.prototype.shakeIt = function (v) { this.shake = Math.max(this.shake, v); };
  FX.prototype.hitStopIt = function (v) { this.hitStop = Math.max(this.hitStop, v); };

  /* ---------------- 更新 / 绘制 ---------------- */

  FX.prototype.update = function (dt) {
    for (var i = this.list.length - 1; i >= 0; i--) {
      var f = this.list[i];
      f.t += dt;
      if (f.delay && f.t < f.delay) continue;
      var lt = f.t - (f.delay || 0);
      if (f.kind === 'chunk') {
        f.x += f.vx * dt; f.y += f.vy * dt; f.vy += (f.g || 520) * dt;
      } else if (f.kind === 'num' || f.kind === 'coin') {
        f.y += f.vy * dt; f.vy += 70 * dt;
      } else if (f.kind === 'spr' && f.vy) {
        f.y += f.vy * dt;
      }
      if (lt >= f.life) this.list.splice(i, 1);
    }
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 22);
      this.shakeX = (Math.random() - 0.5) * this.shake;
      this.shakeY = (Math.random() - 0.5) * this.shake;
    } else { this.shakeX = 0; this.shakeY = 0; }
    if (this.hitStop > 0) this.hitStop -= dt;
  };

  FX.prototype.draw = function (ctx) {
    var A = global.InsectArt.Art, PA = global.PlantArt.Art;
    for (var i = 0; i < this.list.length; i++) {
      var f = this.list[i];
      if (f.delay && f.t < f.delay) continue;
      var lt = f.t - (f.delay || 0);
      var u = M.clamp(lt / f.life, 0, 1);

      if (f.kind === 'spr') {
        var fr = Math.floor(u * f.spr.n * 0.9) % f.spr.n;
        P.draw(ctx, f.spr, f.x, f.y, { frame: fr, scale: f.scale, alpha: 1 - u * 0.25 });

      } else if (f.kind === 'chunk') {
        ctx.save();
        ctx.globalAlpha = 1 - u;
        ctx.fillStyle = f.color;
        ctx.fillRect(f.x, f.y, f.size, f.size);
        ctx.restore();

      } else if (f.kind === 'num') {
        ctx.save();
        ctx.globalAlpha = u < 0.15 ? u / 0.15 : (1 - u) / 0.85;
        ctx.font = '900 ' + (f.size + (1 - u) * 3).toFixed(1) + 'px "Noto Sans SC", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(20,26,18,.85)';
        ctx.strokeText(f.text, f.x, f.y);
        ctx.fillStyle = f.color;
        ctx.fillText(f.text, f.x, f.y);
        ctx.restore();

      } else if (f.kind === 'coin') {
        ctx.save();
        ctx.globalAlpha = 1 - u * 0.8;
        ctx.font = '800 12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffd45e';
        ctx.strokeStyle = 'rgba(60,40,0,.8)'; ctx.lineWidth = 3;
        ctx.strokeText('+' + f.gold, f.x, f.y);
        ctx.fillText('+' + f.gold, f.x, f.y);
        ctx.restore();

      } else if (f.kind === 'ring') {
        ctx.save();
        ctx.globalAlpha = (1 - u) * 0.85;
        ctx.strokeStyle = f.color; ctx.lineWidth = 4 * (1 - u) + 1;
        ctx.beginPath();
        ctx.ellipse(f.x, f.y, f.r * (0.2 + u * 1.1), f.r * 0.42 * (0.2 + u * 1.1), 0, 0, Math.PI * 2);
        ctx.stroke(); ctx.restore();

      } else if (f.kind === 'sweep') {
        ctx.save();
        var gx = f.x + f.w * u;
        var g = ctx.createLinearGradient(gx - 90, 0, gx + 30, 0);
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(0.75, f.color);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.globalAlpha = (1 - u) * 0.55;
        ctx.fillStyle = g;
        ctx.fillRect(f.x, f.y, f.w, f.h);
        ctx.restore();

      } else if (f.kind === 'bolt') {
        ctx.save();
        ctx.globalAlpha = 1 - u;
        ctx.strokeStyle = '#fff8c0'; ctx.lineWidth = 3.2; ctx.lineJoin = 'round';
        ctx.shadowColor = '#ffe45e'; ctx.shadowBlur = 12;
        ctx.beginPath();
        var segs = 7, y0 = f.y0, y1 = f.y1;
        ctx.moveTo(f.x + (Math.random() - 0.5) * 6, y0);
        for (var s = 1; s <= segs; s++) {
          var yy = y0 + (y1 - y0) * (s / segs);
          ctx.lineTo(f.x + (Math.random() - 0.5) * 22, yy);
        }
        ctx.stroke();
        ctx.strokeStyle = '#ffe45e'; ctx.lineWidth = 1.4; ctx.stroke();
        ctx.restore();

      } else if (f.kind === 'crystal') {
        ctx.save();
        ctx.globalAlpha = (1 - u) * 0.9;
        ctx.translate(f.x, f.y - 8);
        ctx.fillStyle = '#bfeaff'; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
        for (var c = 0; c < 5; c++) {
          var a = c / 5 * Math.PI * 2 + 0.3;
          var L = 14 * (0.4 + u);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(Math.cos(a) * L, Math.sin(a) * L * 1.4);
          ctx.lineTo(Math.cos(a + 0.4) * L * 0.6, Math.sin(a + 0.4) * L * 0.9);
          ctx.closePath(); ctx.fill(); ctx.stroke();
        }
        ctx.restore();

      } else if (f.kind === 'root') {
        ctx.save();
        ctx.globalAlpha = 1 - u * 0.6;
        ctx.strokeStyle = '#4e8f30'; ctx.lineWidth = 3.4; ctx.lineCap = 'round';
        for (var r = 0; r < 4; r++) {
          var dir = (r % 2 ? 1 : -1);
          ctx.beginPath();
          ctx.moveTo(f.x + dir * 4, f.y + 6);
          ctx.quadraticCurveTo(f.x + dir * (10 + r * 5), f.y + 2 - u * 10,
            f.x + dir * (16 + r * 8), f.y - 4 - u * 16);
          ctx.stroke();
        }
        ctx.lineCap = 'butt';
        ctx.restore();

      } else if (f.kind === 'beam') {
        ctx.save();
        ctx.globalAlpha = (1 - u) * 0.8;
        var g2 = ctx.createRadialGradient(f.x, f.y, 4, f.x, f.y, 160 * (0.3 + u));
        g2.addColorStop(0, '#fffbe0');
        g2.addColorStop(0.5, 'rgba(255,240,160,.55)');
        g2.addColorStop(1, 'rgba(255,240,160,0)');
        ctx.fillStyle = g2;
        ctx.beginPath(); ctx.arc(f.x, f.y, 160 * (0.3 + u), 0, Math.PI * 2); ctx.fill();
        ctx.restore();

      } else if (f.kind === 'banner') {
        ctx.save();
        var pop = u < 0.2 ? (u / 0.2) : 1;
        var yy = f.y - u * 16;
        ctx.globalAlpha = u < 0.7 ? 1 : (1 - (u - 0.7) / 0.3);
        ctx.font = '900 ' + (20 * (0.7 + pop * 0.3)).toFixed(1) + 'px "Noto Sans SC", system-ui, sans-serif';
        ctx.textAlign = 'center';
        var col = { fire: '#ff7a2b', thunder: '#ffe45e', ice: '#8fd9ff', wood: '#8ee06a', water: '#6fb6ff', light: '#fff2b0' }[f.el] || '#fff';
        ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(16,22,14,.9)';
        ctx.strokeText(f.text, f.x, yy);
        ctx.fillStyle = col; ctx.fillText(f.text, f.x, yy);
        ctx.restore();

      } else if (f.kind === 'shock') {
        ctx.save();
        ctx.globalAlpha = (1 - u) * 0.9;
        ctx.strokeStyle = '#ffe9a8'; ctx.lineWidth = 3 * (1 - u) + 1;
        var R = 20 + u * 70;
        ctx.beginPath(); ctx.arc(f.x, f.y, R, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
    }
  };

  global.FX = FX;
})(window);
