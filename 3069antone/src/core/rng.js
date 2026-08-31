/* 可复现随机数 + 数学工具 */
(function (global) {
  'use strict';

  function RNG(seed) {
    var s = (seed >>> 0) || 0x2f6e2b1;
    this._s = s;
  }
  RNG.prototype.next = function () {
    // xorshift32
    var x = this._s;
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    this._s = x;
    return x / 4294967296;
  };
  RNG.prototype.range = function (a, b) { return a + this.next() * (b - a); };
  RNG.prototype.int = function (a, b) { return Math.floor(this.range(a, b + 1)); };
  RNG.prototype.pick = function (arr) { return arr[Math.floor(this.next() * arr.length)]; };
  RNG.prototype.weighted = function (vals, weights) {
    var tot = 0, i;
    for (i = 0; i < weights.length; i++) tot += weights[i];
    var r = this.next() * tot;
    for (i = 0; i < vals.length; i++) { r -= weights[i]; if (r <= 0) return vals[i]; }
    return vals[vals.length - 1];
  };
  RNG.prototype.chance = function (p) { return this.next() < p; };

  var M = {
    clamp: function (v, a, b) { return v < a ? a : (v > b ? b : v); },
    lerp: function (a, b, t) { return a + (b - a) * t; },
    // 帧率无关的指数逼近
    damp: function (a, b, lambda, dt) { return M.lerp(a, b, 1 - Math.exp(-lambda * dt)); },
    ease: {
      outCubic: function (t) { return 1 - Math.pow(1 - t, 3); },
      outBack: function (t) { var c = 1.70158, c3 = c + 1; return 1 + c3 * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
      outQuad: function (t) { return 1 - (1 - t) * (1 - t); },
      inQuad: function (t) { return t * t; },
      outElastic: function (t) {
        if (t === 0 || t === 1) return t;
        var p = 0.36;
        return Math.pow(2, -10 * t) * Math.sin((t - p / 4) * (2 * Math.PI) / p) + 1;
      }
    }
  };

  global.RNG = RNG;
  global.M = M;
})(window);
