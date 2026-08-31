/* ============================================================
 *  MetaView —— 局外所有界面
 *
 *  三个屏：
 *    decision  关卡通过 → 继续 / 收手（GDD §9.3 同屏四项：
 *              累积池 / 下一关强度预览 / 预估收益 +R / 失败保底规则）
 *    settle    一局结束 → 保留与损失对照，进家园
 *    home      家园：养成树 / 花园 / 商店 / 图鉴 + 开始新的一局
 *
 *  这里只做展示与点击，所有数值与规则变更一律发事件，不做本地计算。
 * ============================================================ */
(function (global) {
  'use strict';
  var EV = global.Bus.EV, M = global.M;

  var C = {
    gold: '#ffd45e', shard: '#7fe0c0', material: '#ffb08a',
    core: '#6fd6ff', star: '#b9a6ff', stardust: '#c79bff'
  };
  var CUR_CN = {
    gold: '金币', shard: '碎片', material: '材料',
    core: '晶核', star: '星核', stardust: '星尘'
  };

  function fmt(v) {
    if (v === undefined || v === null) return '0';
    return Math.abs(v) >= 100 ? String(Math.round(v)) : (Math.round(v * 10) / 10).toFixed(1);
  }

  function hexA(hex, a) {
    var c = global.PX ? global.PX.hexToRgb(hex) : [255, 255, 255];
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }

  function panel(ctx, x, y, w, h, r, fill, stroke) {
    global.roundRect(ctx, x, y, w, h, r || 14);
    ctx.fillStyle = fill || 'rgba(10,16,26,.94)'; ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
  }

  function bg(ctx, W, H) {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0d1522'); g.addColorStop(1, '#070c15');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.save();
    for (var i = 0; i < 46; i++) {
      var x = (i * 137.5) % W, y = (i * 71.3) % H;
      ctx.globalAlpha = 0.1 + 0.25 * Math.abs(Math.sin(i + performance.now() / 2200));
      ctx.fillStyle = '#cfe6ff';
      ctx.fillRect(x, y, 1.6, 1.6);
    }
    ctx.restore();
  }

  function btn(ctx, b, hover, disabled) {
    ctx.save();
    global.roundRect(ctx, b.x, b.y, b.w, b.h, b.r || 10);
    ctx.fillStyle = disabled ? 'rgba(255,255,255,.05)'
      : hover ? hexA(b.col, 0.32) : hexA(b.col, 0.15);
    ctx.fill();
    ctx.strokeStyle = disabled ? 'rgba(255,255,255,.14)' : hexA(b.col, hover ? 1 : 0.6);
    ctx.lineWidth = hover && !disabled ? 2.2 : 1.4;
    ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '800 ' + (b.fs || 14) + 'px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = disabled ? 'rgba(255,255,255,.3)' : (b.textCol || '#eaf3ff');
    ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + (b.sub ? -8 : 0));
    if (b.sub) {
      ctx.font = '700 11px "Noto Sans SC", system-ui, sans-serif';
      ctx.fillStyle = disabled ? 'rgba(255,255,255,.25)' : hexA(b.col, 0.95);
      ctx.fillText(b.sub, b.x + b.w / 2, b.y + b.h / 2 + 12);
    }
    ctx.restore();
  }

  /* ============================================================ */

  function MetaView(meta, run, opts) {
    opts = opts || {};
    this.meta = meta;
    this.run = run;
    this.W = opts.w || 1040;
    this.H = opts.h || 640;
    this.portrait = !!opts.portrait;
    this.t = 0;
    this.screen = 'none';       // none | decision | settle | home
    this.tab = 'upgrade';       // upgrade | garden | shop | codex
    this.hover = null;
    this.buttons = [];
    this.plantPick = null;      // 花园：当前选择的植物/时长
    this.hexPick = null;        // 商店：正在放置的元素地格
    this.onStart = opts.onStart || null;

    var self = this;
    global.Bus.on(EV.RUN_DECISION, function (d) { self.screen = 'decision'; self.decision = d; }, this);
    global.Bus.on(EV.RUN_GAME_OVER, function (s) { self.screen = 'settle'; self.settle = s; }, this);
    global.Bus.on(EV.META_CHANGED, function () { self.plantPick = null; }, this);
  }

  MetaView.prototype.show = function (s) { this.screen = s || 'home'; this.buttons = []; };
  MetaView.prototype.hide = function () { this.screen = 'none'; this.buttons = []; };

  /** 屏幕形状变化时由 main.js 调过来（横竖屏切换不必重建 MetaView） */
  MetaView.prototype.resize = function (w, h, portrait) {
    this.W = w; this.H = h; this.portrait = !!portrait;
    this.buttons = []; this.hover = null;
  };

  MetaView.prototype.update = function (dt) { this.t += dt; };

  MetaView.prototype.onMove = function (x, y) {
    this.hover = null;
    for (var i = 0; i < this.buttons.length; i++) {
      var b = this.buttons[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) { this.hover = b.id; return; }
    }
  };

  MetaView.prototype.onClick = function (x, y) {
    for (var i = 0; i < this.buttons.length; i++) {
      var b = this.buttons[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        if (b.disabled) return true;
        this._act(b);
        return true;
      }
    }
    return false;
  };

  MetaView.prototype._act = function (b) {
    var a = b.act || {};
    switch (a.type) {
      case 'continue': global.Bus.emit(EV.CMD_CONTINUE, {}); this.hide(); break;
      case 'cashout': global.Bus.emit(EV.CMD_CASH_OUT, {}); break;
      case 'home': this.tab = 'upgrade'; this.show('home'); break;
      case 'tab': this.tab = a.tab; this.buttons = []; break;
      case 'upgrade': global.Bus.emit(EV.CMD_UPGRADE, { key: a.key }); break;
      case 'shop': global.Bus.emit(EV.CMD_SHOP_BUY, { key: a.key, arg: a.arg }); break;
      case 'plantPick': this.plantPick = { kind: a.kind }; break;
      case 'plant':
        if (this.plantPick) {
          global.Bus.emit(EV.CMD_GARDEN_PLANT, {
            slot: a.slot, kind: this.plantPick.kind, duration: a.duration
          });
          this.plantPick = null;
        }
        break;
      case 'harvest': global.Bus.emit(EV.CMD_GARDEN_HARVEST, { slot: a.slot }); break;
      case 'start': if (this.onStart) this.onStart(); break;
      case 'wipe': this.meta.wipe(); break;
    }
  };

  /* ============================================================ */
  /*                        主绘制入口                             */
  /* ============================================================ */

  MetaView.prototype.draw = function (ctx) {
    if (this.screen === 'none') return;
    this.buttons = [];
    ctx.save();
    ctx.textBaseline = 'middle';

    if (this.screen === 'decision') this.drawDecision(ctx);
    else if (this.screen === 'settle') this.drawSettle(ctx);
    else if (this.screen === 'home') this.drawHome(ctx);

    ctx.restore();
  };

  MetaView.prototype._btn = function (id, x, y, w, h, label, col, act, opt) {
    opt = opt || {};
    var b = {
      id: id, x: x, y: y, w: w, h: h, label: label, col: col, act: act,
      sub: opt.sub, fs: opt.fs, r: opt.r, textCol: opt.textCol,
      disabled: !!opt.disabled
    };
    this.buttons.push(b);
    btn(ctx__(), b, this.hover === id, b.disabled);
    return b;
  };

  /* ---- 用当前 ctx（由 draw 期间调用，避免到处传参） ---- */
  var _ctx = null;
  function ctx__() { return _ctx; }

  /* ============================================================ */
  /*                     决策屏：继续 vs 收手                       */
  /* ============================================================ */

  MetaView.prototype.drawDecision = function (ctx) {
    _ctx = ctx;
    var W = this.W, H = this.H, d = this.decision;
    if (!d) return;

    ctx.fillStyle = 'rgba(4,8,14,.80)'; ctx.fillRect(0, 0, W, H);

    if (this.portrait) { this._decisionPortrait(ctx, d); return; }

    ctx.textAlign = 'center';
    ctx.font = '900 30px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = '#8fd9ff';
    ctx.fillText('第 ' + d.level + ' 关 · 通过', W / 2, 74);
    ctx.font = '600 13px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = '#7d95b5';
    ctx.fillText('继续冲关，还是就此收手？', W / 2, 102);

    /* ---- 左：累积池 ---- */
    var px = 92, py = 140, pw = 380, ph = 250;
    panel(ctx, px, py, pw, ph, 16, 'rgba(10,16,26,.95)', 'rgba(140,180,230,.22)');
    ctx.textAlign = 'left';
    ctx.font = '800 14px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = '#eaf3ff';
    ctx.fillText('当前累积池（收手可全额带走）', px + 20, py + 26);

    var keys = ['gold', 'shard', 'material', 'core', 'star'];
    var yy = py + 58;
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      ctx.font = '700 12px "Noto Sans SC", system-ui, sans-serif';
      ctx.fillStyle = '#8fa8c6';
      ctx.fillText(CUR_CN[k], px + 22, yy);
      ctx.textAlign = 'right';
      ctx.font = '900 15px system-ui, sans-serif';
      ctx.fillStyle = C[k];
      ctx.fillText(fmt(d.wallet[k]), px + pw - 22, yy);
      ctx.textAlign = 'left';
      yy += 30;
    }
    // 本关净赚
    ctx.font = '700 11px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = '#6d819e';
    ctx.fillText('本关新增', px + 22, yy + 12);
    ctx.textAlign = 'right';
    ctx.font = '800 11px system-ui, sans-serif';
    ctx.fillStyle = '#9fe8b0';
    ctx.fillText('+' + fmt(d.earned.gold) + ' 金 / +' + fmt(d.earned.shard) + ' 碎片', px + pw - 22, yy + 12);

    /* ---- 右：下一关预览 ---- */
    var qx = 508, qw = 440;
    panel(ctx, qx, py, qw, ph, 16, 'rgba(10,16,26,.95)', 'rgba(255,180,120,.22)');
    ctx.textAlign = 'left';
    ctx.font = '800 14px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = '#eaf3ff';
    ctx.fillText('下一关预览', qx + 20, py + 26);

    // 威胁星级
    var th = d.threat;
    ctx.font = '700 12px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = '#8fa8c6';
    ctx.fillText('威胁等级', qx + 22, py + 62);
    for (var s = 0; s < 10; s++) {
      var on = s < th.stars;
      ctx.beginPath();
      ctx.arc(qx + 100 + s * 17, py + 62, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = on ? (th.stars >= 7 ? '#ff8f6a' : th.stars >= 4 ? '#ffc44d' : '#8fd9ff')
        : 'rgba(255,255,255,.10)';
      ctx.fill();
    }
    ctx.font = '900 13px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = th.stars >= 7 ? '#ff8f6a' : '#ffc44d';
    ctx.fillText(th.label, qx + 290, py + 62);

    ctx.font = '700 12px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = '#8fa8c6';
    ctx.fillText('敌人强度', qx + 22, py + 92);
    ctx.textAlign = 'right';
    ctx.font = '900 14px system-ui, sans-serif';
    ctx.fillStyle = '#ff9f7a';
    ctx.fillText('×' + th.hpMult.toFixed(2), qx + qw - 22, py + 92);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#8fa8c6';
    ctx.font = '700 12px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillText('收益倍率', qx + 22, py + 122);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffd45e';
    ctx.font = '900 14px system-ui, sans-serif';
    ctx.fillText('×' + th.mult.toFixed(2), qx + qw - 22, py + 122);

    /* ---- 决策判据：这是整个设计的核心 ---- */
    var bx = qx + 20, by = py + 150;
    ctx.textAlign = 'left';
    ctx.font = '700 11.5px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = '#6d819e';
    ctx.fillText('继续优于收手，当且仅当你自认通关概率高于：', bx, by);

    ctx.font = '900 30px system-ui, sans-serif';
    ctx.fillStyle = '#ffe45e';
    ctx.fillText((d.threshold * 100).toFixed(0) + '%', bx, by + 34);
    ctx.font = '700 12px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = '#8fa8c6';
    ctx.fillText('（临界概率 p*）', bx + 82, by + 36);

    var good = d.chance > d.threshold;
    ctx.font = '700 12px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = '#6d819e';
    ctx.fillText('系统预估你的通关概率', bx, by + 72);
    ctx.textAlign = 'right';
    ctx.font = '900 20px system-ui, sans-serif';
    ctx.fillStyle = good ? '#9fe8b0' : '#ff8f8f';
    ctx.fillText((d.chance * 100).toFixed(0) + '%', bx + 360, by + 70);
    ctx.textAlign = 'left';
    ctx.font = '700 11px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = good ? '#9fe8b0' : '#ff8f8f';
    ctx.fillText(good ? '→ 数学上应该继续' : '→ 数学上应该收手', bx, by + 96);

    /* ---- 保底规则 ---- */
    ctx.font = '600 11px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,143,143,.85)';
    ctx.fillText('失败保底：星枢失守只能带走 ' + Math.round(d.keep * 100) + '% 的累积池', qx + 20, py + ph - 20);

    /* ---- 按钮 ---- */
    var btnY = 424;
    this._btn('continue', 470, btnY, 240, 62, '继 续 冲 关', '#8fd9ff',
      { type: 'continue' },
      { sub: '预估收益 +' + fmt(d.R) + ' 价值', fs: 16 });
    this._btn('cashout', 730, btnY, 200, 62, '收 手 结 算', '#ffd45e',
      { type: 'cashout' },
      { sub: '带走 100% 累积池', fs: 16 });

    ctx.textAlign = 'center';
    ctx.font = '600 11px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(140,165,195,.6)';
    ctx.fillText('阈值会随关卡升高（第 1 关约 32%，第 5 关约 59%）—— 越往后越该收手', W / 2, H - 30);
  };

  /**
   * 竖屏决策屏。
   * 横屏是「左累积池 / 右下一关预览」左右分栏，540 宽下每栏只剩 250 —— 两块面板改成上下堆叠，
   * 两个按钮也从并排改成上下排列（主操作在上，方便拇指够到）。
   */
  MetaView.prototype._decisionPortrait = function (ctx, d) {
    var W = this.W, H = this.H;
    var pad = 20, cw = W - pad * 2;                 // 500

    ctx.textAlign = 'center';
    ctx.font = '900 24px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = '#8fd9ff';
    ctx.fillText('第 ' + d.level + ' 关 · 通过', W / 2, 64);
    ctx.font = '600 12.5px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = '#7d95b5';
    ctx.fillText('继续冲关，还是就此收手？', W / 2, 92);

    // 先把底部按钮区钉死，两块面板再在剩余空间里垂直居中
    var btnH1 = 64, btnH2 = 56, btnTop = H - 196;
    var top = 118, bot = btnTop - 14;
    var h1 = 236, h2 = 320;
    var py = top + Math.max(0, (bot - top - (h1 + 14 + h2)) / 2);
    var py2 = py + h1 + 14;

    /* ---- 上：累积池 ---- */
    panel(ctx, pad, py, cw, h1, 16, 'rgba(10,16,26,.95)', 'rgba(140,180,230,.22)');
    ctx.textAlign = 'left';
    ctx.font = '800 14px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = '#eaf3ff';
    ctx.fillText('当前累积池（收手可全额带走）', pad + 20, py + 26);

    var keys = ['gold', 'shard', 'material', 'core', 'star'];
    var yy = py + 56;
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      ctx.font = '700 12px "Noto Sans SC", system-ui, sans-serif';
      ctx.fillStyle = '#8fa8c6';
      ctx.fillText(CUR_CN[k], pad + 22, yy);
      ctx.textAlign = 'right';
      ctx.font = '900 15px system-ui, sans-serif';
      ctx.fillStyle = C[k];
      ctx.fillText(fmt(d.wallet[k]), pad + cw - 22, yy);
      ctx.textAlign = 'left';
      yy += 28;
    }
    ctx.font = '700 11px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = '#6d819e';
    ctx.fillText('本关新增', pad + 22, yy + 14);
    ctx.textAlign = 'right';
    ctx.font = '800 11px system-ui, sans-serif';
    ctx.fillStyle = '#9fe8b0';
    ctx.fillText('+' + fmt(d.earned.gold) + ' 金 / +' + fmt(d.earned.shard) + ' 碎片',
      pad + cw - 22, yy + 14);

    /* ---- 下：下一关预览 ---- */
    this._previewPanelPortrait(ctx, pad, py2, cw, h2, d);

    /* ---- 按钮 ---- */
    this._btn('continue', pad, btnTop, cw, btnH1, '继 续 冲 关', '#8fd9ff',
      { type: 'continue' },
      { sub: '预估收益 +' + fmt(d.R) + ' 价值', fs: 16 });
    this._btn('cashout', pad, btnTop + btnH1 + 12, cw, btnH2, '收 手 结 算', '#ffd45e',
      { type: 'cashout' },
      { sub: '带走 100% 累积池', fs: 15 });

    ctx.textAlign = 'center';
    ctx.font = '600 11px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(140,165,195,.6)';
    ctx.fillText('阈值随关卡升高（第 1 关约 32%，第 5 关约 59%）', W / 2, H - 34);
  };

  /** 竖屏「下一关预览」面板 */
  MetaView.prototype._previewPanelPortrait = function (ctx, qx, py, qw, ph, d) {
    panel(ctx, qx, py, qw, ph, 16, 'rgba(10,16,26,.95)', 'rgba(255,180,120,.22)');
    ctx.textAlign = 'left';
    ctx.font = '800 14px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = '#eaf3ff';
    ctx.fillText('下一关预览', qx + 20, py + 26);

    var th = d.threat;
    ctx.font = '700 12px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = '#8fa8c6';
    ctx.fillText('威胁等级', qx + 22, py + 62);
    for (var s = 0; s < 10; s++) {
      var on = s < th.stars;
      ctx.beginPath();
      ctx.arc(qx + 100 + s * 17, py + 62, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = on ? (th.stars >= 7 ? '#ff8f6a' : th.stars >= 4 ? '#ffc44d' : '#8fd9ff')
        : 'rgba(255,255,255,.10)';
      ctx.fill();
    }
    ctx.font = '900 13px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = th.stars >= 7 ? '#ff8f6a' : '#ffc44d';
    ctx.fillText(th.label, qx + 290, py + 62);

    ctx.font = '700 12px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = '#8fa8c6';
    ctx.fillText('敌人强度', qx + 22, py + 92);
    ctx.textAlign = 'right';
    ctx.font = '900 14px system-ui, sans-serif';
    ctx.fillStyle = '#ff9f7a';
    ctx.fillText('×' + th.hpMult.toFixed(2), qx + qw - 22, py + 92);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#8fa8c6';
    ctx.font = '700 12px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillText('收益倍率', qx + 22, py + 122);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffd45e';
    ctx.font = '900 14px system-ui, sans-serif';
    ctx.fillText('×' + th.mult.toFixed(2), qx + qw - 22, py + 122);

    /* ---- 决策判据：整个设计的核心 ---- */
    var bx = qx + 20, by = py + 150;
    ctx.textAlign = 'left';
    ctx.font = '700 11.5px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = '#6d819e';
    ctx.fillText('继续优于收手，当且仅当你自认通关概率高于：', bx, by);

    ctx.font = '900 30px system-ui, sans-serif';
    ctx.fillStyle = '#ffe45e';
    ctx.fillText((d.threshold * 100).toFixed(0) + '%', bx, by + 34);
    ctx.font = '700 12px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = '#8fa8c6';
    ctx.fillText('（临界概率 p*）', bx + 82, by + 36);

    var good = d.chance > d.threshold;
    ctx.font = '700 12px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = '#6d819e';
    ctx.fillText('系统预估你的通关概率', bx, by + 72);
    ctx.textAlign = 'right';
    ctx.font = '900 20px system-ui, sans-serif';
    ctx.fillStyle = good ? '#9fe8b0' : '#ff8f8f';
    ctx.fillText((d.chance * 100).toFixed(0) + '%', bx + 360, by + 70);
    ctx.textAlign = 'left';
    ctx.font = '700 11px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = good ? '#9fe8b0' : '#ff8f8f';
    ctx.fillText(good ? '→ 数学上应该继续' : '→ 数学上应该收手', bx, by + 96);

    /* ---- 保底规则 ---- */
    ctx.font = '600 11px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,143,143,.85)';
    ctx.fillText('失败保底：星枢失守只能带走 ' + Math.round(d.keep * 100) + '% 的累积池',
      qx + 20, py + ph - 20);
  };

  /* ============================================================ */
  /*                        结算屏                                 */
  /* ============================================================ */

  MetaView.prototype.drawSettle = function (ctx) {
    _ctx = ctx;
    var W = this.W, H = this.H, s = this.settle;
    if (!s) return;
    bg(ctx, W, H);

    // 竖屏：面板改成满宽，标题字号收一档，底部按钮改成贴底
    var P = this.portrait;
    var win = s.outcome === 'cashout';
    ctx.textAlign = 'center';
    ctx.font = '900 ' + (P ? 28 : 36) + 'px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = win ? '#ffe45e' : '#ff8f8f';
    ctx.fillText(win ? '收 工 结 算' : '星 枢 失 守', W / 2, P ? 76 : 86);
    ctx.font = '600 ' + (P ? 12.5 : 13) + 'px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = '#8fa8c6';
    ctx.fillText('抵达第 ' + s.level + ' 关 · 击杀 ' + s.stats.kills + ' · 合成 ' + s.stats.merges +
      ' 次 · 最高方块 ' + (s.stats.best || 0) + ' · 附魔 ' + s.stats.casts + ' 次', W / 2, P ? 108 : 118);

    // 保留 / 损失对照
    var px = P ? 20 : 150, py = P ? 146 : 156, pw = P ? W - 40 : 740, ph = P ? 256 : 250;
    panel(ctx, px, py, pw, ph, 16, 'rgba(10,16,26,.94)', 'rgba(140,180,230,.22)');
    var keys = ['gold', 'shard', 'material', 'core', 'star', 'stardust'];
    var colW = (pw - 60) / 3;
    ctx.textAlign = 'center';
    ctx.font = '800 12px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = '#6d819e';
    ctx.fillText('货币', px + 30 + colW * 0.5, py + 28);
    ctx.fillText('带走', px + 30 + colW * 1.5, py + 28);
    ctx.fillText('损失', px + 30 + colW * 2.5, py + 28);

    for (var i = 0; i < keys.length; i++) {
      var k = keys[i], y = py + 62 + i * 30;
      ctx.font = '700 12.5px "Noto Sans SC", system-ui, sans-serif';
      ctx.fillStyle = C[k]; ctx.textAlign = 'center';
      ctx.fillText(CUR_CN[k], px + 30 + colW * 0.5, y);
      ctx.font = '900 15px system-ui, sans-serif';
      ctx.fillStyle = '#eaf3ff';
      ctx.fillText(fmt(s.kept[k]), px + 30 + colW * 1.5, y);
      ctx.font = '800 13px system-ui, sans-serif';
      ctx.fillStyle = s.lost[k] > 0.05 ? '#ff8f8f' : 'rgba(255,255,255,.22)';
      ctx.fillText(s.lost[k] > 0.05 ? '−' + fmt(s.lost[k]) : '—', px + 30 + colW * 2.5, y);
    }
    ctx.font = '700 11px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = '#6d819e';
    ctx.fillText('保留比例 ' + Math.round(s.keepRatio * 100) + '%' +
      (win ? '' : '　（失败保底，GDD §9.1 的 b = 0.40）'), px + pw / 2, py + ph - 18);

    // 构筑回顾
    var d = global.__GAME && global.__GAME.cards;
    var sum = d ? d.summary() : [];
    if (sum.length) {
      ctx.textAlign = 'left';
      ctx.font = '800 13px "Noto Sans SC", system-ui, sans-serif';
      ctx.fillStyle = '#eaf3ff';
      ctx.fillText('本局构筑（总战力点 ' + d.totalPP().toFixed(1) + '）', px, P ? py + ph + 26 : 438);
      var bx = px, byY = P ? py + ph + 50 : 462;
      for (var j = 0; j < Math.min(sum.length, 12); j++) {
        var it = sum[j];
        var R = global.CardView.RARITY[it.card.rarity] || global.CardView.RARITY['普通'];
        var tw = ctx.measureText(it.card.name + (it.n > 1 ? ' ×' + it.n : '')).width + 22;
        if (bx + tw > px + pw) { bx = px; byY += 28; }
        global.roundRect(ctx, bx, byY - 11, tw, 22, 6);
        ctx.fillStyle = hexA(R.col, 0.14); ctx.fill();
        ctx.strokeStyle = hexA(R.col, 0.5); ctx.lineWidth = 1; ctx.stroke();
        ctx.font = '700 11px "Noto Sans SC", system-ui, sans-serif';
        ctx.fillStyle = R.col;
        ctx.fillText(it.card.name + (it.n > 1 ? ' ×' + it.n : ''), bx + 11, byY);
        bx += tw + 8;
      }
    }

    this._btn('home', W / 2 - (P ? 160 : 110), P ? H - 90 : 546, P ? 320 : 220, 50,
      '回 到 家 园', '#8fd9ff', { type: 'home' }, { fs: 16 });
  };

  /* ============================================================ */
  /*                         家园                                  */
  /* ============================================================ */

  MetaView.prototype.drawHome = function (ctx) {
    _ctx = ctx;
    bg(ctx, this.W, this.H);
    if (this.portrait) this._homePortrait(ctx);
    else this._homeLandscape(ctx);
  };

  /** 顶部四个 Tab（横竖屏共用，宽度自适应） */
  MetaView.prototype._tabs = function (ctx, x, y, w, h) {
    var tabs = [['upgrade', '养成树'], ['garden', '花园'], ['shop', '商店'], ['codex', '图鉴']];
    var gap = 6;
    var tw = (w - gap * (tabs.length - 1)) / tabs.length;
    var fs = h >= 34 ? 13 : 12.5;
    for (var t = 0; t < tabs.length; t++) {
      var on = this.tab === tabs[t][0];
      var tx = x + t * (tw + gap);
      global.roundRect(ctx, tx, y, tw, h, 9);
      ctx.fillStyle = on ? 'rgba(143,217,255,.18)' : 'rgba(255,255,255,.04)';
      ctx.fill();
      ctx.strokeStyle = on ? '#8fd9ff' : 'rgba(255,255,255,.12)';
      ctx.lineWidth = on ? 2 : 1; ctx.stroke();
      ctx.textAlign = 'center';
      ctx.font = '800 ' + fs + 'px "Noto Sans SC", system-ui, sans-serif';
      ctx.fillStyle = on ? '#eaf3ff' : '#8fa8c6';
      ctx.fillText(tabs[t][1], tx + tw / 2, y + h / 2);
      this.buttons.push({
        id: 'tab' + t, x: tx, y: y, w: tw, h: h, col: '#8fd9ff',
        act: { type: 'tab', tab: tabs[t][0] }, label: tabs[t][1], disabled: false
      });
    }
  };

  /** 顶部资源条：从右往左排，数值在上、名字在下 */
  MetaView.prototype._resBar = function (ctx, xRight, yNum, yName, gap, fsNum, fsName) {
    var p = this.meta.profile;
    var res = [['星尘', p.stardust, C.stardust], ['金币', p.gold, C.gold],
    ['碎片', p.shard, C.shard], ['材料', p.material, C.material], ['晶核', p.core, C.core]];
    ctx.save();
    ctx.textAlign = 'right';
    var rx = xRight;
    for (var i = res.length - 1; i >= 0; i--) {
      ctx.font = '900 ' + fsNum + 'px system-ui, sans-serif';
      ctx.fillStyle = res[i][2];
      ctx.fillText(fmt(res[i][1]), rx, yNum);
      ctx.font = '600 ' + fsName + 'px "Noto Sans SC", system-ui, sans-serif';
      ctx.fillStyle = '#6d819e';
      ctx.fillText(res[i][0], rx, yName);
      rx -= gap;
    }
    ctx.restore();
  };

  /** 底部「开始新的一局」+ 历史统计 */
  MetaView.prototype._startBar = function (ctx, bw, bh, fs) {
    var W = this.W, H = this.H, p = this.meta.profile;
    this._btn('start', W / 2 - bw / 2, H - bh - 16, bw, bh, '开 始 新 的 一 局', '#9fe8b0',
      { type: 'start' }, { fs: fs });
    ctx.textAlign = 'center';
    ctx.font = '600 10.5px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(140,165,195,.6)';
    ctx.fillText('历史最佳：第 ' + (p.stats.bestLevel || 0) + ' 关 · 累计 ' +
      (p.stats.runs || 0) + ' 局 · 累计击杀 ' + (p.stats.totalKills || 0),
      W / 2, H - bh - 34);
  };

  /* ---- 横屏：原版布局 ---- */
  MetaView.prototype._homeLandscape = function (ctx) {
    var W = this.W, H = this.H;
    ctx.textAlign = 'left';
    ctx.font = '900 24px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = '#eaf3ff';
    ctx.fillText('星序家园', 32, 40);
    this._resBar(ctx, W - 32, 32, 48, 96, '15', '10');
    this._tabs(ctx, 32, 66, 4 * 96 + 3 * 8, 32);

    if (this.tab === 'upgrade') this._upgradeTab(ctx, 32, 116, W - 64, H - 200);
    else if (this.tab === 'garden') this._gardenTab(ctx, 32, 116, W - 64, H - 200);
    else if (this.tab === 'shop') this._shopTab(ctx, 32, 116, W - 64, H - 200);
    else this._codexTab(ctx, 32, 116, W - 64, H - 200);

    this._startBar(ctx, 300, 52, 17);
  };

  /* ---- 竖屏：资源条独占一行，Tab 拉满，内容区吃掉剩余高度 ---- */
  MetaView.prototype._homePortrait = function (ctx) {
    var W = this.W, H = this.H;
    var pad = 20, cw = W - pad * 2;         // 500

    ctx.textAlign = 'left';
    ctx.font = '900 20px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = '#eaf3ff';
    ctx.fillText('星序家园', pad, 32);

    // 540 宽塞不下「标题 + 5 项资源」并排，资源条下移一行、字号收紧
    this._resBar(ctx, W - pad, 56, 70, 92, '14', '9');

    var tabY = 88, tabH = 34;
    this._tabs(ctx, pad, tabY, cw, tabH);

    var bodyY = tabY + tabH + 14;            // 136
    var bodyH = H - bodyY - 120;             // 给底部按钮和统计留出位置

    if (this.tab === 'upgrade') this._upgradeTab(ctx, pad, bodyY, cw, bodyH);
    else if (this.tab === 'garden') this._gardenTab(ctx, pad, bodyY, cw, bodyH);
    else if (this.tab === 'shop') this._shopTab(ctx, pad, bodyY, cw, bodyH);
    else this._codexTab(ctx, pad, bodyY, cw, bodyH);

    this._startBar(ctx, cw, 54, 17);
  };

  /* ---- 养成树 ---- */
  MetaView.prototype._upgradeTab = function (ctx, x, y, w, h) {
    var p = this.meta.profile, U = global.Meta.UPGRADES;
    var keys = ['root', 'branch', 'bud', 'fruit'];
    // 竖屏：4 列 → 2×2。540 宽下分 4 列每列只剩 ~122，卡片内的等级点阵（10 点×18）就放不下了
    var cols = this.portrait ? 2 : 4;
    var rows = Math.ceil(keys.length / cols);
    var gap = this.portrait ? 14 : 16;
    var cw = (w - gap * (cols - 1)) / cols;
    var bh = (h - gap * (rows - 1)) / rows - (this.portrait ? 0 : 12);

    ctx.textAlign = 'left';
    ctx.font = '600 11.5px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = '#6d819e';
    ctx.fillText('永久养成 · 星尘消耗 · 满级约 6,820 星尘（约 3–5 周长线）', x, y - 8);

    for (var i = 0; i < keys.length; i++) {
      var k = keys[i], u = U[k], lv = this.meta.upLevel(k);
      var bx = x + (i % cols) * (cw + gap);
      var by = y + Math.floor(i / cols) * (bh + gap);
      panel(ctx, bx, by, cw, bh, 14, 'rgba(10,16,26,.9)', hexA(u.color, 0.28));

      ctx.textAlign = 'center';
      ctx.font = '900 20px "Noto Sans SC", system-ui, sans-serif';
      ctx.fillStyle = u.color;
      ctx.fillText(u.icon, bx + cw / 2, by + 30);
      ctx.font = '800 15px "Noto Sans SC", system-ui, sans-serif';
      ctx.fillStyle = '#eaf3ff';
      ctx.fillText(u.name, bx + cw / 2, by + 56);
      ctx.font = '700 10.5px "Noto Sans SC", system-ui, sans-serif';
      ctx.fillStyle = '#8fa8c6';
      wrapC(ctx, u.desc, bx + cw / 2, by + 82, cw - 28, 15);

      // 等级点阵
      var dotY = by + 142;
      for (var d = 0; d < u.maxLv; d++) {
        var dx = bx + (cw - u.maxLv * 18) / 2 + d * 18 + 9;
        ctx.beginPath(); ctx.arc(dx, dotY, 6, 0, Math.PI * 2);
        ctx.fillStyle = d < lv ? u.color : 'rgba(255,255,255,.08)';
        ctx.fill();
        if (d < lv) {
          ctx.strokeStyle = hexA(u.color, 0.6); ctx.lineWidth = 1; ctx.stroke();
        }
      }
      ctx.font = '900 13px system-ui, sans-serif';
      ctx.fillStyle = u.color;
      ctx.fillText('Lv.' + lv + ' / ' + u.maxLv, bx + cw / 2, dotY + 26);

      ctx.font = '600 10.5px "Noto Sans SC", system-ui, sans-serif';
      ctx.fillStyle = '#6d819e';
      wrapC(ctx, '每级：' + u.per, bx + cw / 2, dotY + 48, cw - 24, 14);

      var maxed = this.meta.upMaxed(k);
      var cost = this.meta.nextCost(k);
      this._btn('up_' + k, bx + 18, by + bh - 62, cw - 36, 44,
        maxed ? '已 满 级' : '升级 · ' + cost + ' 星尘',
        u.color, { type: 'upgrade', key: k },
        { disabled: maxed || p.stardust < cost, fs: 14,
          sub: maxed ? 'Lv.' + u.maxLv : '当前 ' + p.stardust + ' 星尘' });
    }
  };

  /* ---- 花园 ---- */
  MetaView.prototype._gardenTab = function (ctx, x, y, w, h) {
    var p = this.meta.profile, m = this.meta;
    ctx.textAlign = 'left';
    ctx.font = '600 11.5px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = '#6d819e';
    // 完整公式在 540 宽的屏上会顶出边界，竖屏只留结论
    ctx.fillText(this.portrait
      ? '花园 · 离线最多累计 ' + global.Meta.CAP.offlineH + ' 小时'
      : '花园 · 离线最多累计 ' + global.Meta.CAP.offlineH +
      ' 小时 · 产出 = 稀有度基础 ×(1+星级×0.1) ×(1+花园等级×0.05) ×(1+果实加成)', x, y - 8);

    // 竖屏：最多 6 个花盆一行排不下（每格只剩 ~71），改成 3 列 × 2 行
    var pts = Math.max(1, p.pots);
    var cols = this.portrait ? 3 : pts;
    var rows = Math.ceil(pts / cols);
    var gap = 14;
    var rowGap = 12;
    var cw = (w - gap * (cols - 1)) / cols;
    var bh = this.portrait ? 244 : 220;

    for (var i = 0; i < p.pots; i++) {
      var bx = x + (i % cols) * (cw + gap);
      var by = y + Math.floor(i / cols) * (bh + rowGap);
      panel(ctx, bx, by, cw, bh, 14, 'rgba(10,16,26,.9)', 'rgba(127,224,192,.24)');
      var g = p.garden[i];
      ctx.textAlign = 'center';

      if (!g) {
        ctx.font = '700 12px "Noto Sans SC", system-ui, sans-serif';
        ctx.fillStyle = '#6d819e';
        ctx.fillText('空 花 盆', bx + cw / 2, by + 40);
        // 选择植物
        var kinds = ['sprout', 'peashooter', 'cabbagepult'];
        // 原来是 by+68，按这个起点「选时长」那排按钮会掉出面板底边，上移到 by+56
        var ky = by + 56;
        ctx.font = '600 10.5px "Noto Sans SC", system-ui, sans-serif';
        ctx.fillStyle = '#8fa8c6';
        ctx.fillText(this.plantPick ? '再选时长种下' : '① 选植物', bx + cw / 2, ky - 10);
        for (var k = 0; k < kinds.length; k++) {
          var kk = kinds[k];
          var sel = this.plantPick && this.plantPick.kind === kk;
          var rate = m.yieldRate(kk);
          this._btn('pk_' + i + '_' + kk, bx + 12, ky + k * 34, cw - 24, 30,
            global.Meta.PLANTS[kk].name + ' · ' + rate.toFixed(1) + '/h',
            sel ? '#9fe8b0' : '#7fe0c0', { type: 'plantPick', kind: kk }, { fs: 11.5 });
        }
        if (this.plantPick) {
          ctx.font = '600 10.5px "Noto Sans SC", system-ui, sans-serif';
          ctx.fillStyle = '#8fa8c6';
          ctx.fillText('② 选时长', bx + cw / 2, ky + 116);
          var DS = global.Meta.DURATIONS;
          for (var q = 0; q < DS.length; q++) {
            this._btn('pl_' + i + '_' + DS[q].key, bx + 12 + q * ((cw - 24) / 3),
              ky + 132, (cw - 24) / 3 - 4, 28, DS[q].name,
              '#9fe8b0', { type: 'plant', slot: i, duration: DS[q].key }, { fs: 10.5 });
          }
        }
      } else {
        var prog = m.potProgress(i);
        var yld = m.potYield(i);
        var A = global.PlantArt.Art ? global.PlantArt.Art.icon[g.kind] : null;
        if (A) {
          var sway = Math.sin(this.t * 1.6 + i) * 0.06;
          ctx.save();
          ctx.translate(bx + cw / 2, by + 52);
          ctx.rotate(sway);
          global.PX.draw(ctx, A, 0, 16, { frame: Math.floor(this.t * 8) % (A.frames || 1), scale: 2.2 });
          ctx.restore();
        }
        ctx.font = '800 12.5px "Noto Sans SC", system-ui, sans-serif';
        ctx.fillStyle = '#eaf3ff';
        ctx.fillText(global.Meta.PLANTS[g.kind].name, bx + cw / 2, by + 84);

        // 进度条
        var pw2 = cw - 40;
        ctx.fillStyle = 'rgba(255,255,255,.08)';
        global.roundRect(ctx, bx + 20, by + 100, pw2, 12, 6); ctx.fill();
        ctx.fillStyle = prog >= 1 ? '#9fe8b0' : '#7fe0c0';
        global.roundRect(ctx, bx + 20, by + 100, pw2 * prog, 12, 6); ctx.fill();
        ctx.font = '700 10px system-ui, sans-serif';
        ctx.fillStyle = '#8fa8c6';
        ctx.fillText(prog >= 1 ? '已成熟 · ' + yld + ' 星尘' :
          Math.floor(prog * 100) + '% · 预计 ' + yld + ' 星尘', bx + cw / 2, by + 126);

        this._btn('hv_' + i, bx + 20, by + 146, cw - 40, 38,
          prog >= 1 ? '收 获' : '生长中', '#9fe8b0', { type: 'harvest', slot: i },
          { disabled: prog < 1, fs: 13 });
      }
    }

    // 花园等级 / 统计
    var fy = y + rows * (bh + rowGap) + 10;
    ctx.textAlign = 'left';
    ctx.font = '700 12px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = '#8fa8c6';
    ctx.fillText('花园等级 Lv.' + p.gardenLevel + '　花盆 ' + p.pots + ' / 6　' +
      '累计产出 ' + (p.stats.totalStardust || 0) + ' 星尘', x, fy);
    ctx.font = '600 11px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = '#6d819e';
    ctx.fillText('花盆扩容在「商店」购买；产出加成在「养成树 · 果实」分支。', x, fy + 22);
  };

  /* ---- 商店 ---- */
  MetaView.prototype._shopTab = function (ctx, x, y, w, h) {
    var m = this.meta, p = m.profile;
    ctx.textAlign = 'left';
    ctx.font = '600 11.5px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = '#6d819e';
    ctx.fillText('商店 · 只卖养成速度与容量，绝不卖局内战力（GDD v0.2 §4 红线）', x, y - 8);

    var items = global.Meta.SHOP;
    // 竖屏：2 列 → 1 列（每列只有 ~242，价格标签会和商品名挤到一起）
    var cols = this.portrait ? 1 : 2;
    var gap = 16, rowH = 74;
    var rows = Math.ceil(items.length / cols);
    var cw = (w - gap * (cols - 1)) / cols;

    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var st = m.shopItemState(it);
      var bx = x + (i % cols) * (cw + gap);
      var by = y + Math.floor(i / cols) * rowH;
      panel(ctx, bx, by, cw, 66, 12, 'rgba(10,16,26,.9)',
        st === 'owned' ? 'rgba(159,232,176,.4)' : 'rgba(140,180,230,.2)');

      ctx.textAlign = 'left';
      ctx.font = '800 13.5px "Noto Sans SC", system-ui, sans-serif';
      ctx.fillStyle = st === 'owned' ? '#9fe8b0' : '#eaf3ff';
      ctx.fillText(it.name, bx + 16, by + 22);
      ctx.font = '600 10.5px "Noto Sans SC", system-ui, sans-serif';
      ctx.fillStyle = '#8fa8c6';
      ctx.fillText(it.desc, bx + 16, by + 44);

      var costTxt = [];
      if (it.cost.gold) costTxt.push(fmt(it.cost.gold) + ' 金');
      if (it.cost.material) costTxt.push(it.cost.material + ' 材料');
      if (it.cost.shard) costTxt.push(it.cost.shard + ' 碎片');
      var label = st === 'owned' ? '已拥有' : st === 'locked' ? '需前置' : costTxt.join(' + ');

      this._btn('sh_' + i, bx + cw - 130, by + 16, 114, 34, label,
        st === 'owned' ? '#9fe8b0' : '#ffd45e', { type: 'shop', key: it.id },
        { disabled: st !== 'buy', fs: 12 });
    }

    // 元素地格状态（竖屏地格多了会顶出右边界，字号收一档）
    ctx.textAlign = 'left';
    ctx.font = '700 ' + (this.portrait ? 11 : 12) + 'px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = '#8fa8c6';
    ctx.fillText('已染棋盘元素地格：' + (p.boardHexes.length ?
      p.boardHexes.map(function (hx) {
        return '(' + (hx.c + 1) + ',' + (hx.r + 1) + ')' + global.Battlefield.ELEMENT_CN[hx.element];
      }).join(' ') : '暂无'), x, y + rows * rowH + 16);
  };

  /* ---- 图鉴 ---- */
  MetaView.prototype._codexTab = function (ctx, x, y, w, h) {
    var p = this.meta.profile;
    ctx.textAlign = 'left';
    ctx.font = '600 11.5px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = '#6d819e';
    ctx.fillText('图鉴 · 植物与昆虫', x, y - 8);

    var kinds = ['sprout', 'peashooter', 'cabbagepult'];
    // 横屏沿用原版固定 178 宽 / 190 步进；竖屏改成 3 等分撑满 500
    var bw = this.portrait ? (w - 20) / 3 : 178;
    var step = this.portrait ? bw + 10 : 190;

    for (var i = 0; i < kinds.length; i++) {
      var k = kinds[i], pd = global.Meta.PLANTS[k];
      var bx = x + i * step, by = y, bh = 200;
      panel(ctx, bx, by, bw, bh, 14, 'rgba(10,16,26,.9)', 'rgba(127,224,192,.24)');
      var A = global.PlantArt.Art ? global.PlantArt.Art.icon[k] : null;
      if (A) {
        ctx.save();
        ctx.translate(bx + bw / 2, by + 56);
        ctx.rotate(Math.sin(this.t * 1.5 + i * 1.3) * 0.06);
        global.PX.draw(ctx, A, 0, 20, { frame: Math.floor(this.t * 8) % (A.frames || 1), scale: 2.6 });
        ctx.restore();
      }
      ctx.textAlign = 'center';
      ctx.font = '800 14px "Noto Sans SC", system-ui, sans-serif';
      ctx.fillStyle = '#eaf3ff';
      ctx.fillText(pd.name, bx + bw / 2, by + 100);
      ctx.font = '700 10.5px "Noto Sans SC", system-ui, sans-serif';
      ctx.fillStyle = '#8fa8c6';
      ctx.fillText(global.Meta.RARITY_CN[pd.rarity] + ' · 花园 ' + pd.base + ' 星尘/时', bx + bw / 2, by + 120);
      var pl = p.plants[k] || { star: 1, level: 1 };
      ctx.fillStyle = '#ffd45e';
      ctx.fillText('★' + pl.star + ' · Lv.' + pl.level, bx + bw / 2, by + 140);
      ctx.font = '600 10px "Noto Sans SC", system-ui, sans-serif';
      ctx.fillStyle = '#6d819e';
      ctx.fillText('花园产出 ' + this.meta.yieldRate(k).toFixed(1) + ' / 时', bx + bw / 2, by + 162);
    }

    // 昆虫
    var ins = [
      ['ant', '普通蚂蚁', '中速中血，成群推进'],
      ['fireant', '红火蚁', '高速低血，携带灼烧光晕'],
      ['beetle', '天牛', '高血高护甲，重甲单位']
    ];
    var insY = this.portrait ? y + 216 : y + 224;
    var insCY = this.portrait ? y + 232 : y + 240;
    ctx.textAlign = 'left';
    ctx.font = '800 13px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = '#eaf3ff';
    ctx.fillText('昆虫', x, insY);
    for (var j = 0; j < ins.length; j++) {
      var bx2 = x + j * step, by2 = insCY;
      var cx2 = bx2 + bw / 2;
      panel(ctx, bx2, by2, bw, 150, 14, 'rgba(10,16,26,.9)', 'rgba(255,159,122,.22)');
      var IA = global.InsectArt.Art ? global.InsectArt.Art[ins[j][0]] : null;
      if (IA) {
        ctx.save();
        ctx.translate(cx2, by2 + 54);
        global.PX.draw(ctx, IA, 0, 14, {
          frame: Math.floor(this.t * 9) % (IA.frames || 1), scale: 2.4
        });
        ctx.restore();
      }
      ctx.textAlign = 'center';
      ctx.font = '800 13px "Noto Sans SC", system-ui, sans-serif';
      ctx.fillStyle = '#eaf3ff';
      ctx.fillText(ins[j][1], cx2, by2 + 96);
      ctx.font = '600 10px "Noto Sans SC", system-ui, sans-serif';
      ctx.fillStyle = '#8fa8c6';
      wrapC(ctx, ins[j][2], cx2, by2 + 118, bw - 20, 14);
    }

    // 存档管理：竖屏昆虫卡占满三列，按钮挪到整块下方右侧
    this._btn('wipe', this.portrait ? x + w - 110 : x + w - 130,
      this.portrait ? y + 400 : y + 240,
      this.portrait ? 110 : 130, 34, '清空存档', '#ff8f8f',
      { type: 'wipe' }, { fs: 12 });
  };

  function wrapC(ctx, text, cx, y, maxW, lh) {
    var lines = [], cur = '';
    ctx.textAlign = 'center';
    for (var i = 0; i < text.length; i++) {
      var t = cur + text[i];
      if (ctx.measureText(t).width > maxW && cur.length) { lines.push(cur); cur = text[i]; }
      else cur = t;
    }
    if (cur) lines.push(cur);
    for (var k = 0; k < lines.length; k++) ctx.fillText(lines[k], cx, y + k * lh);
  }

  global.MetaView = MetaView;
})(window);
