/* ============================================================
 *  data/basicMat.js —— 基础材料 与 宠物血瓶
 *
 *  基础材料（主人 2026-09-02 定）：
 *    · 关卡掉落的「杂物」，本身不能喂宠物、不能进化
 *    · 唯一用途 = 卖给商店换金币（1 : 1）
 *    · 与「进化材料」（红番茄 / 小辣椒，见 pets.js）是两套东西，别混
 *
 *  宠物血瓶（主人 2026-09-02 定）：
 *    · 培育植物在战场上会掉血，死了不会自动复活
 *    · 除了在室内花园「浇水施肥」慢慢回，也可以花钱立刻回血
 *    · 三档：小瓶 20% / 中瓶 55% / 大瓶 100%，均按「最大 HP 的百分比」回
 *
 *  ★ 这里的 SHOP_ITEMS 会被 meta.js 合并进 Meta.SHOP，
 *    保持「数值同源」—— 改这里，商店与合成屏同时变。
 * ============================================================ */
(function (global) {
  'use strict';

  /* ---------------- 基础材料 ---------------- */
  var BASIC = {
    key: 'basic',
    name: '基础材料',
    color: '#b9a67e',
    desc: '随处可见的杂物。喂不了宠物，只能卖给商店换点金币。',
    sellRate: 1          // 1 基础材料 = 1 金币
  };

  /** 全卖：把所有基础材料换成金币，返回 {gold, used} */
  function sellAll(count) {
    var n = Math.max(0, Math.floor(count || 0));
    return { gold: n * BASIC.sellRate, used: n };
  }

  /** 卖指定数量，返回 {gold, used}（不会超出现有数量） */
  function sell(count, have) {
    var n = Math.min(Math.max(0, Math.floor(count || 0)), Math.max(0, Math.floor(have || 0)));
    return { gold: n * BASIC.sellRate, used: n };
  }

  /* ---------------- 宠物血瓶 ---------------- */
  /* ratio 是「恢复最大 HP 的比例」；cost 走金币。可重复购买（once:false）。 */
  var POTIONS = [
    { id: 'potion_s', name: '小瓶回复液', ratio: 0.20, gold: 50,
      color: '#7fe0c0', desc: '立刻恢复培育植物 20% 的最大生命。' },
    { id: 'potion_m', name: '中瓶回复液', ratio: 0.55, gold: 120,
      color: '#6fd6ff', desc: '立刻恢复培育植物 55% 的最大生命。' },
    { id: 'potion_l', name: '大瓶回复液', ratio: 1.00, gold: 200,
      color: '#c79bff', desc: '立刻恢复培育植物 100% 的最大生命。' }
  ];

  function potionOf(id) {
    for (var i = 0; i < POTIONS.length; i++) if (POTIONS[i].id === id) return POTIONS[i];
    return null;
  }

  /* ---------------- 商店项（合并进 Meta.SHOP） ----------------
   * 与 meta.js 的 SHOP 同构：{id, name, cost, desc, tag, once}
   *   tag='basic' —— 基础材料出售（可重复）
   *   tag='potion' —— 宠物血瓶（可重复）
   */
  var SHOP_ITEMS = [
    {
      id: 'sell_basic', name: '出售基础材料', cost: {},
      desc: '把全部基础材料卖给商店，1 个 = 1 金币。',
      tag: 'basic', once: false
    }
  ].concat(POTIONS.map(function (p) {
    return {
      id: p.id, name: p.name, cost: { gold: p.gold },
      desc: p.desc, tag: 'potion', once: false, ratio: p.ratio
    };
  }));

  global.BasicMat = {
    BASIC: BASIC,
    POTIONS: POTIONS,
    SHOP_ITEMS: SHOP_ITEMS,

    sell: sell,
    sellAll: sellAll,
    potionOf: potionOf
  };
})(window);
