/* ============================================================
 *  app.js —— 编辑器入口：建美术、载草稿、切面板
 * ============================================================ */
(function (ED) {
  'use strict';
  var U = ED.util, G = ED.G, D = ED.Data;

  var app = { cur: null, panels: {} };
  ED.app = app;

  var PANEL_DEF = [
    { key: 'assets', cls: 'panel pad' },
    { key: 'scene', cls: 'panel cols' },
    { key: 'level', cls: 'panel cols' },
    { key: 'map', cls: 'panel cols' },
    { key: 'export', cls: 'panel pad' }
  ];

  app.go = function (key) {
    PANEL_DEF.forEach(function (d) {
      var el = document.getElementById('panel-' + d.key);
      if (!el) return;
      var on = d.key === key;
      el.classList.toggle('active', on);
      var p = ED.Panels[d.key];
      if (p) {
        if (on && !app.panels[d.key]) {
          try { p.mount(el); app.panels[d.key] = true; }
          catch (e) {
            console.error(e);
            U.clear(el);
            el.appendChild(U.h('div', { class: 'banner', text: '面板加载失败：' + e.message }));
          }
        } else if (on && p.render && d.key !== 'level') {
          try { p.render(); } catch (e) { console.error(e); }
        }
      }
    });
    U.qsa('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.panel === key); });
    app.cur = key;
  };

  function buildPanels() {
    var stage = document.getElementById('stage');
    U.clear(stage);
    PANEL_DEF.forEach(function (d) {
      var el = U.h('section', { class: d.cls, id: 'panel-' + d.key });
      stage.appendChild(el);
    });
  }

  function setLink() {
    var el = document.getElementById('linkState');
    if (!el) return;
    if (G.linked) {
      el.textContent = '已连接游戏源码';
      el.className = 'pill';
      el.title = '3069antone/src/*.js';
    } else {
      el.textContent = '未连接游戏源码';
      el.className = 'pill bad';
      el.title = '未找到 ../3069antone/src/*.js，当前为内嵌数值快照';
    }
  }

  function boot() {
    D.load();
    buildPanels();
    setLink();

    // 数据与界面的联动
    D.onChange(function (what) {
      if (ED.Panels.export && ED.Panels.export.mounted) {
        try { ED.Panels.export.refresh(); } catch (e) { }
      }
      if (ED.Panels.scene && ED.Panels.scene.fillLevels) {
        try { ED.Panels.scene.fillLevels(); } catch (e) { }
      }
    });

    var pill = document.getElementById('linkState');
    if (pill) pill.textContent = '正在生成像素美术…';

    // 精灵构建是同步的重活，先让首帧画出来再做
    setTimeout(function () {
      try {
        if (G.PlantArt && G.PlantArt.build) G.PlantArt.build();
        if (G.InsectArt && G.InsectArt.build) G.InsectArt.build();
      } catch (e) {
        console.error('[art]', e);
        ED.toast('精灵生成失败：' + e.message, 'bad');
      }
      setLink();
      app.go('assets');
    }, 40);

    U.qsa('.tab').forEach(function (t) {
      t.addEventListener('click', function () { app.go(t.dataset.panel); });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.ED);
