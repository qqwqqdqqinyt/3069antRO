/* ============================================================
 *  view/petChoose.js —— 初次异变 · 三选一
 *
 *  世界观（主人 2026-09-02 定：极少量，够埋钩子就行）：
 *    一块晶枢坠进后院 → 昆虫异变 → 家里那株牙苗也变了颜色。
 *    玩家从 红 / 绿 / 枯萎 三株里选一株，**选完永不可改**。
 *
 *  本期只有「红色牙苗」可选；绿 / 枯萎 照样显示（让玩家看见未来内容），
 *  但点了只提示未开放 —— 数据层的 VARIANTS[].locked 是唯一开关。
 *
 *  触发时机：Pet 系统发现 profile.petChoice 为空时（第一次进游戏）。
 *  后期要接背景剧情，把这里的 STORY 文案换成剧情节点即可，流程不变。
 * ============================================================ */
(function (global) {
  'use strict';
  var EV = global.Bus.EV, M = global.M, PX = global.PX;

  var FONT = '"Noto Sans SC", system-ui, sans-serif';

  /* 极简背景：三行，只交代「晶枢 → 异变 → 它跟着你」 */
  var STORY = [
    '去年冬天，一块晶枢坠进了后院。',
    '虫子在变，院子里的那株牙苗也一夜之间换了颜色。',
    '它现在还很小 —— 但从今天起，它会一直跟着你。'
  ];

  function PetChoose(opts) {
    opts = opts || {};
    this.W = opts.w || 1040;
    this.H = opts.h || 640;
    this.portrait = !!opts.portrait;
    this.visible = false;
    this.t = 0;
    this.buttons = [];
    this.hover = null;
    this.picked = null;      // 已高亮待确认的 variant key
    this._anims = {};
  }

  PetChoose.prototype.resize = function (w, h, portrait) {
    this.W = w; this.H = h; this.portrait = !!portrait;
    this.buttons = []; this.hover = null;
  };

  PetChoose.prototype.show = function () {
    this.visible = true;
    this.picked = null;
    this.buttons = [];
  };
  PetChoose.prototype.hide = function () { this.visible = false; this.picked = null; };

  PetChoose.prototype.update = function (dt) {
    if (!this.visible) return;
    this.t += dt;
    var vs = global.PetsData.VARIANTS;
    for (var i = 0; i < vs.length; i++) {
      var k = vs[i].kind;
      if (!this._anims[k] && global.PetArt && global.PetArt.PetAnimator) {
        this._anims[k] = new global.PetArt.PetAnimator(k, i * 1.7);
      }
      if (this._anims[k]) this._anims[k].update(dt);
    }
  };

  PetChoose.prototype.onMove = function (x, y) {
    this.hover = null;
    for (var i = 0; i < this.buttons.length; i++) {
      var b = this.buttons[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) { this.hover = b.id; return; }
    }
  };

  /**
   * @returns true 表示消费了点击
   */
  PetChoose.prototype.onClick = function (x, y) {
    if (!this.visible) return false;
    var b = null;
    for (var i = 0; i < this.buttons.length; i++) {
      var q = this.buttons[i];
      if (x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h) { b = q; break; }
    }
    if (!b) return true;                     // 三选一是模态屏，点空白不穿透

    // 'pick:' 长度是 5。写成 slice(6) 会把 key 的头一个字符吃掉（'pick:red' → 'ed'），
    // 于是下面找不到 variant、直接 return，**三选一屏点任何按钮都关不掉、开局卡死**。
    var key = b.id.slice('pick:'.length);    // 'pick:red' → 'red'
    var v = null, vs = global.PetsData.VARIANTS;
    for (var j = 0; j < vs.length; j++) if (vs[j].key === key) v = vs[j];

    if (!v) return true;
    if (v.locked) {
      global.Bus.emit(EV.TOAST, { text: '这条异变链尚未开放', kind: 'bad' });
      return true;
    }
    // 选中即关闭。这一屏只在 petChoice 为空时出现，而 choose() 对「已选过」会直接
    // 返回，所以不存在「点了没选上却把屏关掉」的情况。
    // ★ 不在这里订阅 PET_CHANGED 再关屏：Bus.reset() 会在 buildWorld 时把监听清掉，
    //   而 petChoose 是 boot 期创建、只活一次的，订阅会静默失效（屏永远关不掉）。
    this.hide();
    global.Bus.emit(EV.CMD_PET_CHOOSE, { variant: key });
    return true;
  };

  /* ---------------- 绘制 ---------------- */

  PetChoose.prototype.draw = function (ctx) {
    if (!this.visible) return;
    var W = this.W, H = this.H;
    this.buttons = [];

    // 背景
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#101a16'); g.addColorStop(1, '#070c12');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // 星点
    ctx.save();
    for (var i = 0; i < 44; i++) {
      var x = (i * 137.5) % W, y = (i * 71.3) % H;
      ctx.globalAlpha = 0.08 + 0.18 * Math.abs(Math.sin(i + this.t * 0.7));
      ctx.fillStyle = '#d8ffc0';
      ctx.fillRect(x, y, 1.6, 1.6);
    }
    ctx.restore();

    var vs = global.PetsData.VARIANTS;
    var pad = 20;

    // ---- 标题 ----
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '900 24px ' + FONT;
    ctx.fillStyle = '#d8ffc0';
    ctx.fillText('晶枢坠落之后', W / 2, pad + 26);

    // ---- 背景文字（极少量）----
    ctx.font = '700 13px ' + FONT;
    ctx.fillStyle = 'rgba(207,232,176,.62)';
    for (var s = 0; s < STORY.length; s++) {
      ctx.fillText(STORY[s], W / 2, pad + 60 + s * 20);
    }
    ctx.restore();

    // ---- 卡片 ----
    var top = pad + 60 + STORY.length * 20 + 26;
    var bottom = H - pad - 46;
    var areaH = bottom - top;

    var horiz = (W >= 760);
    var gap = 14;
    var cw, ch, cx0, cy0;
    if (horiz) {
      cw = Math.min(220, (W - pad * 2 - gap * 2) / 3);
      ch = Math.min(areaH, 300);
      cx0 = W / 2 - (cw * 3 + gap * 2) / 2;
      cy0 = top + (areaH - ch) / 2;
    } else {
      cw = Math.min(300, W - pad * 2);
      ch = Math.min((areaH - gap * 2) / 3, 132);
      cx0 = W / 2 - cw / 2;
      cy0 = top + Math.max(0, (areaH - (ch * 3 + gap * 2)) / 2);
    }

    for (var k = 0; k < vs.length; k++) {
      var v = vs[k];
      var bx = horiz ? (cx0 + k * (cw + gap)) : cx0;
      var by = horiz ? cy0 : (cy0 + k * (ch + gap));
      this._card(ctx, v, bx, by, cw, ch);
    }

    // ---- 底部提示 ----
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '700 12px ' + FONT;
    ctx.fillStyle = 'rgba(207,232,176,.45)';
    ctx.fillText('※ 选定后永不可更改', W / 2, H - pad - 14);
    ctx.restore();
  };

  PetChoose.prototype._card = function (ctx, v, x, y, w, h) {
    var hovered = (this.hover === ('pick:' + v.key));
    var locked = !!v.locked;
    var alpha = locked ? 0.5 : 1;

    ctx.save();
    ctx.globalAlpha = alpha;

    global.roundRect(ctx, x, y, w, h, 16);
    ctx.fillStyle = hovered && !locked ? hexA(v.color, 0.20) : 'rgba(12,20,16,.9)';
    ctx.fill();
    ctx.strokeStyle = locked ? 'rgba(255,255,255,.14)' : (hovered ? v.color : hexA(v.color, 0.55));
    ctx.lineWidth = hovered && !locked ? 2.6 : 1.6;
    ctx.stroke();

    // 立绘
    var anim = this._anims[v.kind];
    if (anim && !locked) {
      var r = anim.render();
      var sc = Math.min(3.4, (h * 0.44) / (r.sprite.h || 28));
      sc = Math.max(2.0, sc);
      PX.draw(ctx, r.sprite, x + w / 2, y + h * 0.62 + r.bob, {
        frame: r.frame, scale: sc, lean: r.lean, squash: r.squash
      });
    } else if (global.PetArt && global.PetArt.Art.icon[v.kind]) {
      ctx.globalAlpha = alpha * 0.5;
      PX.draw(ctx, global.PetArt.Art.icon[v.kind], x + w / 2, y + h * 0.62, { frame: 0, scale: 1.6 });
      ctx.globalAlpha = alpha;
    }

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

    ctx.font = '900 17px ' + FONT;
    ctx.fillStyle = v.color;
    ctx.fillText(v.name, x + w / 2, y + 26);

    if (locked) {
      ctx.font = '800 12px ' + FONT;
      ctx.fillStyle = 'rgba(255,255,255,.42)';
      ctx.fillText('尚未开放', x + w / 2, y + h - 24);
    } else {
      ctx.font = '700 11px ' + FONT;
      ctx.fillStyle = 'rgba(207,232,176,.6)';
      wrapText(ctx, v.desc, x + w / 2, y + h - 30, w - 24, 15, 2, true);
    }
    ctx.restore();

    this.buttons.push({ id: 'pick:' + v.key, x: x, y: y, w: w, h: h });
  };

  /* ---------------- 工具 ---------------- */

  function hexA(hex, a) {
    var c = (global.PX && global.PX.hexToRgb) ? global.PX.hexToRgb(hex) : [255, 255, 255];
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }

  function wrapText(ctx, text, cx, y, maxW, lh, maxLines, center) {
    if (!text) return;
    var line = '', lines = [];
    for (var i = 0; i < text.length; i++) {
      var test = line + text[i];
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = text[i]; }
      else line = test;
      if (lines.length >= (maxLines || 2)) break;
    }
    if (line && lines.length < (maxLines || 2)) lines.push(line);
    ctx.textAlign = center ? 'center' : 'left';
    for (var j = 0; j < lines.length; j++) ctx.fillText(lines[j], cx, y + j * lh);
  }

  PetChoose.STORY = STORY;

  global.PetChoose = PetChoose;
})(window);
