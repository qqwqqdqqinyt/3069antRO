/* ============================================================
 *  panel-tune.js —— 卡牌 / 养成 / 经济编辑器（挂载点⑦）
 *  覆盖卡牌数值与展示字段（pp/上限/稀有度/名称/描述），
 *  以及经济常量（充能/附魔/养成成本/植物造价）。
 *  全部经整包级 tuning 进入游戏，缺省与本体一致。
 * ============================================================ */
(function (ED) {
  'use strict';
  var U = ED.util, G = ED.G, D = ED.Data;

  // 养成成本默认（与 meta.js 的 UPGRADE_COST 一致）
  var UPGRADE_DEFAULT = { base: 40, pow: 1.30 };

  var ECON_FIELDS = [
    { f: 'EP_BASE', label: '附魔能量基数', step: 1 },
    { f: 'CHARGE_MAX', label: '充能上限', step: 1 },
    { f: 'CHARGE_K', label: '充能系数 k', step: 0.05 },
    { f: 'ELEM_CAP', label: '元素上限', step: 0.05 },
    { f: 'STEP_GIFT', label: '波次赠步', step: 1 },
    { f: 'K_STAR', label: '星枢加成系数', step: 0.01 },
    { f: 'K_GOLD', label: '金币系数', step: 0.05 },
    { f: 'K_SHARD', label: '碎片系数', step: 0.01 },
    { f: 'RES2', label: '资源2系数', step: 0.01 },
    { f: 'RES3', label: '资源3系数', step: 0.01 },
    { f: 'upgradeCostBase', label: '养成基础费用', step: 1 },
    { f: 'upgradeCostPow', label: '养成费用幂', step: 0.05 }
  ];
  var PLANT_COST_KINDS = [
    { k: 'sprout', label: '牙苗' },
    { k: 'peashooter', label: '豌豆射手' },
    { k: 'cabbagepult', label: '卷心菜投手' },
    { k: 'burningpomegranate', label: '燃芯石榴' }
  ];
  var RARITY_OPTS = ['普通', '稀有', '史诗', '传说', '经济', '生存'];

  function econBase(f) {
    if (f === 'upgradeCostBase') return UPGRADE_DEFAULT.base;
    if (f === 'upgradeCostPow') return UPGRADE_DEFAULT.pow;
    return G.K[f];
  }

  function econRow(field, label, step) {
    var base = econBase(field);
    var ov = D.econGet(field);
    var inp = U.h('input', {
      type: 'number', step: step,
      value: (ov === undefined || ov === null) ? '' : ov,
      class: 'tnum', placeholder: (base === undefined || base === null) ? '—' : String(base)
    });
    inp.addEventListener('change', function () {
      var v = inp.value === '' ? null : parseFloat(inp.value);
      D.econSet(field, (v !== null && isFinite(v)) ? v : null);
    });
    return U.h('tr', {}, [
      U.h('td', { text: label }),
      U.h('td', { class: 'muted', text: (base === undefined || base === null) ? '—' : String(base) }),
      U.h('td', {}, [inp])
    ]);
  }

  function plantCostRow(kind, label) {
    var base = (G.PLANT_COST && G.PLANT_COST[kind]);
    var ov = D.plantCostGet(kind);
    var inp = U.h('input', {
      type: 'number', step: 1,
      value: (ov === undefined || ov === null) ? '' : ov,
      class: 'tnum', placeholder: (base === undefined || base === null) ? '—' : String(base)
    });
    inp.addEventListener('change', function () {
      var v = inp.value === '' ? null : parseFloat(inp.value);
      D.plantCostSet(kind, (v !== null && isFinite(v)) ? v : null);
    });
    return U.h('tr', {}, [
      U.h('td', { text: label }),
      U.h('td', { class: 'muted', text: (base === undefined || base === null) ? '—' : String(base) }),
      U.h('td', {}, [inp])
    ]);
  }

  function cardRow(id, base) {
    var covered = !!(D.getTuning('cards', id, 'pp') !== undefined || D.getTuning('cards', id, 'max') !== undefined
      || D.getTuning('cards', id, 'rarity') !== undefined || D.getTuning('cards', id, 'name') !== undefined
      || D.getTuning('cards', id, 'desc') !== undefined);
    var tds = [
      U.h('td', {}, [U.h('b', { text: base.name || id }), covered ? U.h('span', { class: 'tag', text: ' 覆盖' }) : null]),
      U.h('td', { class: 'muted', text: base.rarity || '—' })
    ];
    // pp
    (function () {
      var ov = D.getTuning('cards', id, 'pp');
      var inp = U.h('input', { type: 'number', step: 0.1, value: ov == null ? '' : ov, class: 'tnum', placeholder: String(base.pp != null ? base.pp : '') });
      inp.addEventListener('change', function () { var v = inp.value === '' ? null : parseFloat(inp.value); D.setTuning('cards', id, 'pp', v != null && isFinite(v) ? v : null); });
      tds.push(U.h('td', {}, [inp]));
    })();
    // max
    (function () {
      var ov = D.getTuning('cards', id, 'max');
      var inp = U.h('input', { type: 'number', step: 1, value: ov == null ? '' : ov, class: 'tnum', placeholder: String(base.max != null ? base.max : '') });
      inp.addEventListener('change', function () { var v = inp.value === '' ? null : parseFloat(inp.value); D.setTuning('cards', id, 'max', v != null && isFinite(v) ? v : null); });
      tds.push(U.h('td', {}, [inp]));
    })();
    // rarity
    (function () {
      var ov = D.getTuning('cards', id, 'rarity') || base.rarity;
      var sel = U.h('select', {}, RARITY_OPTS.map(function (r) {
        return U.h('option', { value: r, text: r, selected: r === ov ? 'selected' : null });
      }));
      sel.addEventListener('change', function () { D.setTuning('cards', id, 'rarity', sel.value); });
      tds.push(U.h('td', {}, [sel]));
    })();
    // name
    (function () {
      var ov = D.getTuning('cards', id, 'name');
      var inp = U.h('input', { type: 'text', value: ov == null ? '' : ov, class: 'tstr', placeholder: base.name || '' });
      inp.addEventListener('change', function () { D.setTuning('cards', id, 'name', inp.value.trim() || null); });
      tds.push(U.h('td', {}, [inp]));
    })();
    // desc
    (function () {
      var ov = D.getTuning('cards', id, 'desc');
      var inp = U.h('input', { type: 'text', value: ov == null ? '' : ov, class: 'tstr wide', placeholder: base.desc || '' });
      inp.addEventListener('change', function () { D.setTuning('cards', id, 'desc', inp.value.trim() || null); });
      tds.push(U.h('td', {}, [inp]));
    })();
    return U.h('tr', {}, tds);
  }

  var Panel = {
    mounted: false,
    root: null,
    mount: function (el) {
      this.root = el;
      this.render();
      this.mounted = true;
    },
    render: function () {
      var root = this.root;
      if (!root) return;
      U.clear(root);

      root.appendChild(U.h('div', { class: 'panel-head' }, [
        U.h('div', {}, [
          U.h('h2', { text: '⑦ 卡牌 · 养成 · 经济编辑器' }),
          U.h('p', { class: 'muted', text: '覆盖卡牌数值/展示与经济常量。只存与本体不同的值；不填 = 沿用本体。' })
        ]),
        U.h('div', { class: 'panel-actions' }, [
          U.h('button', { class: 'btn ghost', text: '清空全部覆盖',
            on: { click: function () { D.tuning = { enemies: {}, plants: {}, cards: {}, economy: {} }; D.emit('tuning'); ED.toast('已清空数值覆盖'); } } })
        ])
      ]));

      root.appendChild(U.h('div', { class: 'pill ' + (D.tuningEmpty() ? 'ghost' : 'warn'),
        text: D.tuningEmpty() ? '当前：未做任何数值覆盖（与游戏本体一致）' : '当前：已存在数值覆盖，将写入导出包' }));

      // 卡牌
      var cardSec = U.h('section', { class: 'card' });
      cardSec.appendChild(U.h('h3', { text: '卡牌覆盖' }));
      cardSec.appendChild(U.h('p', { class: 'muted', text: 'pp = 抽取权重，max = 堆叠上限，稀有度/名称/描述仅影响显示。不改卡牌效果逻辑。' }));
      var ctab = U.h('table', { class: 'tune-table' });
      ctab.appendChild(U.h('thead', {}, [U.h('tr', {}, [
        U.h('th', { text: '卡牌' }), U.h('th', { text: '本体稀有度' }), U.h('th', { text: 'pp' }),
        U.h('th', { text: '上限' }), U.h('th', { text: '稀有度' }), U.h('th', { text: '名称' }), U.h('th', { text: '描述' })
      ])]));
      var cbody = U.h('tbody');
      Object.keys(G.CARDS || {}).forEach(function (id) {
        // 跳过运行时生成的「元素亲和」系列（名称含 · 且非手写）
        cbody.appendChild(cardRow(id, G.CARDS[id]));
      });
      ctab.appendChild(cbody);
      cardSec.appendChild(ctab);
      root.appendChild(cardSec);

      // 经济
      var ecoSec = U.h('section', { class: 'card' });
      ecoSec.appendChild(U.h('h3', { text: '经济与养成常量' }));
      ecoSec.appendChild(U.h('p', { class: 'muted', text: '覆盖 Director.K / Meta 养成曲线 / 植物造价。EP_BASE 等影响附魔强度，upgradeCost 影响养成树费用。' }));
      var etab = U.h('table', { class: 'tune-table' });
      etab.appendChild(U.h('thead', {}, [U.h('tr', {}, [
        U.h('th', { text: '常量' }), U.h('th', { text: '本体值' }), U.h('th', { text: '覆盖值' })
      ])]));
      var ebody = U.h('tbody');
      ECON_FIELDS.forEach(function (e) { ebody.appendChild(econRow(e.f, e.label, e.step)); });
      etab.appendChild(ebody);
      ecoSec.appendChild(etab);

      // 植物造价
      ecoSec.appendChild(U.h('h4', { text: '植物造价（阳光）' }));
      var pct = U.h('table', { class: 'tune-table' });
      pct.appendChild(U.h('thead', {}, [U.h('tr', {}, [U.h('th', { text: '植物' }), U.h('th', { text: '本体价' }), U.h('th', { text: '覆盖价' })])]));
      var pcbody = U.h('tbody');
      PLANT_COST_KINDS.forEach(function (p) { pcbody.appendChild(plantCostRow(p.k, p.label)); });
      pct.appendChild(pcbody);
      ecoSec.appendChild(pct);

      root.appendChild(ecoSec);
      root.appendChild(U.h('p', { class: 'muted small', text: '提示：数值实时写入草稿，导出即生效。游戏侧由 main.js 的 pkgTuning() 统一喂给 Meta/Cards/Director/Battlefield。' }));
    }
  };

  ED.Panels = ED.Panels || {};
  ED.Panels.tune = Panel;
})(window.ED);
