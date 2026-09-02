# 宠物系统 v1 · 实施方案

> 状态：方案稿（待主人确认）
> 起源：2026-09-02 主人新增"宠物/异变植物系统"需求
>

---

## 一、世界观背景（极少融入版）

晶枢碎片（紫色晶石）坠落到主角家后院。原本一株普通的牙苗受异变能量影响，开始泛出**红 / 绿 / 暗绿褐**三种异光——玩家首次进入游戏时三选一种下。

**没有过场动画系统**，仅在首屏顶部 + 异变工坊首页顶部各放一段极简文字描述（`docs/背景故事.md` 风格，几行即可）。

---

## 二、核心决策（已与主人对齐）

| 议题 | 决策 |
|---|---|
| 花园改造 | **彻底改造 + 承担血量恢复**：「室内花园」专做 ① 培育植物展示 ② 进化触发 ③ **浇水施肥恢复血量** |
| 星尘来源 | **关卡结算给**（取代原花园产出），仍为养成树货币 |
| 合成入口 | **home 主菜单新增按钮 → 独立屏**（截图设计：底部三 tab 植物/材料/返回）|
| 入战方式 | **战场左上角新增 petPanel**（点 pet 缩略图→战场点空槽种植），与现 PLANTS 流程同 |
| 战斗死亡 | **可死亡**，需在室内花园浇水施肥恢复，或商店买血瓶 |
| 血瓶商店 | 3 档：小瓶 20% / 中瓶 55% / 大瓶 100%（均金币购买，可重复买）|
| 首次 3 选 1 | **首次进入游戏**（profile.choice 缺失时）强制选，永不可改 |
| 货币体系 | 6 种货币全保留：金币 / 星尘 / 碎片 / 材料 / 晶核 / 星核 |
| 进化材料 | **分种类字典** `materials: { redtomato, smallchili, ... }`，第一关 22% 各掉 1 |
| 基础材料 | 关卡掉落杂物，玩家**卖给商店换金币**（1:1，进 `profile.basic`）|
| 星核（star） | 复用为「高级购买力」—— 合成屏里用于购买高级进化 / 扩编队 |
| 碎片合成 | 暂不做 |
| 当前可选 | **红色牙苗** 1 种；绿/枯萎数据预占位但 UI 点不开 |
| 当前进化链 | 红牙苗 → 龙葵（红番茄）/ 灯笼椒（小辣椒）|
| 美术 | 本喵出占位（形状），Q 版精灵先骨架，后续 `spriteMem/` 精修 |

---

## 三、数据契约

### 3.1 profile 新字段（localStorage `xingxu_meta_v1` 扩展）

```js
blankProfile = {
  // ... 现有字段保留（stardust/gold/shard/material/core/upgrades/.../）
  choice: null,                       // 'red' | 'green' | 'withered'（首次选择，写入后永不可改）
  pet: null | {                       // 当前培育植物（与 choice 配套，初始为 redsprout）
    kind: 'redsprout',                // 当前形态
    stage: 0,                         // 0=牙苗 1=进化形态
    branch: 'longkui' | 'denglongjiao' | null,  // 已选分支
    hp: 100,                          // 当前 HP（从战斗中带过来，浇水施肥恢复）
    hpMax: 100,                       // 最大 HP（随进化链：redsprout=100, longkui=180, denglongjiao=260）
    lastRecovered: 0,                 // 上次恢复时间戳（ms），用于室内花园浇水施肥节流
    fed: { redtomato: 0, smallchili: 0 }  // 已喂的材料计数（调试/展示用）
  },
  materials: {                        // 进化材料字典（关卡 22% 掉红番茄/小辣椒）
    redtomato: 0,
    smallchili: 0
  },
  basic: 0,                           // 基础材料（关卡掉落杂物，1:1 卖商店换金币）
  party: [],                          // 当前出战携带的培育植物（[petKind] 长度≤1）
  bought: { ... }                     // 增加血瓶/基础材料出售项
}
```

**关键区分**：
- `materials` = 进化材料（关卡掉 → 喂宠物 → 进化）
- `basic` = 基础材料（关卡掉 → 1:1 卖商店 → 换金币）
- `profile.material`（旧字段）作为「材料总数」兼容保留
- `pet.hp / hpMax` = 战斗血量，由室内花园浇水施肥恢复，或血瓶立即回

### 3.2 LEVEL_DATA 不动

不引入新关卡数据字段。现有挂载点①-⑦足够。进化/编队完全在 meta profile 侧管理。

### 3.3 新模块清单（3069antone/src/）

| 文件 | 类型 | 职责 |
|---|---|---|
| `data/pets.js` | data | PLANTS_META：redsprout/longkui/denglongjiao 形态定义、战斗数值（dmg/interval/proj/hp/desc）、进化分支表 |
| `data/basicMat.js` | data | 基础材料定义 + 商店卖出比率（第一版占位）|
| `systems/pet.js` | system | 培育系统（基于 Meta：feed / evolve / branchChoice / party / onboard）|
| `systems/forge.js` | system | 合成系统（事件总线 + 静态命令；不参与局内循环）|
| `view/forgeView.js` | view | 合成屏（截图设计）：植物 tab 进化树；材料 tab 进化材料库存 + 基础材料卖出；返回 tab 退出 |
| `view/petPanel.js` | view | 战场左上角"编队"按钮 + 下拉选择培育植物（挂在 BattleView 上）|
| `art/petArt.js` | art | 培育植物精灵（占位：色块+剪影）|
| `art/materialArt.js` | art | 材料精灵（红番茄/小辣椒/基础材料纯形状）|

### 3.4 改动清单

**`systems/meta.js`**（主战场）
- `blankProfile()` 新增 5 字段
- 移除花园产出方法（`plant / harvest / yieldRate / potYield / potProgress`）
- 移除花园相关常量（`PLANTS / DURATIONS / RARITY_BASE / CAP.offlineH`）
- 新增 `pet.feed / pet.evolve / pet.setBranch / pet.branchChoice / pet.partyAdd / pet.partyRemove`
- 新增 `basic.sell()` —— 在商店出售基础材料换金币

**`systems/director.js`**
- `_spawnEnemy` 击杀时：armor>0.2 仍给通用 material；额外按 `LEVEL_DATA.loot || {redtomato:0.22, smallchili:0.22}` 投骰；基础材料按 `basic:0.50` 概率独立投骰
- 局内"具体种类材料"通过新事件 `EV.MATERIAL_DROP` 传给 run.js 结算

**`systems/run.js`**
- `wallet` 增 `materials`（dict）+ `basic`
- 结算时 `materials / basic` 按比例保留

**`systems/battlefield.js`**
- `PLANTS` 表新增 3 kind：redsprout / longkui / denglongjiao
  - 数值占位：redsprout = 豌豆级（直攻），longkui = 毒系单体，denglongjiao = 火系 AOE（石榴级）
- `placePlant` 支持 `opts.fromPet=true` 走编队来源（关卡结算不删）
- 新增 `applyPetFormation(meta.party)` 在 `buildWorld()` 时按 party 列表放置 1 株培育植物
- 与原"开局送 3 株牙苗"并存（培育植物占 1 个额外槽位）

**`view/main.js`**
- 开局判断 `!profile.choice` 时弹「3 选 1」弹窗（独立小函数 `firstPickScreen`）
- 新增 `EV.CMD_FORGE_OPEN / EV.CMD_PET_PLACE / EV.CMD_MATERIAL_DROP` 事件
- `handleClick` 加 petPanel 命中

**`view/metaView.js`**
- home 主菜单顶部加「异变工坊」按钮（位置：「开始游戏」按钮右侧）
- 移除 garden tab → 改为「培育」tab（培育植物展示 + 进化触发）
- 商店 tab 增加「基础材料出售」项
- 合成屏通过 `show('forge')` 进入

**`systems/cards.js`**：不动
**`art/plantArt.js`**：KIND 增 3 种精灵占位（实际渲染走 petArt.js）

---

## 四、美术占位策略

- **进化材料**（红番茄/小辣椒）：纯程序化形状——红番茄=红圆+绿蒂，小辣椒=长条红辣椒轮廓。**不画 Q 版精灵**
- **基础材料**：占位形状（一袋小颗粒 / 杂物包），后续再精修
- **培育植物**（红牙苗/龙葵/灯笼椒）：占位精灵 = 单色色块（红牙苗=红，龙葵=紫+叶形，灯笼椒=红+灯笼形）+ 简笔剪影（8 像素尺度）+ 文字标签
- **编辑器同步**：`editor/index.html` 的 `<script>` 列表增加 `petArt.js`、`materialArt.js`

---

## 五、合成屏 UI 设计（按主人截图）

### 5.1 屏结构
- 整屏是独立屏 `metaView.screen = 'forge'`
- 顶部：「异变工坊」标题 + 返回 home 按钮
- 主体三 tab（底部）：**植物 / 材料 / 返回**
  - **植物 tab**：展示当前 pet 状态 + 进化分支图（红色牙苗→龙葵 / 红色牙苗→灯笼椒），点击分支 → 选材料+金币 → 触发进化
  - **材料 tab**：展示 materials 字典（红番茄/小辣椒库存）+ basic 数量 + "出售基础材料换金币" 入口（跳商店）
  - **返回 tab**：退出合成屏回 home

### 5.2 进化路径展示（按截图）
- 居中：当前 pet（红色牙苗图标）
- 向上/向下两条箭头 → 两个目标形态（龙葵、灯笼椒）
- 每个目标旁边一个小材料图标 + 「需要金币」标签
- 点击目标 → 弹"花费金币 + 1 红番茄/小辣椒 → 进化"确认

---

## 六、战斗接入

### 6.1 战场左上角按钮
- 位置：`BattleView` 区域左上角（不挡轮盘/不挡战场）
- 图标：当前携带的 pet 缩略图（无 pet 时显示 "+"）
- 点击：展开 1 个槽位的下拉（暂只 1 槽）
- 选好后：在 `buildWorld()` 时 `applyPetFormation([{kind: petKind}])` 自动放置 1 株在指定空槽
- 关卡结束不清（profile.party 持续存在）

### 6.2 战斗中行为
- 与现 PLANTS 流程同：自动攻击、吃附魔、吃伤害等
- 死亡行为见 §7.1

---

## 七、待主人在方案阶段确认的小项（已对齐）

### 7.1 「培育植物战斗死亡」的行为（✅ 主人 2026-09-02 答复）

**可死亡**。死了不会被自动复活——玩家需要在**室内花园**通过「浇水 / 施肥」机制让血量慢慢恢复（恢复速度按进化链分级），或者去商店买**百分比血瓶**立即回血。
局内掉血残血状态，局外也会残血（血量同步），残血进入战场，在局内吃buff回血了，则局外也回血

#### 7.1.1 室内花园恢复机制（主人答复整合）
- 培育植物默认就在室内花园里驻留（不依赖玩家手动种）
- 「浇水 / 施肥」是手动触发 → 加快血量恢复速度（×2）
- **恢复时间随进化链分级**（越高级 → 血越多 → 恢复时间越长）
- 第一版占位数值：
  - redsprout：每 30 秒恢复 1% HP，浇水施肥 ×2 加速
  - longkui：每 45 秒恢复 1% HP
  - denglongjiao：每 60 秒恢复 1% HP
- 后期可考虑「广告加速」（不在本次范围）

#### 7.1.2 商店「百分比血瓶」项（新增 SHOP）
- 小瓶（×0.2）：恢复 20% 满血，花费 50 金币
- 中瓶（×0.55）：恢复 55% 满血，花费 120 金币
- 大瓶（×1.0）：恢复 100% 满血，花费 200 金币
- 与现有 SHOP 同构，可重复购买（`once:false`）

#### 7.1.3 入战槽位规则（✅ 主人答复）
**「和普通植物一样选择后，找点位种植」** —— 与现 PLANTS 流程同：
- 玩家在 petPanel 里选好培育植物 → 战场点空槽位 → 种下（不花金币，已持有）
- 死亡后槽空出，下次进战斗需重新在 petPanel 选好再种
- 与现"开局自动放 3 株牙苗"并存

### 7.2 携带出战的"槽位"（✅ 主人答复）
与现 PLANTS 流程同：玩家手动点空槽种培育植物（已含 §7.1.3）

### 7.3 基础材料商店卖出比率（✅ 主人答复）
- **1 基础材料 = 1 金币**（卖出）—— 简单直接

### 7.4 进化成本（第一版占位，未与主人确认）
- 红牙苗 → 龙葵：100 金币 + 1 红番茄
- 红牙苗 → 灯笼椒：100 金币 + 1 小辣椒
- 后续可调（开工前如主人调整请告知）

### 7.5 首次选择剧情融入（极简版方案）

本喵提议在两处各加一段文字（参考 `docs/背景故事.md` 现有风格）：

- **首次进入游戏的 3 选 1 弹窗顶部**：
  > "夜半，一颗紫色晶石穿破你家的玻璃花房，正好砸在那株小小的牙苗旁边。几天后，那株牙苗开始泛起异光……"

- **异变工坊首页顶部**：
  > "那株受过晶枢感染的牙苗就在你手边。喂它吃不同的东西，会长成截然不同的形态——但走哪条路，就回不了头了。"

**合计约 80 字**。是否 OK？

---

## 八、验证清单

### 8.1 冒烟测试（`debug/smoke_editor.js` 新增块）
- 首次选择 → 写入 profile.choice
- 喂养红番茄 → materials.redtomato--
- 触发进化 → pet.kind 从 redsprout → longkui
- 战场放置：party=['longkui'] → BattleView.plants 含 1 株 longkui
- 关卡结算 → profile.party 保留 / pet 保留 / materials.basic 按比例保留
- 旧存档兼容：缺新字段时回落默认

### 8.2 编辑器同步
- `editor/index.html` 加 petArt.js / materialArt.js
- 图鉴面板显示 3 种新 pet（kind 列表）

### 8.3 边界
- 绿色/枯萎牙苗 UI 显示但点不开（数据预占位）
- 进化高级形态（龙葵2/灯笼椒2）数据预占位
- 碎片合成暂不做
- 2 格植物后期扩

---

## 九、工作量评估（粗略）

- 数据契约 + profile 扩展：~150 行
- 宠物系统（pet.js / forge.js）：~300 行
- 合成屏视图（forgeView.js）：~500 行
- 战场接入（petPanel.js + BattleView 改）：~200 行
- 美术占位（petArt.js / materialArt.js）：~300 行
- meta.js 改造（去花园 + 加宠物方法）：~250 行（删除 ~150 + 新增 ~400）
- main.js 装配改动：~80 行
- 冒烟测试：~150 行

合计 **约 1800 行**（含美术占位），**预计 1 个工作日量级**。

---

## 十、最终确认（请主人过目）

主人，方案到这里。所有 6 项关键决策已与主人对齐：

| § | 决策项 | 状态 |
|---|---|---|
| §7.1.1 | 室内花园浇水施肥恢复机制 | ✅ 主人答复 |
| §7.1.2 | 血瓶商店（20% / 55% / 100%）| ✅ 主人答复 |
| §7.1.3 | 入战手动找槽种植 | ✅ 主人答复 |
| §7.3 | 基础材料 1:1 卖商店 | ✅ 主人答复 |
| §7.4 | 进化成本 100 金币 + 1 材料 | ⚠️ 占位数字（开工前调整请告知）|
| §7.5 | 首次选择剧情融入（极简文字版）| ⚠️ 未与主人确认（默认 80 字极简文字）|

**主人请回复"开工"或具体调整意见，本喵立刻执行喵**。
