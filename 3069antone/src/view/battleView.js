/* ============================================================
 *  battleView.js —— 战场渲染（只读 Battlefield 状态）
 * ============================================================ */
(function (global) {
  'use strict';
  var P = global.PX, M = global.M;

  var OBST_COLORS = {
    rock: { color: '#5a6478', edge: '#c8d4e8' },
    boulder: { color: '#4a5466', edge: '#b8c4da' },
    crystal: { color: '#6d7fa8', edge: '#cfe0ff' },
    stump: { color: '#6b5334', edge: '#d8b98a' },
    pillar: { color: '#59617a', edge: '#d0d8ec' }
  };

  /* ---------------- 蜘蛛 rig：8 条腿的运行时解算 ----------------
   * 精灵里那 8 条腿是烤进帧的，只能原地摆 —— 碰不到地面，也碰不到锚点。
   * 这里把身体和腿拆开重画（远侧4 → 身体 → 近侧4），每条腿带真实世界落点。
   *
   * 撑起「有生命力」观感的是三条自洽规则，缺一条就会退回贴图感：
   *   1. 步态不是播出来的 —— 末端落在地上不动，身体走远把它拖出阈值才换步。
   *      「走路」是这个判定的副产品，而不是一段循环帧。
   *   2. 弯曲不是正弦 —— 松弛度 = 1 − 当前长度/舒适长度。腿收拢时下垂明显，
   *      绷直时几乎成直线。绳子拉紧会变直，这条物理直觉就是「自然」的来源。
   *   3. 伸出去抓锚点的腿不再承担体重，支撑腿变少 → 身体下沉。
   *      肢体是负担、姿态改变受力 —— 这比曲线本身更是雨世界那股劲的关键。
   */
  // 触手与身体**同色**（#3a1d4a = 身体腹部暗色）—— 主人的方案：
  // "直接让蜘蛛身体和触手都是同样的黑色，就不用担心穿模"。
  // 同色即无缝：腿从身体下缘伸出去时看不出接缝，也就无所谓穿模。
  // 远近层次改由粗细区分（WID_FAR < WID_NEAR），不再靠明暗。
  // 纯黑：与重新绘制后的身体同色（主人要求只要黑色），同色 = 无缝
  var TENT = { far: '#000000', near: '#000000', tip: '#000000' };
  var TENT_OUTLINE = '#150a1c';   // 与 spiderBody 精灵描边同色（保持视觉一致）
  var TENT_OUT_W = 0.6;           // 描边比本体宽出的量（精灵像素）—— 太宽会鼓出成"双层"

  /* 8 条腿 —— 全部从身体下沿中心**朝下**扇形辐射。
     dir ∈ [1.0, 2.2] ≈ [57°, 126°]，cos ≤ 0.54 —— 没有任何"水平两翼"，
     所有腿看起来都"从身体下出来"。sin 都 ≥ 0.83 → 端部主要在身体下方。
     去掉了 o/ry（所有腿同一根点 = 身体下沿中央）。 */
  // ch = 卷曲手性：+1 右旋 / -1 左旋。相邻两条腿反方向卷，避免 8 条腿
  // 全朝同一手性卷成"风车"；3 条 reach 腿也能各自弧度不同，不像拧成一股。
  // 8 条腿 4 向辐射：每个象限 2 条错开 —— 顶视下真实蜘蛛是 360° 分布，
  // 全朝下像"被腰斩"。起点 bodyCx/bodyCy（被身体覆盖，看不见接缝）。
  // 8 条腿的方位（dir/ph/grp/ch）定义在**逻辑层** battlefield.js 的
  // Battlefield.SPIDER_LEGS —— per-foot 落点打分要用它，view 只是引用同一份。
  var SPIDER_LEGS = global.Battlefield.SPIDER_LEGS;

  var STEP_TRIG = 4.5;    // 末端被拖出理想落点多远才换步（精灵像素）
  var STEP_DUR = 0.16;    // 一次换步耗时（秒）
  var STEP_CD = 0.06;     // 换步后冷却，避免刚落地又弹起来
  var WAIT_GAIN = 30;     // 等待时长加权：每等 1 秒相当于偏差多 30 世界像素。
                          // 没有它就会出现「偏差大的腿永远赢」—— 朝上的腿因
                          // SQUASH_Y 压缩、理想距离只有 60，偏差天然小，会一直抢不到名额。
  var OVERSHOOT = 0.45;   // 迈步过冲：脚往前多踏一点以衔接下一步
  var LIFT_RATIO = 0.32;  // 抬脚高度 / 步幅（程序化走路用 0.8，这里收敛以免像踢正步）
  /* ---- 骨骼链：每条触手 = TENT_SEGS 段等长骨骼 ----
     总长 = SEGS x SEG_LEN 就是「能伸多远」的硬上限。骨骼长度守恒，
     不像贝塞尔那样被无声地拉长 —— 主人最早提的「控制可伸长距离」正解在此。
     站立展开半径 = LEG_SPREAD x k = 32 x 3 = 96，总长留到 108 才有点余量卷曲；
     余量为 0 时整条绷直，余量越大卷得越紧。 */
  var TENT_SEGS = 6;        // 骨骼段数（6 段够卷，再多的段在这个尺度下看不出来）
  var TENT_SEG_LEN = 18;    // 每段长度（世界像素）
  var TENT_TOTAL = TENT_SEGS * TENT_SEG_LEN;  // 108 —— 逻辑层与渲染层共用的同一个数
  var CURL_MAX = 0.55;      // 完全松弛时每段卷曲角（弧度）—— 决定卷得多紧
  var CURL_BREATH = 0.10;   // 呼吸项：静止时也轻轻动，不像塑料模型
  var CURL_HAND = 1;        // 卷曲手性（+1 右旋 / -1 左旋）
  var S_WAVE = 1.0;         // S 形的波数：1 = 一次反弯。调到 2 会变成波浪形
  var TILT_GAIN = 0.0016;   // 纵向速度(px/s) → 身体倾角(弧度)
  var TILT_MAX = 0.20;      // 倾角上限 ≈ 11°，再大就不像蜘蛛像陀螺
  var TILT_LERP = 6;        // 倾角平滑速度（1/秒），避免 pull 瞬间甩过头
  // FABRIK 迭代次数。**故意不收敛**：迭代越多链越直、卷曲被抹平；
  // 3 次刚好把末端拽到目标附近，又保留大部分卷曲形状。
  var FABRIK_ITERS = 3;
  var PIX_SUB = 4;          // 每段之间插几个方块（太少会断成一粒粒）

  var LEG_REACH = TENT_TOTAL;   // 舒适长度 = 骨骼总长，与渲染同源
  var SAG_BODY = 15;      // 支撑腿全丢时的身体下沉量（世界像素 @ sc2=3）
  var REACH_N = 3;        // 抓取用几条腿
  var WID_FAR = 3.2;      // 远侧触手根部粗细（精灵像素）—— 加粗过：原来 1.9 撑不住身体
  var WID_NEAR = 3.8;     // 近侧触手根部粗细（精灵像素）
  var PIX_TIP = 0.8;      // 触手尖端粗细（精灵像素）
  // 触手长度硬上限由骨骼链决定（TENT_TOTAL），不再单独设 LIMB_MAX。
  var ROOT_SPREAD = 0;        // 已停用：根点分散反而强化分离感，统一用身体中心
  // 辐射半径与纵向压缩取自逻辑层（世界像素），这里换算成精灵像素 —— 同源，
  // 否则「逻辑算的落点」和「画出来的腿」会各走各的。
  var LEG_SPREAD = global.Battlefield.SPIDER_LEG_SPREAD / 3;
  var SQUASH_Y = global.Battlefield.SPIDER_SQUASH_Y;
  var _LEG_UNUSED = 0;      // 4 向辐射时半径要够大：身体半宽 48 / 半高 39，
                            // 108(世界) 让 8 条都伸出身体轮廓，腿才看得见—— 端点 = 身体中心 + 半径·(cos, sin)。
                             // 要够大：身体半宽 51 / 半高 39，半径 96(世界) 时连最"斜"的腿
                             // （105°/255°，纵向位移 51）都超出身体轮廓，8 条才都看得见。

  function _lerp(a, b, t) { return a + (b - a) * t; }
  /** S 形缓动（参考程序化走路的 EaseInOutCubic） */
  function _easeInOut(x) { return 1 / (1 + Math.exp(-10 * (x - 0.5))); }

  /**
   * 触手长度硬上限：够不着就是够不着，末端只能停在极限处。
   * 这是「肌肉」和「橡皮筋」的分界 —— 橡皮筋能无限拉长，肌肉不能。
   * 返回截断后的坐标，没超长则返回 null。
   */
  function _capLen(x0, y0, x1, y1, maxLen) {
    var dx = x1 - x0, dy = y1 - y0;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d <= maxLen || d < 0.001) return null;
    return [x0 + dx / d * maxLen, y0 + dy / d * maxLen];
  }

  /**
   * FABRIK（Forward And Backward Reaching IK）—— 骨骼 + IK 那一层。
   * j[0] = 根（钉在身体上），j[n-1] = 末端（够向目标）。每轮两趟：
   *   Backward —— 先把末端放到 target，再从末端往根依次把每段拉回 segLen
   *   Forward  —— 再把根放回原位，从根往末端依次拉回 segLen
   * 两趟都只改方向不改长度，于是整条链**长度守恒**。
   * 目标超出总长时末端只能停在链能到的极限处 —— 够不着就是够不着，
   * 这正是肌肉与橡皮筋的分界。
   */
  function _fabrik(j, tx, ty, segLen, iters) {
    var n = j.length, i, it, dx, dy, d, r;
    var rx = j[0][0], ry = j[0][1];
    for (it = 0; it < iters; it++) {
      // Backward：末端 -> 目标
      j[n - 1][0] = tx; j[n - 1][1] = ty;
      for (i = n - 2; i >= 0; i--) {
        dx = j[i][0] - j[i + 1][0]; dy = j[i][1] - j[i + 1][1];
        d = Math.sqrt(dx * dx + dy * dy); if (d < 0.0001) d = 0.0001;
        r = segLen / d;
        j[i][0] = j[i + 1][0] + dx * r;
        j[i][1] = j[i + 1][1] + dy * r;
      }
      // Forward：根 -> 原位
      j[0][0] = rx; j[0][1] = ry;
      for (i = 1; i < n; i++) {
        dx = j[i][0] - j[i - 1][0]; dy = j[i][1] - j[i - 1][1];
        d = Math.sqrt(dx * dx + dy * dy); if (d < 0.0001) d = 0.0001;
        r = segLen / d;
        j[i][0] = j[i - 1][0] + dx * r;
        j[i][1] = j[i - 1][1] + dy * r;
      }
    }
  }

  /**
   * 一条触手 = 骨骼链 + FABRIK IK + 像素化渲染。三层互不干涉，正是雨世界的组合：
   *   骨骼 + IK  -> 算关节位置（长度守恒，够不着就是够不着）
   *   程序化动画 -> 在上一帧姿态上叠卷曲 + 呼吸，驱动骨骼
   *   像素化渲染 -> 沿关节链画对齐网格的方块，与游戏整体像素风一致
   *
   * 卷曲为什么交给骨骼而不是对数螺旋：严格等角螺旋 r = a·e^(bθ) 只有 3 个自由度
   * （中心 C + a + b），却要同时满足 4 个端点约束（rx, ry, tx, ty），无解。
   * 试过整条触手做一段等角螺旋，因 R/T 间距远大于中心偏移，基础夹角接近 π，
   * 再叠 turns·2π 直接卷成圈 —— 翻车两次，遂放弃。骨骼链的卷曲是「每段多转一点
   * 沿链累积」，同样得到螺旋形，但端点交给 IK 保证，不需要解方程。
   */
  function _limb(ctx, x0, y0, x1, y1, wid, colBase, colTip, k, br, dir, hand, leg, shape) {
    var dx = x1 - x0, dy = y1 - y0;
    var dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
    // 松弛度：目标比骨骼总长短多少。差得多 = 有余量 = 卷；刚好 = 绷直。
    var slack = M.clamp(1 - dist / TENT_TOTAL, 0, 1);

    // 关节链：j[0] = 根，j[TENT_SEGS] = 末端。缓存在 leg 上跨帧保留。
    // 跨帧是关键 —— 卷曲要在**上一帧的姿态**上继续转，这才是软体；
    // 每帧从直线重算就成了会闪的折线。
    var j = leg && leg.joints;
    if (!j || j.length !== TENT_SEGS + 1) {
      j = [];
      for (var q = 0; q <= TENT_SEGS; q++) {
        j.push([x0 + dx * (q / TENT_SEGS), y0 + dy * (q / TENT_SEGS)]);
      }
      if (leg) leg.joints = j;
    }
    j[0][0] = x0; j[0][1] = y0;          // 根永远钉在身体上

    // 卷曲（动画层驱动骨骼）：每段相对前一段多转 curl，沿链累积成弧。
    // curl 随 slack 增大 —— 越够得着越卷，越够不着越直。这是雨世界那股劲的来源。
    // reach 腿刚直指锚点 —— 卷曲会让 3 条抓取腿拧成一束。
    // hand 让相邻两条腿反方向卷，避免 8 条腿全朝同一手性。
    var skipCurl = leg && leg.reach;
    if (slack > 0.02 && !skipCurl) {
      var curl = (CURL_MAX * slack + Math.sin(br) * CURL_BREATH) * (CURL_HAND * hand);
      for (var i = 1; i <= TENT_SEGS; i++) {
        var vx = j[i][0] - j[i - 1][0], vy = j[i][1] - j[i - 1][1];
        var vd = Math.sqrt(vx * vx + vy * vy); if (vd < 0.0001) vd = 0.0001;
        var ux = vx / vd * TENT_SEG_LEN, uy = vy / vd * TENT_SEG_LEN;
        // S 形：卷曲角沿链由 +curl 渐变到 -curl（cos(t·π) 中段过零）→ 反弯成 S。
        // 全链同号（shape=0）只能卷出一段圆弧；交替符号才有软体触手那股扭劲。
        var tt = (i - 0.5) / TENT_SEGS;
        var ci = shape ? curl * Math.cos(tt * Math.PI * S_WAVE) : curl;
        var ca = Math.cos(ci), sa = Math.sin(ci);
        j[i][0] = j[i - 1][0] + ux * ca - uy * sa;
        j[i][1] = j[i - 1][1] + ux * sa + uy * ca;
      }
    }

    // IK：末端拽向目标，各段长度守恒。够不着 -> 末端停在链能到的极限处。
    _fabrik(j, x1, y1, TENT_SEG_LEN, FABRIK_ITERS);

    // 像素化（渲染层）：沿关节链插值画对齐网格的方块，根粗尖细。
    // 两遍 pass —— 先铺一圈描边，再填本体；分开画描边才只露在外轮廓，
    // 逐块各镶一圈会变成格子布。描边色与身体精灵的 outline 同色。
    var n = j.length;
    var wRoot = wid, wTip = PIX_TIP * k, outW = TENT_OUT_W * k;
    var pass, a, sp, f, t, bx, by, sz;
    for (pass = 0; pass < 2; pass++) {
      ctx.fillStyle = pass === 0 ? TENT_OUTLINE : colBase;
      for (a = 0; a < n - 1; a++) {
        for (sp = 0; sp < PIX_SUB; sp++) {
          f = sp / PIX_SUB;
          t = (a + f) / (n - 1);
          bx = j[a][0] + (j[a + 1][0] - j[a][0]) * f;
          by = j[a][1] + (j[a + 1][1] - j[a][1]) * f;
          sz = wRoot + (wTip - wRoot) * t + (pass === 0 ? outW : 0);
          ctx.fillRect(Math.round(bx - sz * 0.5), Math.round(by - sz * 0.5),
            Math.round(sz), Math.round(sz));
        }
      }
    }
  }

  function BattleView(bf, region) {
    this.bf = bf;
    this.region = region;
    this.t = 0;
    this.laneGrass = [];
    for (var i = 0; i < 40; i++) {
      this.laneGrass.push({ x: Math.random(), y: Math.random(), s: 0.6 + Math.random() * 0.8 });
    }
  }

  // _dt 供触手淡出计时用（淡出要按真实时间推进，不能挂在帧数上）
  BattleView.prototype.update = function (dt) {
    this.t += dt;
    this._dt = dt;
    this._f = (this._f || 0) + 1;
  };

  /** 屏幕形状变化：整个渲染都基于 region，换掉即可（无敌方状态需要迁移） */
  BattleView.prototype.relayout = function (region) { this.region = region; };

  /* ---------------- 障碍物（编辑器注入，已带地面几何） ---------------- */

  /** 走一遍多边形路径 */
  function polyPath(ctx, pts, dy) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y - (dy || 0));
    for (var k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y - (dy || 0));
    ctx.closePath();
  }

  /** 提亮（amt > 0）或压暗（amt < 0）一个 #rrggbb */
  function shade(hex, amt) {
    var n = parseInt(hex.slice(1), 16);
    var f = function (v) {
      return Math.max(0, Math.min(255, Math.round(amt > 0 ? v + (255 - v) * amt : v * (1 + amt))));
    };
    return 'rgb(' + f((n >> 16) & 255) + ',' + f((n >> 8) & 255) + ',' + f(n & 255) + ')';
  }

  /**
   * 画一个障碍物。
   * 2.5D 关闭时走正交分支（与历史逐位一致）；开启时按 o.topZ 挤出立体：
   * 地面落影 → 朝向观察者的侧面 → 顶面。侧面只画质心下方那些边，
   * 背面的挤出体天然被顶面盖住，不需要真正的隐藏面消除。
   */
  BattleView.prototype._obstacle = function (ctx, o) {
    var bf = this.bf;
    if (o.applied === false) return;
    var meta = OBST_COLORS[o.kind] || OBST_COLORS.rock;
    var poly = o.poly;
    if (!poly || poly.length < 3) return;

    // 地面轮廓：过一遍深度投影（开关关闭时是恒等）
    var base = [], k;
    for (k = 0; k < poly.length; k++) base.push({ x: bf.projX(poly[k].x, o.v), y: poly[k].y });

    ctx.save();
    if (!bf.cfg.depth25d) {
      ctx.globalAlpha = 0.94;
      polyPath(ctx, base);
      ctx.fillStyle = meta.color; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = meta.edge; ctx.stroke();
      // 顶面高光（取前两个顶点构成的边，向中心收一点）
      ctx.globalAlpha = 0.22;
      ctx.beginPath();
      ctx.moveTo(base[0].x, base[0].y);
      ctx.lineTo(base[1].x, base[1].y);
      ctx.lineTo((base[1].x + base[2].x) / 2, (base[1].y + base[2].y) / 2);
      ctx.lineTo((base[0].x + base[3].x) / 2, (base[0].y + base[3].y) / 2);
      ctx.closePath();
      ctx.fillStyle = '#ffffff'; ctx.fill();
      ctx.restore();
      return;
    }

    var hz = o.topZ || 0;
    var cy = 0;
    for (k = 0; k < base.length; k++) cy += base[k].y;
    cy /= base.length;

    // 落影：随高度往右下偏，越高影子越远，这是高度感的主要来源
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    for (k = 0; k < base.length; k++) {
      var sx = base[k].x + hz * 0.20, sy = base[k].y + hz * 0.05;
      if (k === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    }
    ctx.closePath(); ctx.fill();

    // 侧面：只画质心下方的边（朝向观察者）
    ctx.globalAlpha = 1;
    for (k = 0; k < base.length; k++) {
      var a = base[k], b = base[(k + 1) % base.length];
      if ((a.y + b.y) / 2 < cy) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(b.x, b.y - hz);
      ctx.lineTo(a.x, a.y - hz);
      ctx.closePath();
      ctx.fillStyle = shade(meta.color, -0.34);
      ctx.fill();
    }

    // 顶面
    polyPath(ctx, base, hz);
    ctx.fillStyle = shade(meta.color, 0.20);
    ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = meta.edge; ctx.stroke();
    ctx.restore();
  };

  /** 批量绘制全部障碍物（独立调用用，如编辑器预览） */
  BattleView.prototype._obstacles = function (ctx) {
    var bf = this.bf;
    if (!bf.obstacles || !bf.obstacles.length) return;
    for (var i = 0; i < bf.obstacles.length; i++) this._obstacle(ctx, bf.obstacles[i]);
  };

  /** 车道带的梯形路径。返回 false 表示开关关闭，调用方退回矩形。 */
  BattleView.prototype._trap = function (ctx, bf, yT, yB, vTop, vBot) {
    if (!bf.cfg.depth25d) return false;
    var wT = bf.cfg.w * bf.depthScale(vTop);
    var wB = bf.cfg.w * bf.depthScale(vBot);
    var cx = bf._cx;
    ctx.beginPath();
    ctx.moveTo(cx - wT / 2, yT);
    ctx.lineTo(cx + wT / 2, yT);
    ctx.lineTo(cx + wB / 2, yB);
    ctx.lineTo(cx - wB / 2, yB);
    ctx.closePath();
    return true;
  };

  BattleView.prototype.draw = function (ctx, fx) {
    var bf = this.bf, R = this.region;
    ctx.save();
    ctx.beginPath(); ctx.rect(R.x, R.y, R.w, R.h); ctx.clip();

    this._bg(ctx, R);
    this._slots(ctx);
    this._node(ctx);

    // 按 y 排序，保证前后遮挡正确。障碍物也入列 —— 它有高度，
    // 应该挡住它后面的单位，否则会出现敌人「穿过」岩石的穿帮。
    var ents = [];
    for (var i = 0; i < bf.enemies.length; i++) ents.push({ y: bf.enemies[i].y, o: bf.enemies[i], k: 'e' });
    for (var j = 0; j < bf.plants.length; j++) ents.push({ y: bf.plants[j].y, o: bf.plants[j], k: 'p' });
    for (var m = 0; m < bf.obstacles.length; m++) {
      var ob = bf.obstacles[m];
      if (ob.applied === false) continue;
      ents.push({ y: ob.cy, o: ob, k: 'o' });
    }
    ents.sort(function (a, b) { return a.y - b.y; });
    for (var q = 0; q < ents.length; q++) {
      var it = ents[q];
      if (it.k === 'e') this._enemy(ctx, it.o);
      else if (it.k === 'o') this._obstacle(ctx, it.o);
      else this._plant(ctx, it.o);
    }

    this._projectiles(ctx);
    if (fx) fx.draw(ctx);
    this._topbar(ctx, R);
    ctx.restore();
  };

  /* ---------------- 背景与地块 ---------------- */
  BattleView.prototype._bg = function (ctx, R) {
    var bf = this.bf;
    var g = ctx.createLinearGradient(0, R.y, 0, R.y + R.h);
    g.addColorStop(0, '#2c4a34');
    g.addColorStop(0.45, '#3c6440');
    g.addColorStop(1, '#2a4630');
    ctx.fillStyle = g;
    ctx.fillRect(R.x, R.y, R.w, R.h);

    // 三条行进道。2.5D 开启时是梯形（远窄近宽），越出战场的部分由外层 clip 裁掉 ——
    // 近处地面延伸出视野本就是正确的透视表现。
    for (var i = 0; i < bf.cfg.lanes; i++) {
      var y = bf.laneY(i);
      var h = bf.laneH;
      var yT = y - h / 2 + 6, yB = y + h / 2 - 6;
      ctx.save();
      var lg = ctx.createLinearGradient(0, yT, 0, yB);
      lg.addColorStop(0, 'rgba(255,255,255,.045)');
      lg.addColorStop(0.5, 'rgba(255,255,255,.10)');
      lg.addColorStop(1, 'rgba(0,0,0,.16)');
      ctx.fillStyle = lg;
      if (this._trap(ctx, bf, yT, yB, i - 0.5, i + 0.5)) ctx.fill();
      else ctx.fillRect(R.x, yT, R.w, yB - yT);
      // 边缘线
      ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 1;
      ctx.beginPath();
      var wT = R.w * bf.depthScale(i - 0.5);
      ctx.moveTo(bf._cx - wT / 2, yT); ctx.lineTo(bf._cx + wT / 2, yT);
      ctx.stroke();
      ctx.restore();
    }

    // 草丛点缀
    ctx.save();
    for (var k = 0; k < this.laneGrass.length; k++) {
      var gr = this.laneGrass[k];
      var gy = R.y + 18 + gr.y * (R.h - 34);
      var gv = bf._vOfY(gy);
      var gx = bf.projX(R.x + gr.x * R.w, (gv == null ? (bf.cfg.lanes - 1) / 2 : gv));
      var sway = Math.sin(this.t * 1.4 + k) * 1.6;
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = '#a8e87a';
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.quadraticCurveTo(gx + 2 * gr.s, gy - 7 * gr.s, gx + sway, gy - 12 * gr.s);
      ctx.quadraticCurveTo(gx + 4 * gr.s, gy - 6 * gr.s, gx + 3 * gr.s, gy);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();

    // 右侧来敌方向的暗角
    var vg = ctx.createLinearGradient(R.x + R.w - 120, 0, R.x + R.w, 0);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,.30)');
    ctx.fillStyle = vg;
    ctx.fillRect(R.x + R.w - 120, R.y, 120, R.h);
  };

  BattleView.prototype._slots = function (ctx) {
    var bf = this.bf;
    for (var l = 0; l < bf.cfg.lanes; l++) {
      var lds = bf.depthScale(l);
      var lhw = bf.cellW * 0.36 * lds;
      for (var c = 0; c < bf.cfg.cols; c++) {
        var x = bf.projX(bf.slotX(c), l), y = bf.slotY(l);
        var occupied = bf.plants.some(function (p) { return p.lane === l && p.col === c; });
        ctx.save();
        ctx.globalAlpha = occupied ? 0.10 : 0.22;
        ctx.strokeStyle = '#cfe8b0'; ctx.lineWidth = 1.4;
        ctx.setLineDash([4, 4]);
        global.roundRect(ctx, x - lhw, y - 16, lhw * 2, 34, 8);
        ctx.stroke();
        ctx.restore();
      }
    }
  };

  /* ---------------- 星枢 ---------------- */
  BattleView.prototype._node = function (ctx) {
    var bf = this.bf, R = this.region;
    // 星枢横跨所有车道，取中间车道做横向投影；大小不随深度缩 —— 它是关键 UI，要始终醒目
    var x = bf.projX(R.x + bf.cfg.nodeX, (bf.cfg.lanes - 1) / 2), y = R.y + R.h / 2;
    var pulse = 0.5 + 0.5 * Math.sin(this.t * 2.2);
    var hpR = M.clamp(bf.nodeHp / bf.nodeMax, 0, 1);
    var hit = bf.nodeHitT > 0 ? bf.nodeHitT / 0.4 : 0;

    ctx.save();
    // 底座
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.beginPath(); ctx.ellipse(x, y + 52, 34, 11, 0, 0, Math.PI * 2); ctx.fill();

    // 光晕
    var gl = ctx.createRadialGradient(x, y - 6, 4, x, y - 6, 74);
    gl.addColorStop(0, 'rgba(150,220,255,' + (0.55 + pulse * 0.25) + ')');
    gl.addColorStop(0.5, 'rgba(90,160,255,.22)');
    gl.addColorStop(1, 'rgba(90,160,255,0)');
    ctx.fillStyle = gl;
    ctx.beginPath(); ctx.arc(x, y - 6, 74, 0, Math.PI * 2); ctx.fill();

    // 水晶主体
    ctx.translate(x, y - 6);
    if (hit > 0) { ctx.translate((Math.random() - 0.5) * hit * 8, (Math.random() - 0.5) * hit * 8); }
    var r = 26 + pulse * 2.4;
    ctx.beginPath();
    for (var i = 0; i < 6; i++) {
      var a = -Math.PI / 2 + i * Math.PI / 3;
      var rr = i % 2 === 0 ? r : r * 0.74;
      var px = Math.cos(a) * rr, py = Math.sin(a) * rr * 1.22;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    var cg = ctx.createLinearGradient(0, -r, 0, r);
    cg.addColorStop(0, '#cdefff'); cg.addColorStop(0.55, '#6fb6f5'); cg.addColorStop(1, '#2f6ec0');
    ctx.fillStyle = cg; ctx.fill();
    ctx.strokeStyle = hit > 0 ? '#ff8f8f' : 'rgba(255,255,255,.75)';
    ctx.lineWidth = hit > 0 ? 3 : 2; ctx.stroke();
    // 内核
    ctx.beginPath(); ctx.arc(0, 0, r * 0.34 * (1 + pulse * 0.12), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,' + (0.7 + pulse * 0.3) + ')'; ctx.fill();
    ctx.restore();

    // HP 条
    ctx.save();
    var bw = 76, bx = x - bw / 2, by = y + 60;
    global.roundRect(ctx, bx, by, bw, 9, 4);
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fill();
    global.roundRect(ctx, bx, by, bw * hpR, 9, 4);
    var hg = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    hg.addColorStop(0, '#7fe0a0'); hg.addColorStop(0.6, '#5ec8ff'); hg.addColorStop(1, '#8f9dff');
    ctx.fillStyle = hg; ctx.fill();
    ctx.font = '800 10px system-ui, sans-serif';
    ctx.fillStyle = '#eaf7ff'; ctx.textAlign = 'center';
    ctx.fillText('星枢 ' + Math.ceil(bf.nodeHp) + '/' + bf.nodeMax, x, by + 22);
    ctx.restore();
  };

  /* ---------------- 植物 ---------------- */
  BattleView.prototype._plant = function (ctx, p) {
    // ★ 培育植物走 PetArt（Q 版精灵），普通植物走 PlantArt。
    //   两者 KIND 表的键不互通 —— 拿错表会读到 undefined.scale 直接抛错白屏。
    var isPet = !!p.petId;
    var Art = isPet ? global.PetArt.Art : global.PlantArt.Art;
    var kindTable = isPet ? global.PetArt.KIND : global.PlantArt.KIND;
    var def = global.Battlefield.PLANTS[p.kind];
    var r = p.anim.render();
    var baseSc = ((kindTable[p.kind] && kindTable[p.kind].scale) || 3);
    // 显示调整层（编辑器注入）：覆盖缩放、加偏移
    var disp = (this.bf && this.bf.dispGet) ? this.bf.dispGet('plants', p.kind, 'L' + p.lane + 'C' + p.col) : null;
    var sc = (disp && disp.scale != null) ? disp.scale : baseSc;
    var ox = disp ? (disp.ox || 0) : 0, oy = disp ? (disp.oy || 0) : 0;
    // 2.5D：横向按深度收缩 + 精灵按深度缩放（开关关闭时 ds = 1，与正交逐位一致）
    var pv = (p.v === undefined ? p.lane : p.v);
    var ds = this.bf.depthScale(pv);
    var sc2 = sc * ds;
    var dx = this.bf.projX(p.x + ox, pv), dy = p.y + oy;

    ctx.save();
    // 落地阴影
    P.shadow(ctx, dx, dy + 4, 16 * sc2 / 3 * 0.9, 5 * sc2 / 3 * 0.9, 0.24);

    // 出生弹出
    var born = M.ease.outBack(M.clamp(p.born, 0, 1));
    ctx.translate(dx, dy);
    ctx.scale(born, born);
    ctx.translate(-dx, -dy);

    var lean = r.lean + (p.anim.isFiring() && p.kind === 'peashooter' ? -0.05 : 0);
    P.draw(ctx, r.sprite, dx, dy + r.bob, {
      frame: r.frame, scale: sc2, lean: lean, squash: r.squash,
      flash: p.evolving > 0 ? p.evolving * 0.8 : 0
    });

    // 进化光环
    if (p.evolving > 0) {
      ctx.globalAlpha = p.evolving;
      ctx.strokeStyle = '#d8ffc0'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(dx, dy - 18, 30 * ds * (1.2 - p.evolving * 0.4), 14 * ds * (1.2 - p.evolving * 0.4), 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  };

  /* ---------------- 敌人 ---------------- */

  /**
   * 解算 8 条腿 + 画出远侧 4 条（被身体压住）。返回 rig 交给 _spiderRigNear 收尾。
   * 必须在身体之前调用。坐标基准取自 _enemy 的 P.draw(ctx, spr, 0, 6, …)：
   * 图像画在 (-anchorX, -h)，故底部落在 ey+6、anchorX 处落在 ex —— 腿要落在
   * 这条线上，否则要么踩空要么陷进地里。
   */
  BattleView.prototype._spiderRig = function (ctx, e, ex, ey, sc2) {
    var Art = global.InsectArt.Art;
    var spr = Art.spiderBody || Art.spider;
    var k = sc2;                                  // 精灵 1px = sc2 世界像素
    var dt = this._dt || 0;
    var ax0 = spr.anchorX, sh = spr.h;
    // 描边会让位图比绘制尺寸大一圈（32x24 → 34x26），差的一半就是内容偏移。
    // 漏掉它，整条腿会系统性偏 1 个精灵像素。
    var padX = (spr.w - 32) * 0.5, padY = (spr.h - 24) * 0.5;
    var wx = function (sx) { return ex + (sx + padX - ax0) * k; };
    var wy = function (sy) { return ey + 6 + (sy + padY - sh) * k; };

    var CX = 32 * 0.42, CY = 24 * 0.50;           // 头胸中心（同 drawSpider）
    var ev = (e.v === undefined ? e.lane : e.v);
    // 顶视：8 条腿以身体中心为原点向四周辐射，没有"地面线"概念。
    // 落点 = 身体中心 + 半径·(cos(dir), sin(dir)·纵向压缩)。
    // 展开半径 24 精灵像素 ≈ 72 世界（> 身体半宽 48），8 条都伸出身体轮廓。
    // swingX 在 pull 时给身体一个钟摆感 —— 整个身体横向晃，腿跟着摆。
    var i;

    // ---- 容器 + 回收（蜘蛛一死就走 dead 分支提前 return，只能用帧号兜底）----
    if (!this._tent) this._tent = {};
    var f = this._f || 0, id;
    for (id in this._tent) if (f - this._tent[id].f > 2) delete this._tent[id];
    var S = this._tent[e.id];
    if (!S) {
      S = { f: f, has: false, x: 0, y: 0, v: 0, legs: [], rot: 0, py: 0, pin: false };
      for (i = 0; i < 8; i++) {
        // lt:换步进度  cd:落地冷却  (fx,fy)起点 (mx,my)抬脚中点 (tx,ty)落点
        S.legs.push({
          px: 0, py: 0, lt: 0, cd: 0,
          fx: 0, fy: 0, mx: 0, my: 0, tx: 0, ty: 0,
          rx: 0, ry: 0, init: false,
          wait: SPIDER_LEGS[i].ph * 0.25,     // 开局就错开，别八条一起抢
          idealX: 0, idealY: 0, reach: 0      // 后三个是两阶段之间的传值槽
        });
      }
      this._tent[e.id] = S;
    }
    S.f = f;

    // 锚点快照：_updateSpider 在 pull 完成那帧立刻清 e.anchor，留一份才不会硬切
    var a = e.anchor;
    if (a) { S.x = a.x; S.y = a.y; S.v = (a.v === undefined ? ev : a.v); S.has = true; }
    else S.has = false;

    // ---- 挑哪几条腿去抓 ----
    // 只按水平距离排会让最靠近锚点那一侧的腿永远中选（表现就是「总是前三条」）。
    // 改成按根部到锚点的真实距离打分，再掺一点随时间变化的抖动，
    // 于是同一目标下每次伸出的组合也不尽相同。
    var reach = [0, 0, 0, 0, 0, 0, 0, 0], reachN = 0, axw = 0, ayw = 0;
    if (S.has && (e.state === 'grapple' || e.state === 'pull')) {
      axw = this.bf.projX(S.x, S.v); ayw = S.y;
      var bodyY = wy(CY), order = [0, 1, 2, 3, 4, 5, 6, 7], cost = [];
      // 用**端点**到锚点的距离打分（根点都一样，看谁的方向能最快伸到锚点）
      for (i = 0; i < 8; i++) {
        var lx = bodyCx + Math.cos(SPIDER_LEGS[i].dir) * spread;
        var ly = bodyCy + Math.sin(SPIDER_LEGS[i].dir) * spread * SQUASH_Y;
        var ddx = lx - axw, ddy = ly - ayw;
        cost.push(Math.sqrt(ddx * ddx + ddy * ddy) +
          Math.sin(this.t * 1.7 + SPIDER_LEGS[i].ph * 3) * 7);
      }
      order.sort(function (p, q) { return cost[p] - cost[q]; });
      for (i = 0; i < REACH_N; i++) { reach[order[i]] = 1; reachN++; }
    }

    // ---- 重力：支撑腿越少，身体越沉（下沉 + 压扁）----
    // 这是「肢体是负担」最直接的体现：伸出去抓东西的腿不再撑着身体。
    var load = reachN / 8, sag = 0, squash = 1;
    if (e.state === 'grapple' && reachN > 0) {
      sag = Math.pow(load, 0.7) * SAG_BODY * (k / 3);
      squash = 1 - load * 0.12;
    }

    // pull：被拽过去的「摆荡 + 落地冲击」。
    // 逻辑层用 smoothstep 插值（两端慢中间快），观感就是「平滑滑过去」；
    // 表现层补上被拽的顿挫：中段左右摆荡、落地砸一下。
    var swingX = 0;
    if (e.state === 'pull') {
      var gp = M.clamp(e.gp || 0, 0, 1);
      swingX = Math.sin(gp * Math.PI * 2.2 + e.id * 1.3) * 2.0 * (k / 3) * (1 - gp * 0.65);
      if (gp > 0.80) squash = 1 - (gp - 0.80) / 0.20 * 0.18;
    }

    // ---- 身体随牵引方向轻微旋转（顶视偏航）----
    // 被触手拽着走的时候，躯干会朝移动方向微微扭转；完全不转的躯干看着像
    // 「一张贴纸滑过去」。取纵向速度 → 目标倾角，一阶平滑 + 限幅，防止 pull 甩过头。
    // 只转躯干：腿是绝对世界坐标、在 translate 之前就画完了，不跟着转 —— 顶视下
    // 脚钉在地上、身体在上面扭，本来就该这样。
    var vyRaw = 0;
    if (S.pin) vyRaw = (e.y - S.py) / Math.max(dt, 0.0005);
    S.py = e.y; S.pin = true;
    var tiltT = M.clamp(vyRaw * TILT_GAIN, -TILT_MAX, TILT_MAX);
    S.rot += (tiltT - S.rot) * Math.min(1, dt * TILT_LERP);

    // 顶视：8 条腿以身体中心为原点向四周辐射。身体中心要在 sag/swingX 都算出后再取，
    // 否则 bodyCx = NaN、所有腿落点失效、整只蜘蛛看起来只剩身体。
    var bodyCx = wx(CX) + swingX, bodyCy = wy(CY) + sag;
    var spread = LEG_SPREAD * k;
    // 与渲染层的骨骼链同源：触手到底能伸多远，两边必须是同一个数，
    // 否则会出现「逻辑认为够得着、画出来却差一截」的错位。
    var maxLen = TENT_TOTAL;
    // 同组一次只允许一条腿在迈步，否则会像跳。名额分配见循环后的第二阶段。
    var cand = [];

    for (i = 0; i < 8; i++) {
      var lg = SPIDER_LEGS[i], leg = S.legs[i];
      leg.reach = 0;          // 默认不抓取（reach 腿刚直、不卷曲）
      // 8 条腿**全部从身体中心**伸出 —— 试过让根点沿身体下沿水平分散（ROOT_SPREAD），
      // 结果 8 个不同的根点看起来像"身体下沿挂了 8 个东西"，反而**强化**分离感。
      // 统一从中心出发才最"一体化"：所有腿共用一个根点，朝下方扇形辐射。
      // 关键：bodyCx/bodyCy **已经**含了 swingX/sag，这里绝不能再加一遍。
      // 身体内容中心到下沿 = 7 精灵（精灵 cy=12、螯肢底 sy=18），
      // 6*k = 18 让根部下到腹部下沿（螯肢附近），被身体盖住。
      // 端部 sin≥0.83 伸出身体下沿 → 视觉上"从身体下沿长出来"。
      // 起点统一在身体中心 —— 身体是不透明的，起点被盖住。
      // 这样 4 向辐射的腿看起来都"从身体内长出来"，没有"从旁边伸出"的违和感。
      var rx = bodyCx, ry = bodyCy;
      leg.rx = rx; leg.ry = ry;

      if (!leg.init) {
        leg.px = bodyCx + Math.cos(lg.dir) * spread;
        leg.py = bodyCy + Math.sin(lg.dir) * spread * SQUASH_Y;
        leg.init = true;
      }

      if (reach[i]) {
        leg.reach = 1;        // 抓取腿：刚直指锚点，不参与卷曲
        // 抓取：末端扑向锚点，但受触手长度硬上限约束 —— 够不着就只伸到极限处
        var cap = _capLen(rx, ry, axw, ayw, maxLen);
        var gx = cap ? cap[0] : axw, gy = cap ? cap[1] : ayw;
        var sp = Math.min(1, dt * (e.state === 'grapple' ? 11 : 24));
        leg.px += (gx - leg.px) * sp;
        leg.py += (gy - leg.py) * sp;
        leg.lt = 0;
      } else if (e.state === 'pull') {
        // 腾空：触手轻微收缩到 0.7×spread 位置 —— 保留辐射感，不全收成一团（鸟巢）。
        // reach 腿在前面的 if 分支抓锚点，不会进这里。
        var tx0 = bodyCx + Math.cos(lg.dir) * spread * 0.7;
        var ty0 = bodyCy + Math.sin(lg.dir) * spread * 0.7 * SQUASH_Y;
        var sp2 = Math.min(1, dt * 7);
        leg.px += (tx0 - leg.px) * sp2;
        leg.py += (ty0 - leg.py) * sp2;
        leg.lt = 0;
      } else {
        // 落点取逻辑层 per-foot 打分的结果（e.footPlan[i]，世界坐标）。
        // 以前这里是「身体中心 + 几何辐射」，腿只会机械地回到固定位置；
        // 现在会绕开火力、够向残血，同时被 spread 项拴在自己的扇区里。
        // 打分还没跑出来时（刚生成那一帧）退回几何理想点。
        var fp = e.footPlan && e.footPlan[i];
        var idealX = fp ? fp.x : (bodyCx + Math.cos(lg.dir) * spread);
        var gy0 = fp ? fp.y : (bodyCy + Math.sin(lg.dir) * spread * SQUASH_Y);
        if (leg.lt > 0) {
          leg.lt -= dt / STEP_DUR;
          if (leg.lt <= 0) {
            leg.lt = 0; leg.px = leg.tx; leg.py = leg.ty; leg.cd = STEP_CD;
            leg.wait = 0;                       // 刚落过地，重新排队
          }
          else {
            // 抬脚走二次贝塞尔 Lerp(Lerp(s,m,t), Lerp(m,e,t), t)，mid 点已上抬
            var eu = _easeInOut(1 - leg.lt);
            var sx = _lerp(leg.fx, leg.mx, eu), sy = _lerp(leg.fy, leg.my, eu);
            var ex = _lerp(leg.mx, leg.tx, eu), ey2 = _lerp(leg.my, leg.ty, eu);
            leg.px = _lerp(sx, ex, eu); leg.py = _lerp(sy, ey2, eu);
          }
        } else {
          leg.cd = Math.max(0, (leg.cd || 0) - dt);
          // 着地：末端**真的钉在世界坐标不动**。以前这里有一句把 leg.py 吸回
          // 理想点的插值，注释写着「钉在地面」、做的却是「末端跟着身体走」——
          // 偏差每帧被抹平，迈步永远触发不了，朝上/朝下的腿就成了摆设。
          // 钉住之后，身体一动偏差就积累，换步自然发生。
          // 被拖出阈值、或已经绷到触手长度极限 → 迈一步。
          // 判定必须用**二维距离**：只看 x 的话，dir≈±π/2（正上/正下）的腿
          // 端点几乎只在纵向移动，水平偏差恒≈0 —— 就是「上方三条腿不动」的根因。
          var ddx = idealX - leg.px, ddy = gy0 - leg.py;
          var dist = Math.sqrt(ddx * ddx + ddy * ddy);
          var over = _capLen(rx, ry, leg.px, leg.py, maxLen) !== null;
          leg.wait = (leg.wait || 0) + dt;      // 着地越久越该轮到它
          // 不在这里直接起跳 —— 见下面的两阶段竞争说明。
          if ((dist > STEP_TRIG * k || over) && leg.cd <= 0) {
            leg.idealX = idealX; leg.idealY = gy0;
            // 优先级 = 偏差 + 等待时长×WAIT_GAIN；已经绷到极限的最急，+999 保证排最前
            cand.push({ i: i, d: dist + leg.wait * WAIT_GAIN + (over ? 999 : 0) });
          }
        }
      }
    }

    /* ---- 第二阶段：分配迈步名额 ----
       不能在上面的单腿循环里「先到先得」—— 循环是 i=0..7，抢到名额的腿会立刻
       把本组标记为忙，于是**排在队尾的腿永远抢不到**。实测两条朝上的腿（各组
       第 4 个成员）迈步次数恒为 0、need 却每次都成立，就是这个队尾饥饿。
       改成先收集候选、按偏差降序、每组放行偏差最大的一条：
       最憋不住的腿先动，物理上也对，顺带解决了公平性。 */
    if (cand.length) {
      cand.sort(function (p, q) { return q.d - p.d; });
      var grpTaken = [false, false];
      // 上一帧就在迈步的腿继续占着名额
      for (i = 0; i < 8; i++) if (S.legs[i].lt > 0) grpTaken[SPIDER_LEGS[i].grp] = true;
      for (var c = 0; c < cand.length; c++) {
        var ci = cand[c].i, cl = S.legs[ci];
        if (grpTaken[SPIDER_LEGS[ci].grp]) continue;
        grpTaken[SPIDER_LEGS[ci].grp] = true;
        cl.lt = 1; cl.fx = cl.px; cl.fy = cl.py;
        cl.tx = cl.idealX + (cl.idealX - cl.px) * OVERSHOOT;
        cl.ty = cl.idealY;
        // 抬脚中点：起终点中点再上抬，步幅越大抬得越高。
        // 用二维距离而不是 |dx|+|dy| —— 曼哈顿和会把纵向步幅高估 sqrt2 倍，
        // 朝上/朝下的腿抬脚会夸张地高。
        var sdx = cl.tx - cl.fx, sdy = cl.ty - cl.fy;
        var ss = Math.sqrt(sdx * sdx + sdy * sdy);
        cl.mx = (cl.fx + cl.tx) * 0.5;
        cl.my = (cl.fy + cl.ty) * 0.5 - ss * LIFT_RATIO;
      }
    }

    // 只解算不画。绘制统一在 _spiderRigDrawAll 身体之后做 —— 让 8 条腿都覆盖身体。
    return { sag: sag, squash: squash, legs: S.legs, k: k, bodyCy: bodyCy, bodyCx: bodyCx, rot: S.rot };
  };

  /** 8 条腿统一在身体之后画 —— 顶视下所有腿都从身体向四周伸出覆盖在身上。
   *  远近感由颜色区分（py < bodyCy 用暗色 far，py >= bodyCy 用亮色 near）。 */
  BattleView.prototype._spiderRigDrawAll = function (ctx, rig) {
    // 调用前 _enemy 已 ctx.restore()，这里是干净的画布坐标。L.rx/ry/px/py 是绝对世界坐标。
    var bodyCy = rig.bodyCy, k = rig.k, legs = rig.legs, i, L, lgf;
    for (i = 0; i < 8; i++) {
      L = legs[i]; lgf = SPIDER_LEGS[i];
      var far = (L.py < bodyCy);
      _limb(ctx, L.rx, L.ry, L.px, L.py,
        (far ? WID_FAR : WID_NEAR) * k,
        far ? TENT.far : TENT.near, far ? TENT.far : TENT.tip,
        k, this.t * 2.2 + lgf.ph, lgf.dir, lgf.ch, L, lgf.s);
    }
  };



  BattleView.prototype._enemy = function (ctx, e) {
    var isBee = (e.kind === 'bee' && global.BeeArt);
    var Art = isBee ? global.BeeArt.Art : global.InsectArt.Art;
    var KIND = isBee ? global.BeeArt.KIND : global.InsectArt.KIND;
    var spr = Art[e.kind];
    if (!spr) return;
    var baseSc = (KIND[e.kind].scale || 3) * (e.scale || 1);
    // 显示调整层（编辑器注入）：覆盖缩放、加偏移（e.scale 角色倍率仍保留）
    var disp = (this.bf && this.bf.dispGet) ? this.bf.dispGet('enemies', e.kind, null) : null;
    var sc = (disp && disp.scale != null) ? disp.scale * (e.scale || 1) : baseSc;
    var ox = disp ? (disp.ox || 0) : 0, oy = disp ? (disp.oy || 0) : 0;

    var flash = e.hitT > 0 ? M.clamp(e.hitT / 0.14, 0, 1) : 0;
    var born = M.ease.outBack(M.clamp(e.spawnT, 0, 1));
    // 2.5D：同植物，横向收缩 + 精灵深度缩放
    var ev = (e.v === undefined ? e.lane : e.v);
    var ds = this.bf.depthScale(ev);
    var sc2 = sc * ds;
    var ex = this.bf.projX(e.x + ox, ev), ey = e.y + oy;

    if (e.dead) {
      var u = M.clamp(e.deathT / 0.75, 0, 1);
      ctx.save();
      ctx.globalAlpha = 1 - u;
      ctx.translate(ex, ey);
      ctx.rotate(u * Math.PI * 0.9);
      ctx.scale(1 - u * 0.35, 1 - u * 0.35);
      P.draw(ctx, spr, 0, 8, { frame: e.anim.frame(), scale: sc2, flip: false, squash: 1 - u * 0.3 });
      ctx.restore();
      return;
    }

    // 阴影
    P.shadow(ctx, ex, ey + 5, 13 * sc2 / 3 * (e.scale || 1), 4 * sc2 / 3, 0.26);

    // 蜘蛛：腿与身体拆开画（远侧4 → 身体 → 近侧4）。腿在 _spiderRig 里实时解算，
    // 不走精灵缓存 —— 烤进帧的腿碰不到地面，只能原地摆。
    var rig = null, sagY = 0;
    if (e.kind === 'spider' || e.role === 'spider') {
      rig = this._spiderRig(ctx, e, ex, ey, sc2);
      sagY = rig.sag;
      if (Art.spiderBody) spr = Art.spiderBody;
    }

    // 红火蚁：附加发光（非像素，柔光叠加）
    if (e.kind === 'fireant') {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      var pu = 0.5 + 0.5 * Math.sin(this.t * 6 + e.id);
      var g2 = ctx.createRadialGradient(ex + 6, ey - 6, 1, ex + 6, ey - 6, 26 * ds * (0.8 + pu * 0.3));
      g2.addColorStop(0, 'rgba(255,150,50,' + (0.42 + pu * 0.2) + ')');
      g2.addColorStop(1, 'rgba(255,90,20,0)');
      ctx.fillStyle = g2;
      ctx.beginPath(); ctx.arc(ex + 6, ey - 6, 26 * ds * (0.8 + pu * 0.3), 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // 蜘蛛 8 条腿：画在身体**之前**（腿从身体下缘伸出，被身体覆盖，不盖在身体上）。
    // 放在 ctx.save/translate 之前，用的是干净画布坐标 —— L.rx/ry/px/py 是绝对世界坐标，
    // 若放在 translate 之后会被再平移一次、画到画布外。
    if (rig) this._spiderRigDrawAll(ctx, rig);

    ctx.save();
    ctx.translate(ex, ey);
    ctx.scale(born, born);

    // 身体随牵引方向轻微旋转：绕身体中心转，只转躯干。
    // 腿已在 translate 之前画完（绝对世界坐标），不受影响。
    // 坐标要除以 born —— scale 之后局部坐标是被放大过的。
    if (rig && rig.rot) {
      var rcx = (rig.bodyCx - ex) / born, rcy = (rig.bodyCy - ey) / born;
      ctx.translate(rcx, rcy);
      ctx.rotate(rig.rot);
      ctx.translate(-rcx, -rcy);
    }

    // 受击压扁 + 击退倾斜；蜘蛛再叠一层「支撑变少被压沉」的形变
    var sq = 1 - flash * 0.16;
    if (rig) sq *= rig.squash;
    var lean = flash * 0.12;
    // 状态染色
    var tint = null;
    if (e.slow) tint = '#8fd9ff';
    if (e.root > 0) tint = '#8ee06a';
    if (e.burnT > 0) tint = '#ff9a3c';

    if (isBee) {
      // 蜜蜂：BeeAnimator.render() 驱动悬停浮沉 / 尾针戳击 / 飞走姿态
      var r = e.anim.render();
      ctx.save();
      ctx.globalAlpha = (r.alpha != null) ? r.alpha : 1;
      ctx.translate(r.lunge || 0, r.bob || 0);
      if (r.rot) ctx.rotate(r.rot);
      P.draw(ctx, r.sprite, 0, 6, { frame: r.frame, scale: sc2, flip: false, squash: 1, lean: 0, flash: flash });
      ctx.restore();
    } else {
      // sagY：支撑腿变少时身体真的往下沉一点，不是加特效
      P.draw(ctx, spr, 0, 6 + sagY, {
        frame: e.anim.frame(), scale: sc2, flip: false,
        squash: sq, lean: lean, flash: flash
      });
    }

    // 状态色罩（腿画在 tint 之上：腿用纯色不染色，绝大多数情况无影响；纯色腿更纯净）
    if (tint) {
      ctx.save();
      ctx.globalAlpha = 0.32;
      ctx.globalCompositeOperation = 'lighter';
      ctx.translate(0, 6 + sagY);
      ctx.scale(sc2, sc2 * sq);
      ctx.fillStyle = tint;
      ctx.fillRect(-spr.anchorX, -spr.h, spr.w, spr.h);
      ctx.restore();
    }
    ctx.restore();

    // 血条
    if (e.hp < e.maxHp) {
      var w = 30 * (e.scale || 1) * ds, h = 4;
      var x = ex - w / 2, y = ey - 26 * sc2 / 3 - 4;
      ctx.save();
      global.roundRect(ctx, x, y, w, h, 2);
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fill();
      global.roundRect(ctx, x, y, w * M.clamp(e.hp / e.maxHp, 0, 1), h, 2);
      ctx.fillStyle = e.armor >= 0.2 ? '#ffd06a' : '#ff7d6a'; ctx.fill();
      if (e.armor >= 0.2) {
        ctx.strokeStyle = 'rgba(255,220,140,.9)'; ctx.lineWidth = 1;
        global.roundRect(ctx, x - 0.5, y - 0.5, w + 1, h + 1, 2); ctx.stroke();
      }
      ctx.restore();
    }
  };

  /* ---------------- 投射物 ---------------- */
  BattleView.prototype._projectiles = function (ctx) {
    var bf = this.bf, Art = global.PlantArt.Art;
    for (var i = 0; i < bf.projectiles.length; i++) {
      var pr = bf.projectiles[i];
      // 2.5D：弹丸按当前深度收缩与缩放（开关关闭时恒等）
      var ds = bf.depthScale(pr.v);
      var px = bf.projX(pr.x, pr.v), py = pr.y;
      if (pr.type === 'pea') {
        // 拖尾
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = '#8fe06a'; ctx.lineWidth = 3; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(bf.projX(pr.x - pr.vx * 0.03, pr.v), py - 3); ctx.lineTo(px, py - 3); ctx.stroke();
        ctx.lineCap = 'butt';
        ctx.restore();
        P.draw(ctx, Art.pea, px, py, { frame: 0, scale: 3 * ds, squash: 1 });
      } else if (pr.type === 'seed') {
        // 石榴籽：带余烬微光的小红籽，直线飞行
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = '#ff9a82'; ctx.lineWidth = 2; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(bf.projX(pr.x - pr.vx * 0.03, pr.v), py); ctx.lineTo(px, py); ctx.stroke();
        ctx.lineCap = 'butt';
        ctx.restore();
        P.draw(ctx, Art.seed, px, py, { frame: 0, scale: 3 * ds, squash: 1 });
      } else {
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(pr.rot);
        ctx.scale(3 * ds, 3 * ds);
        ctx.imageSmoothingEnabled = false;
        var fr = Math.floor(Math.abs(pr.rot) * 2) % Art.cabbage.n;
        ctx.drawImage(Art.cabbage.frames[fr], -Art.cabbage.anchorX, -Art.cabbage.h);
        ctx.restore();
        // 落点指示：越过弹道顶点后才显示。
        // 旧实现靠 pr.vy > 0 判断「正在下落」，z 化后 vy 不再积分，改用飞行进度。
        if (pr.arc && pr.t > pr.T * 0.5) {
          ctx.save();
          ctx.globalAlpha = 0.18 + 0.1 * Math.sin(this.t * 12);
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
          ctx.beginPath();
          // 落点在目标车道上，横向也要按目标车道的深度投影，否则圈会和弹丸错开
          ctx.ellipse(bf.projX(pr.x + pr.vx * 0.12, pr.vTo), pr.landY || (py + 20), 20 * ds, 6 * ds, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }
    }
  };

  /* ---------------- 顶部信息 ---------------- */
  BattleView.prototype._topbar = function (ctx, R) {
    var bf = this.bf;
    ctx.save();
    ctx.font = '800 13px "Noto Sans SC", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,.92)';
    ctx.fillText('第 ' + bf.level + ' 关 · 第 ' + bf.wave + ' 波', R.x + 14, R.y + 22);
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,.62)';
    var w = global.Battlefield.WAVES[bf.waveIdx];
    ctx.fillText(w ? w.intent : '准备中…', R.x + 14, R.y + 38);

    ctx.textAlign = 'right';
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,.72)';
    ctx.fillText('存活 ' + bf.enemies.filter(function (e) { return !e.dead; }).length +
      ' · 击杀 ' + bf.stats.kills + ' · 漏怪 ' + bf.stats.leaks, R.x + R.w - 14, R.y + 22);
    ctx.restore();
  };

  global.BattleView = BattleView;
})(window);
