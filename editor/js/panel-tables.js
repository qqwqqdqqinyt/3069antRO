/* ============================================================
 *  panel-tables.js —— 数值表编辑器（挂载点⑥）
 *  编辑敌人 / 植物的「基础数值覆盖层」。
 *  只存与游戏本体不同的值；全空 = 不覆盖。导出时随 tuning 进入游戏。
 * ============================================================ */
(function (ED) {
  'use strict';
  var U = ED.util, G = ED.G, D = ED.Data;

  var ENEMY_FIELDS = [
    { f: 'hp', label: '生命', step: 1 },
    { f: 'dmg', label: '伤害', step: 1 },
    { f: 'speed', label: '速度', step: 0.01 },
    { f: 'armor', label: '护甲', step: 0.01 },
    { f: 'gold', label: '金币', step: 1 },
    { f: 'scale', label: '体型', step: 0.05 }
  ];
  var PLANT_FIELDS = [
    { f: 'hp', label: '生命', step: 1 },
    { f: 'dmg', label: '伤害', step: 1 },
    { f: 'interval', label: '攻击间隔', step: 0.05 },
    { f: 'speed', label: '弹速', step: 1 },
    { f: 'range', label: '射程', step: 1 },
    { f: 'aoe', label: '溅射半径', step: 1 },
    { f: 'aoeRatio', label: '溅射比例', step: 0.05 }
  ];

  function numRow(group, key, field, base, step, coveredEl) {
    var ov = D.getTuning(group, key, field);
    var inp = U.h('input', {
      type: 'number', step: step, value: (ov === undefined || ov === null) ? '' : ov,
      class: 'tnum', placeholder: (base === undefined || base === null) ? '—' : String(base)
    });
    inp.addEventListener('change', function () {
      var v = inp.value === '' ? null : parseFloat(inp.value);
      D.setTuning(group, key, field, (v !== null && isFinite(v)) ? v : null);
      var now = D.getTuning(group, key, field);
      var covered = (now !== undefined && now !== null && now !== base);
      if (coveredEl) coveredEl.className = 'cov ' + (covered ? 'on' : 'off');
    });
    var covered = (ov !== undefined && ov !== null && ov !== base);
    if (coveredEl) coveredEl.className = 'cov ' + (covered ? 'on' : 'off');
    return inp;
  }

  function groupSection(title, group, kindMap, fields, note) {
    var sec = U.h('section', { class: 'card' });
    sec.appendChild(U.h('h3', { text: title }));
    if (note) sec.appendChild(U.h('p', { class: 'muted', text: note }));

    var keys = Object.keys(kindMap);
    var table = U.h('table', { class: 'tune-table' });
    var thead = U.h('thead', {}, [U.h('tr', {}, [
      U.h('th', { text: '名称' }),
      U.h('th', { text: '类型' })
    ].concat(fields.map(function (f) { return U.h('th', { text: f.label }); })))]);
    table.appendChild(thead);

    var tbody = U.h('tbody');
    keys.forEach(function (key) {
      var base = kindMap[key] || {};
      var name = base.name || key;
      var covered = D.hasTuning(group, key);
      var tds = [
        U.h('td', {}, [U.h('b', { text: name }), covered ? U.h('span', { class: 'tag', text: ' 覆盖' }) : null]),
        U.h('td', { class: 'muted', text: base.kind || base.proj || '—' })
      ];
      fields.forEach(function (f) {
        var baseV = base[f.f];
        tds.push(U.h('td', {}, [numRow(group, key, f.f, baseV, f.step, null)]));
      });
      tbody.appendChild(U.h('tr', {}, tds));
    });
    table.appendChild(tbody);
    sec.appendChild(table);
    return sec;
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

      var head = U.h('div', { class: 'panel-head' }, [
        U.h('div', {}, [
          U.h('h2', { text: '⑥ 数值表编辑器' }),
          U.h('p', { class: 'muted', text: '覆盖敌人 / 植物的基础数值。只存与游戏本体不同的值；不填 = 沿用本体。' })
        ]),
        U.h('div', { class: 'panel-actions' }, [
          U.h('button', {
            class: 'btn ghost', text: '清空全部覆盖',
            on: { click: function () { D.tuning = { enemies: {}, plants: {}, cards: {}, economy: {} }; D.emit('tuning'); ED.toast('已清空数值覆盖'); } }
          })
        ])
      ]);
      root.appendChild(head);

      var summary = U.h('div', { class: 'pill ' + (D.tuningEmpty() ? 'ghost' : 'warn'),
        text: D.tuningEmpty() ? '当前：未做任何数值覆盖（与游戏本体一致）' : '当前：已存在数值覆盖，将写入导出包' });
      root.appendChild(summary);

      root.appendChild(groupSection('敌人基础数值', 'enemies', G.ROLES, ENEMY_FIELDS,
        '对应游戏 ROLES。覆盖后该敌人所有关卡统一变更。'));
      root.appendChild(groupSection('植物基础数值', 'plants', G.PLANTS, PLANT_FIELDS,
        '对应游戏 PLANTS。dmg/interval 决定 DPS，speed 为弹道速度。'));

      root.appendChild(U.h('p', { class: 'muted small', text: '提示：数值实时写入草稿（localStorage），切换面板或导出即生效。' }));
    }
  };

  ED.Panels = ED.Panels || {};
  ED.Panels.tables = Panel;
})(window.ED);
