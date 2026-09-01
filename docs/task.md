# 任务日志

> 格式：`## 状态（未完成 / 进行中 / 已完成） · yyyy-MM-dd`
> 内容：计划 / 正在做 / 做了什么（新增、删除；必要时记录重要改动、遇到的困难与决策）

---

## 已完成 · 2026-09-01

### 星序防线 · Web 编辑器 v1（新增 `editor/`）

**需求**：为 `3069antone/` 的 H5 游戏（2048 合成 × 塔防）做一个独立于游戏本体的网页编辑器，
实现 ① 实时查看植物/特效/敌人及其数值 ② 查看场景地图效果 ③ 关卡编辑器 ④ 关卡编辑器内实现地图编辑；
编辑器与游戏解耦，但产出的数据能直接应用到游戏。

**决策：编辑器只读引用游戏源码，不修改任何游戏文件。**
`editor/index.html` 用相对路径 `../3069antone/src/*.js` 加载游戏本体的
`bus / rng / pixel / plantArt / insectArt / fx / board2048 / battlefield / director / battleView / boardView`，
因此精灵、数值、公式与游戏 100% 同源；游戏改数值，编辑器图鉴与预览立刻跟着变。
数据单向流动：**编辑器 → 导出 `levels.js/levels.json` → 游戏加载**。删掉 `editor/` 不影响游戏运行。
（读不到游戏源码时，core.js 内置数值快照兜底，图鉴仍可看数字，仅精灵与模拟不可用。）

#### 目录结构

```
editor/
  index.html              外壳 + 五个面板容器 + 游戏源码引用
  css/editor.css          深色工具型 UI
  js/core.js              工具 / 统一帧调度 / Toast / 游戏数据源桥接 ED.G（含快照兜底）
  js/data.js              关卡数据模型、地形定义、localStorage 草稿、统计计算 ED.Data.Stats
  js/panel-assets.js      ① 图鉴：植物 / 敌人 / 特效 / 元素 / 常量 / 棋盘档位
  js/panel-scene.js       ② 场景预览：真实跑 Battlefield+BattleView+Board2048+Director
  js/panel-level.js       ③ 关卡编辑器：关卡列表、属性、波次表、压力曲线
  js/panel-map.js         ④ 地图编辑：网格绘制、模板、校验
  js/panel-export.js      ⑤ 导出 JSON/JS、接入片段、导入、恢复默认
  js/app.js               入口：建美术、载草稿、切面板
```

#### 功能落点

| 需求 | 实现 |
|---|---|
| ① 实时查看精灵与数值 | 植物 3 种（待机 + 开火动画）、敌人 6 种（行走动画）、特效 9 个（逐帧循环）；植物显示造价/伤害/间隔/DPS/弹种/弹速/射程/溅射/炮口偏移；敌人显示基准 HP、任意关卡缩放后 HP、护甲、有效 HP、px/s、穿越全场时间、漏怪伤害、赏金、金效率，随「关卡」输入框实时重算。另附元素分配规则表、`Director.K` 常量表、`Board2048.tiers` 档位表 |
| ② 场景地图效果 | 1040×640 画布跑游戏原生 `BattleView`；叠加编辑器自有的地形层（种植槽/泥地/水洼/岩石/空洞/出生点）、网格与 HUD。可选联动 2048 棋盘（`BoardView`）与 `Director`，把「合成 → 充能 → 附魔 → 伤害池 → 战场」整条链路跑起来；支持播放/暂停、0.25–3× 速度、下一波、自动连波、星枢无敌、自动合成、方向键合成；悬停敌人显示实时数值；布防模式可点击种植槽增删植物 |
| ③ 关卡编辑器 | 多关卡（新建/复制/删除/排序）；属性：lanes、cols、星枢偏移与 HP、起始金币、棋盘 n、生成档 tier、步数上限/回复、6 格元素轮盘、备注；波次表：时长、设计意图、组成（角色 × 数量）增删、排序、复制、从游戏本体导入 WAVES；每波实时统计敌人数/总 HP/有效 HP/需求 DPS/可用 DPS/密度/赏金/压力%，右栏给出关卡汇总 + 压力曲线图 + 体感检查（超时长、DPS 缺口告警） |
| ④ 地图编辑 | 7 种地块（草地 / 种植槽 / 泥地 / 水洼 / 岩石 / 空洞 / 出生点）拖拽绘制、右键或 Alt 擦除、整行列填充、三个模板（经典 / 隘口 / 泥沼）；与关卡属性共享 lanes/cols，尺寸变化保留已画内容；校验每条轨道的可通行性与种植槽数量；地块统计与已布防植物一览 |

#### 数据契约（导出即此结构）

```json
{ "version": 1, "generator": "星序防线编辑器", "levels": [{
  "id":"L1","name":"第一关 · 苗圃",
  "board":  { "n":5,"tier":1,"stepMax":5,"stepRegen":1.5 },
  "battle": { "lanes":3,"cols":4,"nodeX":58,"nodeHp":100,"gold":60 },
  "roulette":["thunder","fire","ice","wood","water","light"],
  "map":    { "version":1,"lanes":3,"cols":4,"tiles":[["slot",...]],
              "effects":{"mudSlow":0.30,"waterSlow":0.15,"waterIceTaken":1.25} },
  "plants": [{"lane":0,"col":0,"kind":"sprout"}],
  "waves":  [{"t":30,"intent":"教学波","comp":[["grunt",6]]}],
  "notes":"" }]}
```

`waves` 与 `Battlefield.WAVES` 同构，游戏可直接整体替换；`map` 属新增字段，
地形减速/阻挡目前只在编辑器预览里实现，游戏侧按 `map.effects` 自行解释即可（导出面板附接入代码）。

#### 验证

`debug/smoke_editor.js`：Node + 假 DOM/Canvas 沙箱，加载全部游戏与编辑器脚本，
挂载五个面板、跑帧、做导入导出往返。
最近结果：面板全部挂载无异常；模拟 60s 后「波次 2 / 击杀 8 / 漏怪 2 / 附魔 1 / 充能 87」，战斗链路跑通。
运行：`node debug/smoke_editor.js`

#### 待确认（已向用户提出）

1. 是否补「数值表编辑器」（敌人/植物/卡牌数值在编辑器里直接改并导出）
2. 是否补「波次自动配平 / 蒙特卡洛模拟」（复用 debug/ 里的模拟脚本思路）
3. 是否补「卡牌 / 养成树 / 经济参数编辑器」
4. 是否补「帧级精灵查看器 + PNG 序列导出」
5. 数据落地：保持手动导出接入，还是由我直接改游戏代码加入自动加载层（含地形适配、多关切换）

---

## 已完成 · 2026-09-01（续）· 关卡数据格式 v2 + 游戏侧三个挂载点

**目标**：把「独立的网页编辑器可生成关卡」落到实处——先定义唯一数据契约，再在游戏侧埋好挂载点，让导出数据能被游戏无侵入地消费。

**统一关卡数据格式（v2，`editor/js/data.js` 的 `D.FORMAT` 为唯一真相源）**
- 顶层包 `{ version:2, generator, generatedAt, source, levels:[Level] }`。
- `Level` 字段：`board / battle / roulette / map{tiles,effects} / plants / obstacles / display / waves / notes`。
- `obstacles[]`：`{id,lane,col,kind,applied,collide?,shape?}`；碰撞层 `collide` 两维度
  `enemy{ground,air,grappler} × proj{flat,arc}`，实例未写的子项回落类型默认（`COLLIDE_DEFAULT`）。
- `display`：`{byType, byInst}`，两级合并（byType → 实例覆盖），`scale=null` 沿用游戏本体；
  byInst 植物键格式 `"L{lane}C{col}"`（如 `"L0C0"`）。

**游戏侧三个挂载点（均在 `3069antone/src/systems/battlefield.js`，不依赖编辑器模块）**
- ① 启动期常量：`main.js` 的 `buildWorld()` 读 `window.LEVEL_DATA.levels[0]`，
  把 `waves`（`new Battlefield({waves})`）、`roulette`（`Director.roulette`）注入；
  另加 `opts.waves` 钩子（新增 `Battlefield._normWaves`，`startNextWave` 改用实例 `this.waves`——
  旧版 `Battlefield.WAVES = ...` 覆盖其实是空操作，因 `startNextWave` 用闭包 `WAVES`）。
- ② 障碍物碰撞：`loadObstacles(opts.obstacles)` 自动跳过 `applied=false`，
  实例 `collide` 回落类型默认；敌人钳制 `_enemyBlockX`、弹道拦截 `_projBlocked(flat/arc)` 为其消费方。
- ③ 显示调整：`dispGet(group,key,instKey)` 两级合并，`BattleView` 绘制时偏移/缩放精灵。

**导出面板（`editor/js/panel-export.js`）**
- 重写 `ACCESS` 接入片段：3 步——下载 `levels.js` → 放到 `3069antone/src/data/levels.js` →
  在 `index.html` 的 `main.js` 前加一行 `<script src="src/data/levels.js"></script>`；
  拨正了旧版「`Battlefield.WAVES` 覆盖 + 改 main.js lanes/cols/nodeX」的过时写法（lanes/cols/nodeX 现由响应式 Layout 决定，不覆盖）。
- 重写「数据结构说明」卡片：列出 v2 字段 + 三个挂载点 + 修正「编辑器不修改游戏文件」的旧表述
  （改为：不重写游戏逻辑，但导出的是数据文件；不引入 levels.js 则回落默认，行为一致）。

**验证**
- `debug/smoke_editor.js`：新增「挂载点① 波次注入」断言（`new Battlefield({waves})` → `bf.waves` 长度与
  归一化正确、`startNextWave` 使用注入波次）；原有障碍物碰撞 / 显示合并 / 敌人钳制断言全绿。
- 运行：`node debug/smoke_editor.js` → 无错误 ✅。

**未做（沿用待确认 #5 的边界）**
- `balance.js` 数值覆盖层（#7 剩余项）、多关切换、地形寻路适配仍未做。

---

## 已完成 · 2026-09-01（再续）· 数据落地：可选①已通电

**把可选项①落地**：生成 `3069antone/src/data/levels.js` 并在 `index.html` 接入，使编辑器→游戏管线端到端可用。

- 新增 `debug/gen_levels.js`（复用 smoke 沙箱加载器）：加载游戏+编辑器模块 → `ED.Data.load()`（默认=游戏内建 WAVES）→
  `serialize()` → 写出 `window.LEVEL_DATA = {...};`。即「下载 levels.js」按钮的同一份字节，与三个挂载点 100% 兼容。
  写完后就地自校验：读回文件 → `new Battlefield({waves,obstacles,display})` 消费 → 断言 `bf.waves` 长度/障碍物/显示层。
- `3069antone/index.html`：在 `<script src="src/main.js">` 前加 `<script src="src/data/levels.js">`；缺失则 404 无害，
  `main.js` 自动加载层读到 `window.LEVEL_DATA` 即注入（挂载点①②③）。生成的默认关卡与游戏内建一致（无障碍物、显示全 null），
  故游戏启动行为完全不变；删掉该文件即回原版。
- 验证：`node debug/gen_levels.js` 生成 3578 字节 / 自校验 `bf.waves 5 | obstacles 0` 通过；
  `node debug/smoke_editor.js` 仍无错误 ✅。

**收回此前「不落盘」的保守处理**：既然已选「加钩子 + 自动加载层」路线，生成数据文件即该路线的自然产出；
保留 `debug/gen_levels.js` 供后续重新导出（编辑器改完点「下载 levels.js」也能直接覆盖它）。

---

## 已完成 · 2026-09-01（再续二）· 数值覆盖层（挂载点④）

**目标**：把「关卡级数值微调」也变成编辑器可产出、游戏无侵入消费的数据，与①②③同一思路（全字段可选、缺失即回落默认）。

**数据契约（v2 新增可选 `balance`，见 `editor/js/data.js` 的 `D.FORMAT.level.balance`）**
```json
"balance": { "enemyHp":1.0, "enemyDmg":1.0, "enemySpd":1.0,
             "plantDmg":1.0, "plantAspd":1.0, "nodeHp":100 }
```
编辑器侧始终补全为完整对象（`balanceBlank()` / `normalize` 中的 `balanceNorm`）：缺失字段回落乘子 1.0 / 星枢 100，
保证导出给游戏的 JSON 结构完整、可被 `Battlefield` 直接消费。`FORMAT.level` 与 `defaultLevel` / `normalize` 已同步。

**游戏侧实现（只在 `3069antone/src/systems/battlefield.js`，不动其它系统）**
- 构造时 `this.balance = opts.balance || null`（位于 `_applyMod` 之前，使乘子能在 startup 生效）。
- 植物伤害/攻速：在 `_applyMod` 里把 `this.balance.plantDmg / plantAspd` 折进 `this.mod.plantDmg / plantAspd`——
  因 `_applyMod` 每次都从 `src` 重算，所以「卡牌修正 × 关卡乘子」恒成立（无卡牌时乘子叠在 1.0 上）。
- 敌人：在 `_spawnEnemy` 生成时把 `R.hp/sc.hp`、`R.dmg/sc.dmg`、`R.speed/sc.spd` 分别乘以 `enemyHp / enemyDmg / enemySpd`（叠在原有 `levelScale` 之上）。
- 星枢：有 `balance.nodeHp` 时绝对覆盖 `nodeMax / nodeHp`（忽略 `nodeMaxAdd`，下限保护 1）。

**装配**：`main.js` 的 `buildWorld()` 自动加载层新增一行 `battleOpts.balance = _lv.balance`（与①②③并列的钩子④）。

**导出落地**：`debug/gen_levels.js` 重新生成 `3069antone/src/data/levels.js`（3743 字节），默认关卡现含 `balance`（全 1.0 / 星枢 100），游戏启动行为不变。

**验证**
- `debug/smoke_editor.js` 新增「挂载点④ 数值覆盖层」断言：
  `new Battlefield({balance:{enemyHp:2,enemyDmg:1.5,enemySpd:0.5,plantDmg:1.25,plantAspd:2,nodeHp:250})`
  → 断言 grunt hp 190(95×2)、dmg 7.5、spd 0.175、`mod.plantDmg` 1.25、`mod.plantAspd` 2、`nodeMax/nodeHp` 250。
- 运行：`node debug/smoke_editor.js` → 无错误 ✅（含 30s 战斗模拟链路、障碍物碰撞、显示合并、波次注入、数值覆盖全绿）。
- 运行：`node debug/gen_levels.js` → 生成并自校验通过 ✅。

**剩余（选项②其它项 / #7 后半）**：地形寻路适配（#20）仍待做（#19 多关切换已完成，见下）。

---

## 已完成 · 2026-09-01（再续四）· 多关切换（#19）+ 蜜蜂接入游戏

### #19 多关切换：关卡作为真实序列
**动机（回应质疑）**：原 `Run.chooseContinue()` 推进后只下发新关卡号，`Battlefield` 旧 handler 仅 `self.level = p.level`（一个难度标量，喂给 `levelScale()`），`LEVEL_DATA.levels[1..]` 从未被读取——波次/障碍/显示/balance 永远不换。故此前「多关」只是「难度递增 + 重放第一关 5 波」。用户确认要手工设计的多关战役。

**游戏侧改动（仅 `battlefield.js` + `main.js`）**
- `battlefield.js`：`_applyMod` 改为从 `_modBase` 快照重算（idempotent，开关卡重算乘子不会叠两次）；新增 `applyLevelContent(L)`（换 `waves`/`obstacles`/`display`/`balance` + 重置波次计数 + 清空生成队列）。
- `main.js`：模块级 `LEVELS=[]`/`appliedLevelIdx=-1`；`buildWorld` 捕获 `LEVELS`；新增 `CMD_NEXT_LEVEL` handler：`level→索引 ai=Math.min(level-1, LEVELS.length-1)`，越界固守最后一关（无尽递增难度），同索引跳过；切换时同步 `director.roulette`。

**验证**：`smoke_editor.js` 断言「关卡切换：波次首 t 30 | 障碍 1 | nodeMax 100→200 | enemyHp 乘子 3 | 波次计数 0」与「序号映射（3 关）0,1,2,2,2」全绿。

### 蜜蜂接入游戏（首只放第一关最后一波）
按用户「做完 #19 再把蜜蜂接入，先放第一关最后一波 1 只」。

**游戏侧（`battlefield.js` + `battleView.js`）**
- `ROLES` 新增 `bee:{kind:'bee',...,flying:true}`（数值照搬 `BeeArt.KIND.bee`：hp70/spd0.62/dmg6/armor0/gold9）。
- `WAVES` 最后一波 `comp` 加 `['bee',1]`（"收尾放 1 只蜜蜂试探空中"）——经 `G.WAVES` → `defaultLevel` → `gen_levels` 自然流入 `levels.js`。
- `_spawnEnemy`：`R.kind==='bee'` 时用 `BeeArt.BeeAnimator`；实体标 `flying`。
- `_enemyBlockX`：飞行单位走 `air` 阻挡层（越过岩石 air=0，被巨石 boulder air=1 拦下）。
- `battleView._enemy`：`e.kind==='bee'` 改用 `e.anim.render()` 驱动悬停浮沉/尾针戳击/飞走姿态（bob/rot/alpha/lunge），精灵取自 `BeeArt.Art`。

**编辑器侧（`core.js` / `panel-assets.js` / `app.js`）**
- `core.js`：`FALLBACK.ROLES` 补 bee；暴露 `G.BeeArt`；`G.INSECT_KIND` 合并 `BeeArt.KIND`（离线兜底补 bee）。
- `panel-assets.js`：`enemyCards()` 对 bee 用 `BeeArt` 的 animator/sprite。
- `app.js`：boot 时补 `G.BeeArt.build()`。

**死亡 FX 安全**：`fx.js` 的 `ENEMY_DEAD` handler 对 fireant/beetle 特判、其余（含 bee）走 `else` 通用分支（splat/chunks/coin），无 `InsectArt.Art[kind]` 查找 → 蜜蜂死亡不崩。

**验证**：`smoke_editor.js` 新增蜜蜂块（生成/动画器/飞行标记/越障岩石∞·巨石545/最后一波含 bee/编辑器图鉴可见）全绿；`gen_levels.js` 重生成 `levels.js`（3823 字节，末波含 bee）。

**已知边界（首版刻意留白，非 bug）**
- 蜜蜂走「lane 内直线前进 + 飞行越障」简化模型；未做跨道/悬停啃食植物（引擎敌人本就不攻击植物，只冲星枢）。
- `metaView.js` 图鉴"昆虫"行是硬编码 `[ant,fireant,beetle]` 列表，蜜蜂暂不出现于该图鉴（游戏内战斗、编辑器图鉴面板均已可见）。
- 飞行为"可被所有弹道命中"的首版设定；若要"只有抛物弹(卷心菜)能打飞行"，需另加命中筛选（已记录，非本次范围）。

**剩余**：无。#20 地形寻路适配已完成（见下「再续五」）。至此 5 个游戏侧挂载点（①②③④⑤）全部通电。

---

## 已完成 · 2026-09-01（再续五）· 地形寻路适配（挂载点⑤ · #20 收尾）

**目标**：让编辑器导出的 `map.tiles`（泥地减速 / 岩石·空洞阻挡 / 水洼冰系加成）真正影响游戏侧寻路，而非只在编辑器预览里生效。

**前提澄清**：引擎此前已具备分数车道基础设施——`laneYf(v)`、索敌/命中的 v-区间判定、蜘蛛 `ROLES` 跨道 grapple、弹道携带 `pr.v`。因此 #20 不是「跨道寻路重构」，而是把编辑器既有的地形表（`editor/js/data.js` 的 `TILES`）原样接入 `Battlefield`，由关卡数据 `map.tiles / map.effects` 驱动。

**游戏侧改动（仅 `3069antone/src/systems/battlefield.js`，其它系统零改动）**
- 新增 `TILE_PROPS` 表 + `tileProp(key)`：`grass/slot`(slow0,walk true)、`mud`(0.30,true)、`water`(0.15,true,water)、`rock/hole`(0,false=阻挡)、`spawn`(0,true)。
- 构造 / `applyLevelContent`：读 `this.map / this.tiles / this.terrainEffects`（默认 `mudSlow:0.30, waterSlow:0.15, waterIceTaken:1.25`）。
- 地形辅助方法：`tileAt(lane,col)`（越界/无 tiles 回落 grass）、`_spawnLanes()`（含 spawn tile 的车道）、`_spawnCellForLane(lane)`（最右 spawn 列）；
  `_terrainApply(e)`（每帧 `e.baseSpeed = e._baseSpeed × tf`，mud tf=0.70 / water tf=0.85，置 `e._onWater`）、
  `_terrainBlock(e)`（非 grappler 且 `tileProp.walk===false` 时钳制 `x` 到该格右侧 `slotX(col)+cellW/2+1`）。
- `_spawnEnemy`：偏好 `_spawnLanes()` 刷怪；缓存 `_baseSpeed`；若有 spawn tile 则把敌人 x/y 钉到出生格。
- `damageEnemy`：元素 `ice` 且 `e._onWater` → 伤害 `eff × terrainEffects.waterIceTaken`（默认 1.25）。

**装配**：`main.js` 的 `buildWorld()` 自动加载层加 `battleOpts.map = (_lv && _lv.map) ? _lv.map : null`（钩子⑤）。

**编辑器同步**：`editor/js/panel-scene.js` 的 `build()` 给 `Battlefield` 传 `map: L.map`；**删除编辑器自有的 `applyTerrain()` 及其 `update` 调用**（逻辑统一下沉到引擎，保证编辑器与游戏 100% 同源，不再双重施加地形）。

**验证**
- `debug/smoke_editor.js` 新增地形断言全绿：`地形·泥地减速 baseSpeed×0.700`（期望≈0.70）、`地形·空洞阻挡 钳制 x=433.5`（期望≥433.5）、`地形·水洼冰系 水面伤害 125 / 草地伤害 100`（期望 125/100）。
- `debug/gen_levels.js` 重生成 `3069antone/src/data/levels.js`（3823 字节，含 `map.tiles` 与 `map.effects`）；自校验 `bf.waves 5 | obstacles 0` 通过。
- 蜜蜂「单位存在但看不见」修复的回归（校验 `editor/index.html` 必含 `insectArt.js/beeArt.js/fx.js`）仍在绿区。
- 运行：`node debug/smoke_editor.js` → 无错误 ✅；`node debug/gen_levels.js` → 无错误 ✅。

**边界（刻意留白，非 bug）**
- 岩石/空洞的阻挡是「贴格右侧钳制」而非「绕行/A* 重规划」——引擎敌人本就直线冲星枢，地形只做减速与硬阻挡，不做改道（与编辑器预览行为一致）。
- 水洼只影响「减速 + 冰系加成」，不改变可通行性（walk true）。

---

## 已完成 · 2026-09-01（再续六）· 游戏侧统一 tuning 覆盖层（挂载点⑥/⑦ · #24）

**目标**：为编辑器即将落地的四大数值面板（#25 数值表 / #26 卡牌·养成·经济 / #27 波次配平 / #28 精灵查看器）提供一个**统一、最小侵入**的游戏侧注入点。所有覆盖走同一份 `LEVEL_DATA.tuning` 对象，字段全部可选，缺省（无编辑器数据）与硬编码默认值逐位一致——编辑器缺席时游戏行为完全不变。

**约定（数据契约）**：`LEVEL_DATA.tuning` 为可选对象，含四个可选子对象：
- `enemies`：`{ [roleKey]: { hp,dmg,speed,armor,gold,... } }` → 覆盖 `ROLES`
- `plants`：`{ [kind]: { hp,dmg,aspd,... } }` → 覆盖 `PLANTS`
- `cards`：`{ [cardId]: { pp,max,rarity,tag,name,desc,flavor } }` → 覆盖卡池数值/展示字段（不改 `apply()` 与元素变体）
- `economy`：`{ EP_BASE,CHARGE_MAX,CHARGE_K,ELEM_CAP,STEP_GIFT,STAR_POW,K_STAR,K_GOLD,K_SHARD,RES2,RES3,upgradeCostBase,upgradeCostPow,plantCost }` → 覆盖 `Director.K` 副本 / `Meta.upgradeCost` / 植物造价

**游戏侧改动（5 文件，纯增量）**
- `battlefield.js`：构造时存 `this.tuning`；新增 `roleDef(key)` / `plantDef(kind)` 合并方法（base `ROLES`/`PLANTS` + `tuning` 覆盖，结果缓存于 `this._roleDefs`/`this._plantDefs`）。`_spawnEnemy / placePlant / _fire / _preyNear / _threatAt / update / _updateSpider` 全部改走 `roleDef/plantDef`。`applyLevelContent` 换关时整体换上 `L.tuning` 并使缓存失效。
- `cards.js`：构造时 `if (opts.tuning.cards) applyTuning(...)`；`applyTuning(cards)` 把 `pp/max/rarity/tag/name/desc/flavor` 合并进 `BY_ID`（POOL 共享对象，两处同改）。
- `director.js`：构造时 `this.K = Object.assign({}, K)`，再从 `opts.tuning.economy` 覆盖 11 个常量键；方法内全部 `K.` → `this.K.`。
- `meta.js`：构造时 `this.upgradeCost = Object.assign({}, UPGRADE_COST)`，再从 `opts.tuning.economy` 覆盖 `upgradeCostBase/Pow`；新增实例方法 `upCost(level)`（受覆盖影响），`nextCost` 转调它。
- `main.js`：新增 `pkgTuning()`（读 `LEVEL_DATA.tuning`）；`Meta/Cards/Director/Battlefield` 全部经 `tuning` 注入；植物造价 `PLANT_COST` 经 `tuning.economy.plantCost` 合并。

**验证**：`debug/smoke_editor.js` 新增 #24 块全部转绿（harness 已补加载 `cards.js`/`meta.js`）：
- 数值覆盖：`grunt.hp 200 / dmg 9 / peashooter.dmg 50`；缺省回落 `grunt.hp 95`（= `ROLES.grunt` 基准）。
- 卡牌覆盖：`sharp.pp 9 / max 5 / name 锋锐X`。
- 经济覆盖：`Director.K.EP_BASE 999 / CHARGE_MAX 250`；缺省与 `Director.K` 模块默认一致。
- 养成覆盖：`upCost(2)` 默认 52 → 覆盖（base40,pow2）80；缺省曲线 52 正常。
- 运行 `node debug/smoke_editor.js` → 无错误 ✅（全量回归：图鉴/场景/关卡/地图/导出/模拟 30s/障碍/蜜蜂/地形 均绿）。

**下一步（用户「全做」四选）**：#25 数值表编辑器面板⑥、#26 卡牌·养成·经济编辑器面板⑦、#27 波次自动配平+蒙特卡洛、#28 帧级精灵查看器+PNG 导出。游戏侧 ingestion 现已齐备，编辑器只需产出 `tuning` 并写回 `levels.js`。
