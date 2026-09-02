/* ============================================================
 *  art/materialArt.js —— 材料图标（纯形状，非 Q 版）
 *
 *  ★ 主人 2026-09-02 明确：材料就纯对应形状，只有「能上战场的单位」
 *    （培育植物 / 敌人）才画 Q 版精灵。所以这里三个都是「物品」画法：
 *    没有眼睛、没有表情、没有姿态，只有轮廓 + 高光 + 体积感。
 *
 *  三种材料：
 *    redtomato  红番茄 —— 进化材料，喂下去走「龙葵」分支
 *    smallchili 小辣椒 —— 进化材料，喂下去走「灯笼椒」分支
 *    basic      基础材料 —— 关卡掉的杂物，只能卖给商店换金币（1:1）
 *
 *  尺寸刻意压小（16~22 px），因为它们是「图标」不是「角色」：
 *  合成屏里要并排显示多个，画太大反而喧宾夺主。
 * ============================================================ */
(function (global) {
  'use strict';
  var P = global.PX;
  var Art = {};

  /* ---------------- 红番茄 ---------------- */
  function drawTomato(g, w, h) {
    var cx = w / 2, cy = h * 0.55;
    var r = w * 0.40;
    // 果身
    P.circ(g, cx, cy, r, '#e8503a');
    // 底部压深一点，撑出体积
    P.ell(g, cx, cy + r * 0.42, r * 0.78, r * 0.36, '#c43a2a');
    // 左上高光
    P.circ(g, cx - r * 0.34, cy - r * 0.34, r * 0.23, '#ff9a8a');
    // 绿蒂：中心蒂 + 左右两片小叶
    P.circ(g, cx, cy - r * 0.92, r * 0.17, '#4a8c3a');
    P.ell(g, cx - r * 0.40, cy - r * 0.74, r * 0.24, r * 0.10, '#4a8c3a');
    P.ell(g, cx + r * 0.40, cy - r * 0.74, r * 0.24, r * 0.10, '#4a8c3a');
  }

  /* ---------------- 小辣椒 ---------------- */
  function drawChili(g, w, h) {
    var cx = w / 2;
    // 椒身：从右上斜向左下的弯曲胶囊
    P.cap(g, cx + w * 0.16, h * 0.32, cx - w * 0.12, h * 0.76, w * 0.30, '#d63b2f');
    // 尖端收成小圆
    P.circ(g, cx - w * 0.12, h * 0.76, w * 0.16, '#d63b2f');
    // 沿椒身的高光条
    P.cap(g, cx + w * 0.02, h * 0.38, cx - w * 0.10, h * 0.66, w * 0.08, '#ff8a7a');
    // 绿柄 + 柄帽
    P.cap(g, cx + w * 0.16, h * 0.32, cx + w * 0.26, h * 0.16, w * 0.11, '#4a8c3a');
    P.ell(g, cx + w * 0.20, h * 0.21, w * 0.20, w * 0.10, '#4a8c3a');
  }

  /* ---------------- 基础材料（杂物小袋） ---------------- */
  function drawBasic(g, w, h) {
    var cx = w / 2, cy = h * 0.56;
    // 袋身
    P.rr(g, cx - w * 0.32, cy - h * 0.20, w * 0.64, h * 0.50, w * 0.12, '#b9a67e');
    // 袋身下缘压深
    P.rr(g, cx - w * 0.32, cy + h * 0.16, w * 0.64, h * 0.14, w * 0.10, '#9a8a66');
    // 袋口束颈
    P.rr(g, cx - w * 0.17, cy - h * 0.34, w * 0.34, h * 0.18, w * 0.06, '#8a7a5a');
    // 束口绳
    P.cap(g, cx - w * 0.20, cy - h * 0.26, cx + w * 0.20, cy - h * 0.26, w * 0.07, '#6a5a3a');
    // 袋面上透出的几颗颗粒（暗示「里面装的是杂物」）
    P.circ(g, cx - w * 0.13, cy + h * 0.02, w * 0.07, '#d8c8a0');
    P.circ(g, cx + w * 0.10, cy - h * 0.03, w * 0.06, '#d8c8a0');
    P.circ(g, cx + w * 0.01, cy + h * 0.15, w * 0.06, '#d8c8a0');
  }

  var SHAPES = {
    redtomato: { fn: drawTomato, w: 20, h: 20, outline: '#5a1a0f' },
    smallchili: { fn: drawChili, w: 16, h: 22, outline: '#5a1208' },
    basic: { fn: drawBasic, w: 20, h: 20, outline: '#4a3f28' }
  };

  function build() {
    for (var k in SHAPES) {
      var s = SHAPES[k];
      (function (key, fn, w, h, ol) {
        Art[key] = P.makeSprite(w, h, 1, function (g, ww, hh) { fn(g, ww, hh); }, { outline: ol });
      })(k, s.fn, s.w, s.h, s.outline);
    }
  }

  /**
   * 便捷绘制：以 (x, y) 为中心画一个材料图标。
   * 合成屏 / 掉落提示 / 商店里都用它，避免各视图各写一遍 drawImage。
   */
  function drawAt(ctx, key, x, y, scale) {
    var spr = Art[key];
    if (!spr) return false;
    var s = scale || 1;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(spr.frames[0], x - spr.w * s / 2, y - spr.h * s / 2, spr.w * s, spr.h * s);
    ctx.restore();
    return true;
  }

  global.MaterialArt = {
    build: build, Art: Art, drawAt: drawAt,
    SHAPES: SHAPES,
    /** 该材料图标的原始尺寸（布局时算间距用） */
    sizeOf: function (key) {
      var s = SHAPES[key];
      return s ? { w: s.w, h: s.h } : { w: 16, h: 16 };
    }
  };
})(window);
