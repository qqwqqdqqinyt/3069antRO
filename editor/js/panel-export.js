/* ============================================================
 *  panel-export.js —— ⑤ 导出 / 接入
 *    · 导出 JSON（完整数据包）
 *    · 导出 levels.js（window.LEVEL_DATA，可直接被游戏 <script> 引入）
 *    · 生成接入片段（两行 script 即可让游戏吃到关卡数据）
 *    · 导入 JSON / 恢复默认
 * ============================================================ */
(function (ED) {
  'use strict';
  var U = ED.util, G = ED.G, D = ED.Data;

  var P = { root: null, area: null, mounted: false };

  function jsonText(pretty) {
    return JSON.stringify(D.serialize(), null, pretty === false ? 0 : 2);
  }

  function jsText() {
    var pkg = D.serialize();
    return '/* ============================================================\n' +
      ' *  levels.js —— 由「星序防线 · 编辑器」生成，请勿手改\n' +
      ' *  生成时间：' + pkg.generatedAt + '\n' +
      ' *  数据源：' + pkg.source + '\n' +
      ' *  用法：在 index.html 里 <script src="src/main.js"> 之前引入本文件\n' +
      ' * ============================================================ */\n' +
      'window.LEVEL_DATA = ' + JSON.stringify(pkg, null, 2) + ';\n';
  }

  var ACCESS =
    '<!-- ① 把导出的 levels.js 放到：3069antone/src/data/levels.js -->\n' +
    '\n' +
    '<!-- ② 在 3069antone/index.html 中，紧接着 <script src="src/main.js"></script> 之前加入两行 -->\n' +
    '<script src="src/data/levels.js"></script>\n' +
    '<script>\n' +
    '  (function () {\n' +
    '    var d = window.LEVEL_DATA;\n' +
    '    if (!d || !d.levels || !d.levels.length) return;\n' +
    '    var L = d.levels[0];                     // 目前游戏只有一套 WAVES，取第一关\n' +
    '\n' +
    '    // 必接：波次表（结构与 Battlefield.WAVES 完全一致）\n' +
    '    Battlefield.WAVES = L.waves.map(function (w) {\n' +
    '      return { t: w.t, intent: w.intent, comp: w.comp.map(function (c) { return [c[0], c[1]]; }) };\n' +
    '    });\n' +
    '\n' +
    '    // 选接：战场尺寸 / 星枢 / 元素轮盘 / 地形\n' +
    '    // main.js 的 buildWorld() 里把 new Battlefield({...}) 的 lanes/cols/nodeX\n' +
    '    // 换成 L.battle.lanes / L.battle.cols / L.battle.nodeX，\n' +
    '    // 再把 director.roulette = L.roulette.slice()。\n' +
    '    // 地形 L.map.tiles[lane][col] 需要游戏侧实现寻路与增益后才生效（effects 见 L.map.effects）。\n' +
    '  })();\n' +
    '</script>';

  function refresh() {
    if (P.area) P.area.value = jsonText();
  }

  P.mount = function (root) {
    P.root = root; P.mounted = true;
    U.clear(root);

    var area = U.h('textarea', { rows: 16, readonly: 'readonly' });
    P.area = area;

    var fileInput = U.h('input', {
      type: 'file', accept: '.json,application/json', style: { display: 'none' },
      on: {
        change: function () {
          var f = this.files && this.files[0];
          if (!f) return;
          var fr = new FileReader();
          fr.onload = function () {
            try {
              var n = D.importJSON(String(fr.result));
              ED.toast('已导入 ' + n + ' 个关卡', 'good');
              refresh();
              if (ED.Panels.level) ED.Panels.level.render();
              if (ED.Panels.scene) ED.Panels.scene.rebuild();
            } catch (e) { ED.toast('导入失败：' + e.message, 'bad'); }
          };
          fr.readAsText(f);
          this.value = '';
        }
      }
    });

    var pasteArea = U.h('textarea', { rows: 5, placeholder: '也可以把 JSON 粘到这里后点「从文本导入」' });

    root.appendChild(U.h('div', { class: 'two' }, [

      U.h('div', {}, [
        U.h('div', { class: 'card' }, [
          U.h('div', { class: 'h' }, [
            U.h('span', { text: '导出' }),
            U.h('span', { class: 'sub', text: D.levels.length + ' 个关卡 · ' + (G.linked ? '数据源=游戏本体' : '数据源=快照') })
          ]),
          U.h('div', { class: 'row wrap' }, [
            U.h('button', {
              class: 'btn primary', text: '⬇ 下载 levels.json',
              on: {
                click: function () {
                  U.download('levels.json', jsonText(), 'application/json');
                  ED.toast('已下载 levels.json', 'good');
                }
              }
            }),
            U.h('button', {
              class: 'btn good', text: '⬇ 下载 levels.js',
              on: {
                click: function () {
                  U.download('levels.js', jsText(), 'application/javascript');
                  ED.toast('已下载 levels.js（放到 src/data/）', 'good');
                }
              }
            }),
            U.h('button', {
              class: 'btn', text: '⧉ 复制 JSON',
              on: {
                click: function () {
                  var ok = U.copy(jsonText());
                  ED.toast(ok ? 'JSON 已复制' : '复制失败', ok ? 'good' : 'bad');
                }
              }
            }),
            U.h('button', {
              class: 'btn', text: '⧉ 复制接入代码',
              on: { click: function () { U.copy(ACCESS); ED.toast('接入代码已复制', 'good'); } }
            }),
            U.h('button', {
              class: 'btn', text: '⟳ 刷新预览',
              on: { click: function () { refresh(); } }
            })
          ]),
          U.h('hr', { class: 'sep' }),
          U.h('div', { class: 'h' }, [U.h('span', { text: '数据预览' })]),
          area
        ]),

        U.h('div', { class: 'card' }, [
          U.h('div', { class: 'h' }, [U.h('span', { text: '导入 / 重置' })]),
          U.h('div', { class: 'row wrap' }, [
            U.h('button', { class: 'btn', text: '📂 选择 JSON 文件', on: { click: function () { fileInput.click(); } } }),
            fileInput,
            U.h('button', {
              class: 'btn', text: '从文本导入',
              on: {
                click: function () {
                  try {
                    var n = D.importJSON(pasteArea.value);
                    ED.toast('已导入 ' + n + ' 个关卡', 'good');
                    refresh();
                    if (ED.Panels.level) ED.Panels.level.render();
                    if (ED.Panels.scene) ED.Panels.scene.rebuild();
                  } catch (e) { ED.toast('导入失败：' + e.message, 'bad'); }
                }
              }
            }),
            U.h('span', { class: 'sp' }),
            U.h('button', {
              class: 'btn danger', text: '恢复默认关卡',
              on: {
                click: function () {
                  if (!confirm('确定放弃当前所有编辑，回到游戏本体默认关卡？')) return;
                  D.resetToDefault();
                  refresh();
                  if (ED.Panels.level) ED.Panels.level.render();
                  if (ED.Panels.scene) ED.Panels.scene.rebuild();
                  ED.toast('已恢复默认');
                }
              }
            })
          ]),
          U.h('div', { style: { marginTop: '8px' } }, [pasteArea])
        ])
      ]),

      U.h('div', {}, [
        U.h('div', { class: 'card' }, [
          U.h('div', { class: 'h' }, [U.h('span', { text: '游戏接入步骤' })]),
          U.h('div', { class: 'code', text: ACCESS })
        ]),
        U.h('div', { class: 'card' }, [
          U.h('div', { class: 'h' }, [U.h('span', { text: '数据结构说明' })]),
          U.h('div', { class: 'muted', html:
            '<b>levels[]</b><br>' +
            '· <code>board</code>：2048 棋盘尺寸 n、生成档 tier、步数上限与回复<br>' +
            '· <code>battle</code>：lanes / cols / nodeX / nodeHp / gold —— 直接对应 Battlefield 构造参数<br>' +
            '· <code>roulette</code>：6 格元素轮盘，对应 Director.roulette<br>' +
            '· <code>map.tiles[lane][col]</code>：地块类型；<code>map.effects</code>：泥地/水洼系数（游戏侧可选实现）<br>' +
            '· <code>plants[]</code>：开局布防（lane/col/kind），只有落在种植槽上的会被采用<br>' +
            '· <code>waves[]</code>：<code>{t, intent, comp:[[role,count]]}</code> —— 与 Battlefield.WAVES 同构，游戏可直接替换<br><br>' +
            '<b>编辑器与游戏的关系</b><br>' +
            '· 编辑器位于 <code>editor/</code>，只读引用 <code>3069antone/src/*.js</code>，<b>不修改任何游戏文件</b><br>' +
            '· 数据单向流动：编辑器 → 导出 levels.js → 游戏加载。删掉 editor/ 不影响游戏运行<br>' +
            '· 游戏源码改动（数值、精灵、公式）会立刻反映到编辑器的图鉴与预览' })
        ])
      ])
    ]));

    refresh();
  };

  P.unmount = function () { P.mounted = false; };
  P.refresh = refresh;

  ED.Panels = ED.Panels || {};
  ED.Panels.export = P;
})(window.ED);
