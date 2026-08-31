/* ============================================================
 *  battleView.js —— 战场渲染（只读 Battlefield 状态）
 * ============================================================ */
(function (global) {
  'use strict';
  var P = global.PX, M = global.M;

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

  BattleView.prototype.draw = function (ctx, fx) {
    var bf = this.bf, R = this.region;
    ctx.save();
    ctx.beginPath(); ctx.rect(R.x, R.y, R.w, R.h); ctx.clip();

    this._bg(ctx, R);
    this._slots(ctx);
    this._node(ctx);

    // 按 y 排序，保证前后遮挡正确
    var ents = [];
    for (var i = 0; i < bf.enemies.length; i++) ents.push({ y: bf.enemies[i].y, o: bf.enemies[i], k: 'e' });
    for (var j = 0; j < bf.plants.length; j++) ents.push({ y: bf.plants[j].y, o: bf.plants[j], k: 'p' });
    ents.sort(function (a, b) { return a.y - b.y; });
    for (var q = 0; q < ents.length; q++) {
      if (ents[q].k === 'e') this._enemy(ctx, ents[q].o);
      else this._plant(ctx, ents[q].o);
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

    // 三条行进道
    for (var i = 0; i < bf.cfg.lanes; i++) {
      var y = bf.laneY(i);
      var h = bf.laneH;
      ctx.save();
      var lg = ctx.createLinearGradient(0, y - h / 2, 0, y + h / 2);
      lg.addColorStop(0, 'rgba(255,255,255,.045)');
      lg.addColorStop(0.5, 'rgba(255,255,255,.10)');
      lg.addColorStop(1, 'rgba(0,0,0,.16)');
      ctx.fillStyle = lg;
      ctx.fillRect(R.x, y - h / 2 + 6, R.w, h - 12);
      // 边缘线
      ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(R.x, y - h / 2 + 6); ctx.lineTo(R.x + R.w, y - h / 2 + 6);
      ctx.stroke();
      ctx.restore();
    }

    // 草丛点缀
    ctx.save();
    for (var k = 0; k < this.laneGrass.length; k++) {
      var gr = this.laneGrass[k];
      var gx = R.x + gr.x * R.w;
      var gy = R.y + 18 + gr.y * (R.h - 34);
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
      for (var c = 0; c < bf.cfg.cols; c++) {
        var x = bf.slotX(c), y = bf.slotY(l);
        var occupied = bf.plants.some(function (p) { return p.lane === l && p.col === c; });
        ctx.save();
        ctx.globalAlpha = occupied ? 0.10 : 0.22;
        ctx.strokeStyle = '#cfe8b0'; ctx.lineWidth = 1.4;
        ctx.setLineDash([4, 4]);
        global.roundRect(ctx, x - bf.cellW * 0.36, y - 16, bf.cellW * 0.72, 34, 8);
        ctx.stroke();
        ctx.restore();
      }
    }
  };

  /* ---------------- 星枢 ---------------- */
  BattleView.prototype._node = function (ctx) {
    var bf = this.bf, R = this.region;
    var x = R.x + bf.cfg.nodeX, y = R.y + R.h / 2;
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
    var sc = (global.PlantArt.KIND[p.kind].scale || 3);

    ctx.save();
    // 落地阴影
    P.shadow(ctx, p.x, p.y + 4, 16 * sc / 3 * 0.9, 5 * sc / 3 * 0.9, 0.24);

    // 出生弹出
    var born = M.ease.outBack(M.clamp(p.born, 0, 1));
    ctx.translate(p.x, p.y);
    ctx.scale(born, born);
    ctx.translate(-p.x, -p.y);

    var lean = r.lean + (p.anim.isFiring() && p.kind === 'peashooter' ? -0.05 : 0);
    P.draw(ctx, r.sprite, p.x, p.y + r.bob, {
      frame: r.frame, scale: sc, lean: lean, squash: r.squash,
      flash: p.evolving > 0 ? p.evolving * 0.8 : 0
    });

    // 进化光环
    if (p.evolving > 0) {
      ctx.globalAlpha = p.evolving;
      ctx.strokeStyle = '#d8ffc0'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y - 18, 30 * (1.2 - p.evolving * 0.4), 14 * (1.2 - p.evolving * 0.4), 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  };

  /* ---------------- 敌人 ---------------- */
  BattleView.prototype._enemy = function (ctx, e) {
    var Art = global.InsectArt.Art;
    var spr = Art[e.kind];
    if (!spr) return;
    var sc = (global.InsectArt.KIND[e.kind].scale || 3) * (e.scale || 1);
    var flash = e.hitT > 0 ? M.clamp(e.hitT / 0.14, 0, 1) : 0;
    var born = M.ease.outBack(M.clamp(e.spawnT, 0, 1));

    if (e.dead) {
      var u = M.clamp(e.deathT / 0.75, 0, 1);
      ctx.save();
      ctx.globalAlpha = 1 - u;
      ctx.translate(e.x, e.y);
      ctx.rotate(u * Math.PI * 0.9);
      ctx.scale(1 - u * 0.35, 1 - u * 0.35);
      P.draw(ctx, spr, 0, 8, { frame: e.anim.frame(), scale: sc, flip: false, squash: 1 - u * 0.3 });
      ctx.restore();
      return;
    }

    // 阴影
    P.shadow(ctx, e.x, e.y + 5, 13 * sc / 3 * (e.scale || 1), 4 * sc / 3, 0.26);

    // 红火蚁：附加发光（非像素，柔光叠加）
    if (e.kind === 'fireant') {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      var pu = 0.5 + 0.5 * Math.sin(this.t * 6 + e.id);
      var g2 = ctx.createRadialGradient(e.x + 6, e.y - 6, 1, e.x + 6, e.y - 6, 26 * (0.8 + pu * 0.3));
      g2.addColorStop(0, 'rgba(255,150,50,' + (0.42 + pu * 0.2) + ')');
      g2.addColorStop(1, 'rgba(255,90,20,0)');
      ctx.fillStyle = g2;
      ctx.beginPath(); ctx.arc(e.x + 6, e.y - 6, 26 * (0.8 + pu * 0.3), 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.scale(born, born);

    // 受击压扁 + 击退倾斜
    var sq = 1 - flash * 0.16;
    var lean = flash * 0.12;
    // 状态染色
    var tint = null;
    if (e.slow) tint = '#8fd9ff';
    if (e.root > 0) tint = '#8ee06a';
    if (e.burnT > 0) tint = '#ff9a3c';

    P.draw(ctx, spr, 0, 6, {
      frame: e.anim.frame(), scale: sc, flip: false,
      squash: sq, lean: lean, flash: flash
    });

    // 状态色罩
    if (tint) {
      ctx.save();
      ctx.globalAlpha = 0.32;
      ctx.globalCompositeOperation = 'lighter';
      ctx.translate(0, 6);
      ctx.scale(sc, sc * sq);
      ctx.fillStyle = tint;
      ctx.fillRect(-spr.anchorX, -spr.h, spr.w, spr.h);
      ctx.restore();
    }
    ctx.restore();

    // 血条
    if (e.hp < e.maxHp) {
      var w = 30 * (e.scale || 1), h = 4;
      var x = e.x - w / 2, y = e.y - 26 * sc / 3 - 4;
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
      if (pr.type === 'pea') {
        // 拖尾
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = '#8fe06a'; ctx.lineWidth = 3; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(pr.x - pr.vx * 0.03, pr.y - 3); ctx.lineTo(pr.x, pr.y - 3); ctx.stroke();
        ctx.lineCap = 'butt';
        ctx.restore();
        P.draw(ctx, Art.pea, pr.x, pr.y, { frame: 0, scale: 3, squash: 1 });
      } else {
        ctx.save();
        ctx.translate(pr.x, pr.y);
        ctx.rotate(pr.rot);
        ctx.scale(3, 3);
        ctx.imageSmoothingEnabled = false;
        var fr = Math.floor(Math.abs(pr.rot) * 2) % Art.cabbage.n;
        ctx.drawImage(Art.cabbage.frames[fr], -Art.cabbage.anchorX, -Art.cabbage.h);
        ctx.restore();
        // 落点指示
        if (pr.vy > 0) {
          ctx.save();
          ctx.globalAlpha = 0.18 + 0.1 * Math.sin(this.t * 12);
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.ellipse(pr.x + pr.vx * 0.12, pr.targetY || (pr.y + 20), 20, 6, 0, 0, Math.PI * 2);
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
