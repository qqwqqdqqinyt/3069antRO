/* 固定步长主循环：逻辑用固定 dt 推进，渲染用插值 alpha */
(function (global) {
  'use strict';

  function Loop(opts) {
    opts = opts || {};
    this.step = opts.step || 1 / 60;
    this.maxFrame = opts.maxFrame || 0.25;   // 卡顿保护：单帧最多补 0.25s
    this.update = opts.update || function () {};
    this.render = opts.render || function () {};
    this._acc = 0; this._last = 0; this._raf = 0; this.running = false;
    this.time = 0; this.frame = 0; this.fps = 60;
    this._fpsAcc = 0; this._fpsFrames = 0;
    this.timeScale = 1;
  }

  Loop.prototype.start = function () {
    if (this.running) return;
    this.running = true; this._last = performance.now(); this._acc = 0;
    var self = this;
    function tick(now) {
      if (!self.running) return;
      self._raf = requestAnimationFrame(tick);
      var raw = (now - self._last) / 1000;
      self._last = now;
      if (raw > self.maxFrame) raw = self.maxFrame;

      self._fpsAcc += raw; self._fpsFrames++;
      if (self._fpsAcc >= 0.5) {
        self.fps = self._fpsFrames / self._fpsAcc;
        self._fpsAcc = 0; self._fpsFrames = 0;
      }

      self._acc += raw * self.timeScale;
      var guard = 0;
      while (self._acc >= self.step && guard++ < 8) {
        self.update(self.step, self.time);
        self.time += self.step; self.frame++;
        self._acc -= self.step;
      }
      self.render(self._acc / self.step, raw);
    }
    this._raf = requestAnimationFrame(tick);
  };

  Loop.prototype.stop = function () {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  };

  global.Loop = Loop;
})(window);
