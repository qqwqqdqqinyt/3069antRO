/* ============================================================
 *  view/petPanel.js —— 战场左上角的「培育植物」面板
 *
 *  交互（主人 2026-09-02 定）：
 *    培育植物不是花钱买的，是玩家养的。所以它不走「点空位 → 花钱种牙苗」
 *    那条路，而是：左上角按钮 → 展开我的培育植物 → 选一只 → 点空位种下。
 *    种下不花金币（它已经是你的了），但**一关只能派一只**、且血是带着走的。
 *
 *  与 Pet 系统的分工：
 *    · 本模块只管「选谁、种哪、长什么样」，不碰存档
 *    · 能不能派（血量 / 槽位 / 是否已派）一律问 Pet.canDeploy()
 *    · 真正落子走 EV.CMD_PLANT_PLACE，由 Battlefield 执行
 *
 *  ★ 种植模式的坑：Battlefield.placePlant 会「同格替换」已有植物。
 *    直接下发会把玩家花金币种的豌豆射手顶掉 —— 所以 plantAt 必须先查占用。
 * ============================================================ */
(function (global) {
  'use strict';
  var EV = global.Bus.EV, M = global.M, PX = global.PX;

  var FONT = '"Noto Sans SC", system-ui, sans-serif';

  var BTN = { w: 52, h: 52, pad: 10 };
  var ITEM = { w: 172, h: 48, gap: 6 };

  function PetPanel(opts) {
    opts = opts || {};
    this.pet = opts.pet;          // Pet 系统实例（持久）
    this.bf = opts.battle;        // Battlefield（每局重建，relayout 时不用换引用）
    this.open = false;            // 列表是否展开
    this.picking = false;         // 是否处于「选点种植」模式
    this._pickedId = null;
    this.hover = -2;              // -2 无 / -1 按钮 / >=0 第 i 项
    this.t = 0;
  }

  PetPanel.prototype.setBattle = function (bf) { this.bf = bf; };
  PetPanel.prototype.isPicking = function () { return this.picking; };
  PetPanel.prototype.isOpen = function () { return this.open; };

  PetPanel.prototype.update = function (dt) { this.t += dt; };

  /** 退出种植模式（换关 / 按 ESC / 点了别处） */
  PetPanel.prototype.cancel = function () {
    this.picking = false;
    this._pickedId = null;
  };

  /* ---------------- 布局 ---------------- */

  PetPanel.prototype.btnRect = function () {
    var c = this.bf ? this.bf.cfg : { x: 0, y: 0 };
    return { x: c.x + BTN.pad, y: c.y + BTN.pad, w: BTN.w, h: BTN.h };
  };

  PetPanel.prototype.listRects = function () {
    if (!this.open || !this.pet) return [];
    var b = this.btnRect();
    var pets = this.pet.profile().pets;
    var out = [];
    for (var i = 0; i < pets.length; i++) {
      out.push({
        i: i, pet: pets[i],
        x: b.x, y: b.y + b.h + 6 + i * (ITEM.h + ITEM.gap),
        w: ITEM.w, h: ITEM.h
      });
    }
    return out;
  };

  /** 可点击区域：按钮 + （展开时）列表项 */
  PetPanel.prototype.hitRects = function () {
    var out = this.listRects();
    var b = this.btnRect();
    out.unshift({ i: -1, btn: true, pet: null, x: b.x, y: b.y, w: b.w, h: b.h });
    return out;
  };

  /* ---------------- 输入 ---------------- */

  PetPanel.prototype.onMove = function (x, y) {
    var rs = this.hitRects();
    for (var i = 0; i < rs.length; i++) {
      var r = rs[i];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) { this.hover = r.i; return; }
    }
    this.hover = -2;
  };

  /**
   * @returns true 表示点击被面板消费（main.js 不再走「种牙苗」那套）
   */
  PetPanel.prototype.onClick = function (x, y) {
    var rs = this.hitRects();
    for (var i = 0; i < rs.length; i++) {
      var r = rs[i];
      if (!(x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h)) continue;

      if (r.btn) {
        if (!this.pet || !this.pet.hasPet()) {
          toast('还没有培育植物 —— 去主页的「异变工坊」领养', 'bad');
          return true;
        }
        this.open = !this.open;
        if (!this.open) this.cancel();
        return true;
      }
      this._pick(r.pet);
      return true;
    }
    return false;
  };

  PetPanel.prototype._pick = function (pet) {
    if (!pet) return;
    var chk = this.pet.canDeploy(pet);
    if (!chk.ok) { toast(chk.text, 'bad'); return; }
    this._pickedId = pet.id;
    this.picking = true;
    this.open = false;
    toast('选一个空位种下【' + nameOf(pet) + '】', 'good');
  };

  /**
   * 在指定格种下已选中的培育植物。由 main.js 在点战场时调用。
   * @returns true 表示种下了（main.js 应停止后续处理）
   */
  PetPanel.prototype.plantAt = function (slot) {
    if (!this.picking) return false;
    var pet = this.pet.byId(this._pickedId) || this.pet.pet();
    if (!pet) { this.cancel(); return false; }

    var chk = this.pet.canDeploy(pet);
    if (!chk.ok) { toast(chk.text, 'bad'); this.cancel(); return false; }

    // ★ placePlant 会顶掉同格植物，先自己查一遍
    if (occupied(this.bf, slot)) {
      toast('这一格已经种了东西', 'bad');
      return true;                 // 仍在种植模式，玩家可以换个格子
    }

    var st = this.pet.combatStats(pet);
    global.Bus.emit(EV.CMD_PLANT_PLACE, {
      slot: { lane: slot.lane, col: slot.col },
      kind: st.kind,
      opts: {
        petId: pet.id,
        hp: st.hp,
        def: { dmg: st.dmg, interval: st.interval }
      }
    });
    this.pet.deploy(pet.id);
    toast('【' + nameOf(pet) + '】登场 · ' + st.hp + ' HP', 'good');
    this.cancel();
    return true;
  };

  /* ---------------- 绘制 ---------------- */

  PetPanel.prototype.draw = function (ctx) {
    if (!this.pet) return;
    var b = this.btnRect();
    var pet = this.pet.pet();

    this._drawButton(ctx, b, pet);

    if (this.open) {
      var rs = this.listRects();
      for (var i = 0; i < rs.length; i++) this._drawItem(ctx, rs[i]);
    }

    if (this.picking) this._drawPickingHint(ctx);
  };

  PetPanel.prototype._drawButton = function (ctx, b, pet) {
    var hovered = (this.hover === -1);
    var active = this.picking;

    ctx.save();
    // 底板
    global.roundRect(ctx, b.x, b.y, b.w, b.h, 12);
    ctx.fillStyle = active ? 'rgba(120,90,30,.92)' : (hovered ? 'rgba(38,50,34,.95)' : 'rgba(20,28,20,.88)');
    ctx.fill();
    ctx.strokeStyle = active ? '#ffd479' : 'rgba(207,232,176,.55)';
    ctx.lineWidth = active ? 2.2 : 1.6;
    ctx.stroke();

    if (!pet) {
      // 未领养：画一个「＋」
      ctx.strokeStyle = 'rgba(207,232,176,.75)';
      ctx.lineWidth = 3; ctx.lineCap = 'round';
      var cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      ctx.beginPath();
      ctx.moveTo(cx - 9, cy); ctx.lineTo(cx + 9, cy);
      ctx.moveTo(cx, cy - 9); ctx.lineTo(cx, cy + 9);
      ctx.stroke();
      ctx.restore();
      return;
    }

    // 宠物头像
    var icon = global.PetArt && global.PetArt.Art.icon[pet.kind];
    if (icon) {
      var s = 1.15;
      PX.draw(ctx, icon, b.x + b.w / 2, b.y + b.h - 13, { frame: 0, scale: s });
    }

    // 等级徽章
    ctx.globalAlpha = 1;
    ctx.font = '800 10px ' + FONT;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var bw = 26, bh = 14;
    global.roundRect(ctx, b.x + b.w - bw - 3, b.y + 3, bw, bh, 7);
    ctx.fillStyle = 'rgba(0,0,0,.62)'; ctx.fill();
    ctx.fillStyle = '#ffe08a';
    ctx.fillText('Lv' + (pet.level || 1), b.x + b.w - bw / 2 - 3, b.y + 3 + bh / 2 + 0.5);

    // 血条
    var hr = this.pet.hpRatio(pet);
    var hx = b.x + 7, hy = b.y + b.h - 7, hw = b.w - 14, hh = 4;
    global.roundRect(ctx, hx, hy, hw, hh, 2);
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fill();
    var col = hr > 0.5 ? '#7fe0a0' : (hr > 0.2 ? '#ffd479' : '#ff7b6b');
    if (hr > 0) {
      global.roundRect(ctx, hx, hy, Math.max(2, hw * hr), hh, 2);
      ctx.fillStyle = col; ctx.fill();
    }

    // 已派出 → 打勾遮罩
    if (this.pet.isDeployed(pet.id)) {
      ctx.fillStyle = 'rgba(0,0,0,.42)';
      global.roundRect(ctx, b.x, b.y, b.w, b.h, 12);
      ctx.fill();
      ctx.fillStyle = '#cfe8b0';
      ctx.font = '900 11px ' + FONT;
      ctx.fillText('出战中', b.x + b.w / 2, b.y + b.h / 2);
    }
    ctx.restore();
  };

  PetPanel.prototype._drawItem = function (ctx, r) {
    var pet = r.pet;
    var chk = this.pet.canDeploy(pet);
    var hovered = (this.hover === r.i);
    var def = global.PetsData.defOf(pet.kind);

    ctx.save();
    global.roundRect(ctx, r.x, r.y, r.w, r.h, 10);
    ctx.fillStyle = hovered ? 'rgba(40,52,36,.97)' : 'rgba(18,25,18,.94)';
    ctx.fill();
    ctx.strokeStyle = chk.ok ? (hovered ? '#d8ffc0' : 'rgba(207,232,176,.5)') : 'rgba(140,140,140,.35)';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    var dim = chk.ok ? 1 : 0.55;
    ctx.globalAlpha = dim;

    // 头像
    var icon = global.PetArt && global.PetArt.Art.icon[pet.kind];
    if (icon) PX.draw(ctx, icon, r.x + 24, r.y + r.h - 8, { frame: 0, scale: 0.95 });

    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    var tx = r.x + 44;

    // 名字 + 等级
    ctx.font = '800 13px ' + FONT;
    ctx.fillStyle = def ? def.color : '#e8f0d8';
    ctx.fillText((def ? def.name : pet.kind), tx, r.y + 15);

    ctx.font = '700 10px ' + FONT;
    ctx.fillStyle = '#ffe08a';
    ctx.fillText('Lv.' + (pet.level || 1), tx + 54, r.y + 15);

    // 血条 + 数值
    var hr = this.pet.hpRatio(pet);
    var maxHp = this.pet.maxHp(pet);
    var hx = tx, hy = r.y + 26, hw = r.w - tx + r.x - 12, hh = 6;
    global.roundRect(ctx, hx, hy, hw, hh, 3);
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fill();
    if (hr > 0) {
      global.roundRect(ctx, hx, hy, Math.max(2, hw * hr), hh, 3);
      ctx.fillStyle = hr > 0.5 ? '#7fe0a0' : (hr > 0.2 ? '#ffd479' : '#ff7b6b');
      ctx.fill();
    }
    ctx.font = '700 9px ' + FONT;
    ctx.fillStyle = 'rgba(230,240,220,.85)';
    ctx.fillText(Math.ceil(pet.hp) + ' / ' + maxHp, hx, hy + 14);

    // 不可派遣的原因
    if (!chk.ok) {
      ctx.font = '700 10px ' + FONT;
      ctx.fillStyle = '#ff9a8a';
      ctx.textAlign = 'right';
      ctx.fillText(chk.text, r.x + r.w - 10, r.y + 15);
    }
    ctx.restore();
  };

  /** 种植模式：画面顶部一条提示条 */
  PetPanel.prototype._drawPickingHint = function (ctx) {
    var c = this.bf ? this.bf.cfg : null;
    if (!c) return;
    var pulse = 0.55 + 0.45 * Math.sin(this.t * 5);
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '800 13px ' + FONT;
    var txt = '选一个空位种下培育植物';
    var tw = ctx.measureText(txt).width + 30;
    var x = c.x + c.w / 2, y = c.y + 22;
    global.roundRect(ctx, x - tw / 2, y - 14, tw, 28, 14);
    ctx.fillStyle = 'rgba(18,25,18,.9)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,212,121,' + (0.4 + 0.5 * pulse) + ')';
    ctx.lineWidth = 1.8; ctx.stroke();
    ctx.fillStyle = '#ffd479';
    ctx.fillText(txt, x, y + 1);
    ctx.restore();
  };

  /* ---------------- 小工具 ---------------- */

  function occupied(bf, slot) {
    if (!bf) return false;
    for (var i = 0; i < bf.plants.length; i++) {
      var p = bf.plants[i];
      if (p.lane === slot.lane && p.col === slot.col) return true;
    }
    return false;
  }

  function nameOf(pet) {
    var d = global.PetsData.defOf(pet.kind);
    return d ? d.name : pet.kind;
  }

  function toast(text, kind) { global.Bus.emit(EV.TOAST, { text: text, kind: kind }); }

  PetPanel.BTN = BTN;
  PetPanel.ITEM = ITEM;

  global.PetPanel = PetPanel;
})(window);
