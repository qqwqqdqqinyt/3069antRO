/* ============================================================
 *  boardView.js —— 2048 棋盘的渲染（只读系统状态，不反过来驱动逻辑）
 * ============================================================ */
(function (global) {
  'use strict';
  var M = global.M;

  var TILE_COLORS = {
    2: ['#cfd8e8', '#eef3fa', '#5a6478'], 4: ['#a9cfe8', '#d8ecfb', '#33465c'],
    8: ['#7fb6e6', '#b3d9f5', '#123049'], 16: ['#6f9fe0', '#a6c8f2', '#ffffff'],
    32: ['#8f7fd6', '#c3b7ee', '#ffffff'], 64: ['#b07ad0', '#ddb8ec', '#ffffff'],
    128: ['#d46fb8', '#f0aede', '#ffffff'], 256: ['#f0638f', '#ffa6c0', '#ffffff'],
    512: ['#ff7a4d', '#ffb08c', '#ffffff'], 1024: ['#ffb03a', '#ffd68a', '#4a2c00'],
    2048: ['#ffe45e', '#fff3ad', '#5a4400'], 4096: ['#b6ff6a', '#d9ffae', '#2b4a08'],
    8192: ['#6affe0', '#b6fff2', '#05463d'], 16384: ['#9ce8ff', '#d2f5ff', '#06374a']
  };

  function BoardView(board, region) {
    this.board = board;
    this.region = region;
    this.pad = 10;
    this.gap = 8;
    this.tilePos = {};      // id -> {x,y,s}
    this.ghosts = [];       // 合并消失中的块
    this.flashT = 0;
    this.layout();
  }

  BoardView.prototype.layout = function () {
    var r = this.region, n = this.board.n;
    var size = Math.min(r.w, r.h) - this.pad * 2;
    this.cell = (size - this.gap * (n + 1)) / n;
    this.ox = r.x + (r.w - size) / 2 + this.gap;
    this.oy = r.y + this.pad + this.gap;
  };

  BoardView.prototype.cellX = function (c) { return this.ox + c * (this.cell + this.gap); };
  BoardView.prototype.cellY = function (r) { return this.oy + r * (this.cell + this.gap); };

  BoardView.prototype.update = function (dt) {
    var b = this.board, seen = {}, self = this;
    for (var r = 0; r < b.n; r++) {
      for (var c = 0; c < b.n; c++) {
        var t = b.grid[r][c];
        if (!t) continue;
        seen[t.id] = 1;
        var p = this.tilePos[t.id];
        var tx = this.cellX(c), ty = this.cellY(r);
        if (!p) { p = this.tilePos[t.id] = { x: tx, y: ty, s: 0 }; }
        p.x = M.damp(p.x, tx, 22, dt);
        p.y = M.damp(p.y, ty, 22, dt);
        var want = t.justMerged ? 1.22 : 1;
        if (!t.justMerged) p.s = M.damp(p.s, 1, 16, dt);
        else p.s = M.damp(p.s, want, 30, dt);
      }
    }
    // 清理消失的块
    Object.keys(this.tilePos).forEach(function (id) {
      if (!seen[id]) delete self.tilePos[id];
    });
    if (this.flashT > 0) this.flashT -= dt;
  };

  BoardView.prototype.draw = function (ctx) {
    var b = this.board, n = b.n, self = this;
    var R = this.region;

    // 背板
    roundRect(ctx, R.x, R.y, R.w, R.h, 16);
    var g = ctx.createLinearGradient(0, R.y, 0, R.y + R.h);
    g.addColorStop(0, 'rgba(20,32,52,.92)');
    g.addColorStop(1, 'rgba(12,20,36,.96)');
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(120,170,230,.28)'; ctx.lineWidth = 1.5; ctx.stroke();

    // 标题
    ctx.save();
    ctx.font = '700 13px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = '#9fc4e8'; ctx.textAlign = 'left';
    ctx.fillText('星序棋盘 · ' + b.tierCfg().name + '（' + b.tierCfg().levels + ' 关）', R.x + 14, R.y + 22);
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillStyle = '#6f8bab'; ctx.textAlign = 'right';
    ctx.fillText('技巧门槛：' + b.tierCfg().goal, R.x + R.w - 14, R.y + 22);
    ctx.restore();

    var gy = R.y + 32;
    // 网格底
    var gw = n * this.cell + (n + 1) * this.gap;
    roundRect(ctx, this.ox - this.gap + 2, this.oy - this.gap + 2, gw - 4, gw - 4, 12);
    ctx.fillStyle = 'rgba(8,16,30,.62)'; ctx.fill();
    for (var i = 0; i < n; i++) {
      for (var j = 0; j < n; j++) {
        roundRect(ctx, this.cellX(j), this.cellY(i), this.cell, this.cell, 8);
        ctx.fillStyle = 'rgba(255,255,255,.045)'; ctx.fill();
      }
    }

    // 方块
    for (var r2 = 0; r2 < n; r2++) {
      for (var c2 = 0; c2 < n; c2++) {
        var t = b.grid[r2][c2];
        if (!t) continue;
        var p = this.tilePos[t.id] || { x: this.cellX(c2), y: this.cellY(r2), s: 0 };
        this._tile(ctx, t, p);
      }
    }

    // 步数 / 充能 / 货币
    var iy = this.oy + gw + 12;
    this._steps(ctx, R.x + 14, iy);
    this._charge(ctx, R.x + 14, iy + 42, R.w - 28);
  };

  BoardView.prototype._tile = function (ctx, t, p) {
    var col = TILE_COLORS[t.v] || ['#8ea0b8', '#c8d4e4', '#101820'];
    var s = p.s, size = this.cell * s;
    var cx = p.x + this.cell / 2, cy = p.y + this.cell / 2;
    ctx.save();
    ctx.translate(cx, cy);
    if (t.justMerged) {
      var k = 1 + Math.sin(Math.min(1, t.mergedT) * Math.PI) * 0.14;
      ctx.scale(k, k);
    }
    // 外发光（高值块）
    if (t.v >= 256) {
      ctx.shadowColor = col[0]; ctx.shadowBlur = 14 + Math.log(t.v) * 1.2;
    }
    roundRect(ctx, -size / 2, -size / 2, size, size, Math.max(5, size * 0.13));
    var g = ctx.createLinearGradient(0, -size / 2, 0, size / 2);
    g.addColorStop(0, col[1]); g.addColorStop(1, col[0]);
    ctx.fillStyle = g; ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1.4; ctx.stroke();
    // 内高光
    roundRect(ctx, -size / 2 + 3, -size / 2 + 3, size - 6, (size - 6) * 0.42, size * 0.1);
    ctx.fillStyle = 'rgba(255,255,255,.16)'; ctx.fill();

    // 数字
    var txt = String(t.v);
    var fs = size * (txt.length >= 4 ? 0.30 : txt.length === 3 ? 0.36 : 0.44);
    ctx.font = '900 ' + fs.toFixed(1) + 'px "Noto Sans SC", system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = col[2];
    ctx.fillText(txt, 0, size * 0.03);

    // 超载星级标记
    if (t.v >= 256) {
      var star = Math.round(Math.log(t.v) / Math.LN2) - 7;
      ctx.font = '900 ' + (size * 0.2).toFixed(1) + 'px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(40,24,0,.75)';
      ctx.fillText('★' + star, 0, -size * 0.30);
    }
    ctx.restore();
  };

  BoardView.prototype._steps = function (ctx, x, y) {
    var b = this.board;
    ctx.save();
    ctx.font = '700 12px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = '#9fc4e8'; ctx.textAlign = 'left';
    ctx.fillText('步数', x, y + 12);
    for (var i = 0; i < b.stepMax; i++) {
      var on = i < b.steps;
      roundRect(ctx, x + 40 + i * 20, y, 16, 16, 5);
      ctx.fillStyle = on ? '#7fe0a0' : 'rgba(255,255,255,.10)';
      ctx.fill();
      if (on) { ctx.strokeStyle = '#bff7d0'; ctx.lineWidth = 1; ctx.stroke(); }
    }
    // 回复进度
    if (b.steps < b.stepMax) {
      var w = 20 * b.stepMax;
      var pr = b._regen / b.stepRegen;
      roundRect(ctx, x + 40, y + 18, w, 3, 2);
      ctx.fillStyle = 'rgba(255,255,255,.10)'; ctx.fill();
      roundRect(ctx, x + 40, y + 18, w * pr, 3, 2);
      ctx.fillStyle = 'rgba(127,224,160,.6)'; ctx.fill();
    }
    ctx.restore();
  };

  BoardView.prototype._charge = function (ctx, x, y, w) {
    var d = this.director;
    var pct = d ? M.clamp(d.charge / global.Director.K.CHARGE_MAX, 0, 1) : 0;
    ctx.save();
    ctx.font = '700 12px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = '#9fc4e8'; ctx.textAlign = 'left';
    ctx.fillText('充能', x, y + 11);

    roundRect(ctx, x + 36, y, w - 36, 15, 7);
    ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fill();
    if (pct > 0) {
      roundRect(ctx, x + 36, y, (w - 36) * pct, 15, 7);
      var g = ctx.createLinearGradient(x, 0, x + w, 0);
      g.addColorStop(0, '#6fd6ff'); g.addColorStop(0.6, '#a98cff'); g.addColorStop(1, '#ff9ee0');
      ctx.fillStyle = g; ctx.fill();
      if (pct > 0.9) {
        ctx.shadowColor = '#ffd2f5'; ctx.shadowBlur = 12;
        roundRect(ctx, x + 36, y, (w - 36) * pct, 15, 7); ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
    ctx.font = '800 10px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.textAlign = 'center';
    ctx.fillText(Math.floor(pct * 100) + '%', x + 36 + (w - 36) / 2, y + 11);
    ctx.restore();
  };

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  global.BoardView = BoardView;
  global.roundRect = roundRect;
})(window);
