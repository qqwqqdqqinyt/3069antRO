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
    '把「下载 levels.js」按钮生成的文件放到：3069antone/src/data/levels.js\n' +
    '（内容形如：window.LEVEL_DATA = {...}，编辑器已生成好）\n' +
    '\n' +
    '然后在 3069antone/index.html 中，紧挨下面这行之前加一行：\n' +
    '    <script src="src/main.js"></script>\n' +
    '改为：\n' +
    '    <script src="src/data/levels.js"></script>\n' +
    '    <script src="src/main.js"></script>\n' +
    '\n' +
    '完成。Battlefield 已内置三个挂载点，main.js 的 buildWorld() 会自动读取\n' +
    'window.LEVEL_DATA.levels[0] 并注入，无需你改动任何游戏逻辑。\n' +
    '\n' +
    '挂载点（游戏侧已实现）：\n' +
    '  ① 波次/轮盘/常量：buildWorld 取 LEVEL_DATA.levels[0]，把 waves / roulette 喂给\n' +
    '     new Battlefield({ waves }) / Director.roulette\n' +
    '  ② 障碍物碰撞：Battlefield.loadObstacles(opts.obstacles)，自动跳过 applied=false\n' +
    '  ③ 显示调整：Battlefield.dispGet(group,key,instKey)，BattleView 绘制时消费缩放/偏移\n' +
    '\n' +
    '  Battlefield 新增构造参数：{ waves:[...], obstacles:[...], display:{...} }\n' +
    '  不传则全部回落游戏内默认值；删掉 levels.js 即回到原版行为。';

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
            '<b>levels[]</b>（统一格式 v' + D.FORMAT.version + '）<br>' +
            '· <code>board</code>：2048 棋盘 n / 生成档 tier / 步数上限与回复<br>' +
            '· <code>battle</code>：lanes / cols / nodeX / nodeHp / gold（布局由游戏响应式 Layout 决定，关卡假设与其一致）<br>' +
            '· <code>roulette</code>：6 格元素轮盘 → Director.roulette（挂载点①）<br>' +
            '· <code>map.tiles[lane][col]</code>：地块类型；<code>map.effects</code>：泥地/水洼系数<br>' +
            '· <code>plants[]</code>：开局布防（lane/col/kind），仅落在种植槽上的生效<br>' +
            '· <code>obstacles[]</code>：<code>{id,lane,col,kind,applied,collide?,shape?}</code> → <code>Battlefield.loadObstacles</code>（挂载点②）；<code>applied=false</code> 不进游戏<br>' +
            '· <code>display</code>：<code>{byType, byInst}</code> 缩放/偏移 → <code>Battlefield.dispGet</code>，BattleView 消费（挂载点③）；<code>scale=null</code> 沿用本体；byInst 植物键为 <code>"L{lane}C{col}"</code><br>' +
            '· <code>waves[]</code>：<code>{t, intent, comp:[[role,count]]}</code> → <code>new Battlefield({waves})</code>（挂载点①）<br><br>' +
            '<b>挂载点（游戏侧已内置，编辑器只产数据）</b><br>' +
            '· ① 启动期常量：buildWorld 读 <code>window.LEVEL_DATA.levels[0]</code>，注入 waves / roulette<br>' +
            '· ② 障碍物碰撞：<code>loadObstacles(opts.obstacles)</code>，逐实例 collide 回落类型默认，自动跳过未应用项<br>' +
            '· ③ 显示调整：<code>dispGet(group,key,instKey)</code> 两级合并（byType → byInst），BattleView 绘制时偏移/缩放精灵<br><br>' +
            '<b>编辑器与游戏的关系</b><br>' +
            '· 编辑器只读引用游戏源码做图鉴/预览，<b>不重写游戏逻辑</b>；但导出的是数据文件 <code>levels.js</code><br>' +
            '· 数据单向流动：编辑器 → 导出 levels.js（挂 window.LEVEL_DATA）→ 游戏 buildWorld 注入<br>' +
            '· 不引入 levels.js 则全部走游戏内默认，行为与旧版一致；精灵/数值改动经 ED.G 同源即时反映' })
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
