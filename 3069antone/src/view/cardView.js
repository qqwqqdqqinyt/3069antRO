/* ============================================================
 *  CardView —— 肉鸽三选一面板
 *
 *  设计要点（GDD §9.3 的同屏原则同样适用于三选一）：
 *    · 卡面必须同屏显示「名字 + 效果 + 稀有度 + 战力点 + 已持有层数」
 *    · 战力点(PP)直接印在卡面上 —— 让玩家自己学会用这把尺子评估卡
 *    · 图标全部代码绘制，与植物/昆虫保持同一套像素语言
 * ============================================================ */
(function (global) {
  'use strict';

  var RARITY = {
    '普通': { col: '#9fb4cc', glow: 'rgba(159,180,204,.35)', bg: '#141c28' },
    '稀有': { col: '#5fb4ff', glow: 'rgba(95,180,255,.45)', bg: '#101c2c' },
    '史诗': { col: '#c58bff', glow: 'rgba(197,139,255,.5)', bg: '#1a1230' },
    '传说': { col: '#ffc44d', glow: 'rgba(255,196,77,.55)', bg: '#2a1e0c' },
    '经济': { col: '#ffd45e', glow: 'rgba(255,212,94,.4)', bg: '#241f0e' },
    '生存': { col: '#7fe0c0', glow: 'rgba(127,224,192,.4)', bg: '#0f2620' }
  };

  var ELEM_COL = {
    fire: '#ff7a2b', water: '#4aa8ff', wood: '#6cc04a',
    light: '#ffe07a', thunder: '#ffd93c', ice: '#8fd9ff'
  };

  /* ---------------- 卡面图标（代码绘制） ---------------- */

  function icon(ctx, card, cx, cy, s, t) {
    ctx.save();
    ctx.translate(cx, cy);
    var pulse = 1 + Math.sin(t * 2.2) * 0.04;
    ctx.scale(s * pulse, s * pulse);
    ctx.imageSmoothingEnabled = false;

    if (card.element) { drawElement(ctx, card.element, t); }
    else if (card.tag === 'plant') { drawPlantGlyph(ctx, card.id, t); }
    else if (card.tag === 'charge' || card.tag === 'step') { drawBolt(ctx, card.id, t); }
    else if (card.tag === 'enchant') { drawOrb(ctx, card.id, t); }
    else if (card.tag === 'econ') { drawCoin(ctx, card.id, t); }
    else if (card.tag === 'defense') { drawShield(ctx, card.id, t); }
    else { drawCrosshair(ctx, t); }

    ctx.restore();
  }

  function drawElement(ctx, el, t) {
    var c = ELEM_COL[el] || '#fff';
    // 外圈
    ctx.beginPath(); ctx.arc(0, 0, 17, 0, Math.PI * 2);
    ctx.fillStyle = hexA(c, 0.18); ctx.fill();
    ctx.strokeStyle = hexA(c, 0.75); ctx.lineWidth = 2; ctx.stroke();

    ctx.fillStyle = c;
    ctx.strokeStyle = c;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    if (el === 'fire') {           // 火苗
      ctx.beginPath();
      ctx.moveTo(0, -11);
      ctx.quadraticCurveTo(9, -2, 5, 6);
      ctx.quadraticCurveTo(3, 11, 0, 11);
      ctx.quadraticCurveTo(-3, 11, -5, 6);
      ctx.quadraticCurveTo(-9, -2, 0, -11);
      ctx.fill();
      ctx.fillStyle = '#fff3c4';
      ctx.beginPath();
      ctx.moveTo(0, -3); ctx.quadraticCurveTo(4, 2, 0, 7);
      ctx.quadraticCurveTo(-4, 2, 0, -3); ctx.fill();
    } else if (el === 'water') {   // 水滴
      ctx.beginPath();
      ctx.moveTo(0, -12);
      ctx.bezierCurveTo(8, -2, 9, 9, 0, 9);
      ctx.bezierCurveTo(-9, 9, -8, -2, 0, -12);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.55)';
      ctx.beginPath(); ctx.ellipse(-2.5, 1, 1.8, 3.2, 0, 0, Math.PI * 2); ctx.fill();
    } else if (el === 'wood') {    // 叶片
      ctx.beginPath();
      ctx.moveTo(0, 11);
      ctx.bezierCurveTo(-11, 4, -9, -10, 0, -11);
      ctx.bezierCurveTo(9, -10, 11, 4, 0, 11);
      ctx.fill();
      ctx.strokeStyle = 'rgba(20,60,20,.7)'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(0, 10); ctx.lineTo(0, -9); ctx.stroke();
    } else if (el === 'light') {   // 星芒
      ctx.beginPath();
      for (var i = 0; i < 8; i++) {
        var a = i * Math.PI / 4, r = (i % 2 === 0 ? 12 : 5);
        var x = Math.cos(a) * r, y = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(0, 0, 3.2, 0, Math.PI * 2); ctx.fill();
    } else if (el === 'thunder') { // 闪电
      ctx.beginPath();
      ctx.moveTo(2, -12); ctx.lineTo(-6, 1); ctx.lineTo(-1, 1);
      ctx.lineTo(-3, 12); ctx.lineTo(7, -2); ctx.lineTo(1, -2);
      ctx.closePath(); ctx.fill();
    } else {                        // 冰晶
      ctx.lineWidth = 2.4;
      for (var k = 0; k < 3; k++) {
        var ang = k * Math.PI / 3 + t * 0.25;
        ctx.beginPath();
        ctx.moveTo(-Math.cos(ang) * 12, -Math.sin(ang) * 12);
        ctx.lineTo(Math.cos(ang) * 12, Math.sin(ang) * 12);
        ctx.stroke();
      }
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawPlantGlyph(ctx, id, t) {
    // 直接复用植物像素精灵，保持视觉一致
    var A = global.PlantArt && global.PlantArt.Art ? global.PlantArt.Art.icon : null;
    var kind = (id === 'bigshot') ? 'cabbagepult'
      : (id === 'twinbarrel' || id === 'crit' || id === 'rapid') ? 'peashooter'
        : 'sprout';
    if (A && A[kind]) {
      var f = Math.floor(t * 8) % (A[kind].frames || 1);
      global.PX.draw(ctx, A[kind], 0, 14, { frame: f, scale: 2.0 });
      return;
    }
    // 兜底：一片叶子
    ctx.fillStyle = '#6cc04a';
    ctx.beginPath();
    ctx.moveTo(0, 12); ctx.bezierCurveTo(-11, 4, -9, -10, 0, -11);
    ctx.bezierCurveTo(9, -10, 11, 4, 0, 12); ctx.fill();
  }

  function drawBolt(ctx, id, t) {
    var c = id === 'gale' || id === 'surge' ? '#8fd9ff' : '#ffd93c';
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, Math.PI * 2);
    ctx.globalAlpha = 0.16; ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = hexA(c, 0.7); ctx.lineWidth = 2; ctx.stroke();

    if (id === 'gale' || id === 'surge') {   // 步数：向右的箭头雨
      ctx.strokeStyle = c; ctx.lineWidth = 3; ctx.lineCap = 'round';
      for (var i = 0; i < 3; i++) {
        var off = ((t * 26 + i * 9) % 27) - 13;
        ctx.globalAlpha = 0.5 + 0.5 * Math.sin((off + 13) / 27 * Math.PI);
        ctx.beginPath();
        ctx.moveTo(off - 4, -8 + i * 8); ctx.lineTo(off + 3, -8 + i * 8);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(off + 3, -8 + i * 8); ctx.lineTo(off - 1, -11 + i * 8);
        ctx.moveTo(off + 3, -8 + i * 8); ctx.lineTo(off - 1, -5 + i * 8);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    } else {                                  // 充能：向上充能条 + 闪电
      ctx.fillStyle = hexA(c, 0.22);
      ctx.fillRect(-8, -10, 16, 20);
      var h = 20 * (0.35 + 0.6 * (0.5 + 0.5 * Math.sin(t * 3)));
      ctx.fillStyle = c;
      ctx.fillRect(-8, 10 - h, 16, h);
      ctx.fillStyle = '#fffbe0';
      ctx.beginPath();
      ctx.moveTo(1, -6); ctx.lineTo(-4, 1); ctx.lineTo(-0.5, 1);
      ctx.lineTo(-2, 7); ctx.lineTo(4, -1); ctx.lineTo(0.5, -1);
      ctx.closePath(); ctx.fill();
    }
  }

  function drawOrb(ctx, id, t) {
    var c = id === 'singularity' ? '#c58bff' : '#ff9ee8';
    var r = 13 + Math.sin(t * 2.6) * 1.6;
    var g = ctx.createRadialGradient(-3, -3, 1, 0, 0, r + 3);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.4, c);
    g.addColorStop(1, hexA(c, 0.15));
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = hexA(c, 0.85); ctx.lineWidth = 1.6; ctx.stroke();
    // 环绕粒子
    for (var i = 0; i < 5; i++) {
      var a = t * 1.4 + i * Math.PI * 2 / 5;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * (r + 5), Math.sin(a) * (r + 5) * 0.45, 1.8, 0, Math.PI * 2);
      ctx.fillStyle = hexA(c, 0.9); ctx.fill();
    }
  }

  function drawCoin(ctx, id, t) {
    var c = id === 'stardust' ? '#b9a6ff' : id === 'scavenger' ? '#ffb08a' : '#ffd45e';
    var sq = Math.abs(Math.cos(t * 2.0));       // 旋转的伪 3D
    ctx.beginPath(); ctx.ellipse(0, 0, 13 * (0.25 + 0.75 * sq), 13, 0, 0, Math.PI * 2);
    ctx.fillStyle = c; ctx.fill();
    ctx.strokeStyle = hexA('#7a5a10', 0.8); ctx.lineWidth = 1.6; ctx.stroke();
    if (sq > 0.35) {
      ctx.fillStyle = 'rgba(90,60,10,.75)';
      ctx.font = '900 13px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(id === 'stardust' ? '★' : '$', 0, 1);
    }
  }

  function drawShield(ctx, id, t) {
    var c = id === 'mender' ? '#9fe8b0' : id === 'thorn' ? '#ff9f7a' : '#7fe0c0';
    ctx.beginPath();
    ctx.moveTo(0, -13);
    ctx.lineTo(11, -7); ctx.lineTo(11, 4);
    ctx.quadraticCurveTo(11, 11, 0, 14);
    ctx.quadraticCurveTo(-11, 11, -11, 4);
    ctx.lineTo(-11, -7); ctx.closePath();
    ctx.fillStyle = hexA(c, 0.22); ctx.fill();
    ctx.strokeStyle = c; ctx.lineWidth = 2.2; ctx.stroke();
    if (id === 'mender') {                 // 十字
      ctx.fillStyle = c;
      ctx.fillRect(-2, -6, 4, 12); ctx.fillRect(-6, -2, 12, 4);
    } else if (id === 'thorn') {           // 尖刺
      ctx.fillStyle = c;
      for (var i = 0; i < 5; i++) {
        var a = -Math.PI / 2 + (i - 2) * 0.5;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 5, Math.sin(a) * 5);
        ctx.lineTo(Math.cos(a + 0.22) * 11, Math.sin(a + 0.22) * 11);
        ctx.lineTo(Math.cos(a - 0.22) * 11, Math.sin(a - 0.22) * 11);
        ctx.closePath(); ctx.fill();
      }
    } else {                                // 砖墙
      ctx.fillStyle = hexA(c, 0.85);
      for (var r = 0; r < 3; r++)
        for (var q = 0; q < 3; q++)
          ctx.fillRect(-9 + q * 6.5 + (r % 2 ? 1 : 0), -6 + r * 5, 5.5, 4);
    }
  }

  function drawCrosshair(ctx, t) {
    var c = '#ff9f7a';
    ctx.strokeStyle = c; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.stroke();
    var g = 6 + Math.sin(t * 3) * 3;
    ctx.beginPath();
    ctx.moveTo(-g, 0); ctx.lineTo(-2, 0); ctx.moveTo(2, 0); ctx.lineTo(g, 0);
    ctx.moveTo(0, -g); ctx.lineTo(0, -2); ctx.moveTo(0, 2); ctx.lineTo(0, g);
    ctx.stroke();
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.arc(0, 0, 2.4, 0, Math.PI * 2); ctx.fill();
  }

  function hexA(hex, a) {
    var c = global.PX ? global.PX.hexToRgb(hex) : [255, 255, 255];
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }

  /* ============================================================ */

  function CardView(cards, opts) {
    opts = opts || {};
    this.cards = cards;
    this.W = opts.w || 1040;
    this.H = opts.h || 640;
    this.portrait = !!opts.portrait;
    this.t = 0;
    this.hover = -1;
    this.rects = [];
    this.anim = [0, 0, 0];   // 每张卡的入场进度
    var self = this;
    global.Bus.on(global.Bus.EV.CARD_DRAFT, function () { self.show(); }, this);
    global.Bus.on(global.Bus.EV.CARD_PICKED, function () { self.hide(); }, this);
    this.visible = false;
  }

  CardView.prototype.show = function () {
    this.visible = true;
    this.t = 0;
    this.anim = [0, 0, 0];
  };
  CardView.prototype.hide = function () { this.visible = false; this.hover = -1; };

  /** 屏幕形状变化时由 main.js 调过来（横竖屏切换不必重建 CardView） */
  CardView.prototype.resize = function (w, h, portrait) {
    this.W = w; this.H = h; this.portrait = !!portrait;
    this.rects = [];
  };

  CardView.prototype.update = function (dt) {
    this.t += dt;
    for (var i = 0; i < 3; i++) {
      // 依次入场，间隔 0.09s
      var target = M.clamp((this.t - i * 0.09) / 0.34, 0, 1);
      this.anim[i] += (target - this.anim[i]) * Math.min(1, dt * 22);
    }
  };

  /** 命中测试：返回卡片索引或 -1 */
  CardView.prototype.hitTest = function (x, y) {
    for (var i = 0; i < this.rects.length; i++) {
      var r = this.rects[i];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i;
    }
    return -1;
  };

  CardView.prototype.onMove = function (x, y) { this.hover = this.hitTest(x, y); };

  CardView.prototype.onClick = function (x, y) {
    var i = this.hitTest(x, y);
    if (i >= 0 && this.cards && this.cards.pending && this.cards.pending.options[i]) {
      global.Bus.emit(global.Bus.EV.CMD_CARD_PICK, { id: this.cards.pending.options[i].id });
      return true;
    }
    return false;
  };

  CardView.prototype.draw = function (ctx) {
    if (!this.visible || !this.cards || !this.cards.pending) return;
    var p = this.cards.pending;
    var W = this.W, H = this.H;

    ctx.save();
    ctx.fillStyle = 'rgba(4,8,14,.80)';
    ctx.fillRect(0, 0, W, H);

    var n = p.options.length;
    var cw, ch, gap, sx, topY;

    if (this.portrait) {
      // 竖屏：三张横排需要 3×236 + 2×26 = 760 逻辑宽，而屏宽只有 540 —— 只能改成纵向堆叠
      var avail = H - 112 - 56;                       // 上下留出标题区和提示区
      ch = Math.max(210, Math.min(270, (avail - 28) / 3));
      cw = Math.min(W - 72, 420);
      gap = 14;
      sx = (W - cw) / 2;
      topY = 112 + (avail - (ch * 3 + gap * 2)) / 2;  // 三张整体垂直居中
    } else {
      cw = 236; ch = 330; gap = 26;
      sx = (W - (n * cw + (n - 1) * gap)) / 2;
      topY = H / 2 - 6 - ch / 2;
    }

    // 标题
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '900 ' + (this.portrait ? 22 : 26) + 'px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = '#eaf3ff';
    ctx.fillText('三 选 一', W / 2, this.portrait ? 62 : 92);
    ctx.font = '600 12px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = '#7d95b5';
    var sub = p.reason === 'level' ? '通关奖励 · 选择一张卡带入下一关' : '第 ' + p.wave + ' 波清空 · 选择一张卡';
    ctx.fillText(sub, W / 2, this.portrait ? 86 : 118);

    this.rects = [];
    for (var i = 0; i < n; i++) {
      var card = p.options[i];
      var a = this.anim[i];
      var hov = (this.hover === i);
      var x = this.portrait ? sx : sx + i * (cw + gap);
      // 入场：从下方浮起 + 淡入
      var y = (this.portrait ? topY + i * (ch + gap) : topY) + (1 - a) * 46;
      var lift = hov ? (this.portrait ? -6 : -10) : 0;
      ctx.globalAlpha = a;
      this._card(ctx, card, x, y + lift, cw, ch, hov, i);
      ctx.globalAlpha = 1;
      this.rects.push({ x: x, y: y + lift, w: cw, h: ch });
    }

    ctx.font = '600 11px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(140,165,195,.72)';
    ctx.textAlign = 'center';
    ctx.fillText(this.portrait
      ? '点击卡面选择　·　PP 越高，对输出的提升越大'
      : '点击卡面或按 1 / 2 / 3 选择　·　战力点 PP 越高，对输出的提升越大',
      W / 2, this.portrait ? H - 30 : H - 54);
    ctx.restore();
  };

  CardView.prototype._card = function (ctx, card, x, y, w, h, hover, idx) {
    var R = RARITY[card.rarity] || RARITY['普通'];
    var stack = this.cards.count(card.id);

    ctx.save();
    if (hover) {
      ctx.shadowColor = R.glow;
      ctx.shadowBlur = 26;
    }
    global.roundRect(ctx, x, y, w, h, 16);
    ctx.fillStyle = R.bg; ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = hover ? 3 : 2;
    ctx.strokeStyle = hover ? R.col : hexA(R.col, 0.55);
    ctx.stroke();

    // 顶部稀有度条
    ctx.save();
    global.roundRect(ctx, x, y, w, h, 16); ctx.clip();
    var g = ctx.createLinearGradient(x, y, x, y + 54);
    g.addColorStop(0, hexA(R.col, 0.30));
    g.addColorStop(1, hexA(R.col, 0));
    ctx.fillStyle = g; ctx.fillRect(x, y, w, 54);
    ctx.restore();

    // 稀有度标签
    ctx.font = '800 11px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = R.col; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(card.rarity, x + 14, y + 18);
    // 快捷键
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    ctx.font = '800 12px system-ui, sans-serif';
    ctx.fillText(String(idx + 1), x + w - 14, y + 18);

    // 卡面内部各元素的纵向偏移：
    // 横屏沿用原版固定值；竖屏卡更矮（210~270），按新节奏重排，并砍掉 flavor 让位给描述
    var P = !this.portrait;
    var iY = P ? 92 : 76;
    var nY = P ? 152 : 124;
    var dY = P ? 182 : 150;
    var dLh = P ? 18 : 17;
    var dW = P ? w - 34 : w - 40;
    var dLines = P ? 4 : 3;
    var oY = P ? h - 74 : h - 62;
    var pY = P ? h - 44 : h - 34;

    // 图标
    icon(ctx, card, x + w / 2, y + iY, P ? 1.05 : 1.0, this.t + idx);

    // 名称
    ctx.textAlign = 'center';
    ctx.font = '900 19px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = '#f2f8ff';
    ctx.fillText(card.name, x + w / 2, y + nY);

    // 效果描述（自动折行）
    ctx.font = '600 12.5px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = '#c8d8ea';
    wrapText(ctx, card.desc, x + w / 2, y + dY, dW, dLh, dLines);

    // 已持有
    if (stack > 0) {
      ctx.font = '800 11px "Noto Sans SC", system-ui, sans-serif';
      ctx.fillStyle = '#9fe8b0';
      ctx.fillText('已持有 ×' + stack, x + w / 2, y + oY);
    }

    // 战力点
    ctx.font = '700 10px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(140,165,195,.8)';
    ctx.fillText('战力点', x + w / 2 - 26, y + pY);
    ctx.font = '900 17px system-ui, sans-serif';
    ctx.fillStyle = card.pp >= 20 ? '#ffc44d' : card.pp >= 11 ? '#c58bff'
      : card.pp >= 7 ? '#5fb4ff' : '#9fb4cc';
    ctx.fillText(card.pp > 0 ? card.pp.toFixed(1) : '—', x + w / 2 + 12, y + pY + 1);

    // flavor（竖屏空间不够，省略）
    if (card.flavor && P) {
      ctx.font = '500 10px "Noto Sans SC", system-ui, sans-serif';
      ctx.fillStyle = 'rgba(140,165,195,.55)';
      wrapText(ctx, card.flavor, x + w / 2, y + h - 22, w - 30, 13, 1);
    }
    ctx.restore();
  };

  function wrapText(ctx, text, cx, y, maxW, lh, maxLines) {
    var lines = [], cur = '';
    for (var i = 0; i < text.length; i++) {
      var test = cur + text[i];
      if (ctx.measureText(test).width > maxW && cur.length) {
        lines.push(cur); cur = text[i];
        if (lines.length >= maxLines) { cur = ''; break; }
      } else cur = test;
    }
    if (cur && lines.length < maxLines) lines.push(cur);
    if (lines.length >= maxLines && text.length > lines.join('').length) {
      lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1) + '…';
    }
    for (var k = 0; k < lines.length; k++) ctx.fillText(lines[k], cx, y + k * lh);
  }

  CardView.RARITY = RARITY;
  global.CardView = CardView;
})(window);
