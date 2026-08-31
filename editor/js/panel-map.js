/* ============================================================
 *  panel-map.js —— ④ 地图编辑
 *    · 网格绘制：草地 / 种植槽 / 泥地 / 水洼 / 岩石 / 空洞 / 出生点
 *    · 拖拽连续绘制、整行列填充、右键擦除
 *    · 与关卡属性联动（lanes / cols），尺寸变化时保留已画内容
 *    · 连通性校验：每条轨道必须存在从入口到星枢方向的可行路径
 * ============================================================ */
(function (ED) {
  'use strict';
  var U = ED.util, G = ED.G, D = ED.Data;

  var CW = 86, CH = 92, PAD = 26;
  var P = {
    root: null, host: null, cv: null, ctx: null,
    brush: 'slot', painting: false, erasing: false,
    showCoord: true, statHost: null, warnHost: null
  };

  function L() { return D.cur(); }

  function tileAt(lane, col) {
    var m = L().map;
    if (!m.tiles[lane]) return 'grass';
    var v = m.tiles[lane][col];
    return D.TILES[v] ? v : 'grass';
  }
  function setTile(lane, col, v) {
    var m = L().map;
    if (lane < 0 || lane >= m.lanes || col < 0 || col >= m.cols) return;
    if (m.tiles[lane][col] === v) return;
    m.tiles[lane][col] = v;
    // 移除非种植槽上的植物
    if (v !== 'slot') {
      L().plants = L().plants.filter(function (p) { return !(p.lane === lane && p.col === col); });
    }
    D.emit('map');
  }

  /* ---------------- 绘制 ---------------- */
  function drawTile(ctx, x, y, w, h, key, lane, col) {
    var t = D.TILES[key];
    ctx.fillStyle = t.color;
    ctx.fillRect(x, y, w, h);

    // 纹理
    if (key === 'grass' || key === 'slot') {
      ctx.strokeStyle = 'rgba(168,232,122,.35)'; ctx.lineWidth = 1;
      for (var i = 0; i < 5; i++) {
        var gx = x + 8 + ((col * 13 + i * 17 + lane * 7) % (w - 16));
        var gy = y + h - 10 - ((i * 9 + lane * 5) % (h - 26));
        ctx.beginPath();
        ctx.moveTo(gx, gy); ctx.quadraticCurveTo(gx + 2, gy - 5, gx + 4, gy - 8);
        ctx.stroke();
      }
    }
    if (key === 'mud') {
      ctx.fillStyle = 'rgba(255,220,160,.18)';
      ctx.fillRect(x, y + h - 6, w, 6);
      ctx.strokeStyle = 'rgba(255,230,190,.35)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x + 6, y + h * 0.6); ctx.lineTo(x + w - 6, y + h * 0.45); ctx.stroke();
    }
    if (key === 'water') {
      ctx.strokeStyle = 'rgba(160,220,255,.5)'; ctx.lineWidth = 1.4;
      for (var k = 0; k < 2; k++) {
        ctx.beginPath();
        var yy = y + h * (0.45 + k * 0.2);
        ctx.moveTo(x + 6, yy);
        ctx.quadraticCurveTo(x + w / 2, yy - 5, x + w - 6, yy);
        ctx.stroke();
      }
    }
    if (key === 'rock') {
      ctx.strokeStyle = 'rgba(220,230,245,.45)'; ctx.lineWidth = 1.2;
      for (var r = -h; r < w; r += 10) {
        ctx.beginPath(); ctx.moveTo(x + r, y + h); ctx.lineTo(x + r + h, y); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(240,246,255,.85)';
      ctx.font = '900 22px system-ui'; ctx.textAlign = 'center';
      ctx.fillText('▲', x + w / 2, y + h / 2 + 9);
    }
    if (key === 'hole') {
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, w * 0.36, h * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    }
    if (key === 'spawn') {
      ctx.fillStyle = 'rgba(255,170,170,.9)';
      ctx.font = '900 20px system-ui'; ctx.textAlign = 'center';
      ctx.fillText('▶', x + w / 2, y + h / 2 + 8);
    }

    // 边框
    ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    if (key === 'slot') {
      ctx.strokeStyle = 'rgba(207,232,176,.75)'; ctx.lineWidth = 1.6;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(x + 5.5, y + 5.5, w - 11, h - 11);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(207,232,176,.9)';
      ctx.font = '800 10px "Noto Sans SC", system-ui'; ctx.textAlign = 'center';
      ctx.fillText('种植槽', x + w / 2, y + h - 12);
    }

    // 已放置植物
    var pl = L().plants.filter(function (p) { return p.lane === lane && p.col === col; })[0];
    if (pl) {
      var kind = G.PLANT_KIND[pl.kind] || { name: pl.kind };
      ctx.fillStyle = 'rgba(10,20,14,.72)';
      ctx.fillRect(x + 8, y + 8, w - 16, 20);
      ctx.fillStyle = '#dfffd0';
      ctx.font = '800 11px "Noto Sans SC", system-ui'; ctx.textAlign = 'center';
      ctx.fillText(kind.name, x + w / 2, y + 22);
    }

    if (P.showCoord) {
      ctx.fillStyle = 'rgba(255,255,255,.4)';
      ctx.font = '600 9px system-ui'; ctx.textAlign = 'left';
      ctx.fillText('L' + lane + 'C' + col, x + 4, y + 11);
    }
  }

  function render() {
    var ctx = P.ctx, m = L().map;
    var w = m.cols * CW + PAD * 2 + 40, h = m.lanes * CH + PAD * 2;
    P.cv.canvas.width = Math.round(w * P.cv.dpr);
    P.cv.canvas.height = Math.round(h * P.cv.dpr);
    P.cv.canvas.style.width = w + 'px';
    P.cv.canvas.style.height = h + 'px';
    ctx.setTransform(P.cv.dpr, 0, 0, P.cv.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // 左侧星枢示意
    ctx.fillStyle = 'rgba(111,182,245,.16)';
    ctx.fillRect(0, PAD, PAD + 12, m.lanes * CH);
    ctx.save();
    ctx.translate(PAD / 2 + 6, PAD + m.lanes * CH / 2);
    ctx.fillStyle = '#9fd8ff';
    ctx.font = '800 12px "Noto Sans SC", system-ui'; ctx.textAlign = 'center';
    ctx.fillText('星枢', 0, -6);
    ctx.fillText('星枢', 0, 12);
    ctx.restore();
    ctx.fillStyle = 'rgba(154,232,114,.9)';
    ctx.font = '800 11px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('→', PAD + 8, PAD + m.lanes * CH / 2 + 4);

    for (var l = 0; l < m.lanes; l++) {
      for (var c = 0; c < m.cols; c++) {
        var x = PAD + 26 + c * CW, y = PAD + l * CH;
        drawTile(ctx, x, y, CW, CH, tileAt(l, c), l, c);
      }
      // 轨道标签
      ctx.fillStyle = 'rgba(160,180,205,.8)';
      ctx.font = '700 10px system-ui'; ctx.textAlign = 'right';
      ctx.fillText('L' + l, PAD + 22, PAD + l * CH + CH / 2);
    }

    // 右侧来敌方向
    ctx.fillStyle = 'rgba(255,140,140,.85)';
    ctx.font = '800 11px "Noto Sans SC", system-ui'; ctx.textAlign = 'center';
    ctx.fillText('来敌', PAD + 26 + m.cols * CW + 18, PAD + m.lanes * CH / 2 - 6);
    ctx.fillText('方向', PAD + 26 + m.cols * CW + 18, PAD + m.lanes * CH / 2 + 8);

    renderStats();
  }

  /* ---------------- 校验 / 统计 ---------------- */
  function validate() {
    var m = L().map, msgs = [];
    var plantable = 0, spawns = 0;
    for (var l = 0; l < m.lanes; l++) {
      var hasSpawn = false, blockedAll = true;
      for (var c = 0; c < m.cols; c++) {
        var k = tileAt(l, c), t = D.TILES[k];
        if (k === 'spawn') { hasSpawn = true; spawns++; }
        if (k === 'slot') plantable++;
        if (t.walk) blockedAll = false;
      }
      if (blockedAll) msgs.push('L' + l + ' 整条轨道都被不可通行地块堵死，敌人无法进入。');
      if (hasSpawn) {
        var firstSpawn = -1;
        for (var c2 = 0; c2 < m.cols; c2++) if (tileAt(l, c2) === 'spawn') { firstSpawn = c2; break; }
        var ok = true;
        for (var c3 = firstSpawn; c3 >= 0; c3--) if (!D.TILES[tileAt(l, c3)].walk) ok = false;
        if (!ok) msgs.push('L' + l + ' 从出生点到星枢方向存在不可通行格，敌人会被卡住（预览里表现为停在墙前）。');
      }
    }
    if (!plantable) msgs.push('整张地图没有种植槽，玩家无法布防。');
    return { msgs: msgs, plantable: plantable, spawns: spawns };
  }

  function renderStats() {
    if (!P.statHost) return;
    var v = validate();
    U.clear(P.statHost);

    var counts = {};
    var m = L().map;
    for (var l = 0; l < m.lanes; l++) for (var c = 0; c < m.cols; c++) {
      var k = tileAt(l, c); counts[k] = (counts[k] || 0) + 1;
    }
    P.statHost.appendChild(U.h('div', { class: 'h' }, [U.h('span', { text: '地块统计' })]));
    D.TILE_KEYS.forEach(function (k) {
      if (!counts[k]) return;
      P.statHost.appendChild(U.h('div', { class: 'stat-line' }, [
        U.h('span', { class: 'muted', text: D.TILES[k].name }),
        U.h('b', { text: String(counts[k]) })
      ]));
    });
    P.statHost.appendChild(U.h('hr', { class: 'sep' }));
    P.statHost.appendChild(U.h('div', { class: 'stat-line' }, [
      U.h('span', { class: 'muted', text: '已布防植物' }), U.h('b', { text: String(L().plants.length) })
    ]));
    P.statHost.appendChild(U.h('div', { class: 'stat-line' }, [
      U.h('span', { class: 'muted', text: '地图尺寸' }), U.h('b', { text: m.lanes + ' × ' + m.cols })
    ]));

    U.clear(P.warnHost);
    P.warnHost.appendChild(U.h('div', { class: 'h' }, [U.h('span', { text: '校验' })]));
    if (v.msgs.length) {
      v.msgs.forEach(function (t) {
        P.warnHost.appendChild(U.h('div', { class: 'muted', style: { color: '#ffcfcf', marginBottom: '4px' }, text: '· ' + t }));
      });
    } else {
      P.warnHost.appendChild(U.h('div', { class: 'muted', style: { color: '#bff7d0' }, text: '· 地图可通行性正常。' }));
    }
  }

  /* ---------------- 交互 ---------------- */
  function cellFromEvent(ev) {
    var r = P.cv.canvas.getBoundingClientRect();
    var x = (ev.clientX - r.left) * (parseFloat(P.cv.canvas.style.width) / r.width);
    var y = (ev.clientY - r.top) * (parseFloat(P.cv.canvas.style.height) / r.height);
    var col = Math.floor((x - PAD - 26) / CW);
    var lane = Math.floor((y - PAD) / CH);
    var m = L().map;
    if (lane < 0 || lane >= m.lanes || col < 0 || col >= m.cols) return null;
    return { lane: lane, col: col };
  }

  function paint(ev) {
    var c = cellFromEvent(ev);
    if (!c) return;
    setTile(c.lane, c.col, P.erasing ? 'grass' : P.brush);
    render();
  }

  /* ---------------- 模板 ---------------- */
  function fillAll(v) {
    var m = L().map;
    for (var l = 0; l < m.lanes; l++) for (var c = 0; c < m.cols; c++) m.tiles[l][c] = v;
    if (v !== 'slot') L().plants = [];
    D.emit('map'); render();
  }
  function fillCol(col, v) {
    var m = L().map;
    for (var l = 0; l < m.lanes; l++) m.tiles[l][col] = v;
    D.emit('map'); render();
  }
  function fillRow(lane, v) {
    var m = L().map;
    for (var c = 0; c < m.cols; c++) m.tiles[lane][c] = v;
    D.emit('map'); render();
  }
  function template(kind) {
    var m = L().map;
    fillAll('slot');
    if (kind === 'classic') {
      for (var l = 0; l < m.lanes; l++) m.tiles[l][m.cols - 1] = 'spawn';
    } else if (kind === 'choke') {
      var mid = Math.floor(m.cols / 2);
      for (var l2 = 0; l2 < m.lanes; l2++) {
        m.tiles[l2][m.cols - 1] = 'spawn';
        if (l2 !== Math.floor(m.lanes / 2)) m.tiles[l2][mid] = 'rock';
        m.tiles[l2][Math.max(0, mid - 1)] = 'mud';
      }
    } else if (kind === 'puddle') {
      for (var l3 = 0; l3 < m.lanes; l3++) {
        m.tiles[l3][m.cols - 1] = 'spawn';
        if (l3 % 2 === 0) m.tiles[l3][Math.max(0, m.cols - 3)] = 'water';
        else m.tiles[l3][Math.max(0, m.cols - 4)] = 'mud';
      }
    }
    D.emit('map'); render();
  }

  /* ---------------- 挂载 ---------------- */
  P.mount = function (root) {
    P.root = root;
    U.clear(root);

    var wrap = U.h('div', { class: 'map-wrap' });
    var side = U.h('div', { class: 'side', style: { flex: '0 0 330px' } });

    /* 调色板 */
    var palHost = U.h('div', { class: 'palette' });
    function renderPalette() {
      U.clear(palHost);
      D.TILE_KEYS.forEach(function (k) {
        var t = D.TILES[k];
        palHost.appendChild(U.h('div', {
          class: 'pal' + (P.brush === k ? ' on' : ''),
          on: { click: function () { P.brush = k; renderPalette(); } }
        }, [
          U.h('span', { class: 'sw', style: { background: t.color } }),
          U.h('div', {}, [
            U.h('div', { class: 'nm', text: t.name }),
            U.h('div', { class: 'ds', text: t.desc })
          ])
        ]));
      });
    }

    /* 工具条 */
    var laneIn = U.h('input', {
      type: 'number', value: L().map.lanes, min: 1, max: 6,
      on: {
        change: function () {
          var Lx = L();
          Lx.battle.lanes = Math.max(1, +this.value || 1);
          Lx.map.lanes = Lx.battle.lanes;
          D.normalize(Lx);
          D.emit('levels'); mount2();
        }
      }
    });
    var colIn = U.h('input', {
      type: 'number', value: L().map.cols, min: 2, max: 12,
      on: {
        change: function () {
          var Lx = L();
          Lx.battle.cols = Math.max(2, +this.value || 2);
          Lx.map.cols = Lx.battle.cols;
          D.normalize(Lx);
          D.emit('levels'); mount2();
        }
      }
    });

    var rowSel = U.h('select', {}, [U.h('option', { value: '-1', text: '整行填充 →' })]
      .concat((function () {
        var a = [];
        for (var i = 0; i < L().map.lanes; i++) a.push(U.h('option', { value: i, text: 'L' + i }));
        return a;
      })()));
    var colSel = U.h('select', {}, [U.h('option', { value: '-1', text: '整列填充 →' })]
      .concat((function () {
        var a = [];
        for (var i = 0; i < L().map.cols; i++) a.push(U.h('option', { value: i, text: 'C' + i }));
        return a;
      })()));
    rowSel.addEventListener('change', function () {
      var i = +this.value; this.value = '-1';
      if (i >= 0) fillRow(i, P.brush);
    });
    colSel.addEventListener('change', function () {
      var i = +this.value; this.value = '-1';
      if (i >= 0) fillCol(i, P.brush);
    });

    var bar = U.h('div', { class: 'card', style: { padding: '9px 10px', marginBottom: '10px' } }, [
      U.h('div', { class: 'row wrap' }, [
        U.h('label', { class: 'f' }, [U.h('span', { text: '轨道' }), laneIn]),
        U.h('label', { class: 'f' }, [U.h('span', { text: '列数' }), colIn]),
        rowSel, colSel,
        U.h('span', { class: 'sp' }),
        U.h('label', { class: 'f', style: { cursor: 'pointer' } }, [
          U.h('input', {
            type: 'checkbox', checked: P.showCoord,
            on: { change: function () { P.showCoord = this.checked; render(); } }
          }),
          U.h('span', { text: '坐标', style: { minWidth: '0' } })
        ])
      ]),
      U.h('div', { class: 'row wrap', style: { marginTop: '8px' } }, [
        U.h('span', { class: 'muted', text: '模板：' }),
        U.h('button', { class: 'btn sm', text: '经典（全槽+最右出生）', on: { click: function () { template('classic'); } } }),
        U.h('button', { class: 'btn sm', text: '隘口（岩石分流）', on: { click: function () { template('choke'); } } }),
        U.h('button', { class: 'btn sm', text: '泥沼（减速带）', on: { click: function () { template('puddle'); } } }),
        U.h('span', { class: 'sp' }),
        U.h('button', { class: 'btn sm', text: '全部设为草地', on: { click: function () { fillAll('grass'); } } }),
        U.h('button', { class: 'btn sm danger', text: '清空植物', on: { click: function () { L().plants = []; D.emit('map'); render(); } } })
      ])
    ]);
    wrap.appendChild(bar);

    /* 画布 */
    var box = U.h('div', { class: 'map-canvas-box' });
    var c = U.mkCanvas(100, 100);
    P.cv = c; P.ctx = c.ctx;
    c.canvas.style.cursor = 'crosshair';
    c.canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    c.canvas.addEventListener('mousedown', function (ev) {
      if (ev.button === 2) { P.erasing = true; } else { P.erasing = ev.altKey; }
      P.painting = true; paint(ev);
    });
    c.canvas.addEventListener('mousemove', function (ev) { if (P.painting) paint(ev); });
    P.onUp = function () { P.painting = false; P.erasing = false; };
    window.addEventListener('mouseup', P.onUp);
    box.appendChild(c.canvas);
    wrap.appendChild(box);

    root.appendChild(wrap);
    root.appendChild(side);

    side.appendChild(U.h('div', { class: 'card' }, [
      U.h('div', { class: 'h' }, [U.h('span', { text: '地块调色板' }), U.h('span', { class: 'sub', text: '左键绘制 · 右键/Alt 擦除' })]),
      palHost
    ]));
    side.appendChild(U.h('div', { class: 'card' }, [P.statHost = U.h('div')]));
    side.appendChild(U.h('div', { class: 'card' }, [P.warnHost = U.h('div')]));
    side.appendChild(U.h('div', { class: 'card' }, [
      U.h('div', { class: 'h' }, [U.h('span', { text: '说明' })]),
      U.h('div', { class: 'muted', html:
        '· <b>种植槽</b>决定玩家可以放植物的格子；只有槽位上的植物会出现在场景预览与导出数据中。<br>' +
        '· <b>出生点</b>标记敌人从哪一格进场；没有出生点时敌人从战场右边缘进场（与当前游戏行为一致）。<br>' +
        '· <b>岩石 / 空洞</b>在预览里会挡住敌人；游戏侧需读取 <code>map.tiles</code> 自行实现寻路。<br>' +
        '· 泥地 / 水洼的减速系数写在 <code>map.effects</code> 里，预览已实现。' })
    ]));
    side.appendChild(U.h('div', { class: 'card' }, [
      U.h('div', { class: 'row' }, [
        U.h('button', { class: 'btn primary', text: '在场景中预览 →', on: { click: function () { ED.app.go('scene'); } } }),
        U.h('button', { class: 'btn', text: '编辑波次 →', on: { click: function () { ED.app.go('level'); } } })
      ])
    ]));

    renderPalette();
    render();

    /** 尺寸变化后重建本面板（保留滚动位置） */
    function mount2() {
      var m = L().map;
      laneIn.value = m.lanes; colIn.value = m.cols;
      U.clear(rowSel);
      rowSel.appendChild(U.h('option', { value: '-1', text: '整行填充 →' }));
      for (var i = 0; i < m.lanes; i++) rowSel.appendChild(U.h('option', { value: i, text: 'L' + i }));
      U.clear(colSel);
      colSel.appendChild(U.h('option', { value: '-1', text: '整列填充 →' }));
      for (var j = 0; j < m.cols; j++) colSel.appendChild(U.h('option', { value: j, text: 'C' + j }));
      render();
    }
    P.mount2 = mount2;
  };

  P.unmount = function () {
    if (P.onUp) { window.removeEventListener('mouseup', P.onUp); P.onUp = null; }
  };
  P.render = function () { if (P.ctx) render(); };

  ED.Panels = ED.Panels || {};
  ED.Panels.map = P;
})(window.ED);
