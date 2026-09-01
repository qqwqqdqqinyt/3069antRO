/* 弹道 z 化：新旧两套实现的数值对比验算（一次性，验完即删） */
'use strict';

function mkGeom(top, laneH, lanes) {
  var laneY = function (i) { return top + laneH * (i + 0.5) + 14; };
  var laneYf = function (v) {
    var c = Math.max(0, Math.min(lanes - 1, v));
    var i = Math.floor(c), f = c - i;
    if (f < 1e-6 || i >= lanes - 1) return laneY(i);
    return laneY(i) + (laneY(i + 1) - laneY(i)) * f;
  };
  return { laneY: laneY, laneYf: laneYf, laneH: laneH, top: top };
}

var DT = 1 / 60;

/** 旧实现：屏幕 y 积分，落地看 laneY(发射道)+4 */
function simOld(G, sy, ty, dx, fireLane) {
  var T = Math.max(0.55, Math.min(1.25, dx / 300));
  var g = 980;
  var vy = (ty - sy - 0.5 * g * T * T) / T;
  var groundY = G.laneY(fireLane) + 4;
  var y = sy, t = 0, peak = y;
  for (var k = 0; k < 600; k++) {
    vy += g * DT; y += vy * DT; t += DT;
    if (y < peak) peak = y;
    if (y >= groundY) return { t: t, x: dx * t / T, y: y, peak: peak, early: true };
    if (t >= T) return { t: t, x: dx, y: y, peak: peak, early: false };
  }
  return { t: t, x: dx, y: y, peak: peak, early: false };
}

/** 新实现：参数化 (v, z)，屏幕 y = laneYf(v) - z，落地看 z <= 0 */
function simNew(G, sy, dx, vFrom, vTo, arcRatio) {
  var T = Math.max(0.55, Math.min(1.25, dx / 300));
  var z0 = G.laneYf(vFrom) - sy;
  var hArc = G.laneH * arcRatio;
  var t = 0, z = z0, v = vFrom, y = sy, peak = y, peakZ = z0;
  for (var k = 0; k < 600; k++) {
    t += DT;
    var s = Math.min(1, t / T);
    z = z0 + (0 - z0) * s + hArc * 4 * s * (1 - s);
    v = vFrom + (vTo - vFrom) * s;
    y = G.laneYf(v) - z;
    if (z > peakZ) { peakZ = z; peak = y; }
    if (z <= 0) return { t: t, x: dx * s, y: y, peak: peak, peakZ: peakZ, early: false };
  }
  return { t: t, x: dx, y: y, peak: peak, peakZ: peakZ, early: false };
}

var fails = 0;
function chk(name, cond, detail) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
  if (!cond) fails++;
}

function run(label, top, laneH, dx) {
  var G = mkGeom(top, laneH, 3);
  var ARC_RATIO = 0.45;
  console.log('\n=== ' + label + '   laneH=' + laneH + '  dx=' + dx + '  战场顶 y=' + top + ' ===');
  var lane0 = G.laneY(0), sy = lane0 - 12;      // 枪口比地面高 12px

  /* A. 平射：z 恒定，屏幕 y 必须恒等于 sy（与旧实现逐位一致） */
  var z0 = G.laneYf(0) - sy;
  console.log('A. 平射');
  chk('枪口离地 z0 = 12', Math.abs(z0 - 12) < 1e-9, 'z0=' + z0.toFixed(3));
  chk('屏幕 y 恒 = ' + sy.toFixed(1), Math.abs((G.laneYf(0) - z0) - sy) < 1e-9);

  /* B. 同道抛物线 */
  console.log('B. 抛物线 · 同道 (v0 → v0)');
  var ty = G.laneY(0);
  var o = simOld(G, sy, ty, dx, 0);
  var n = simNew(G, sy, dx, 0, 0, ARC_RATIO);
  chk('新实现落点 = 地面', Math.abs(n.y - G.laneY(0)) < 1.0, 'y=' + n.y.toFixed(1) + ' 期望 ' + G.laneY(0).toFixed(1));
  chk('新实现走满全程', Math.abs(n.x - dx) < 2, 'x=' + n.x.toFixed(1) + ' / ' + dx);
  chk('弧高不超出战场顶', n.peak > top, '顶点 y=' + n.peak.toFixed(1) + ' 战场顶=' + top);
  console.log('        旧实现: 顶点 y=' + o.peak.toFixed(1) + (o.peak > top ? '' : '  <-- 已飞出战场被裁'));
  console.log('        新实现: 顶点 y=' + n.peak.toFixed(1) + '  (z_peak=' + n.peakZ.toFixed(1) + ')');

  /* C. 跨半道抛物线 —— 用户报的 bug 场景 */
  console.log('C. 抛物线 · 跨半道 (v0 → v0.84，蜘蛛停在两道之间)');
  var vTo = 0.84;
  var ty2 = G.laneYf(vTo);
  var o2 = simOld(G, sy, ty2, dx, 0);
  var n2 = simNew(G, sy, dx, 0, vTo, ARC_RATIO);
  chk('新实现落点 = 目标道地面', Math.abs(n2.y - G.laneYf(vTo)) < 1.5,
    'y=' + n2.y.toFixed(1) + ' 期望 ' + G.laneYf(vTo).toFixed(1));
  chk('新实现走满全程', Math.abs(n2.x - dx) < 2, 'x=' + n2.x.toFixed(1) + ' / ' + dx);
  var oldPct = (o2.x / dx * 100);
  console.log('        旧实现: ' + (o2.early ? '提前落地' : '走满') +
    '  只飞了 ' + oldPct.toFixed(1) + '% 路程  x=' + o2.x.toFixed(1) + ' / ' + dx);

  /* D. 障碍物高度与弧高的关系 */
  console.log('D. 越障判定（平射 z=12，抛物线 z_peak=' + n.peakZ.toFixed(1) + '）');
  var H = { rock: 0.28, stump: 0.24, boulder: 0.78, pillar: 1.05, crystal: 0.50 };
  Object.keys(H).forEach(function (k) {
    var hz = laneH * H[k];
    var flatBlocked = 12 < hz;
    var arcBlocked = n.peakZ < hz;
    console.log('        ' + (k + '        ').slice(0, 9) + ' h=' + hz.toFixed(1) +
      'px   平射' + (flatBlocked ? '被挡' : '通过') + '   抛物线' + (arcBlocked ? '被挡' : '通过'));
  });
  var flatOK = 12 < laneH * H.rock;
  var arcPass = n.peakZ > laneH * H.rock;
  var boulderBlocks = n.peakZ < laneH * H.boulder;
  chk('rock 挡平射', flatOK);
  chk('rock 不挡抛物线', arcPass);
  chk('boulder 挡抛物线', boulderBlocks);
}

run('竖屏 540x1120', 52, 112, 300);
run('横屏 1040x640', 52, 192, 300);

console.log('\n' + (fails ? '*** ' + fails + ' 项未通过 ***' : '全部通过'));
process.exit(fails ? 1 : 0);
