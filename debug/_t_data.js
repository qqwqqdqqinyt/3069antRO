global.window = { ED: {}, devicePixelRatio: 1 };
global.document = { getElementById: function(){ return null; } };
require('../editor/js/core.js');
require('../editor/js/data.js');
var ED = global.window.ED, D = ED.Data;

D.load();
var L = D.cur();                       // 必须与编辑器一致：所有写入都落在这里
console.log('骨架:', JSON.stringify(L.obstacles), JSON.stringify(L.display.byType));

// 1. 放置 + id
var a = D.obsAdd(0, 1, 'rock');
var b = D.obsAdd(2, 3, 'stump');
console.log('id:', a.id, b.id, '| 默认形状=满格矩形:', JSON.stringify(a.shape.pts.map(function(p){return p.x+','+p.y;})));

// 2. 碰撞层默认值（rock: 挡ground/flat，不挡air/arc）
console.log('rock 默认 ground/air/flat/arc:', D.obsBlocks(a,'enemy','ground'), D.obsBlocks(a,'enemy','air'), D.obsBlocks(a,'proj','flat'), D.obsBlocks(a,'proj','arc'));
console.log('stump 默认 flat/arc:', D.obsBlocks(b,'proj','flat'), D.obsBlocks(b,'proj','arc'));

// 3. 实例覆盖：只勾 air 与 arc
D.obsSetBlock(a, 'enemy', 'air', 1);
D.obsSetBlock(a, 'proj', 'arc', 1);
console.log('覆盖后 air/arc:', D.obsBlocks(a,'enemy','air'), D.obsBlocks(a,'proj','arc'), '| ground 仍跟随类型:', D.obsBlocks(a,'enemy','ground'), '| 自定义:', D.obsCustom(a));

// 4. applied 总开关
a.applied = false;
console.log('applied=false → 挡ground?', D.obsBlocks(a,'enemy','ground'), '| 已应用数:', D.obsApplied(L).length, '(应为1)');
a.applied = true;

// 5. 显示参数两级合并
D.dispSet('plants', 'peashooter', null, { scale: 3.4, oy: -6 });
D.dispSet('plants', 'peashooter', 'L0C0', { ox: 12 });
console.log('类型:', JSON.stringify(D.dispGet('plants','peashooter',null)));
console.log('实例:', JSON.stringify(D.dispGet('plants','peashooter','L0C0')), '← ox=12 覆盖，scale/oy 继承类型');
console.log('未被覆盖的实例:', JSON.stringify(D.dispGet('plants','peashooter','L1C0')));

// 6. 障碍物占位 → 同格植物被剔除
L.plants.push({ lane: 0, col: 1, kind: 'sprout' }, { lane: 2, col: 2, kind: 'sprout' });
D.levels[0] = D.normalize(L);
L = D.cur();
console.log('L0C1(有障碍)植物保留?', L.plants.some(function(p){return p.lane===0&&p.col===1;}), '(应 false)');
console.log('L2C2(无障碍)植物保留?', L.plants.some(function(p){return p.lane===2&&p.col===2;}), '(应 true)');

// 7. 顶点越界夹紧 / 少于3点回退
var o = D.obsAt(2,3);
D.obsSetPts(o, [{x:-5,y:9},{x:0.5,y:2},{x:1,y:1}]);
console.log('夹紧后:', JSON.stringify(o.shape.pts.map(function(p){return p.x+','+p.y;})));
D.obsSetPts(o, [{x:0,y:0},{x:1,y:0}]);
console.log('少于3点回退矩形:', JSON.stringify(o.shape.pts.map(function(p){return p.x+','+p.y;})));
