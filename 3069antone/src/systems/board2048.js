/* ============================================================
 *  Board2048 —— 纯逻辑的 2048 系统
 *
 *  独立契约：
 *    · 不认识 Battlefield、不认识渲染、不读 DOM
 *    · 只通过 Bus 发事件 / 收命令
 *    · 对外只暴露：grid、steps、tier、move()、update()、reset()
 *
 *  与 GDD v0.2 的对应：
 *    5x5 棋盘 / 每步生成 1 块 / 步数上限 10 / 1s 回复 1 步
 *    生成池按关卡分 5 档（弱分层 M2） / 棋盘跨关保留 BOARD_CARRY=1
 * ============================================================ */
(function (global) {
  'use strict';
  var EV = global.Bus.EV;

  /** 弱分层五档生成池（GDD v0.2 · M2） */
  var TIERS = [
    { name: 'T1', pool: [2, 4], w: [90, 10], E: 2.2, levels: '1–2', goal: '冲 256' },
    { name: 'T2', pool: [2, 4, 8], w: [70, 20, 10], E: 3.0, levels: '3–4', goal: '冲 256 稳定化' },
    { name: 'T3', pool: [4, 8], w: [80, 20], E: 4.8, levels: '5–6', goal: '冲 512' },
    { name: 'T4', pool: [4, 8, 16], w: [70, 20, 10], E: 6.0, levels: '7–9', goal: '冲 512 稳定化' },
    { name: 'T5', pool: [8, 16], w: [80, 20], E: 9.6, levels: '10+', goal: '冲 1024' }
  ];

  function Board2048(opts) {
    opts = opts || {};
    this.n = opts.n || 5;
    this.seed = opts.seed || (Date.now() & 0xffff);
    this.rng = new global.RNG(this.seed);

    this.stepMax = opts.stepMax !== undefined ? opts.stepMax : 10;
    this.stepRegen = opts.stepRegen !== undefined ? opts.stepRegen : 1;
    this.spawnPerMove = 1;
    this.initTiles = 2;

    this.tier = 1;
    this.steps = this.stepMax;
    this._regen = 0;
    this.jammed = false;
    this.stats = { moves: 0, merges: 0, best: 0, wasted: 0 };

    // 卡牌修正值：Board 只取自己关心的字段，Cards 不存在时保持默认
    this.mod = { stepRegen: 1, cvMult: 1 };

    this.grid = [];
    this._uid = 1;
    this.reset();
    this._bind();
  }

  Board2048.tiers = TIERS;

  Board2048.prototype._bind = function () {
    var self = this;
    global.Bus.on(EV.CMD_MOVE, function (p) { self.move(p.dir); }, this);
    global.Bus.on(EV.CMD_GRANT_STEPS, function (p) { self.grantSteps(p.n); }, this);
    global.Bus.on(EV.CMD_SET_TIER, function (p) { self.setTier(p.tier); }, this);

    // 卡牌修正：只认字段，不认系统。没有 Cards 时这条事件永远不会来，默认值生效。
    global.Bus.on(EV.MOD_CHANGED, function (p) {
      self.mod.stepRegen = p.mod.stepRegen;
      self.mod.cvMult = p.mod.cvMult;
    }, this);
  };

  /** 实际步数回复周期（秒）—— 受「疾风」等卡影响 */
  Board2048.prototype.regenPeriod = function () {
    return this.stepRegen / (this.mod.stepRegen || 1);
  };

  /* ---------------- 基础 ---------------- */

  Board2048.prototype.tierCfg = function () { return TIERS[this.tier - 1] || TIERS[0]; };
  Board2048.prototype.E = function () { return this.tierCfg().E; };

  Board2048.prototype.reset = function (keepTiles) {
    this.grid = [];
    for (var r = 0; r < this.n; r++) {
      this.grid.push([]);
      for (var c = 0; c < this.n; c++) this.grid[r].push(null);
    }
    this._uid = 1;
    if (!keepTiles) {
      for (var i = 0; i < this.initTiles; i++) this._spawn(true);
    }
    this.jammed = false;
    global.Bus.emit(EV.BOARD_RESET, { board: this });
  };

  Board2048.prototype.setTier = function (t) {
    t = global.M.clamp(t | 0, 1, 5);
    if (t === this.tier) return;
    this.tier = t;
  };

  Board2048.prototype.emptyCells = function () {
    var out = [];
    for (var r = 0; r < this.n; r++)
      for (var c = 0; c < this.n; c++)
        if (!this.grid[r][c]) out.push([r, c]);
    return out;
  };

  Board2048.prototype._spawn = function (silent) {
    var e = this.emptyCells();
    if (!e.length) return null;
    var p = e[Math.floor(this.rng.next() * e.length)];
    var cfg = this.tierCfg();
    var v = this.rng.weighted(cfg.pool, cfg.w);
    var t = {
      id: this._uid++, v: v, r: p[0], c: p[1],
      // 动画用
      fromR: p[0], fromC: p[1], spawnT: 0, mergedT: 0, justMerged: false, dead: false
    };
    this.grid[p[0]][p[1]] = t;
    if (!silent) global.Bus.emit(EV.BOARD_SPAWN, { value: v, x: p[1], y: p[0], tile: t });
    return t;
  };

  Board2048.prototype.grantSteps = function (n) {
    this.steps = Math.min(this.stepMax, this.steps + (n | 0));
    global.Bus.emit(EV.BOARD_STEP, { steps: this.steps, max: this.stepMax, reason: 'grant' });
  };

  /* ---------------- 移动 ---------------- */

  var VEC = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };

  Board2048.prototype._line = function (dir, i) {
    // 返回该行/列在“朝 dir 方向压缩”时的坐标序列（从最靠近边的一端开始）
    var n = this.n, out = [], k;
    if (dir === 'left') { for (k = 0; k < n; k++) out.push([i, k]); }
    else if (dir === 'right') { for (k = n - 1; k >= 0; k--) out.push([i, k]); }
    else if (dir === 'up') { for (k = 0; k < n; k++) out.push([k, i]); }
    else { for (k = n - 1; k >= 0; k--) out.push([k, i]); }
    return out;
  };

  Board2048.prototype.canMove = function () {
    var n = this.n;
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        var t = this.grid[r][c];
        if (!t) return true;
        if (c + 1 < n && this.grid[r][c + 1] && this.grid[r][c + 1].v === t.v) return true;
        if (r + 1 < n && this.grid[r + 1][c] && this.grid[r + 1][c].v === t.v) return true;
      }
    }
    return false;
  };

  /**
   * 执行一次移动。
   * @returns {moved:boolean, merges:[], spawned:tile|null, reason:string}
   */
  Board2048.prototype.move = function (dir) {
    if (!VEC[dir]) return { moved: false, reason: 'baddir' };
    if (this.steps <= 0) {
      global.Bus.emit(EV.BOARD_STEP, { steps: 0, max: this.stepMax, reason: 'nostep' });
      return { moved: false, reason: 'nostep' };
    }

    var n = this.n, allMerges = [], moved = false, self = this;
    var before = this._snapshot();

    for (var i = 0; i < n; i++) {
      var coords = this._line(dir, i);
      var tiles = [];
      for (var a = 0; a < coords.length; a++) {
        var t = this.grid[coords[a][0]][coords[a][1]];
        if (t) tiles.push(t);
      }
      // 压缩 + 合并
      var out = [], k = 0, chain = 0;
      while (k < tiles.length) {
        if (k + 1 < tiles.length && tiles[k].v === tiles[k + 1].v) {
          var A = tiles[k], B = tiles[k + 1];
          var nv = A.v * 2;
          var dest = coords[out.length];
          A.r = dest[0]; A.c = dest[1];
          A.v = nv;
          A.justMerged = true; A.mergedT = 0;
          B.dead = true;
          B.r = dest[0]; B.c = dest[1];         // 被吞的那块滑到同一格再消失
          out.push(A);
          allMerges.push({
            value: nv, x: dest[1], y: dest[0],
            chainIndex: chain, tileId: A.id, consumed: B.id
          });
          chain++;
          k += 2;
        } else {
          var t2 = tiles[k];
          var d2 = coords[out.length];
          t2.r = d2[0]; t2.c = d2[1];
          out.push(t2);
          k++;
        }
      }
      // 重建该行
      for (var q = 0; q < coords.length; q++) this.grid[coords[q][0]][coords[q][1]] = null;
      for (var q2 = 0; q2 < out.length; q2++) this.grid[out[q2].r][out[q2].c] = out[q2];
    }

    moved = !this._sameAs(before);

    // 清掉被吞的块（保留一帧供渲染做消失动画）
    for (var r2 = 0; r2 < n; r2++) {
      for (var c2 = 0; c2 < n; c2++) {
        var tt = this.grid[r2][c2];
        if (tt && tt.dead) this.grid[r2][c2] = null;
      }
    }

    if (!moved) {
      this.stats.wasted++;
      global.Bus.emit(EV.BOARD_MOVE, { dir: dir, moved: false, stepsLeft: this.steps, reason: 'blocked' });
      return { moved: false, reason: 'blocked' };
    }

    this.steps--;
    this.stats.moves++;
    var spawned = null;
    for (var s = 0; s < this.spawnPerMove; s++) spawned = this._spawn();

    // 记录本次移动的“链长”与“全局序号”，供外部判断
    //   chainIndex = 行内第几次合并（渲染用）
    //   seq        = 本次移动内的全局第几次（「连锁」卡判定用，跨行累计）
    for (var m = 0; m < allMerges.length; m++) {
      allMerges[m].chainLen = allMerges.length;
      allMerges[m].seq = m;
    }
    this.stats.merges += allMerges.length;
    for (var m2 = 0; m2 < allMerges.length; m2++) {
      if (allMerges[m2].value > this.stats.best) this.stats.best = allMerges[m2].value;
    }

    global.Bus.emit(EV.BOARD_MOVE, { dir: dir, moved: true, stepsLeft: this.steps, merges: allMerges.length });
    for (var m3 = 0; m3 < allMerges.length; m3++) {
      global.Bus.emit(EV.BOARD_MERGE, allMerges[m3]);
    }
    global.Bus.emit(EV.BOARD_STEP, { steps: this.steps, max: this.stepMax, reason: 'spend' });

    if (!this.canMove()) {
      this.jammed = true;
      global.Bus.emit(EV.BOARD_JAMMED, { reason: 'nomove' });
    }
    return { moved: true, merges: allMerges, spawned: spawned };
  };

  Board2048.prototype._snapshot = function () {
    var s = [];
    for (var r = 0; r < this.n; r++) for (var c = 0; c < this.n; c++) {
      var t = this.grid[r][c];
      s.push(t ? t.v : 0);
    }
    return s.join(',');
  };
  Board2048.prototype._sameAs = function (snap) { return this._snapshot() === snap; };

  /* ---------------- 步数回复 ---------------- */

  Board2048.prototype.update = function (dt) {
    if (this.steps < this.stepMax) {
      this._regen += dt;
      var period = this.regenPeriod();
      while (this._regen >= period && this.steps < this.stepMax) {
        this._regen -= period;
        this.steps++;
        global.Bus.emit(EV.BOARD_STEP, { steps: this.steps, max: this.stepMax, reason: 'regen' });
      }
    } else {
      this._regen = 0;
    }
    // 生成块动画计时
    for (var r = 0; r < this.n; r++) {
      for (var c = 0; c < this.n; c++) {
        var t = this.grid[r][c];
        if (!t) continue;
        if (t.spawnT < 1) t.spawnT = Math.min(1, t.spawnT + dt * 7);
        if (t.justMerged) {
          t.mergedT += dt * 5;
          if (t.mergedT >= 1) { t.justMerged = false; }
        }
      }
    }
  };

  global.Board2048 = Board2048;
})(window);
