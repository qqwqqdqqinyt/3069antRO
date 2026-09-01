/* ============================================================
 *  panel-assets.js —— ① 图鉴 / 数值
 *    · 植物：实时像素动画（含开火动作）+ 全部战斗数值
 *    · 敌人：实时行走动画 + HP / 护甲 / 速度 / 穿越时间 / 赏金，随关卡缩放联动
 *    · 特效：投射物与命中特效精灵逐帧播放
 *    · 元素规则与核心常量
 * ============================================================ */
(function (ED) {
  'use strict';
  var U = ED.util, G = ED.G, D = ED.Data, S = D.Stats;

  var P = { root: null, tickers: [], levelNo: 1, autoFire: true };

  /* ---------------- 小组件 ---------------- */
  function table(rows) {
    return U.h('table', { class: 'mini-tbl' }, rows.map(function (r) {
      return U.h('tr', {}, [
        U.h('td', { text: r[0] }),
        U.h('td', { html: r[1] })
      ]);
    }));
  }

  function shot(size, drawFn, label) {
    var c = U.mkCanvas(size, size);
    var box = U.h('div', { class: 'shot' }, [c.canvas, U.h('div', { class: 'lbl', text: label || '' })]);
    P.tickers.push(function (dt, t) {
      c.ctx.clearRect(0, 0, size, size);
      c.ctx.imageSmoothingEnabled = false;
      drawFn(c.ctx, size, dt, t);
    });
    return box;
  }

  /* ---------------- 显示参数微调（缩放 / 偏移） ----------------
   * 两级合并（按类型统一 → 实例覆盖）由 D.dispGet 负责。
   * 这里编辑的是“按类型”的默认项（instKey 省略）。
   * 预览走逐帧读取 D.dispGet，因此这边一改、预览实时跟手。        */
  function dispControls(group, key, baseScale) {
    function cur() { return D.dispGet(group, key, null); }
    function dirty() { return D.dispDirty(group, key, null); }

    var scaleIn = U.h('input', {
      type: 'number', step: 0.1, min: 0.3, max: 10, placeholder: String(baseScale),
      title: '渲染缩放（留空 = 沿用游戏本体 ×' + baseScale + '）',
      on: { change: commit }
    });
    var oxIn = U.h('input', {
      type: 'number', step: 1, placeholder: '0', title: '水平偏移 px',
      on: { change: commit }
    });
    var oyIn = U.h('input', {
      type: 'number', step: 1, placeholder: '0', title: '垂直偏移 px',
      on: { change: commit }
    });
    var tag = U.h('span', { class: 'tag warn', text: '已覆盖', style: { display: 'none' } });
    var reset = U.h('button', { class: 'mini', text: '清除覆盖', on: { click: clearIt } });

    function commit() {
      var scale = scaleIn.value === '' ? null : (Math.max(0.3, +scaleIn.value || baseScale));
      var ox = oxIn.value === '' ? 0 : (Math.round(+oxIn.value) || 0);
      var oy = oyIn.value === '' ? 0 : (Math.round(+oyIn.value) || 0);
      D.dispSet(group, key, null, { scale: scale, ox: ox, oy: oy });
      refresh();
    }
    function clearIt() {
      D.dispClear(group, key, null);
      scaleIn.value = ''; oxIn.value = ''; oyIn.value = '';
      refresh();
    }
    function refresh() {
      var c = cur();
      scaleIn.value = (c.scale != null) ? c.scale : '';
      oxIn.value = c.ox || '';
      oyIn.value = c.oy || '';
      tag.style.display = dirty() ? '' : 'none';
    }
    refresh();

    return U.h('div', { class: 'disp-ctl' }, [
      U.h('div', { class: 'disp-row' }, [
        U.h('span', { class: 'disp-lbl', text: '显示调整' }),
        tag,
        U.h('span', { class: 'sp' }),
        reset
      ]),
      U.h('div', { class: 'disp-row' }, [
        U.h('label', { class: 'disp-f' }, [U.h('span', { text: '缩放' }), scaleIn]),
        U.h('label', { class: 'disp-f' }, [U.h('span', { text: 'X' }), oxIn]),
        U.h('label', { class: 'disp-f' }, [U.h('span', { text: 'Y' }), oyIn])
      ])
    ]);
  }

  /* ---------------- 植物 ---------------- */
  function plantCard(kind, i) {
    var def = G.PLANTS[kind] || {};
    var k = G.PLANT_KIND[kind] || {};
    var cost = G.PLANT_COST[kind];
    var dps = S.plantDps(kind);

    var anim = null, fireTimer = 1.2 + i * 0.7;
    if (G.PlantArt && G.PlantArt.PlantAnimator) anim = new G.PlantArt.PlantAnimator(kind, i * 2.3);

    var baseSc = k.scale || 3;
    var box = shot(104, function (ctx, size, dt) {
      if (!anim || !G.PX) return;
      var dp = D.dispGet('plants', kind, null);
      var sc = (dp.scale != null) ? dp.scale : baseSc;
      var ox = dp.ox || 0, oy = dp.oy || 0;
      anim.update(dt);
      if (def.proj) {
        fireTimer -= dt;
        if (fireTimer <= 0) { if (P.autoFire) anim.triggerFire(); fireTimer = 2.4; }
      }
      var r = anim.render();
      G.PX.shadow(ctx, size / 2 + ox, size - 10 + oy, 15, 4.5, 0.28);
      G.PX.draw(ctx, r.sprite, size / 2 + ox, size - 10 + r.bob + oy, {
        frame: r.frame, scale: sc, lean: r.lean, squash: r.squash
      });
    }, (k.w || 0) + '×' + (k.h || 0) + ' px');

    var rows = [
      ['造价', cost === undefined ? '-' : '<b style="color:#ffd45e">' + cost + '</b> 金币'],
      ['单发伤害', def.dmg ? U.num(def.dmg, 1) : '<span class="muted">—（不可攻击）</span>'],
      ['攻击间隔', def.interval ? U.num(def.interval, 2) + ' s' : '<span class="muted">—</span>'],
      ['理论 DPS', dps ? '<b style="color:#9ae872">' + U.num(dps, 2) + '</b>' : '<span class="muted">—</span>'],
      ['弹种', def.proj ? def.proj : '<span class="muted">无</span>'],
      ['弹速', def.speed ? U.num(def.speed, 0) + ' px/s' : '<span class="muted">抛物</span>'],
      ['射程', def.range ? (def.range > 1e8 ? '全场' : U.num(def.range, 0)) : '<span class="muted">—</span>'],
      ['溅射', def.aoe ? '半径 ' + def.aoe + ' · 副目标 ' + Math.round((def.aoeRatio || 0) * 100) + '%' : '<span class="muted">无</span>'],
      ['炮口偏移', def.muzzle ? '(' + def.muzzle.dx + ', ' + def.muzzle.dy + ')' : '<span class="muted">—</span>'],
      ['渲染缩放', '×' + baseSc + ' <span class="muted">(可被下方调整覆盖)</span>']
    ];

    var tags = [];
    if (kind === 'sprout') tags.push(U.h('span', { class: 'tag good', text: '可进化' }));
    if (def.aoe) tags.push(U.h('span', { class: 'tag pur', text: '范围' }));
    if (def.proj === 'pea') tags.push(U.h('span', { class: 'tag acc', text: '直射' }));
    if (def.proj === 'cabbage') tags.push(U.h('span', { class: 'tag acc', text: '抛射' }));

    return U.h('div', { class: 'unit' }, [
      box,
      U.h('div', { class: 'meta' }, [
        U.h('div', { class: 'name' }, [U.h('span', { text: k.name || def.name || kind }), U.h('span', { class: 'sp' }), U.h('span', { class: 'chips' }, tags)]),
        U.h('div', { class: 'desc', text: def.desc || '' }),
        table(rows),
        dispControls('plants', kind, baseSc),
        kind === 'sprout' ? U.h('div', { class: 'muted', style: { marginTop: '5px' }, html: '进化目标：豌豆射手 / 卷心菜投手' }) : null
      ])
    ]);
  }

  /* ---------------- 敌人 ---------------- */
  function enemyCards() {
    return Object.keys(G.ROLES).map(function (key, i) {
      var R = G.ROLES[key];
      var sc = StatsLevelScale();
      var hp = R.hp * sc.hp;
      var armor = R.armor || 0;
      var ehp = hp / Math.max(0.05, 1 - armor);
      var cross = S.crossTime(key, D.cur() ? D.cur().battle.nodeX : 58);
      var gold = R.gold;

      var isBee = (R.kind === 'bee' && G.BeeArt);
      var anim = null;
      if (isBee && G.BeeArt.BeeAnimator) anim = new G.BeeArt.BeeAnimator(R.kind, R.speed, i * 3.1);
      else if (G.InsectArt && G.InsectArt.InsectAnimator) anim = new G.InsectArt.InsectAnimator(R.kind, R.speed, i * 3.1);
      var baseIsc = (G.INSECT_KIND[R.kind] || {}).scale || 3;

      var box = shot(104, function (ctx, size, dt) {
        if (!anim || !G.PX) return;
        var dp = D.dispGet('enemies', R.kind, null);
        var isc = (dp.scale != null) ? dp.scale : baseIsc;
        var sprScale = isc * (R.scale || 1);
        var ox = dp.ox || 0, oy = dp.oy || 0;
        anim.update(dt, 1);
        var spr = isBee ? (G.BeeArt && G.BeeArt.Art[R.kind]) : G.InsectArt.Art[R.kind];
        if (!spr) return;
        G.PX.shadow(ctx, size / 2 + 6 + ox, size - 14 + oy, 14, 4, 0.26);
        G.PX.draw(ctx, spr, size / 2 + 6 + ox, size - 14 + oy, { frame: anim.frame(), scale: sprScale * 0.9 });
      }, (G.INSECT_KIND[R.kind] ? R.kind : '') + ' · ' + (R.scale || 1).toFixed(2) + '×');

      var rows = [
        ['基准 HP', U.num(R.hp, 0)],
        ['Lv' + P.levelNo + ' HP', '<b style="color:#ff8f8f">' + U.num(hp, 0) + '</b>'],
        ['护甲', armor ? Math.round(armor * 100) + '% <span class="muted">（减伤）</span>' : '<span class="muted">无</span>'],
        ['有效 HP', '<b>' + U.num(ehp, 0) + '</b>'],
        ['速度', R.speed + ' 格/s <span class="muted">≈ ' + U.num(R.speed * 120, 0) + ' px/s</span>'],
        ['穿越全场', '<b style="color:#ffd45e">' + U.num(cross, 1) + ' s</b>'],
        ['漏怪伤害', U.num(R.dmg * sc.dmg, 1) + ' <span class="muted">/ 次</span>'],
        ['赏金', '<b style="color:#ffd45e">' + gold + '</b> 金'],
        ['金效率', U.num(gold / ehp * 100, 2) + ' <span class="muted">金/百有效HP</span>'],
        ['体型', '×' + (R.scale || 1)]
      ];

      var tagCls = key === 'boss' ? 'bad' : key === 'elite' ? 'pur' : armor >= 0.2 ? 'warn' : 'acc';
      return U.h('div', { class: 'unit' }, [
        box,
        U.h('div', { class: 'meta' }, [
          U.h('div', { class: 'name' }, [
            U.h('span', { text: R.name }),
            U.h('span', { class: 'tag ' + tagCls, text: key }),
            U.h('span', { class: 'sp' }),
            U.h('span', { class: 'muted', text: G.INSECT_KIND[R.kind] ? G.INSECT_KIND[R.kind].name : R.kind })
          ]),
          U.h('div', { class: 'desc', text: '出场受关卡数量缩放 ×' + U.num(sc.count, 2) + '（Boss/精英不缩放）' }),
          table(rows),
          dispControls('enemies', R.kind, baseIsc)
        ])
      ]);
    });
  }

  function StatsLevelScale() { return S.levelScale(P.levelNo); }

  /* ---------------- 特效 ---------------- */
  function fxCards() {
    var list = [
      ['pea', '豌豆弹', 'plant'], ['cabbage', '卷心菜', 'plant'],
      ['muzzle', '炮口焰', 'plant'], ['ring', '冲击环', 'plant'],
      ['splatPea', '豌豆溅射', 'insect'], ['splatCabbage', '卷心菜爆开', 'insect'],
      ['spark', '火花（打甲）', 'insect'], ['flame', '火焰（红火蚁死亡）', 'insect'],
      ['dust', '尘土（落地）', 'insect']
    ];
    return list.map(function (it) {
      var key = it[0], src = it[1] === 'plant' ? 'PlantArt' : 'InsectArt';
      var Art = G[src] && G[src].Art ? G[src].Art[key] : null;
      var box = shot(84, function (ctx, size, dt, t) {
        if (!Art) {
          ctx.fillStyle = '#3a4a63'; ctx.font = '600 10px system-ui'; ctx.textAlign = 'center';
          ctx.fillText('未连接', size / 2, size / 2);
          return;
        }
        var f = Math.floor(t * 12) % Art.n;
        var sc = key === 'pea' || key === 'cabbage' ? 3 : (key === 'flame' || key === 'dust' ? 2.4 : 2.6);
        G.PX.draw(ctx, Art, size / 2, size * 0.72, { frame: f, scale: sc });
      }, Art ? (Art.w + '×' + Art.h + ' · ' + Art.n + '帧') : '—');

      return U.h('div', { class: 'unit', style: { minWidth: '0' } }, [
        box,
        U.h('div', { class: 'meta', style: { display: 'flex', flexDirection: 'column', justifyContent: 'center' } }, [
          U.h('div', { class: 'name', text: it[1] }),
          U.h('div', { class: 'desc', text: 'sprites.' + src + '.Art.' + key }),
          U.h('div', { class: 'muted', text: Art ? '帧数 ' + Art.n : '需要连接游戏源码' })
        ])
      ]);
    });
  }

  /* ---------------- 元素 / 常量 ---------------- */
  function elementTable() {
    return U.h('table', { class: 'tbl' }, [
      U.h('thead', {}, [U.h('tr', {}, ['元素', '伤害分配规则', '附加状态'].map(function (t) { return U.h('th', { text: t }); }))]),
      U.h('tbody', {}, G.ELEMENTS.map(function (el) {
        var extra = { fire: '灼烧 3s（0.30×池 / 3s）', thunder: '无', ice: '减速 50% · 3s', water: '击退 46px + 减速 30% · 2s', wood: '定身 1.2s', light: '星枢回复 5%' }[el] || '—';
        return U.h('tr', {}, [
          U.h('td', {}, [U.h('span', { class: 'tag acc', text: (G.ELEMENT_CN[el] || el) + ' ' + el })]),
          U.h('td', { text: G.ELEM_RULE[el] || '—' }),
          U.h('td', { text: extra })
        ]);
      }))
    ]);
  }

  function constTable() {
    var K = G.K;
    var rows = [
      ['CHARGE_MAX', K.CHARGE_MAX, '充能上限，满则触发一次小附魔'],
      ['CHARGE_K', K.CHARGE_K, '充能系数 k：充能 = k × log₂(v / E)'],
      ['EP_BASE', K.EP_BASE, '附魔基础伤害池'],
      ['ELEM_CAP', K.ELEM_CAP, '元素分配封顶倍率'],
      ['STAR_POW', (K.STAR_POW || []).join(' / '), '超载星级威力（索引 = 星数）'],
      ['K_STAR / K_GOLD / K_SHARD', K.K_STAR + ' / ' + K.K_GOLD + ' / ' + K.K_SHARD, 'CV′ 换算星核 / 金币 / 碎片'],
      ['STEP_GIFT', K.STEP_GIFT, '每波开波赠送步数'],
      ['HP 缩放', '1.55^(n-1) × (1+0.05(n-1))', '关卡敌人 HP'],
      ['伤害 / 速度 / 数量', '1.25^(n-1) / 1+0.04(n-1) / 1+0.12(n-1)', '关卡缩放其余三项']
    ];
    return U.h('table', { class: 'tbl' }, [
      U.h('thead', {}, [U.h('tr', {}, ['常量', '值', '含义'].map(function (t) { return U.h('th', { text: t }); }))]),
      U.h('tbody', {}, rows.map(function (r) {
        return U.h('tr', {}, [
          U.h('td', { html: '<code>' + U.esc(r[0]) + '</code>' }),
          U.h('td', { class: 'num', html: '<b>' + U.esc(String(r[1])) + '</b>' }),
          U.h('td', { text: r[2] })
        ]);
      }))
    ]);
  }

  function tierTable() {
    return U.h('table', { class: 'tbl' }, [
      U.h('thead', {}, [U.h('tr', {}, ['档位', '生成池', '权重', 'E[v]', '适用关卡', '技巧目标'].map(function (t) { return U.h('th', { text: t }); }))]),
      U.h('tbody', {}, G.TIERS.map(function (t) {
        return U.h('tr', {}, [
          U.h('td', {}, [U.h('span', { class: 'tag acc', text: t.name })]),
          U.h('td', { text: t.pool.join(' / ') }),
          U.h('td', { text: t.w.join(' / ') }),
          U.h('td', { class: 'num', text: t.E }),
          U.h('td', { text: t.levels }),
          U.h('td', { text: t.goal })
        ]);
      }))
    ]);
  }

  /* ---------------- 挂载 ---------------- */
  P.mount = function (root) {
    P.root = root;
    P.tickers = [];
    U.clear(root);

    var enemyHost = U.h('div', { class: 'grid-cards' });

    var lvlInput = U.h('input', {
      type: 'number', value: P.levelNo, min: 1, max: 12,
      on: {
        change: function () {
          P.levelNo = Math.max(1, Math.min(12, +this.value || 1));
          this.value = P.levelNo;
          renderEnemies();
        }
      }
    });

    var mounted = false, enemyTickers = [];

    /** 只替换敌人区块的动画回调，避免误删植物/特效的 ticker */
    function renderEnemies() {
      enemyTickers.forEach(function (f) {
        ED.ticker.remove(f);
        var i = P.tickers.indexOf(f);
        if (i >= 0) P.tickers.splice(i, 1);
      });
      enemyTickers = [];
      var before = P.tickers.length;
      U.clear(enemyHost);
      enemyCards().forEach(function (c) { enemyHost.appendChild(c); });
      enemyTickers = P.tickers.slice(before);
      if (mounted) enemyTickers.forEach(function (f) { ED.ticker.add(f); });
    }

    var plants = Object.keys(G.PLANTS).map(plantCard);

    root.appendChild(U.h('div', { class: 'banner', html: G.linked
      ? '数据源：<b>已连接游戏本体</b> <code>3069antone/src</code> —— 精灵与数值直接读自游戏源码，改游戏即改图鉴。'
      : '<b>未连接到游戏源码</b>（<code>../3069antone/src/*.js</code> 未加载）。当前显示内嵌数值快照，精灵与场景模拟不可用。' }));

    root.appendChild(U.h('div', { class: 'card' }, [
      U.h('div', { class: 'h' }, [
        U.h('span', { text: '植物' }),
        U.h('span', { class: 'sub', text: '程序化像素精灵 · 实时动画 · 每 2.4s 演示一次开火' }),
        U.h('span', { class: 'sp' }),
        U.h('label', { class: 'f' }, [
          U.h('input', {
            type: 'checkbox', checked: P.autoFire,
            on: { change: function () { P.autoFire = this.checked; } }
          }), U.h('span', { text: '循环开火', style: { minWidth: '0' } })
        ])
      ]),
      U.h('div', { class: 'grid-cards' }, plants)
    ]));

    root.appendChild(U.h('div', { class: 'card' }, [
      U.h('div', { class: 'h' }, [
        U.h('span', { text: '敌人' }),
        U.h('span', { class: 'sub', text: '数值随关卡缩放实时重算' }),
        U.h('span', { class: 'sp' }),
        U.h('label', { class: 'f' }, [U.h('span', { text: '关卡' }), lvlInput])
      ]),
      enemyHost
    ]));

    renderEnemies();

    root.appendChild(U.h('div', { class: 'card' }, [
      U.h('div', { class: 'h' }, [U.h('span', { text: '特效与投射物' }), U.h('span', { class: 'sub', text: '逐帧循环播放' })]),
      U.h('div', { class: 'grid-cards', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(214px,1fr))' } }, fxCards())
    ]));

    root.appendChild(U.h('div', { class: 'two' }, [
      U.h('div', { class: 'card' }, [
        U.h('div', { class: 'h' }, [U.h('span', { text: '元素附魔规则' })]),
        elementTable()
      ]),
      U.h('div', { class: 'card' }, [
        U.h('div', { class: 'h' }, [U.h('span', { text: '核心常量' }), U.h('span', { class: 'sub', text: 'Director.K / 关卡缩放' })]),
        constTable()
      ])
    ]));

    root.appendChild(U.h('div', { class: 'card' }, [
      U.h('div', { class: 'h' }, [U.h('span', { text: '棋盘生成档位' }), U.h('span', { class: 'sub', text: 'Board2048.tiers · 弱分层 M2' })]),
      tierTable()
    ]));

    P.tickers.forEach(function (f) { ED.ticker.add(f); });
    mounted = true;
  };

  P.unmount = function () {
    P.tickers.forEach(function (f) { ED.ticker.remove(f); });
    P.tickers = [];
  };

  /** 已挂载状态下由 app.go 调用：清掉旧 ticker 后整体重建，确保切关卡后显示参数同步 */
  P.render = function (root) {
    P.unmount();
    P.mount(root || P.root);
  };

  ED.Panels = ED.Panels || {};
  ED.Panels.assets = P;
})(window.ED);
