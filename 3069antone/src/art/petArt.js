/* ============================================================
 *  art/petArt.js —— 培育植物（宠物）精灵
 *
 *  与 plantArt.js 同构：build() 生成 → Art[kind] / Art[kind+'Fire'] / Art.icon[kind]
 *  → PetAnimator 输出 {sprite, frame, lean, squash, bob, firing}，
 *    视图层（battleView / forgeView / petPanel）不需要知道具体形态。
 *
 *  美术定位（主人 2026-09-02 定）：
 *    · 材料是纯形状（见 materialArt.js）
 *    · 培育植物是「能上战场的单位」，所以画成有脸有姿态的 Q 版剪影
 *    · 本期是占位稿：色块 + 简笔剪影（8 像素尺度可读），后续在 spriteMem/ 精修
 *
 *  形态：redsprout（红牙苗）/ longkui（龙葵）/ denglongjiao（灯笼椒）
 *        + greensprout / witheredsprout（未开放链，仅占位不参与流程）
 * ============================================================ */
(function (global) {
  'use strict';
  var P = global.PX;
  var Art = {};

  var IDLE_FRAMES = 6, FIRE_FRAMES = 4;

  /* ---------------- 配色 ---------------- */
  var C = {
    redsprout: {
      stem: '#3f7a33', stem2: '#2f5c26',
      leaf: '#ff6b6b', leaf2: '#d94f4f',
      bud: '#ff8f6b', hi: '#ffd0c0', eye: '#2a1418', outline: '#4a1216'
    },
    longkui: {
      stem: '#5a3a6a', stem2: '#3f2849',
      leaf: '#8a5aa0', leaf2: '#6a3f80',
      berry: '#2a1a3a', berry2: '#a86bd8', hi: '#d8b0ff', eye: '#150a1e', outline: '#2a0f38'
    },
    denglongjiao: {
      stem: '#6a4a2a', stem2: '#4a331c',
      leaf: '#4a8c3a', leaf2: '#3a6c2c',
      fruit: '#ff8c42', rib: '#d9632a', hi: '#ffd9a0', eye: '#3a1a08', outline: '#5a1f08'
    },
    greensprout: {
      stem: '#3f7a33', stem2: '#2f5c26',
      leaf: '#6cc04a', leaf2: '#4a9c34',
      bud: '#9fe06a', hi: '#e0ffc0', eye: '#1a2a14', outline: '#12300f'
    },
    witheredsprout: {
      stem: '#6a5a3a', stem2: '#4a3f28',
      leaf: '#9a8f7a', leaf2: '#7a6f5c',
      bud: '#b0a68a', hi: '#e0d8c0', eye: '#2a2418', outline: '#2f2a1c'
    }
  };

  /* ---------------- 绘制：红色牙苗 ----------------
   * 结构：茎 → 两片叶 → 顶芽（带一对小眼睛）
   * fire 帧：叶片前倾、顶芽张开（吐籽的瞬间）
   */
  function drawRedSprout(g, w, h, f, n, firing) {
    var t = f / n, c = C.redsprout;
    var sw = Math.sin(t * Math.PI * 2);
    var breathe = sw * 0.8;
    var cx = w / 2, footY = h - 2;
    var lean = firing ? 1.6 : 0;                 // 开火时整体前倾

    // 茎
    P.cap(g, cx, footY, cx + lean * 0.3, footY - 14 + breathe, 3.2, c.stem);
    // 叶片（开火时前伸）
    var ly = footY - 8 + breathe * 0.5;
    var ext = firing ? 1.8 : 0;
    P.ell(g, cx - 6 - ext * 0.4, ly, 5.5 + ext * 0.3, 3.2, c.leaf);
    P.ell(g, cx + 6 + ext, ly - 1, 5.5 + ext * 0.3, 3.2, c.leaf2);
    // 顶芽
    var hy = footY - 16 + breathe;
    P.circ(g, cx + lean, hy, firing ? 4.8 : 4.2, c.bud);
    P.circ(g, cx + lean - 1.4, hy - 1.2, 1.4, c.hi);
    // 一对小眼睛
    P.circ(g, cx + lean - 1.6, hy + 0.6, 0.9, c.eye);
    P.circ(g, cx + lean + 1.6, hy + 0.6, 0.9, c.eye);
  }

  /* ---------------- 绘制：龙葵 ----------------
   * 结构：高茎 → 宽大紫叶 → 顶部三颗浆果（成品字形）
   */
  function drawLongkui(g, w, h, f, n, firing) {
    var t = f / n, c = C.longkui;
    var breathe = Math.sin(t * Math.PI * 2) * 0.7;
    var cx = w / 2, footY = h - 2;
    var lean = firing ? 1.8 : 0;

    // 茎（比牙苗高）
    P.cap(g, cx, footY, cx + lean * 0.3, footY - 17 + breathe, 3.6, c.stem);
    // 宽大叶片
    var ly = footY - 10 + breathe * 0.4;
    var ext = firing ? 2.0 : 0;
    P.ell(g, cx - 7 - ext * 0.5, ly, 7, 4, c.leaf);
    P.ell(g, cx + 7 + ext, ly - 1.5, 7, 4, c.leaf2);
    // 浆果串：下两颗 + 顶一颗
    var by = footY - 19 + breathe;
    P.circ(g, cx + lean - 3.8, by, 3.0, c.berry);
    P.circ(g, cx + lean + 3.8, by + 1, 3.0, c.berry);
    P.circ(g, cx + lean, by - 3.8, 3.4, c.berry2);
    // 顶浆果的眼睛（脸在最高那颗上）
    P.circ(g, cx + lean - 1.2, by - 4.2, 0.85, c.eye);
    P.circ(g, cx + lean + 1.2, by - 4.2, 0.85, c.eye);
    P.circ(g, cx + lean - 1.0, by - 5.2, 1.1, c.hi);
  }

  /* ---------------- 绘制：灯笼椒 ----------------
   * 结构：粗茎 → 大叶片 → 顶部灯笼形果实（带竖纹 + 高光）
   */
  function drawDenglongjiao(g, w, h, f, n, firing) {
    var t = f / n, c = C.denglongjiao;
    var breathe = Math.sin(t * Math.PI * 2) * 0.9;
    var cx = w / 2, footY = h - 2;
    var lean = firing ? 1.4 : 0;

    // 粗茎
    P.cap(g, cx, footY, cx + lean * 0.3, footY - 12 + breathe, 4.2, c.stem);
    // 大叶片
    var ly = footY - 7 + breathe * 0.3;
    var ext = firing ? 1.6 : 0;
    P.ell(g, cx - 8 - ext * 0.4, ly, 8, 4.5, c.leaf);
    P.ell(g, cx + 8 + ext, ly - 1, 8, 4.5, c.leaf2);
    // 灯笼果实
    var fy = footY - 21 + breathe;
    var glow = firing ? 1.0 : 0;                  // 开火时灯笼更亮
    P.rr(g, cx + lean - 6, fy, 12, 11, 4, glow ? c.hi : c.fruit);
    if (!glow) {
      P.rr(g, cx + lean - 6, fy, 12, 11, 4, c.fruit);
      // 竖纹
      P.cap(g, cx + lean - 2.5, fy + 2, cx + lean - 2.5, fy + 9, 1, c.rib);
      P.cap(g, cx + lean + 2.5, fy + 2, cx + lean + 2.5, fy + 9, 1, c.rib);
      // 高光
      P.ell(g, cx + lean - 3, fy + 3.5, 2, 2.8, c.hi);
    }
    // 顶部小柄
    P.cap(g, cx + lean, fy, cx + lean, fy - 2.5, 1.6, c.stem);
    // 眼睛（在灯笼上半部）
    P.circ(g, cx + lean - 2.2, fy + 4.5, 1.0, c.eye);
    P.circ(g, cx + lean + 2.2, fy + 4.5, 1.0, c.eye);
  }

  /* ---------------- 绘制：绿色牙苗（未开放，占位） ---------------- */
  function drawGreenSprout(g, w, h, f, n, firing) {
    var t = f / n, c = C.greensprout;
    var breathe = Math.sin(t * Math.PI * 2) * 0.9;
    var cx = w / 2, footY = h - 2;
    P.cap(g, cx, footY, cx, footY - 14 + breathe, 3.4, c.stem);
    var ly = footY - 8 + breathe * 0.5;
    P.ell(g, cx - 6.5, ly, 6, 3.4, c.leaf);
    P.ell(g, cx + 6.5, ly - 1, 6, 3.4, c.leaf2);
    var hy = footY - 16 + breathe;
    P.circ(g, cx, hy, 4.4, c.bud);
    P.circ(g, cx - 1.4, hy - 1.2, 1.4, c.hi);
    P.circ(g, cx - 1.6, hy + 0.6, 0.9, c.eye);
    P.circ(g, cx + 1.6, hy + 0.6, 0.9, c.eye);
  }

  /* ---------------- 绘制：枯萎牙苗（未开放，占位） ----------------
   * 与红色牙苗同骨架，但叶片下垂（角度朝下）、配色灰褐
   */
  function drawWitheredSprout(g, w, h, f, n, firing) {
    var t = f / n, c = C.witheredsprout;
    var breathe = Math.sin(t * Math.PI * 2) * 0.5;   // 垂头丧气，起伏小
    var cx = w / 2, footY = h - 2;
    P.cap(g, cx, footY, cx + 0.8, footY - 13 + breathe, 3.0, c.stem);
    // 叶片下垂：中心 y 比茎顶低
    var ly = footY - 6 + breathe * 0.4;
    P.ell(g, cx - 6, ly + 1.5, 5, 2.8, c.leaf);
    P.ell(g, cx + 6.5, ly + 2.2, 5, 2.8, c.leaf2);
    var hy = footY - 15 + breathe;
    P.circ(g, cx + 0.8, hy, 3.8, c.bud);
    P.circ(g, cx - 0.6, hy - 1.0, 1.2, c.hi);
    P.circ(g, cx - 0.8, hy + 0.5, 0.85, c.eye);
    P.circ(g, cx + 2.4, hy + 0.5, 0.85, c.eye);
  }

  var DRAW = {
    redsprout: drawRedSprout,
    longkui: drawLongkui,
    denglongjiao: drawDenglongjiao,
    greensprout: drawGreenSprout,
    witheredsprout: drawWitheredSprout
  };

  /* 各形态的精灵尺寸（与 plantArt 同一量级：22~28 宽、28~32 高） */
  var SIZE = {
    redsprout: [24, 28], longkui: [26, 32], denglongjiao: [28, 30],
    greensprout: [24, 28], witheredsprout: [24, 28]
  };

  /* ---------------- 构建 ---------------- */
  function build() {
    for (var k in DRAW) {
      var sz = SIZE[k] || [26, 30];
      var ol = C[k] ? C[k].outline : '#20301a';
      (function (kind, fn, w, h, outline) {
        Art[kind] = P.makeSprite(w, h, IDLE_FRAMES,
          function (g, ww, hh, f, n) { fn(g, ww, hh, f, n, false); }, { outline: outline });
        Art[kind + 'Fire'] = P.makeSprite(w, h, FIRE_FRAMES,
          function (g, ww, hh, f, n) { fn(g, ww, hh, f, n, true); }, { outline: outline });
        Art[kind]._flash = P.makeFlash(Art[kind], '#ffffff');
        Art[kind + 'Fire']._flash = Art[kind]._flash;
        // 小头像（合成屏 / 编队面板用）
        Art.icon[kind] = P.makeSprite(w, h, 1,
          function (g, ww, hh) { fn(g, ww, hh, 0, 1, false); }, { outline: outline });
      })(k, DRAW[k], sz[0], sz[1], ol);
    }
  }

  /* ---------------- 动画控制器 ----------------
   * 与 PlantAnimator 输出同构，方便 battleView 直接复用绘制路径。
   */
  function PetAnimator(kind, seed) {
    this.kind = kind;
    this.t = (seed || 0) * 1.7;     // 相位错开
    this.fireT = -1;                 // <0 表示未在发射
    this.fireDur = 0.28;
  }
  PetAnimator.prototype.triggerFire = function () { this.fireT = 0; };
  PetAnimator.prototype.update = function (dt) {
    this.t += dt;
    if (this.fireT >= 0) {
      this.fireT += dt;
      if (this.fireT >= this.fireDur) this.fireT = -1;
    }
  };
  PetAnimator.prototype.isFiring = function () { return this.fireT >= 0; };
  /** 击发瞬间（归一化时刻）—— 与 PlantAnimator.strikeAt 同义 */
  PetAnimator.prototype.strikeAt = function () { return 0.25; };
  PetAnimator.prototype.render = function () {
    var idle = Art[this.kind], fire = Art[this.kind + 'Fire'];
    var firing = this.fireT >= 0;
    var spr = (firing && fire) ? fire : idle;
    var frame;
    if (firing && fire) frame = Math.min(fire.n - 1, Math.floor(this.fireT / this.fireDur * fire.n));
    else frame = Math.floor(this.t * 8.5) % spr.n;
    var s = Math.sin(this.t * Math.PI * 2 * 0.42);
    return {
      sprite: spr, frame: frame,
      lean: s * 0.03, squash: 1 + s * 0.026, bob: s * 0.9,
      firing: firing
    };
  };

  Art.icon = {};   // build() 里填充

  global.PetArt = {
    build: build, Art: Art, PetAnimator: PetAnimator,
    C: C, IDLE_FRAMES: IDLE_FRAMES, FIRE_FRAMES: FIRE_FRAMES,
    KIND: {
      redsprout: { name: '红色牙苗', w: 24, h: 28, scale: 3 },
      longkui: { name: '龙葵', w: 26, h: 32, scale: 3 },
      denglongjiao: { name: '灯笼椒', w: 28, h: 30, scale: 3 },
      greensprout: { name: '绿色牙苗', w: 24, h: 28, scale: 3 },
      witheredsprout: { name: '枯萎牙苗', w: 24, h: 28, scale: 3 }
    }
  };
})(window);
