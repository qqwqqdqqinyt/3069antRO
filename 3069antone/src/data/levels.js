/* ============================================================
 *  levels.js —— 由「星序防线 · 编辑器」生成，请勿手改
 *  生成时间：2026-09-01T12:55:29.357Z
 *  数据源：3069antone/src (live)
 *  用法：在 index.html 里 <script src="src/main.js"></script> 之前引入本文件
 * ============================================================ */
window.LEVEL_DATA = {
  "version": 2,
  "generator": "星序防线编辑器",
  "generatedAt": "2026-09-01T12:55:29.357Z",
  "source": "3069antone/src (live)",
  "levels": [
    {
      "id": "L1",
      "name": "第一关 · 苗圃",
      "board": {
        "n": 5,
        "tier": 1,
        "stepMax": 5,
        "stepRegen": 1.5
      },
      "battle": {
        "lanes": 3,
        "cols": 4,
        "nodeX": 58,
        "nodeHp": 100,
        "gold": 60
      },
      "roulette": [
        "thunder",
        "fire",
        "ice",
        "wood",
        "water",
        "light"
      ],
      "map": {
        "version": 1,
        "lanes": 3,
        "cols": 4,
        "tiles": [
          [
            "slot",
            "slot",
            "slot",
            "slot"
          ],
          [
            "slot",
            "slot",
            "slot",
            "slot"
          ],
          [
            "slot",
            "slot",
            "slot",
            "slot"
          ]
        ],
        "effects": {
          "mudSlow": 0.3,
          "waterSlow": 0.15,
          "waterIceTaken": 1.25
        }
      },
      "plants": [
        {
          "lane": 0,
          "col": 0,
          "kind": "sprout"
        },
        {
          "lane": 1,
          "col": 0,
          "kind": "sprout"
        },
        {
          "lane": 2,
          "col": 0,
          "kind": "sprout"
        }
      ],
      "obstacles": [],
      "display": {
        "byType": {
          "plants": {},
          "enemies": {},
          "obstacles": {}
        },
        "byInst": {
          "plants": {},
          "enemies": {},
          "obstacles": {}
        }
      },
      "waves": [
        {
          "t": 30,
          "intent": "教学波。不可能失败。",
          "comp": [
            [
              "grunt",
              6
            ]
          ]
        },
        {
          "t": 35,
          "intent": "引入群体压力与时间压力。",
          "comp": [
            [
              "grunt",
              4
            ],
            [
              "swarm",
              4
            ],
            [
              "swift",
              2
            ]
          ]
        },
        {
          "t": 45,
          "intent": "引入护甲 + 触手蛛亮相（会跨道绕后啃残血）。",
          "comp": [
            [
              "armor",
              2
            ],
            [
              "grunt",
              6
            ],
            [
              "spider",
              1
            ]
          ]
        },
        {
          "t": 45,
          "intent": "时间压力为主，逼玩家加快合成；蜘蛛开始拆前排。",
          "comp": [
            [
              "swift",
              6
            ],
            [
              "armor",
              2
            ],
            [
              "spider",
              1
            ]
          ]
        },
        {
          "t": 60,
          "intent": "Boss 波。检验轮盘编排与多线兼顾；收尾放 1 只蜜蜂试探空中。",
          "comp": [
            [
              "elite",
              1
            ],
            [
              "grunt",
              8
            ],
            [
              "swarm",
              4
            ],
            [
              "spider",
              2
            ],
            [
              "bee",
              1
            ]
          ]
        }
      ],
      "balance": {
        "enemyHp": 1,
        "enemyDmg": 1,
        "enemySpd": 1,
        "plantDmg": 1,
        "plantAspd": 1,
        "nodeHp": 100
      },
      "notes": "源自游戏本体 Battlefield.WAVES（关 1 基准）"
    }
  ]
};
