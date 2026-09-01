/* ============================================================
 *  layout.js —— 自适应布局（唯一「知道屏幕是什么形状」的地方）
 *
 *  两套逻辑坐标空间：
 *    横屏 / 桌面  1040 × 640   战场在左，棋盘在右（原版布局，数值不变）
 *    竖屏 / 手机   540 × 动态   战场在上，棋盘在下，元素轮盘居底
 *
 *  为什么要抽这一层？
 *    原版把 1040×640 硬编码进 main.js / cardView / metaView，
 *    任何一次「换个屏幕」都要改十几处。现在屏幕形状只在这里算一次，
 *    其它模块一律只认 region 矩形，不再关心自己跑在什么设备上。
 *
 *  坐标约定：
 *    所有 rect 都是「逻辑坐标」，与 dpr、CSS 缩放完全无关。
 *    CSS 尺寸由 fitCss() 统一按 contain 算出，交给 main.js 贴到 canvas 上。
 * ============================================================ */
(function (global) {
  'use strict';

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* ---- 竖屏逻辑画布：宽度固定，高度跟随真实宽高比（并夹紧） ---- */
  var PORTRAIT_W = 540;
  var PORTRAIT_H_MIN = 900;
  var PORTRAIT_H_MAX = 1120;   // 9:19.5 长屏到此为止，剩余空间留给上下留白

  /* ---- 横屏：桌面观感保守一点，不要被 4K 屏放大到失真 ---- */
  var LANDSCAPE_W = 1040;
  var LANDSCAPE_H = 640;
  var LANDSCAPE_MAX_SCALE = 1.25;

  /* ---- 竖屏纵向分配（自上而下）---- */
  var PAD = 12;                // 左右安全边距
  var HEADER_H = 46;           // 顶部：标题 + 货币
  var BATTLE_TOP = 52;         // 战场起始 y
  var BATTLE_RATIO = 0.32;     // 战场占屏高比例
  var BATTLE_H_MIN = 268;
  var BATTLE_H_MAX = 336;
  var WHEEL_H = 78;            // 底部元素轮盘
  var GAP = 8;                 // 区块间距

  /**
   * 计算布局
   * @param {number} vw 视口 CSS 宽
   * @param {number} vh 视口 CSS 高
   * @returns {object} 布局对象
   */
  function compute(vw, vh) {
    vw = Math.max(200, vw || 1024);
    vh = Math.max(200, vh || 768);

    // 判定竖屏：高/宽 >= 1.12（覆盖 9:8 及更长的手机屏；平板横放仍走横屏）
    var portrait = (vh / vw) >= 1.12;
    var L = { portrait: portrait, vw: vw, vh: vh };

    if (portrait) {
      L.W = PORTRAIT_W;
      L.H = Math.round(clamp(PORTRAIT_W * vh / vw, PORTRAIT_H_MIN, PORTRAIT_H_MAX));
      portraitLayout(L);
    } else {
      L.W = LANDSCAPE_W;
      L.H = LANDSCAPE_H;
      landscapeLayout(L);
    }

    /* 2.5D 梯形投影。默认关闭 —— 正交外观是回归基线，逐屏目检通过后再打开。
     * depthFar = 最远车道宽度 / 最近车道宽度。0.72 是「看得出纵深」与
     * 「远排单位仍可辨认」的临界点；再小远排精灵会糊。 */
    L.depth25d = true;
    L.depthFar = 0.72;

    fitCss(L, vw, vh);
    return L;
  }

  /* ---------------- 竖屏：战场在上，棋盘在下 ---------------- */
  function portraitLayout(L) {
    var W = L.W, H = L.H;
    L.pad = PAD;
    L.small = true;                 // 紧凑排版标记（字号 / 间距开关）

    L.header = { x: PAD, y: 0, w: W - PAD * 2, h: HEADER_H };

    var battleH = Math.round(clamp(H * BATTLE_RATIO, BATTLE_H_MIN, BATTLE_H_MAX));
    L.battle = { x: PAD, y: BATTLE_TOP, w: W - PAD * 2, h: battleH };

    // 轮盘钉在最底部
    L.wheel = { x: PAD, y: H - PAD - WHEEL_H, w: W - PAD * 2, h: WHEEL_H };

    // 棋盘吃掉中间剩下的全部空间
    var boardTop = L.battle.y + battleH + GAP;
    L.board = {
      x: PAD, y: boardTop, w: W - PAD * 2,
      h: L.wheel.y - boardTop - GAP
    };

    // 战场内部参数：竖屏窄一点，把星枢往左收，给 4 列种植位留足空间
    L.battleCfg = { lanes: 3, cols: 4, nodeX: 52 };

    L.swipe = 24;                   // 滑动判定阈值（逻辑像素）
  }

  /* ---------------- 横屏：左战场，右棋盘（沿用原版坐标） ---------------- */
  function landscapeLayout(L) {
    L.pad = 14;
    L.small = false;

    L.header = { x: 16, y: 0, w: L.W - 32, h: 44 };
    L.battle = { x: 14, y: 52, w: 596, h: 576 };
    L.board = { x: 622, y: 52, w: 404, h: 576 };
    // 横屏轮盘画在棋盘区底部（原版行为），不需要独立区域
    L.wheel = null;
    L.battleCfg = { lanes: 3, cols: 4, nodeX: 58 };
    L.swipe = 26;
  }

  /* ---------------- CSS 尺寸：contain 缩放，居中留白 ---------------- */
  function fitCss(L, vw, vh) {
    var s = Math.min(vw / L.W, vh / L.H);
    if (!L.portrait) s = Math.min(s, LANDSCAPE_MAX_SCALE);
    L.scale = s;
    L.cssW = Math.round(L.W * s);
    L.cssH = Math.round(L.H * s);
  }

  /**
   * 供调试 / 测试用：直接按设备名拿一份布局
   * @param {string} name 'iphone-se' | 'iphone-14' | 'iphone-14-pro-max' | 'ipad' | 'desktop'
   */
  var PRESETS = {
    'iphone-se': [375, 667],
    'iphone-14': [390, 844],
    'iphone-14-pro-max': [430, 932],
    'android-20-9': [412, 915],
    'ipad': [768, 1024],
    'desktop': [1440, 900]
  };
  function preset(name) {
    var p = PRESETS[name] || PRESETS['iphone-14'];
    return compute(p[0], p[1]);
  }

  global.Layout = {
    compute: compute,
    preset: preset,
    PRESETS: PRESETS,
    PORTRAIT_W: PORTRAIT_W,
    LANDSCAPE_W: LANDSCAPE_W,
    LANDSCAPE_H: LANDSCAPE_H
  };
})(window);
