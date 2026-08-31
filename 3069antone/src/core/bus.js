/* ============================================================
 *  EventBus —— 系统之间唯一的耦合点
 *  规则：Board2048 与 Battlefield 互不 import、互不持有引用。
 *        所有跨系统影响一律走这里的事件。
 * ============================================================ */
(function (global) {
  'use strict';

  var listeners = Object.create(null);
  var wildcards = [];
  var muted = false;

  function on(type, fn, owner) {
    (listeners[type] || (listeners[type] = [])).push({ fn: fn, owner: owner || null });
    return function off() { Bus.off(type, fn); };
  }

  function once(type, fn) {
    var d = on(type, function (p) { d(); fn(p); });
    return d;
  }

  function off(type, fn) {
    var arr = listeners[type];
    if (!arr) return;
    for (var i = arr.length - 1; i >= 0; i--) if (arr[i].fn === fn) arr.splice(i, 1);
  }

  function offOwner(owner) {
    for (var k in listeners) {
      listeners[k] = listeners[k].filter(function (h) { return h.owner !== owner; });
    }
  }

  /** '*' 监听所有事件，调试/埋点用 */
  function onAny(fn) { wildcards.push(fn); return function () { wildcards = wildcards.filter(function (f) { return f !== fn; }); }; }

  function emit(type, payload) {
    if (muted) return;
    var arr = listeners[type];
    if (arr) {
      // 拷贝一份，允许回调里增删监听
      var snap = arr.slice();
      for (var i = 0; i < snap.length; i++) {
        try { snap[i].fn(payload, type); }
        catch (e) { console.error('[Bus] handler error on "' + type + '"', e); }
      }
    }
    for (var j = 0; j < wildcards.length; j++) {
      try { wildcards[j](type, payload); } catch (e2) { console.error('[Bus] wildcard error', e2); }
    }
  }

  var Bus = {
    on: on, once: once, off: off, offOwner: offOwner, onAny: onAny, emit: emit,
    mute: function () { muted = true; },
    unmute: function () { muted = false; },
    reset: function () { listeners = Object.create(null); wildcards = []; },
    stats: function () { var o = {}; for (var k in listeners) o[k] = listeners[k].length; return o; }
  };

  /** 事件名常量表 —— 跨系统的唯一契约，改这里必须同步改订阅方 */
  Bus.EV = {
    // ---- Board2048 → 外部 ----
    BOARD_MOVE: 'board:move',            // {dir, moved, stepsLeft}
    BOARD_MERGE: 'board:merge',          // {value, x, y, chainIndex, chainLen}
    BOARD_SPAWN: 'board:spawn',          // {value, x, y}
    BOARD_STEP: 'board:step',            // {steps, max, reason}
    BOARD_JAMMED: 'board:jammed',        // {reason} 无步可走
    BOARD_RESET: 'board:reset',

    // ---- 外部 → Board2048 ----
    CMD_MOVE: 'cmd:board:move',          // {dir}
    CMD_GRANT_STEPS: 'cmd:board:steps',  // {n}
    CMD_SET_TIER: 'cmd:board:tier',      // {tier}

    // ---- Battlefield → 外部 ----
    WAVE_START: 'battle:waveStart',      // {wave, level}
    WAVE_CLEAR: 'battle:waveClear',      // {wave, level, kills}
    ENEMY_SPAWN: 'battle:enemySpawn',    // {enemy}
    ENEMY_HIT: 'battle:enemyHit',        // {enemy, amount, source, element}
    ENEMY_DEAD: 'battle:enemyDead',      // {enemy, source}
    ENEMY_LEAK: 'battle:enemyLeak',      // {enemy, damage}
    NODE_DAMAGE: 'battle:nodeDamage',    // {amount, hp, max}
    NODE_DEAD: 'battle:nodeDead',
    PLANT_FIRE: 'battle:plantFire',      // {plant, projectile}
    LEVEL_CLEAR: 'battle:levelClear',    // {level}

    // ---- 外部 → Battlefield ----
    CMD_DAMAGE_POOL: 'cmd:battle:damagePool', // {pool, element, star, source}
    CMD_PLANT_EVOLVE: 'cmd:battle:evolve',    // {slot, target}
    CMD_PLANT_PLACE: 'cmd:battle:place',      // {slot, kind}
    CMD_WAVE_START: 'cmd:battle:waveStart',
    CMD_HEAL_NODE: 'cmd:battle:healNode',     // {amount}

    // ---- Director → UI ----
    CHARGE_GAIN: 'dir:chargeGain',       // {gain, charge, max}
    ENCHANT_CAST: 'dir:enchantCast',     // {element, pool, star, source}
    CURRENCY: 'dir:currency',            // {star, gold, shard, core}
    TOAST: 'ui:toast',                   // {text, kind}

    // ---- Cards → 全局 ----
    CARD_DRAFT: 'card:draft',            // {options:[card], wave, reason}
    CARD_PICKED: 'card:picked',          // {card, index, stack}
    MOD_CHANGED: 'card:mod',             // {mod}  各系统自行取用所需字段
    CMD_CARD_PICK: 'cmd:card:pick',      // {id}

    // ---- Run（关卡流程） → UI ----
    RUN_LEVEL_CLEAR: 'run:levelClear',   // {level, stats}
    RUN_DECISION: 'run:decision',        // {level, ev, risk}
    RUN_GAME_OVER: 'run:gameOver',       // {level, wave, stats}
    CMD_CONTINUE: 'cmd:run:continue',    // 继续下一关
    CMD_CASH_OUT: 'cmd:run:cashOut',     // 收手结算
    CMD_NEXT_LEVEL: 'cmd:run:nextLevel',

    // ---- Meta（元游戏） ----
    META_CHANGED: 'meta:changed',        // {profile}
    CMD_SHOP_BUY: 'cmd:meta:shopBuy',    // {key}
    CMD_UPGRADE: 'cmd:meta:upgrade',     // {key}
    CMD_GARDEN_PLANT: 'cmd:meta:gardenPlant', // {slot, kind}
    CMD_GARDEN_HARVEST: 'cmd:meta:gardenHarvest',
    CMD_SAVE: 'cmd:meta:save'            // 手动存档
  };

  global.Bus = Bus;
})(window);
