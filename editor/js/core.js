/* ============================================================
 *  core.js —— 编辑器基础设施
 *    · ED.util      通用工具
 *    · ED.ticker    统一动画帧调度（所有精灵预览共用一个 rAF）
 *    · ED.toast     提示
 *    · ED.G         游戏数据源桥接（读游戏本体源码，不写回）
 * ============================================================ */
window.ED = window.ED || {};
(function (ED) {
  'use strict';

  /* ---------------- 工具 ---------------- */
  var U = {
    esc: function (s) {
      return String(s === undefined || s === null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    },
    /*
     * h(tag, attrs, children) —— 极简 DOM 构造
     * attrs: { class, text, html, style, on:{click:fn}, data:{k:v}, ... 其余为属性 }
     */
    h: function (tag, attrs, kids) {
      var e = document.createElement(tag);
      attrs = attrs || {};
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k === 'html') e.innerHTML = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
        else if (k === 'on') Object.keys(v).forEach(function (ev) { e.addEventListener(ev, v[ev]); });
        else if (k === 'data') Object.keys(v).forEach(function (dk) { e.dataset[dk] = v[dk]; });
        else e.setAttribute(k, v);
      });
      (kids || []).forEach(function (c) {
        if (c === null || c === undefined || c === false) return;
        e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
      return e;
    },
    qs: function (sel, root) { return (root || document).querySelector(sel); },
    qsa: function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); },
    clear: function (el) { while (el && el.firstChild) el.removeChild(el.firstChild); },

    num: function (v, d) {
      if (v === null || v === undefined || isNaN(v)) return '-';
      var p = Math.pow(10, d === undefined ? 1 : d);
      return String(Math.round(v * p) / p);
    },
    /** 整数千分位 */
    gi: function (v) { return String(Math.round(v || 0)); },

    /** 高 DPI 画布 */
    mkCanvas: function (w, h) {
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      var c = document.createElement('canvas');
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      c.style.width = w + 'px'; c.style.height = h + 'px';
      var ctx = c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
      return { canvas: c, ctx: ctx, w: w, h: h, dpr: dpr };
    },

    download: function (name, text, mime) {
      var blob = new Blob([text], { type: (mime || 'application/json') + ';charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 200);
    },

    copy: function (text) {
      var ok = false;
      try {
        var ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        ok = document.execCommand('copy');
        ta.remove();
      } catch (e) { ok = false; }
      if (!ok && navigator.clipboard) {
        navigator.clipboard.writeText(text).then(function () { }, function () { });
        ok = true;
      }
      return ok;
    },

    clone: function (o) { return JSON.parse(JSON.stringify(o)); }
  };
  ED.util = U;

  /* ---------------- Toast ---------------- */
  ED.toast = function (msg, kind) {
    var box = document.getElementById('toasts');
    if (!box) return;
    var d = U.h('div', { class: 'tst ' + (kind || ''), text: msg });
    box.appendChild(d);
    setTimeout(function () {
      d.style.transition = 'opacity .25s'; d.style.opacity = '0';
      setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 260);
    }, 1900);
  };

  /* ---------------- 统一帧调度 ---------------- */
  var items = [], raf = 0, last = 0;
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    var dt = last ? Math.min(0.1, (ts - last) / 1000) : 0.016;
    last = ts;
    for (var i = 0; i < items.length; i++) {
      try { items[i](dt, ts / 1000); } catch (e) { console.error('[ticker]', e); }
    }
  }
  ED.ticker = {
    add: function (fn) { if (items.indexOf(fn) < 0) items.push(fn); if (!raf) { last = 0; raf = requestAnimationFrame(frame); } },
    remove: function (fn) { var i = items.indexOf(fn); if (i >= 0) items.splice(i, 1); },
    clear: function () { items.length = 0; }
  };

  /* ============================================================
   *  游戏数据源桥接
   *  优先读游戏本体（同源、永远最新）；读不到时用内嵌快照兜底，
   *  保证编辑器在脱离游戏目录拷走时仍能查看数值（但无法渲染精灵）。
   * ============================================================ */
  var FALLBACK = {
    ROLES: {
      grunt: { kind: 'ant', name: '小兵', hp: 95, speed: 0.35, dmg: 5, armor: 0.0, scale: 1.00, gold: 4 },
      swarm: { kind: 'ant', name: '群聚', hp: 25, speed: 0.50, dmg: 2, armor: 0.0, scale: 0.66, gold: 2 },
      swift: { kind: 'fireant', name: '迅捷', hp: 85, speed: 0.75, dmg: 3, armor: 0.0, scale: 0.92, gold: 6 },
      armor: { kind: 'beetle', name: '重甲', hp: 190, speed: 0.22, dmg: 12, armor: 0.30, scale: 1.00, gold: 12 },
      elite: { kind: 'beetle', name: '精英', hp: 450, speed: 0.28, dmg: 25, armor: 0.15, scale: 1.26, gold: 30 },
      boss: { kind: 'beetle', name: 'Boss', hp: 1400, speed: 0.20, dmg: 40, armor: 0.20, scale: 1.52, gold: 90 }
    },
    PLANTS: {
      sprout: { name: '牙苗', dmg: 0, interval: 0, range: 0, proj: null, desc: '一切的开始，可进化为任意植物' },
      peashooter: { name: '豌豆射手', dmg: 11, interval: 1.4, range: 1e9, proj: 'pea', speed: 430, muzzle: { dx: 15, dy: -14 }, desc: '炮口直射，单体稳定输出' },
      cabbagepult: { name: '卷心菜投手', dmg: 24, interval: 2.4, range: 1e9, proj: 'cabbage', speed: 0, aoe: 52, aoeRatio: 0.6, muzzle: { dx: -15, dy: -22 }, desc: '尾部抛射，落点小范围溅射' }
    },
    WAVES: [
      { t: 30, comp: [['grunt', 6]], intent: '教学波。不可能失败。' },
      { t: 35, comp: [['grunt', 4], ['swarm', 4], ['swift', 2]], intent: '引入群体压力与时间压力。' },
      { t: 45, comp: [['armor', 2], ['grunt', 6]], intent: '引入护甲，制造第一次「打不动」。' },
      { t: 45, comp: [['swift', 6], ['armor', 2]], intent: '时间压力为主，逼玩家加快合成。' },
      { t: 60, comp: [['elite', 1], ['grunt', 8], ['swarm', 4]], intent: 'Boss 波。检验轮盘编排。' }
    ],
    ELEMENTS: ['fire', 'water', 'wood', 'light', 'thunder', 'ice'],
    ELEMENT_CN: { fire: '火', water: '水', wood: '木', light: '光', thunder: '雷', ice: '冰' },
    K: {
      CHARGE_MAX: 100, CHARGE_K: 2.9, EP_BASE: 180, ELEM_CAP: 2.5,
      K_STAR: 0.15, K_GOLD: 1.0, K_SHARD: 0.04, STEP_GIFT: 2,
      STAR_POW: [1.0, 2.0, 3.5, 6.0, 10.0, 16.0, 25.0]
    },
    TIERS: [
      { name: 'T1', pool: [2, 4], w: [90, 10], E: 2.2, levels: '1–2', goal: '冲 256' },
      { name: 'T2', pool: [2, 4, 8], w: [70, 20, 10], E: 3.0, levels: '3–4', goal: '冲 256 稳定化' },
      { name: 'T3', pool: [4, 8], w: [80, 20], E: 4.8, levels: '5–6', goal: '冲 512' },
      { name: 'T4', pool: [4, 8, 16], w: [70, 20, 10], E: 6.0, levels: '7–9', goal: '冲 512 稳定化' },
      { name: 'T5', pool: [8, 16], w: [80, 20], E: 9.6, levels: '10+', goal: '冲 1024' }
    ]
  };

  function build() {
    var w = window;
    var linked = !!(w.Battlefield && w.PlantArt && w.InsectArt && w.PX && w.Bus && w.M);
    var G = {
      linked: linked,
      art: !!(w.PlantArt && w.InsectArt && w.PX),
      Bus: w.Bus || null,
      M: w.M || { clamp: function (v, a, b) { return v < a ? a : (v > b ? b : v); } },
      PX: w.PX || null,
      PlantArt: w.PlantArt || null,
      InsectArt: w.InsectArt || null,
      FX: w.FX || null,
      Battlefield: w.Battlefield || null,
      Board2048: w.Board2048 || null,
      Director: w.Director || null,
      BattleView: w.BattleView || null,
      BoardView: w.BoardView || null,
      ROLES: (w.Battlefield && w.Battlefield.ROLES) || FALLBACK.ROLES,
      PLANTS: (w.Battlefield && w.Battlefield.PLANTS) || FALLBACK.PLANTS,
      WAVES: (w.Battlefield && w.Battlefield.WAVES) || FALLBACK.WAVES,
      ELEMENTS: (w.Battlefield && w.Battlefield.ELEMENTS) || FALLBACK.ELEMENTS,
      ELEMENT_CN: (w.Battlefield && w.Battlefield.ELEMENT_CN) || FALLBACK.ELEMENT_CN,
      K: (w.Director && w.Director.K) || FALLBACK.K,
      TIERS: (w.Board2048 && w.Board2048.tiers) || FALLBACK.TIERS,
      PLANT_COST: { sprout: 20, peashooter: 60, cabbagepult: 140 },
      ELEM_RULE: {
        fire: '全场均分，总量封顶 EP×2.5；附加灼烧',
        thunder: '最前 5 个目标均分',
        ice: '最前 4 个目标均分 + 减速 50%（3s）',
        water: '单体全额 + 全场击退与减速 30%',
        wood: '最前 3 个目标均分 + 定身 1.2s',
        light: '单体全额 + 星枢回复 5%'
      }
    };
    G.PLANT_KIND = (w.PlantArt && w.PlantArt.KIND) || {
      sprout: { name: '牙苗', scale: 3 }, peashooter: { name: '豌豆射手', scale: 3 }, cabbagepult: { name: '卷心菜投手', scale: 3 }
    };
    G.INSECT_KIND = (w.InsectArt && w.InsectArt.KIND) || {
      ant: { name: '普通蚂蚁', scale: 3 }, fireant: { name: '红火蚁', scale: 3 }, beetle: { name: '天牛', scale: 3 }
    };
    G.DEFAULT_ROULETTE = ['thunder', 'fire', 'ice', 'wood', 'water', 'light'];
    return G;
  }

  ED.G = build();

})(window.ED);
