/* ============================================================
 *  pixel.js —— 程序化像素美术引擎
 *
 *  思路：用矢量图元在低分辨率画布上作画 → 阈值化 alpha（去抗锯齿）
 *        → 膨胀描边 → 得到干净的像素精灵。动画靠按时间生成多帧。
 *  这样每只角色的形象、配色、动作全部由代码参数化生成，没有外部贴图。
 * ============================================================ */
(function (global) {
  'use strict';

  function cv(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0);
    var x = c.getContext('2d');
    x.imageSmoothingEnabled = false;
    return c;
  }

  /* ---------------- 低分辨率绘图图元 ---------------- */

  function ell(g, cx, cy, rx, ry, fill) {
    g.beginPath();
    g.ellipse(cx, cy, Math.max(0.4, rx), Math.max(0.4, ry), 0, 0, Math.PI * 2);
    g.fillStyle = fill; g.fill();
  }
  function circ(g, cx, cy, r, fill) { ell(g, cx, cy, r, r, fill); }

  function rr(g, x, y, w, h, r, fill) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y);
    g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
    g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
    g.closePath();
    g.fillStyle = fill; g.fill();
  }

  /** 胶囊（用于腿、触角、茎） */
  function cap(g, x1, y1, x2, y2, w, fill) {
    g.lineCap = 'round';
    g.strokeStyle = fill; g.lineWidth = w;
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    g.lineCap = 'butt';
  }

  /** 折线（触角/腿的多段） */
  function poly(g, pts, w, fill) {
    if (pts.length < 2) return;
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = fill; g.lineWidth = w;
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.stroke();
    g.lineCap = 'butt'; g.lineJoin = 'miter';
  }

  function vgrad(g, x, y0, y1, c0, c1) {
    var gr = g.createLinearGradient(0, y0, 0, y1);
    gr.addColorStop(0, c0); gr.addColorStop(1, c1);
    return gr;
  }
  function rgrad(g, cx, cy, r, c0, c1) {
    var gr = g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(0.5, r));
    gr.addColorStop(0, c0); gr.addColorStop(1, c1);
    return gr;
  }

  /* ---------------- 阈值化：抹掉抗锯齿，得到硬边像素 ---------------- */

  function threshold(g, w, h, cut) {
    cut = cut === undefined ? 0.42 : cut;
    var im = g.getImageData(0, 0, w, h), d = im.data;
    for (var i = 0; i < d.length; i += 4) {
      d[i + 3] = d[i + 3] > 255 * cut ? 255 : 0;
    }
    g.putImageData(im, 0, 0);
  }

  /* ---------------- 描边：8 邻域膨胀 ---------------- */

  function outline(srcCanvas, color, inner) {
    var w = srcCanvas.width, h = srcCanvas.height;
    var g = srcCanvas.getContext('2d');
    var im = g.getImageData(0, 0, w, h), d = im.data;
    var mask = new Uint8Array(w * h);
    for (var p = 0, i = 0; i < d.length; i += 4, p++) mask[p] = d[i + 3] > 8 ? 1 : 0;

    var W = inner ? w : w + 2, H = inner ? h : h + 2;
    var out = cv(W, H), og = out.getContext('2d');
    var oim = og.createImageData(W, H), od = oim.data;
    var ox = inner ? 0 : 1, oy = inner ? 0 : 1;

    // 先把原图搬过去
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var s = (y * w + x) * 4, t = ((y + oy) * W + (x + ox)) * 4;
        od[t] = d[s]; od[t + 1] = d[s + 1]; od[t + 2] = d[s + 2]; od[t + 3] = d[s + 3];
      }
    }
    // 再画描边环
    var rgb = hexToRgb(color || '#1b2a16');
    for (var y2 = 0; y2 < h; y2++) {
      for (var x2 = 0; x2 < w; x2++) {
        if (mask[y2 * w + x2]) continue;
        var near = false;
        for (var dy = -1; dy <= 1 && !near; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            var nx = x2 + dx, ny = y2 + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            if (mask[ny * w + nx]) { near = true; break; }
          }
        }
        if (!near) continue;
        var tt = ((y2 + oy) * W + (x2 + ox)) * 4;
        od[tt] = rgb[0]; od[tt + 1] = rgb[1]; od[tt + 2] = rgb[2]; od[tt + 3] = 255;
      }
    }
    og.putImageData(oim, 0, 0);
    return out;
  }

  function hexToRgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  /* ---------------- 精灵生成 ---------------- */

  /**
   * @param w,h    作画分辨率（会被 +2 用于描边）
   * @param frames 帧数
   * @param drawFn (g, w, h, f, n) => void
   * @param opts   {outline:'#..', scale:基础不缩放, cut:阈值}
   */
  function makeSprite(w, h, frames, drawFn, opts) {
    opts = opts || {};
    var out = [];
    for (var f = 0; f < frames; f++) {
      var c = cv(w, h), g = c.getContext('2d');
      g.imageSmoothingEnabled = false;
      drawFn(g, w, h, f, frames);
      threshold(g, w, h, opts.cut);
      // outline === false → 不加描边（用于粒子/光效类精灵）
      out.push(opts.outline === false ? c : outline(c, opts.outline || '#20301a', opts.inner));
    }
    return { w: out[0].width, h: out[0].height, frames: out, n: frames, anchorX: w / 2 + (opts.inner ? 0 : 1) };
  }

  /** 生成纯白剪影（受击闪白用） */
  function makeFlash(spr, color) {
    var rgb = hexToRgb(color || '#ffffff');
    var out = [];
    for (var i = 0; i < spr.frames.length; i++) {
      var s = spr.frames[i];
      var c = cv(s.width, s.height), g = c.getContext('2d');
      g.drawImage(s, 0, 0);
      var im = g.getImageData(0, 0, s.width, s.height), d = im.data;
      for (var p = 0; p < d.length; p += 4) {
        if (d[p + 3] > 8) { d[p] = rgb[0]; d[p + 1] = rgb[1]; d[p + 2] = rgb[2]; }
      }
      g.putImageData(im, 0, 0);
      out.push(c);
    }
    var r = { w: spr.w, h: spr.h, frames: out, n: spr.n, anchorX: spr.anchorX };
    return r;
  }

  /* ---------------- 绘制 ---------------- */

  /**
   * @param spr   精灵
   * @param x,y   屏幕坐标，y 为「脚底」锚点
   * @param o     {frame, scale, flip, lean, squash, alpha, flash, tint, shadow}
   */
  function draw(ctx, spr, x, y, o) {
    o = o || {};
    var f = spr.frames[((o.frame | 0) % spr.n + spr.n) % spr.n];
    if (!f) return;
    var s = o.scale || 1;
    var lean = o.lean || 0;
    var squash = o.squash === undefined ? 1 : o.squash;
    var flip = o.flip ? -1 : 1;

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    if (o.alpha !== undefined && o.alpha < 1) ctx.globalAlpha = o.alpha;
    ctx.translate(x, y);
    if (lean) ctx.transform(1, 0, lean, 1, 0, 0);   // 顶部水平偏移 → 摆动/倾斜
    ctx.scale(s * flip, s * squash);                // 竖向压缩：以脚底为轴
    ctx.drawImage(f, -spr.anchorX, -spr.h);
    if (o.flash > 0) {
      ctx.globalAlpha = Math.min(1, o.flash);
      ctx.globalCompositeOperation = 'lighter';
      var ff = spr._flash && spr._flash.frames[((o.frame | 0) % spr.n + spr.n) % spr.n];
      if (ff) ctx.drawImage(ff, -spr.anchorX, -spr.h);
    }
    ctx.restore();
  }

  /** 地面阴影 */
  function shadow(ctx, x, y, rx, ry, a) {
    ctx.save();
    ctx.globalAlpha = a === undefined ? 0.22 : a;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  global.PX = {
    cv: cv, ell: ell, circ: circ, rr: rr, cap: cap, poly: poly,
    vgrad: vgrad, rgrad: rgrad,
    makeSprite: makeSprite, makeFlash: makeFlash,
    draw: draw, shadow: shadow, hexToRgb: hexToRgb, threshold: threshold
  };
})(window);
