/* ============================================================
 *  panel-level.js —— ③ 关卡编辑器
 *    · 关卡列表：新建 / 复制 / 删除 / 排序
 *    · 关卡属性：战场尺寸、星枢、经济、棋盘档位、元素轮盘
 *    · 波次编辑：组成增删、时长、设计意图、排序
 *    · 实时统计：每波总 HP / 有效 HP / 需求 DPS / 可用 DPS / 压力曲线
 * ============================================================ */
(function (ED) {
  'use strict';
  var U = ED.util, G = ED.G, D = ED.Data, S = D.Stats;

  var P = { root: null, listHost: null, mainHost: null, statHost: null };

  /* ---------------- 关卡列表 ---------------- */
  function renderList() {
    var host = P.listHost;
    U.clear(host);
    host.appendChild(U.h('div', { class: 'h' }, [
      U.h('span', { text: '关卡' }), U.h('span', { class: 'sub', text: D.levels.length + ' 个' })
    ]));

    D.levels.forEach(function (L, i) {
      var st = S.level(L, i + 1);
      host.appendChild(U.h('div', {
        class: 'lv-item' + (i === D.active ? ' on' : ''),
        on: {
          click: function () {
            if (D.active === i) return;
            D.active = i; D.save();
            renderList(); renderMain(); renderStats();
            if (ED.Panels.scene) ED.Panels.scene.rebuild();
          }
        }
      }, [
        U.h('div', { class: 't' }, [
          U.h('div', { text: (i + 1) + '. ' + L.name }),
          U.h('div', { class: 'w', text: L.waves.length + ' 波 · ' + st.total.count + ' 敌 · ' + U.num(st.total.t, 0) + 's' })
        ])
      ]));
    });

    host.appendChild(U.h('div', { class: 'row', style: { marginTop: '8px' } }, [
      U.h('button', { class: 'btn sm', text: '+ 新建', on: { click: function () { D.addLevel(null); renderList(); renderMain(); renderStats(); } } }),
      U.h('button', { class: 'btn sm', text: '⧉ 复制', on: { click: function () { D.addLevel(D.cur()); renderList(); renderMain(); renderStats(); } } }),
      U.h('button', { class: 'btn sm', text: '↑', on: { click: function () { D.moveLevel(D.active, -1); renderList(); renderMain(); renderStats(); } } }),
      U.h('button', { class: 'btn sm', text: '↓', on: { click: function () { D.moveLevel(D.active, 1); renderList(); renderMain(); renderStats(); } } }),
      U.h('button', { class: 'btn sm danger', text: '删除', on: { click: function () { D.removeLevel(D.active); renderList(); renderMain(); renderStats(); } } })
    ]));
  }

  /* ---------------- 属性 ---------------- */
  function field(label, input) {
    return U.h('label', { class: 'f' }, [U.h('span', { text: label }), input]);
  }

  function numInput(get, set, opts) {
    opts = opts || {};
    var el = U.h('input', {
      type: 'number', value: get(), min: opts.min, max: opts.max, step: opts.step || 1,
      on: {
        change: function () {
          var v = +this.value;
          if (opts.min !== undefined && v < opts.min) v = opts.min;
          if (opts.max !== undefined && v > opts.max) v = opts.max;
          this.value = v;
          set(v);
          if (opts.structural) { renderMain(); }
          renderStats();
          D.emit(opts.structural ? 'levels' : 'props');
        }
      }
    });
    return el;
  }

  function renderMain() {
    var host = P.mainHost;
    U.clear(host);
    var L = D.cur();

    /* 基础属性 */
    var nameIn = U.h('input', {
      type: 'text', value: L.name, class: 'wide',
      on: { input: function () { L.name = this.value; D.emit('props'); renderList(); } }
    });
    var idIn = U.h('input', {
      type: 'text', value: L.id, style: { width: '90px' },
      on: { input: function () { L.id = this.value; D.emit('props'); } }
    });

    host.appendChild(U.h('div', { class: 'card' }, [
      U.h('div', { class: 'h' }, [U.h('span', { text: '关卡属性' }), U.h('span', { class: 'sub', text: '改动立即写入草稿，并同步到场景预览' })]),
      U.h('div', { class: 'row wrap' }, [
        field('名称', nameIn),
        field('ID', idIn)
      ]),
      U.h('hr', { class: 'sep' }),
      U.h('div', { class: 'row wrap' }, [
        field('轨道数 lanes', numInput(function () { return L.battle.lanes; }, function (v) {
          L.battle.lanes = v; L.map.lanes = v; D.normalize(L);
          L.plants = L.plants.filter(function (p) { return p.lane < v; });
        }, { min: 1, max: 6, structural: true })),
        field('地图列 cols', numInput(function () { return L.battle.cols; }, function (v) {
          L.battle.cols = v; L.map.cols = v; D.normalize(L);
          L.plants = L.plants.filter(function (p) { return p.col < v; });
        }, { min: 2, max: 12, structural: true })),
        field('星枢偏移', numInput(function () { return L.battle.nodeX; }, function (v) { L.battle.nodeX = v; }, { min: 20, max: 200 })),
        field('星枢 HP', numInput(function () { return L.battle.nodeHp; }, function (v) { L.battle.nodeHp = v; }, { min: 10, max: 9999 })),
        field('起始金币', numInput(function () { return L.battle.gold; }, function (v) { L.battle.gold = v; }, { min: 0, max: 9999 }))
      ]),
      U.h('hr', { class: 'sep' }),
      U.h('div', { class: 'row wrap' }, [
        field('棋盘 n', numInput(function () { return L.board.n; }, function (v) { L.board.n = v; }, { min: 3, max: 7 })),
        field('生成档 tier', numInput(function () { return L.board.tier; }, function (v) { L.board.tier = v; }, { min: 1, max: 5 })),
        field('步数上限', numInput(function () { return L.board.stepMax; }, function (v) { L.board.stepMax = v; }, { min: 1, max: 12 })),
        field('步数回复(s)', numInput(function () { return L.board.stepRegen; }, function (v) { L.board.stepRegen = v; }, { min: 0.2, max: 10, step: 0.1 }))
      ]),
      U.h('div', { class: 'muted', style: { marginTop: '6px' } }, [
        U.h('span', { html: '生成档：' }),
        U.h('span', { class: 'tag acc', text: (G.TIERS[L.board.tier - 1] || G.TIERS[0]).name }),
        U.h('span', { text: '　E[v] = ' + (G.TIERS[L.board.tier - 1] || G.TIERS[0]).E + '　' + (G.TIERS[L.board.tier - 1] || G.TIERS[0]).goal })
      ])
    ]));

    /* 元素轮盘 */
    var wheelHost = U.h('div', { class: 'row wrap' });
    L.roulette.forEach(function (el, i) {
      var sel = U.h('select', {
        on: {
          change: function () { L.roulette[i] = this.value; D.emit('props'); if (ED.Panels.scene) ED.Panels.scene.rebuild(); }
        }
      }, G.ELEMENTS.map(function (e) {
        return U.h('option', { value: e, text: G.ELEMENT_CN[e] + ' ' + e, selected: e === el });
      }));
      wheelHost.appendChild(U.h('div', { class: 'f' }, [
        U.h('span', { class: 'tag', text: '第' + (i + 1) + '次' }), sel
      ]));
    });
    host.appendChild(U.h('div', { class: 'card' }, [
      U.h('div', { class: 'h' }, [
        U.h('span', { text: '元素轮盘' }),
        U.h('span', { class: 'sub', text: '决定每次附魔的元素顺序（与游戏 Director.roulette 同构）' })
      ]),
      wheelHost
    ]));

    /* 波次 */
    var wavesHost = U.h('div');
    host.appendChild(U.h('div', { class: 'card' }, [
      U.h('div', { class: 'h' }, [
        U.h('span', { text: '波次' }),
        U.h('span', { class: 'sub', text: '数量按关卡缩放 ×' + U.num(S.levelScale(D.active + 1).count, 2) + '（Boss/精英除外）' }),
        U.h('span', { class: 'sp' }),
        U.h('button', { class: 'btn sm primary', text: '+ 添加波次', on: { click: function () { D.waveAdd(); renderMain(); renderStats(); } } }),
        U.h('button', { class: 'btn sm', text: '从游戏导入', on: { click: function () {
          L.waves = (G.WAVES || []).map(function (w) {
            return { t: w.t, intent: w.intent || '', comp: w.comp.map(function (c) { return [c[0], c[1]]; }) };
          });
          D.emit('waves'); renderMain(); renderStats(); ED.toast('已用游戏本体 WAVES 覆盖', 'good');
        } } })
      ]),
      wavesHost
    ]));

    L.waves.forEach(function (w, i) { wavesHost.appendChild(waveRow(L, w, i)); });

    /* 备注 */
    host.appendChild(U.h('div', { class: 'card' }, [
      U.h('div', { class: 'h' }, [U.h('span', { text: '设计备注' })]),
      U.h('textarea', {
        rows: 3, value: L.notes,
        on: { input: function () { L.notes = this.value; D.emit('props'); } }
      }, [])
    ]));
  }

  /* ---------------- 单行波次 ---------------- */
  function waveRow(L, w, i) {
    var st = S.wave(L, w, D.active + 1);
    var avail = S.defenseDps(L) + S.enchantDps(w.t);
    var ratio = avail > 0 ? st.needDpsArmor / avail : 0;

    var head = U.h('div', { class: 'wave-head' }, [
      U.h('span', { class: 'wave-no', text: String(i + 1) }),
      U.h('label', { class: 'f' }, [
        U.h('span', { text: '时长' }),
        U.h('input', {
          type: 'number', value: w.t, min: 5, max: 300, step: 5,
          on: {
            change: function () {
              w.t = Math.max(5, +this.value || 30); this.value = w.t;
              D.emit('waves'); renderStats(); refreshRowStats();
            }
          }
        }),
        U.h('span', { text: 's', style: { minWidth: '0' } })
      ]),
      U.h('input', {
        type: 'text', value: w.intent, class: 'wide', placeholder: '设计意图（会显示在战场顶部）',
        on: { input: function () { w.intent = this.value; D.emit('props'); } }
      }),
      U.h('span', { class: 'sp' }),
      U.h('span', { class: 'tag ' + (ratio > 1 ? 'bad' : ratio > 0.8 ? 'warn' : 'good'), text: '压力 ' + U.num(ratio * 100, 0) + '%' }),
      U.h('button', { class: 'btn sm', text: '↑', on: { click: function () { D.waveMove(i, -1); renderMain(); renderStats(); } } }),
      U.h('button', { class: 'btn sm', text: '↓', on: { click: function () { D.waveMove(i, 1); renderMain(); renderStats(); } } }),
      U.h('button', { class: 'btn sm', text: '⧉', on: { click: function () { D.waveDup(i); renderMain(); renderStats(); } } }),
      U.h('button', { class: 'btn sm danger', text: '✕', on: { click: function () { D.waveDel(i); renderMain(); renderStats(); } } })
    ]);

    var compHost = U.h('div', { class: 'chips', style: { gap: '6px', alignItems: 'center' } });
    function renderComp() {
      U.clear(compHost);
      w.comp.forEach(function (c, ci) {
        var R = G.ROLES[c[0]] || {};
        compHost.appendChild(U.h('div', { class: 'comp-item' }, [
          U.h('select', {
            on: { change: function () { c[0] = this.value; D.emit('waves'); renderStats(); refreshRowStats(); } }
          }, Object.keys(G.ROLES).map(function (k) {
            return U.h('option', { value: k, text: G.ROLES[k].name, selected: k === c[0] });
          })),
          U.h('input', {
            type: 'number', value: c[1], min: 1, max: 999, style: { width: '58px' },
            on: {
              change: function () {
                c[1] = Math.max(1, Math.round(+this.value || 1)); this.value = c[1];
                D.emit('waves'); renderStats(); refreshRowStats();
              }
            }
          }),
          U.h('span', { class: 'muted', text: '只' }),
          U.h('span', { class: 'tag', text: 'HP ' + U.num((R.hp || 0) * S.levelScale(D.active + 1).hp, 0) }),
          U.h('button', {
            class: 'btn sm danger', text: '✕',
            on: {
              click: function () {
                w.comp.splice(ci, 1);
                if (!w.comp.length) w.comp.push(['grunt', 4]);
                D.emit('waves'); renderComp(); renderStats(); refreshRowStats();
              }
            }
          })
        ]));
      });
      compHost.appendChild(U.h('button', {
        class: 'btn sm', text: '+ 敌人',
        on: {
          click: function () {
            w.comp.push(['grunt', 4]);
            D.emit('waves'); renderComp(); renderStats(); refreshRowStats();
          }
        }
      }));
    }
    renderComp();

    var statsEl = U.h('div', { class: 'muted', style: { marginTop: '6px' } });
    function refreshRowStats() {
      var s2 = S.wave(L, w, D.active + 1);
      var av2 = S.defenseDps(L) + S.enchantDps(w.t);
      var r2 = av2 > 0 ? s2.needDpsArmor / av2 : 0;
      U.clear(statsEl);
      statsEl.appendChild(U.h('span', { class: 'tag', text: '敌人数 ' + s2.count }));
      statsEl.appendChild(U.h('span', { class: 'tag', text: '总HP ' + U.gi(s2.hp) }));
      statsEl.appendChild(U.h('span', { class: 'tag', text: '有效HP ' + U.gi(s2.ehp) }));
      statsEl.appendChild(U.h('span', { class: 'tag', text: '需求DPS ' + U.num(s2.needDpsArmor, 1) }));
      statsEl.appendChild(U.h('span', { class: 'tag', text: '可用DPS ' + U.num(av2, 1) }));
      statsEl.appendChild(U.h('span', { class: 'tag', text: '密度 ' + U.num(s2.density, 2) + '/s' }));
      statsEl.appendChild(U.h('span', { class: 'tag', text: '赏金 ' + U.gi(s2.gold) }));
      statsEl.appendChild(U.h('span', { class: 'tag ' + (r2 > 1 ? 'bad' : r2 > 0.8 ? 'warn' : 'good'), text: '压力 ' + U.num(r2 * 100, 0) + '%' }));
    }
    refreshRowStats();

    return U.h('div', { class: 'wave-row' }, [head, compHost, statsEl]);
  }

  /* ---------------- 统计 ---------------- */
  function drawChart(cv, rows) {
    var ctx = cv.ctx, w = cv.w, h = cv.h;
    ctx.clearRect(0, 0, w, h);
    if (!rows.length) return;
    var padL = 34, padB = 20, padT = 10, padR = 8;
    var cw = w - padL - padR, ch = h - padT - padB;
    var maxV = 0;
    rows.forEach(function (r) { maxV = Math.max(maxV, r.needDpsArmor, r.availDps); });
    maxV = Math.max(1, maxV) * 1.15;

    // 网格
    ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 1;
    for (var g = 0; g <= 4; g++) {
      var y = padT + ch * g / 4;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      ctx.fillStyle = 'rgba(160,180,205,.6)'; ctx.font = '600 9px system-ui';
      ctx.textAlign = 'right';
      ctx.fillText(U.num(maxV * (1 - g / 4), 0), padL - 4, y + 3);
    }

    var bw = cw / rows.length;
    rows.forEach(function (r, i) {
      var bh = ch * (r.needDpsArmor / maxV);
      var x = padL + i * bw + bw * 0.22;
      var bwid = bw * 0.56;
      var over = r.availDps > 0 && r.needDpsArmor > r.availDps;
      ctx.fillStyle = over ? 'rgba(255,143,143,.85)' : 'rgba(111,214,255,.75)';
      ctx.fillRect(x, padT + ch - bh, bwid, bh);
      ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.font = '700 9px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(String(i + 1), x + bwid / 2, h - 6);
    });

    // 可用 DPS 折线
    ctx.beginPath();
    rows.forEach(function (r, i) {
      var x = padL + i * bw + bw / 2;
      var y = padT + ch - ch * Math.min(1, r.availDps / maxV);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.strokeStyle = '#9ae872'; ctx.lineWidth = 2; ctx.stroke();
    rows.forEach(function (r, i) {
      var x = padL + i * bw + bw / 2;
      var y = padT + ch - ch * Math.min(1, r.availDps / maxV);
      ctx.beginPath(); ctx.arc(x, y, 2.6, 0, Math.PI * 2);
      ctx.fillStyle = '#9ae872'; ctx.fill();
    });

    ctx.fillStyle = 'rgba(154,232,114,.95)'; ctx.font = '700 9px system-ui'; ctx.textAlign = 'left';
    ctx.fillText('— 可用 DPS', padL + 2, padT + 8);
    ctx.fillStyle = 'rgba(111,214,255,.9)';
    ctx.fillText('■ 需求 DPS', padL + 66, padT + 8);
  }

  function renderStats() {
    var host = P.statHost;
    U.clear(host);
    var L = D.cur();
    var st = S.level(L, D.active + 1);

    host.appendChild(U.h('div', { class: 'card' }, [
      U.h('div', { class: 'h' }, [U.h('span', { text: '关卡汇总' })]),
      U.h('dl', { class: 'kv' }, [
        ['总时长', U.num(st.total.t, 0) + ' s'],
        ['敌人总数', U.gi(st.total.count)],
        ['总 HP', U.gi(st.total.hp)],
        ['总有效 HP', '<b>' + U.gi(st.total.ehp) + '</b>'],
        ['平均需求 DPS', U.num(st.total.avgDps, 1)],
        ['峰值需求 DPS', '<b style="color:#ffd08a">' + U.num(st.total.peak, 1) + '</b>（第 ' + (st.total.peakIdx + 1) + ' 波）'],
        ['总赏金', U.gi(st.total.gold) + ' 金'],
        ['布防 DPS（植物）', U.num(st.total.availDps, 1)]
      ].reduce(function (a, r) { a.push(U.h('dt', { text: r[0] })); a.push(U.h('dd', { html: r[1] })); return a; }, []))
    ]));

    var cv = U.mkCanvas(360, 150);
    host.appendChild(U.h('div', { class: 'card' }, [
      U.h('div', { class: 'h' }, [U.h('span', { text: '压力曲线' }), U.h('span', { class: 'sub', text: '需求 vs 可用' })]),
      cv.canvas
    ]));
    drawChart(cv, st.rows);

    var tbl = U.h('table', { class: 'tbl' }, [
      U.h('thead', {}, [U.h('tr', {}, ['波', '敌数', '有效HP', '时长', '需求DPS', '可用DPS', '压力'].map(function (t) {
        return U.h('th', { text: t, style: t === '波' ? {} : { textAlign: 'right' } });
      }))]),
      U.h('tbody', {}, st.rows.map(function (r, i) {
        var over = r.availDps > 0 && r.needDpsArmor > r.availDps;
        return U.h('tr', {}, [
          U.h('td', { text: String(i + 1) }),
          U.h('td', { class: 'num', text: U.gi(r.count) }),
          U.h('td', { class: 'num', text: U.gi(r.ehp) }),
          U.h('td', { class: 'num', text: r.t + 's' }),
          U.h('td', { class: 'num', text: U.num(r.needDpsArmor, 1) }),
          U.h('td', { class: 'num', text: U.num(r.availDps, 1) }),
          U.h('td', { class: 'num' }, [U.h('span', {
            class: 'tag ' + (over ? 'bad' : r.ratio > 0.8 ? 'warn' : 'good'),
            text: U.num(r.ratio * 100, 0) + '%'
          })])
        ]);
      }))
    ]);
    host.appendChild(U.h('div', { class: 'card' }, [
      U.h('div', { class: 'h' }, [U.h('span', { text: '逐波明细' })]),
      tbl
    ]));

    var warns = [];
    st.rows.forEach(function (r, i) {
      if (r.needDpsArmor > r.availDps) warns.push('第 ' + (i + 1) + ' 波需求 DPS ' + U.num(r.needDpsArmor, 1) +
        ' 超过可用 ' + U.num(r.availDps, 1) + '（压力 ' + U.num(r.ratio * 100, 0) + '%），考虑加植物或拉长时长。');
    });
    if (!L.plants.length) warns.push('还没有布置任何植物，可用 DPS 只算了附魔部分。');
    if (st.total.t > 400) warns.push('单关总时长 ' + U.num(st.total.t, 0) + 's，H5 休闲品类建议控制在 3–5 分钟以内。');
    host.appendChild(U.h('div', { class: 'card' }, [
      U.h('div', { class: 'h' }, [U.h('span', { text: '体感检查' })]),
      warns.length
        ? U.h('div', { class: 'col' }, warns.map(function (t) {
          return U.h('div', { class: 'muted', style: { color: '#ffddb0' }, text: '· ' + t });
        }))
        : U.h('div', { class: 'muted', style: { color: '#bff7d0' }, text: '· 当前配平在可用 DPS 之内。' })
    ]));
  }

  /* ---------------- 挂载 ---------------- */
  P.mount = function (root) {
    P.root = root;
    U.clear(root);
    root.appendChild(U.h('div', { class: 'lv-list' }, [P.listHost = U.h('div')]));
    root.appendChild(U.h('div', { class: 'scroll', style: { flex: '1', minWidth: '0', overflow: 'auto', paddingRight: '4px' } },
      [P.mainHost = U.h('div')]));
    root.appendChild(U.h('div', { class: 'side', style: { flex: '0 0 384px' } }, [P.statHost = U.h('div')]));
    renderList(); renderMain(); renderStats();
  };

  P.unmount = function () { };
  P.render = function () { if (P.root) { renderList(); renderMain(); renderStats(); } };

  ED.Panels = ED.Panels || {};
  ED.Panels.level = P;
})(window.ED);
