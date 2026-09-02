/* ============================================================
 *  view/forgeView.js —— 「异变工坊」合成屏
 *
 *  UI 结构（按主人给的截图）：底部三 tab —— 植物 / 材料 / 返回。
 *    · 植物页：当前培育植物的状态 + 两条分支进化（等级 + 材料 + 金币三条件）
 *    · 材料页：进化材料（可喂养换经验）/ 基础材料（卖钱）/ 血瓶（立即回血）
 *    · 返回：关掉这一屏
 *
 *  与其它屏的关系：
 *    · 由 metaView 的 home 屏按钮打开（发 CMD_FORGE_OPEN）
 *    · 绘制与输入优先级高于 metaView —— main.js 里先问 forge.isOpen()
 *    · 所有写操作都发事件给 Pet / Forge 系统，本文件不碰存档
 *
 *  ★ 与 metaView 的绘制工具（panel/btn/hexA）是**各写一份**的：
 *    那些是 metaView 模块内的私有函数，拿不到。两边视觉参数保持一致，
 *    改风格时记得两处都要改。
 * ============================================================ */
(function (global) {
  'use strict';
  var EV = global.Bus.EV, M = global.M, PX = global.PX;

  var FONT = '"Noto Sans SC", system-ui, sans-serif';

  var TOP_H = 52;        // 顶栏
  var TAB_H = 56;        // 底部 tab 栏
  var PAD = 16;

  var COL = {
    gold: '#ffd45e',
    exp: '#7fd8ff',
    hp: '#7fe0a0',
    hpMid: '#ffd479',
    hpLow: '#ff7b6b',
    accent: '#d8ffc0',
    dim: 'rgba(255,255,255,.32)'
  };

  function ForgeView(forge, opts) {
    opts = opts || {};
    this.forge = forge;
    this.W = opts.w || 1040;
    this.H = opts.h || 640;
    this.portrait = !!opts.portrait;
    this.t = 0;
    this.buttons = [];
    this.hover = null;
    this._anim = null;
    this._animKind = null;
  }

  ForgeView.prototype.resize = function (w, h, portrait) {
    this.W = w; this.H = h; this.portrait = !!portrait;
    this.buttons = []; this.hover = null;
  };

  ForgeView.prototype.update = function (dt) {
    this.t += dt;
    if (this._anim) this._anim.update(dt);
  };

  ForgeView.prototype.onMove = function (x, y) {
    this.hover = null;
    for (var i = 0; i < this.buttons.length; i++) {
      var b = this.buttons[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) { this.hover = b.id; return; }
    }
  };

  /* ============================================================
   *  点击
   * ============================================================ */

  ForgeView.prototype.onClick = function (x, y) {
    var b = null;
    for (var i = 0; i < this.buttons.length; i++) {
      var q = this.buttons[i];
      if (x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h) { b = q; break; }
    }
    if (!b) return false;

    var id = b.id, f = this.forge;

    // ---- 底部 tab ----
    if (id === 'tab:back') { global.Bus.emit(EV.CMD_FORGE_CLOSE); return true; }
    if (id.indexOf('tab:') === 0) { f.setTab(id.slice(4)); return true; }
    if (id === 'close') { global.Bus.emit(EV.CMD_FORGE_CLOSE); return true; }

    // ---- 植物页 ----
    if (id === 'water') { f.doWater(); return true; }
    if (id.indexOf('branch:') === 0) { f.select(id.slice(7)); return true; }
    if (id === 'evolve:yes') { f.doEvolve(f.selected()); return true; }
    if (id === 'evolve:no') { f.select(null); f.confirm(false); return true; }

    // ---- 材料页 ----
    if (id.indexOf('feed:') === 0) { f.doFeed(id.slice(5)); return true; }
    if (id === 'sellbasic') { f.doSellBasic('all'); return true; }
    if (id.indexOf('potion:') === 0) { f.doPotion(id.slice(7)); return true; }

    return true;
  };

  /* ============================================================
   *  绘制
   * ============================================================ */

  ForgeView.prototype.draw = function (ctx) {
    var W = this.W, H = this.H;
    this.buttons = [];

    bg(ctx, W, H);
    this._topBar(ctx);
    this._tabs(ctx);

    var top = TOP_H + 8;
    var bodyH = H - top - TAB_H - PAD;
    if (this.forge.tab() === 'material') this._materialPage(ctx, PAD, top, W - PAD * 2, bodyH);
    else this._plantPage(ctx, PAD, top, W - PAD * 2, bodyH);
  };

  /* ---------------- 顶栏 / 底栏 ---------------- */

  ForgeView.prototype._topBar = function (ctx) {
    var W = this.W;
    ctx.save();
    ctx.fillStyle = 'rgba(8,14,24,.86)';
    ctx.fillRect(0, 0, W, TOP_H);
    ctx.strokeStyle = 'rgba(216,255,192,.16)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, TOP_H); ctx.lineTo(W, TOP_H); ctx.stroke();

    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.font = '900 19px ' + FONT;
    ctx.fillStyle = '#d8ffc0';
    ctx.fillText('异变工坊', PAD, TOP_H / 2);

    ctx.font = '700 11px ' + FONT;
    ctx.fillStyle = 'rgba(207,232,176,.55)';
    ctx.fillText('喂养 · 浇水 · 分支进化', PAD + 96, TOP_H / 2 + 1);

    // 金币
    ctx.textAlign = 'right';
    ctx.font = '800 15px ' + FONT;
    ctx.fillStyle = COL.gold;
    ctx.fillText(fmt(this.forge.meta.profile.gold) + ' 金币', W - PAD - 52, TOP_H / 2);

    // 关闭
    this._pushBtn(ctx, {
      id: 'close', x: W - PAD - 40, y: 10, w: 34, h: 32, r: 8,
      col: '#ff9a8a', label: '×', fs: 18
    });
    ctx.restore();
  };

  ForgeView.prototype._tabs = function (ctx) {
    var W = this.W, H = this.H, f = this.forge;
    var tabs = global.Forge.TABS;
    var y = H - TAB_H;
    var gap = 10;
    var totalW = W - PAD * 2 - gap * (tabs.length - 1);
    var bw = totalW / tabs.length;

    ctx.save();
    ctx.fillStyle = 'rgba(8,14,24,.9)';
    ctx.fillRect(0, y - 8, W, TAB_H + 8);

    for (var i = 0; i < tabs.length; i++) {
      var t = tabs[i];
      var on = (t.key === 'back') ? false : (f.tab() === t.key);
      var b = {
        id: 'tab:' + t.key,
        x: PAD + i * (bw + gap), y: y + 4, w: bw, h: TAB_H - 14, r: 12,
        col: t.key === 'back' ? '#ff9a8a' : '#d8ffc0',
        label: t.name, fs: 15
      };
      ctx.globalAlpha = (t.key === 'back' || on) ? 1 : 0.62;
      this._pushBtn(ctx, b);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  };

  /* ============================================================
   *  植物页
   * ============================================================ */

  ForgeView.prototype._plantPage = function (ctx, x, y, w, h) {
    var info = this.forge.petInfo();

    if (!info) { this._noPet(ctx, x, y, w, h); return; }

    // 宽屏左右分栏，窄屏上下
    var two = (w >= 700);
    var cardR, branchR;
    if (two) {
      var lw = Math.min(340, w * 0.42);
      cardR = { x: x, y: y, w: lw, h: h };
      branchR = { x: x + lw + 14, y: y, w: w - lw - 14, h: h };
    } else {
      var th = Math.min(292, h * 0.55);
      cardR = { x: x, y: y, w: w, h: th };
      branchR = { x: x, y: y + th + 12, w: w, h: h - th - 12 };
    }

    this._petCard(ctx, cardR, info);
    this._branchArea(ctx, branchR, info);
  };

  ForgeView.prototype._noPet = function (ctx, x, y, w, h) {
    panel(ctx, x, y, w, h, 16, 'rgba(10,16,26,.9)', 'rgba(216,255,192,.2)');
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '900 20px ' + FONT;
    ctx.fillStyle = '#d8ffc0';
    ctx.fillText('还没有培育植物', x + w / 2, y + h / 2 - 16);
    ctx.font = '700 13px ' + FONT;
    ctx.fillStyle = 'rgba(207,232,176,.6)';
    ctx.fillText('先回主页完成初次异变三选一', x + w / 2, y + h / 2 + 14);
    ctx.restore();
  };

  /** 宠物状态卡：立绘 + 等级/经验 + 血条恢复 + 浇水 */
  ForgeView.prototype._petCard = function (ctx, R, info) {
    panel(ctx, R.x, R.y, R.w, R.h, 16, 'rgba(10,16,26,.92)', hexA(info.color, 0.35));

    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

    // ---- 立绘 ----
    var spr = (global.PetArt && global.PetArt.Art[info.kind]) ? global.PetArt.Art[info.kind] : null;
    var cx = R.x + R.w / 2;
    var picY = R.y + R.h * 0.46;
    if (spr) {
      var sc = Math.min(4.2, (R.h * 0.42) / (spr.h || 28));
      sc = Math.max(2.2, sc);
      if (!this._anim || this._animKind !== info.kind) {
        this._anim = new global.PetArt.PetAnimator(info.kind, 0);
        this._animKind = info.kind;
      }
      var r = this._anim.render();
      PX.draw(ctx, r.sprite, cx, picY + r.bob, {
        frame: r.frame, scale: sc, lean: r.lean, squash: r.squash
      });
    }

    // ---- 名字 + 等级 ----
    var ny = R.y + 26;
    ctx.font = '900 20px ' + FONT;
    ctx.fillStyle = info.color;
    ctx.fillText(info.name, cx, ny);
    ctx.font = '800 12px ' + FONT;
    ctx.fillStyle = COL.gold;
    ctx.fillText('Lv.' + info.level + ' / ' + info.maxLevel, cx, ny + 22);

    // ---- 经验条 ----
    var ey = ny + 40;
    bar(ctx, R.x + 18, ey, R.w - 36, 9, info.expRatio, COL.exp,
      info.level >= info.maxLevel ? '已满级' : (info.exp + ' / ' + info.expNeed + ' EXP'));

    // ---- 血条 ----
    var hy = ey + 34;
    var hpCol = info.hpRatio > 0.5 ? COL.hp : (info.hpRatio > 0.2 ? COL.hpMid : COL.hpLow);
    bar(ctx, R.x + 18, hy, R.w - 36, 11, info.hpRatio, hpCol,
      Math.ceil(info.hp) + ' / ' + info.hpMax);

    // ---- 恢复信息 ----
    var ry = hy + 24;
    ctx.font = '700 11px ' + FONT;
    ctx.fillStyle = 'rgba(207,232,176,.62)';
    if (info.hpRatio >= 1) {
      ctx.fillText('状态极好', cx, ry);
    } else {
      var txt = '每 ' + info.recoverSecPer1 + ' 秒回 1%';
      if (info.waterLeftSec > 0) txt += '（浇水加速中 ×2，剩 ' + fmtSec(info.waterLeftSec) + '）';
      ctx.fillText(txt, cx, ry);
      ctx.fillStyle = hexA(hpCol, 0.9);
      ctx.fillText('满血还需 ' + fmtSec(info.etaSec), cx, ry + 16);
    }

    // ---- 战斗属性 ----
    var sy = ry + 38;
    ctx.font = '700 11px ' + FONT;
    ctx.fillStyle = 'rgba(207,232,176,.5)';
    ctx.fillText('伤害 ' + fmt(info.dmg) + '　·　攻击间隔 ' + fmt(info.interval) + ' s', cx, sy);

    // ---- 浇水按钮 ----
    var bwid = R.w - 36;
    var b = {
      id: 'water', x: R.x + 18, y: R.y + R.h - 54, w: bwid, h: 38, r: 10,
      col: '#6fd6ff', label: '浇水施肥', fs: 14
    };
    if (info.waterCdSec > 0) {
      b.disabled = true;
      b.sub = '冷却 ' + fmtSec(info.waterCdSec);
    } else {
      b.sub = '恢复 ×2 · +' + global.PetsData.EXP.water + ' 经验';
    }
    this._pushBtn(ctx, b);
    ctx.restore();
  };

  /** 进化分支区 */
  ForgeView.prototype._branchArea = function (ctx, R, info) {
    var opts = this.forge.evolveOptions();

    ctx.save();
    panel(ctx, R.x, R.y, R.w, R.h, 16, 'rgba(10,16,26,.88)', 'rgba(216,255,192,.16)');

    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = '800 14px ' + FONT;
    ctx.fillStyle = '#d8ffc0';
    ctx.fillText('分支进化', R.x + 16, R.y + 22);

    if (!opts.length) {
      ctx.font = '700 12px ' + FONT;
      ctx.fillStyle = 'rgba(207,232,176,.45)';
      ctx.fillText('这条异变链暂时走到了尽头。', R.x + 16, R.y + R.h / 2);
      ctx.restore();
      return;
    }

    // 卡片：宽屏两列，窄屏一列
    var cols = (R.w >= 420) ? Math.min(2, opts.length) : 1;
    var gap = 12;
    var cw = (R.w - 32 - gap * (cols - 1)) / cols;
    var cy0 = R.y + 40;
    var ch = Math.min(150, R.h - 40 - 12);

    for (var i = 0; i < opts.length; i++) {
      var o = opts[i];
      var bx = R.x + 16 + (i % cols) * (cw + gap);
      var by = cy0 + Math.floor(i / cols) * (ch + gap);
      this._branchCard(ctx, o, bx, by, cw, ch);
    }

    // 选中后的二次确认条
    var sel = this.forge.selected();
    if (sel) {
      var so = null;
      for (var j = 0; j < opts.length; j++) if (opts[j].to === sel) so = opts[j];
      if (so) this._confirmBar(ctx, R, so, info);
    }
    ctx.restore();
  };

  ForgeView.prototype._branchCard = function (ctx, o, x, y, w, h) {
    var ok = o.chk.ok;
    var sel = (this.forge.selected() === o.to);
    var def = global.PetsData.defOf(o.to);
    var col = def ? def.color : '#888';

    ctx.save();
    global.roundRect(ctx, x, y, w, h, 14);
    ctx.fillStyle = ok ? hexA(col, sel ? 0.22 : 0.11) : 'rgba(255,255,255,.045)';
    ctx.fill();
    ctx.strokeStyle = sel ? '#ffd479' : (ok ? hexA(col, 0.75) : 'rgba(255,255,255,.13)');
    ctx.lineWidth = sel ? 2.4 : 1.6;
    ctx.stroke();

    ctx.globalAlpha = ok ? 1 : 0.62;

    // 图标
    var icon = global.PetArt && global.PetArt.Art.icon[o.to];
    if (icon) {
      PX.draw(ctx, icon, x + 38, y + h - 26, { frame: 0, scale: 1.5 });
    }

    var tx = x + 70;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';

    ctx.font = '900 15px ' + FONT;
    ctx.fillStyle = col;
    ctx.fillText(o.name, tx, y + 24);

    // 条件
    ctx.font = '700 11px ' + FONT;
    ctx.fillStyle = ok ? 'rgba(230,240,220,.9)' : 'rgba(255,255,255,.5)';
    ctx.fillText(o.reqText, tx, y + 46);

    // 缺什么 / hint
    var subY = y + 68;
    ctx.font = '700 11px ' + FONT;
    if (!ok) {
      ctx.fillStyle = '#ff9a8a';
      ctx.fillText(o.reason, tx, subY);
    } else {
      ctx.fillStyle = 'rgba(207,232,176,.6)';
      wrapText(ctx, o.hint || '', tx, subY, w - tx + x - 14, 14, 2);
    }

    // 状态角标
    ctx.textAlign = 'right';
    ctx.font = '900 11px ' + FONT;
    ctx.fillStyle = ok ? '#7fe0a0' : 'rgba(255,255,255,.35)';
    ctx.fillText(ok ? '可异变' : '未满足', x + w - 12, y + 24);

    ctx.restore();

    this._pushBtn(ctx, {
      id: 'branch:' + o.to, x: x, y: y, w: w, h: h, r: 14,
      col: col, label: '', fs: 12, plain: true
    });
  };

  /** 选中分支后的确认条（异变不可逆，必须二次确认） */
  ForgeView.prototype._confirmBar = function (ctx, R, o, info) {
    var bw = 116, bh = 38, gap = 12;
    var by = R.y + R.h - bh - 12;
    var totalW = bw * 2 + gap;
    var bx = R.x + (R.w - totalW) / 2;

    ctx.save();
    global.roundRect(ctx, bx - 14, by - 30, totalW + 28, bh + 42, 12);
    ctx.fillStyle = 'rgba(6,10,18,.92)'; ctx.fill();
    ctx.strokeStyle = hexA(global.PetsData.defOf(o.to).color, 0.6);
    ctx.lineWidth = 1.4; ctx.stroke();

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '800 12px ' + FONT;
    ctx.fillStyle = '#d8ffc0';
    ctx.fillText('把【' + info.name + '】异变成【' + o.name + '】？', R.x + R.w / 2, by - 12);

    this._pushBtn(ctx, {
      id: 'evolve:yes', x: bx, y: by, w: bw, h: bh, r: 10,
      col: '#7fe0a0', label: '确认异变', fs: 14
    });
    this._pushBtn(ctx, {
      id: 'evolve:no', x: bx + bw + gap, y: by, w: bw, h: bh, r: 10,
      col: '#ff9a8a', label: '再想想', fs: 14
    });
    ctx.restore();
  };

  /* ============================================================
   *  材料页
   * ============================================================ */

  ForgeView.prototype._materialPage = function (ctx, x, y, w, h) {
    var mats = this.forge.materials();
    var basic = this.forge.basicInfo();
    var pots = this.forge.potions();

    var col = (w >= 620) ? 3 : 2;
    var gap = 12;
    var cw = (w - gap * (col - 1)) / col;
    var ch = 104;
    var cy = y;

    // ---- 进化材料 ----
    sectionTitle(ctx, x, cy, w, '进化材料　（可喂养换经验）');
    cy += 22;

    for (var i = 0; i < mats.length; i++) {
      var m = mats[i];
      var bx = x + (i % col) * (cw + gap);
      var by = cy + Math.floor(i / col) * (ch + gap);
      this._matCard(ctx, m, bx, by, cw, ch);
    }
    cy += Math.ceil(mats.length / col) * (ch + gap);

    // ---- 基础材料 ----
    sectionTitle(ctx, x, cy, w, '基础材料　（只能卖钱）');
    cy += 22;
    this._basicCard(ctx, basic, x, cy, cw, ch);

    // ---- 血瓶 ----
    cy += ch + gap + 6;
    sectionTitle(ctx, x, cy, w, '回复液　（立刻按比例回血）');
    cy += 22;
    var pw = (w - gap * 2) / 3;
    for (var j = 0; j < pots.length; j++) {
      this._potionCard(ctx, pots[j], x + j * (pw + gap), cy, pw, ch);
    }
  };

  ForgeView.prototype._matCard = function (ctx, m, x, y, w, h) {
    ctx.save();
    panel(ctx, x, y, w, h, 14, 'rgba(10,16,26,.9)', hexA(m.color, m.count > 0 ? 0.4 : 0.14));

    // 图标（纯形状，无表情 —— 主人要求）
    if (global.MaterialArt) {
      global.MaterialArt.drawAt(ctx, m.key, x + 34, y + 40, 2.0);
    }

    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = '800 13px ' + FONT;
    ctx.fillStyle = m.color;
    ctx.fillText(m.name, x + 62, y + 24);

    ctx.font = '900 16px ' + FONT;
    ctx.fillStyle = m.count > 0 ? '#eaf3ff' : 'rgba(255,255,255,.3)';
    ctx.fillText('×' + m.count, x + 62, y + 46);

    ctx.font = '700 10px ' + FONT;
    ctx.fillStyle = 'rgba(207,232,176,.5)';
    wrapText(ctx, m.desc, x + 62, y + 66, w - 74, 13, 2);

    this._pushBtn(ctx, {
      id: 'feed:' + m.key, x: x + 12, y: y + h - 32, w: w - 24, h: 24, r: 8,
      col: '#7fd8ff', label: '喂养 +' + global.PetsData.EXP.feed + ' EXP', fs: 11,
      disabled: m.count <= 0
    });
    ctx.restore();
  };

  ForgeView.prototype._basicCard = function (ctx, b, x, y, w, h) {
    ctx.save();
    panel(ctx, x, y, w, h, 14, 'rgba(10,16,26,.9)', hexA(b.color, b.count > 0 ? 0.4 : 0.14));

    if (global.MaterialArt) global.MaterialArt.drawAt(ctx, 'basic', x + 34, y + 40, 2.0);

    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = '800 13px ' + FONT;
    ctx.fillStyle = b.color;
    ctx.fillText(b.name, x + 62, y + 24);
    ctx.font = '900 16px ' + FONT;
    ctx.fillStyle = b.count > 0 ? '#eaf3ff' : 'rgba(255,255,255,.3)';
    ctx.fillText('×' + b.count, x + 62, y + 46);
    ctx.font = '700 10px ' + FONT;
    ctx.fillStyle = 'rgba(207,232,176,.5)';
    wrapText(ctx, '关卡掉落，' + b.rate + ' 个 = ' + b.rate + ' 金币', x + 62, y + 66, w - 74, 13, 2);

    this._pushBtn(ctx, {
      id: 'sellbasic', x: x + 12, y: y + h - 32, w: w - 24, h: 24, r: 8,
      col: COL.gold, label: '全部卖出 +' + b.gold, fs: 11,
      disabled: b.count <= 0
    });
    ctx.restore();
  };

  ForgeView.prototype._potionCard = function (ctx, p, x, y, w, h) {
    ctx.save();
    panel(ctx, x, y, w, h, 14, 'rgba(10,16,26,.9)', hexA(p.color, p.afford ? 0.42 : 0.14));

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

    // 瓶身（纯形状）
    var cx = x + w / 2, by = y + 34;
    ctx.fillStyle = hexA(p.color, 0.9);
    ctx.fillRect(cx - 7, by - 8, 14, 6);              // 瓶口
    ctx.beginPath();
    ctx.moveTo(cx - 11, by - 2);
    ctx.lineTo(cx + 11, by - 2);
    ctx.lineTo(cx + 14, by + 16);
    ctx.lineTo(cx - 14, by + 16);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    ctx.fillRect(cx - 9, by + 2, 5, 10);

    ctx.font = '800 13px ' + FONT;
    ctx.fillStyle = p.color;
    ctx.fillText(p.name, cx, y + 62);
    ctx.font = '900 15px ' + FONT;
    ctx.fillStyle = p.afford ? '#eaf3ff' : 'rgba(255,255,255,.32)';
    ctx.fillText('+' + Math.round(p.ratio * 100) + '%', cx, y + 80);

    this._pushBtn(ctx, {
      id: 'potion:' + p.id, x: x + 10, y: y + h - 26, w: w - 20, h: 22, r: 8,
      col: COL.gold, label: p.gold + ' 金币', fs: 11,
      disabled: !p.afford
    });
    ctx.restore();
  };

  /* ============================================================
   *  绘制工具（与 metaView 各写一份，参数保持一致）
   * ============================================================ */

  ForgeView.prototype._pushBtn = function (ctx, b) {
    this.buttons.push(b);
    if (b.plain) return;                 // 只做点击热区，不画外观
    var hover = (this.hover === b.id);
    var dis = !!b.disabled;
    ctx.save();
    global.roundRect(ctx, b.x, b.y, b.w, b.h, b.r || 10);
    ctx.fillStyle = dis ? 'rgba(255,255,255,.05)' : (hover ? hexA(b.col, 0.32) : hexA(b.col, 0.15));
    ctx.fill();
    ctx.strokeStyle = dis ? 'rgba(255,255,255,.13)' : hexA(b.col, hover ? 1 : 0.6);
    ctx.lineWidth = (hover && !dis) ? 2.2 : 1.4;
    ctx.stroke();
    if (b.label) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '800 ' + (b.fs || 14) + 'px ' + FONT;
      ctx.fillStyle = dis ? 'rgba(255,255,255,.3)' : '#eaf3ff';
      ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + (b.sub ? -7 : 0));
      if (b.sub) {
        ctx.font = '700 10px ' + FONT;
        ctx.fillStyle = dis ? 'rgba(255,255,255,.25)' : hexA(b.col, 0.95);
        ctx.fillText(b.sub, b.x + b.w / 2, b.y + b.h / 2 + 10);
      }
    }
    ctx.restore();
  };

  function sectionTitle(ctx, x, y, w, text) {
    ctx.save();
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = '800 13px ' + FONT;
    ctx.fillStyle = 'rgba(216,255,192,.85)';
    ctx.fillText(text, x, y + 8);
    ctx.strokeStyle = 'rgba(216,255,192,.14)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y + 18); ctx.lineTo(x + w, y + 18); ctx.stroke();
    ctx.restore();
  }

  function bar(ctx, x, y, w, h, ratio, col, label) {
    ctx.save();
    global.roundRect(ctx, x, y, w, h, h / 2);
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fill();
    var fw = Math.max(0, Math.min(1, ratio)) * w;
    if (fw > 1) {
      global.roundRect(ctx, x, y, fw, h, h / 2);
      ctx.fillStyle = col; ctx.fill();
    }
    if (label) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '800 10px ' + FONT;
      ctx.fillStyle = 'rgba(255,255,255,.92)';
      ctx.fillText(label, x + w / 2, y + h / 2 + 0.5);
    }
    ctx.restore();
  }

  function panel(ctx, x, y, w, h, r, fill, stroke) {
    global.roundRect(ctx, x, y, w, h, r || 14);
    ctx.fillStyle = fill || 'rgba(10,16,26,.94)'; ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
  }

  function bg(ctx, W, H) {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0e1a16'); g.addColorStop(1, '#070c15');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.save();
    for (var i = 0; i < 40; i++) {
      var x = (i * 137.5) % W, y = (i * 71.3) % H;
      ctx.globalAlpha = 0.08 + 0.2 * Math.abs(Math.sin(i + (global.performance ? performance.now() : 0) / 2400));
      ctx.fillStyle = '#d8ffc0';
      ctx.fillRect(x, y, 1.6, 1.6);
    }
    ctx.restore();
  }

  function hexA(hex, a) {
    var c = (global.PX && global.PX.hexToRgb) ? global.PX.hexToRgb(hex) : [255, 255, 255];
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }

  /** 简易按字符宽度换行（中文按 1 字宽算） */
  function wrapText(ctx, text, x, y, maxW, lh, maxLines) {
    if (!text) return;
    var line = '', lines = [];
    for (var i = 0; i < text.length; i++) {
      var test = line + text[i];
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = text[i]; }
      else line = test;
      if (lines.length >= (maxLines || 2)) break;
    }
    if (line && lines.length < (maxLines || 2)) lines.push(line);
    for (var j = 0; j < lines.length; j++) {
      ctx.fillText(lines[j], x, y + j * lh);
    }
  }

  function fmt(v) {
    if (v === undefined || v === null) return '0';
    return Math.abs(v) >= 100 ? String(Math.round(v)) : (Math.round(v * 10) / 10).toFixed(1);
  }

  function fmtSec(s) {
    s = Math.max(0, Math.ceil(s));
    if (s < 60) return s + ' 秒';
    var m = Math.floor(s / 60), r = s % 60;
    if (m < 60) return r ? (m + ' 分 ' + r + ' 秒') : (m + ' 分');
    return Math.floor(m / 60) + ' 小时 ' + (m % 60) + ' 分';
  }

  global.ForgeView = ForgeView;
})(window);
