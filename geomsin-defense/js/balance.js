/* 전생검신 균형 데이터 — Jeonsaeng Geomsin balance.
   Edit this file only. The rest of the game reads these numbers and names.
   숫자와 이름만 고치면 난이도, 확률, 파도, 비급이 바뀐다. */
'use strict';

var GEOMSIN_BALANCE = {
  meta: {
    title: '전생검신',
    cols: 4,
    rows: 3,
    startGold: 240,
    startLives: 20,
    summonCost: 50,
    rerollCost: 18,
    upgradeBase: 130,
    maxSummonLevel: 5,
    pityEvery: 8,
    pityTier: 3,
    firstPrepSeconds: 14,
    prepSeconds: 9,
    /* Cross time is pathRef / enemy.speed seconds, on every screen size. */
    pathRef: 1900,
    /* Pierce thickness, as a fraction of a cell's width. */
    pierceWidth: 0.42,
    buffCap: 0.85,
    storageKey: 'geomsin-defense-best-v1',
    muteKey: 'geomsin-defense-mute-v1'
  },

  skillNames: {
    slash: '베기',
    pierce: '관통',
    area: '광역',
    slow: '둔화',
    buff: '진법'
  },

  /* damageMul is per hit versus tier 1. A tier-2 sword is slightly stronger than three tier-1 copies.
   family.range is how many cell-widths of road the sword covers, measured one way from the cell.
   0.6 is a short reach. 1.5 covers most of a row. splash and aura use the same cell-width unit. */
  tiers: [
    { tier: 1, name: '일반', en: 'Common', damageMul: 1, intervalMul: 1, rangeMul: 1 },
    { tier: 2, name: '희귀', en: 'Rare', damageMul: 3.25, intervalMul: 0.94, rangeMul: 1.05 },
    { tier: 3, name: '영웅', en: 'Epic', damageMul: 11, intervalMul: 0.88, rangeMul: 1.1 },
    { tier: 4, name: '전설', en: 'Legendary', damageMul: 36, intervalMul: 0.82, rangeMul: 1.16 },
    { tier: 5, name: '신화', en: 'Mythic', damageMul: 115, intervalMul: 0.76, rangeMul: 1.22 }
  ],

  /* Weights are tier 1..5. Sum need not be 100. */
  weights: {
    1: [74, 20, 5, 1, 0],
    2: [55, 28, 12, 4, 1],
    3: [38, 30, 20, 9, 3],
    4: [24, 28, 26, 15, 7],
    5: [12, 22, 28, 24, 14]
  },

  sellByTier: { 1: 22, 2: 78, 3: 220, 4: 580, 5: 1500 },

  families: [
    {
      id: 'hoegeom',
      name: '회검',
      epithet: '재의 기본검',
      flavor: '죽으며 떨어뜨린 검을 다시 주워 들었다.',
      skill: 'slash',
      color: '#e6d3a3',
      ink: '#8a6a32',
      damage: 11,
      interval: 0.86,
      range: 0.75,
      hits: 1,
      pool: true
    },
    {
      id: 'cheongmyeong',
      name: '청명',
      epithet: '이슬 관통',
      flavor: '맑은 날의 기억이 검끝을 가늘고 길게 벼린다.',
      skill: 'pierce',
      color: '#9ad7ea',
      ink: '#1e6f8a',
      damage: 6,
      interval: 0.68,
      range: 1.25,
      hits: 3,
      pool: true
    },
    {
      id: 'jeokyeom',
      name: '적염',
      epithet: '불꽃 베기',
      flavor: '분노로 죽은 전생이 검날에 아직 뜨겁다.',
      skill: 'area',
      color: '#f09986',
      ink: '#a33b28',
      damage: 9,
      interval: 1.16,
      range: 0.55,
      splash: 0.55,
      hits: 6,
      pool: true
    },
    {
      id: 'hanbing',
      name: '한빙',
      epithet: '서리 검',
      flavor: '차가운 회한이 적의 발목을 얼린다.',
      skill: 'slow',
      color: '#c9d4ff',
      ink: '#4454a8',
      damage: 6,
      interval: 0.96,
      range: 0.85,
      slow: 0.52,
      slowTime: 1.45,
      pool: true
    },
    {
      id: 'jingak',
      name: '진각',
      epithet: '검진의 기수',
      flavor: '말을 잃은 기수가 검으로 박자를 친다.',
      skill: 'buff',
      color: '#f0d78a',
      ink: '#a07a16',
      damage: 4,
      interval: 1.24,
      range: 0.5,
      buff: 0.24,
      aura: 1.7,
      pool: true
    },
    {
      id: 'wolheun',
      name: '월흔',
      epithet: '달그림자',
      flavor: '밤의 전생은 멀리서 급소만 가른다.',
      skill: 'pierce',
      color: '#d5c2f4',
      ink: '#6a4e99',
      damage: 13,
      interval: 1.28,
      range: 1.55,
      hits: 2,
      pool: true
    },
    {
      id: 'sanggeuk',
      name: '상극검',
      epithet: '불서리',
      flavor: '맞서는 두 기억이 한 칼집에서 싸운다.',
      skill: 'area',
      color: '#f2b6c8',
      ink: '#8a3a55',
      damage: 12,
      interval: 1.02,
      range: 0.8,
      splash: 0.62,
      hits: 7,
      slow: 0.6,
      slowTime: 1.25,
      pool: false
    },
    {
      id: 'samjae',
      name: '삼재검',
      epithet: '세 재앙',
      flavor: '이슬과 불과 서리가 겹쳐 재앙의 검이 되었다.',
      skill: 'pierce',
      color: '#ffd0a4',
      ink: '#b85a2a',
      damage: 11,
      interval: 0.9,
      range: 1.15,
      hits: 4,
      splash: 0.5,
      slow: 0.58,
      slowTime: 1.15,
      pool: false
    },
    {
      id: 'saebyeok',
      name: '새벽베기',
      epithet: '첫 빛',
      flavor: '재와 달그림자가 걷히며 새벽이 한 줄로 베어진다.',
      skill: 'slash',
      color: '#ffe7b0',
      ink: '#c47b2b',
      damage: 26,
      interval: 0.74,
      range: 1.2,
      hits: 1,
      pool: false
    },
    {
      id: 'mujeong',
      name: '무정검신',
      epithet: '무정',
      flavor: '정을 버린 검신. 진을 세우고 달을 떨어뜨린다.',
      skill: 'pierce',
      color: '#f7f1e4',
      ink: '#5c5346',
      damage: 18,
      interval: 0.68,
      range: 1.4,
      hits: 5,
      buff: 0.16,
      aura: 1.8,
      pool: false
    }
  ],

  /* needs.tier is the minimum tier consumed. The cheapest match is used. */
  recipes: [
    {
      id: 'sanggeuk',
      name: '상극검',
      blurb: '불의 기억과 서리의 기억을 한 칼집에 넣는다.',
      result: 'sanggeuk',
      tier: 3,
      needs: [
        { family: 'jeokyeom', tier: 2 },
        { family: 'hanbing', tier: 2 }
      ]
    },
    {
      id: 'samjae',
      name: '삼재검',
      blurb: '이슬, 불, 서리가 겹치면 재앙이 검이 된다.',
      result: 'samjae',
      tier: 4,
      needs: [
        { family: 'cheongmyeong', tier: 3 },
        { family: 'jeokyeom', tier: 3 },
        { family: 'hanbing', tier: 3 }
      ]
    },
    {
      id: 'saebyeok',
      name: '새벽베기',
      blurb: '재의 검과 달그림자가 맞물리며 새벽이 열린다.',
      result: 'saebyeok',
      tier: 4,
      needs: [
        { family: 'hoegeom', tier: 4 },
        { family: 'wolheun', tier: 4 }
      ]
    },
    {
      id: 'mujeong',
      name: '무정검신',
      blurb: '진을 친 기수와 불꽃과 달빛이 정을 버린다.',
      result: 'mujeong',
      tier: 5,
      needs: [
        { family: 'jingak', tier: 4 },
        { family: 'jeokyeom', tier: 4 },
        { family: 'wolheun', tier: 3 }
      ]
    }
  ],

  enemies: {
    shade: {
      name: '잔념',
      hp: 78,
      speed: 86,
      gold: 4,
      leak: 1,
      radius: 13,
      color: '#d2c6d6',
      shape: 'shade',
      boss: false,
      slowResist: 0
    },
    wraith: {
      name: '칼날귀',
      hp: 64,
      speed: 128,
      gold: 5,
      leak: 1,
      radius: 12,
      color: '#c47d8c',
      shape: 'wraith',
      boss: false,
      slowResist: 0
    },
    iron: {
      name: '철갑령',
      hp: 260,
      speed: 58,
      gold: 8,
      leak: 2,
      radius: 16,
      color: '#b7b5a8',
      shape: 'iron',
      boss: false,
      slowResist: 0.15
    },
    wisp: {
      name: '도깨비불',
      hp: 36,
      speed: 168,
      gold: 3,
      leak: 1,
      radius: 9,
      color: '#e07a3d',
      shape: 'wisp',
      boss: false,
      slowResist: 0
    },
    boss1: {
      name: '업화령',
      hp: 3600,
      speed: 52,
      gold: 90,
      leak: 8,
      radius: 26,
      color: '#e15a3c',
      shape: 'boss',
      boss: true,
      slowResist: 0.45
    },
    boss2: {
      name: '무명검귀',
      hp: 10800,
      speed: 50,
      gold: 140,
      leak: 8,
      radius: 28,
      color: '#d5d8e4',
      shape: 'boss',
      boss: true,
      slowResist: 0.5
    },
    boss3: {
      name: '단죄검혼',
      hp: 25000,
      speed: 46,
      gold: 220,
      leak: 10,
      radius: 30,
      color: '#e4c56a',
      shape: 'boss',
      boss: true,
      slowResist: 0.55
    }
  },

  /* Boss waves are 5, 10, and 15. hpMul applies to non-boss enemies only.
     gap is extra seconds before that group. interval is seconds between spawns. */
  waves: [
    { hpMul: 1, clearGold: 22, groups: [{ type: 'shade', count: 8, interval: 0.9 }] },
    { hpMul: 1.08, clearGold: 26, groups: [{ type: 'shade', count: 8, interval: 0.75 }, { type: 'wraith', count: 4, interval: 0.95 }] },
    { hpMul: 1.16, clearGold: 30, groups: [{ type: 'wisp', count: 12, interval: 0.42 }, { type: 'shade', count: 5, interval: 0.8 }] },
    { hpMul: 1.24, clearGold: 36, groups: [{ type: 'shade', count: 6, interval: 0.6 }, { type: 'iron', count: 3, interval: 1.5 }] },
    {
      hpMul: 1.3,
      clearGold: 85,
      groups: [
        { type: 'shade', count: 8, interval: 0.55 },
        { type: 'boss1', count: 1, interval: 1, gap: 2.4 },
        { type: 'wraith', count: 4, interval: 0.7 }
      ]
    },
    { hpMul: 1.45, clearGold: 40, groups: [{ type: 'wraith', count: 8, interval: 0.62 }, { type: 'wisp', count: 10, interval: 0.38 }] },
    { hpMul: 1.58, clearGold: 44, groups: [{ type: 'iron', count: 4, interval: 1.35 }, { type: 'shade', count: 8, interval: 0.55 }] },
    { hpMul: 2.15, clearGold: 48, groups: [{ type: 'wisp', count: 14, interval: 0.34 }, { type: 'wraith', count: 7, interval: 0.6 }] },
    { hpMul: 2.4, clearGold: 54, groups: [{ type: 'iron', count: 5, interval: 1.2 }, { type: 'wraith', count: 6, interval: 0.55 }, { type: 'shade', count: 6, interval: 0.5 }] },
    {
      hpMul: 2.55,
      clearGold: 120,
      groups: [
        { type: 'iron', count: 3, interval: 1.1 },
        { type: 'boss2', count: 1, interval: 1, gap: 2.2 },
        { type: 'wraith', count: 6, interval: 0.55 }
      ]
    },
    { hpMul: 2.9, clearGold: 58, groups: [{ type: 'wisp', count: 16, interval: 0.3 }, { type: 'iron', count: 3, interval: 1.3 }] },
    { hpMul: 3.2, clearGold: 62, groups: [{ type: 'wraith', count: 10, interval: 0.48 }, { type: 'shade', count: 10, interval: 0.42 }] },
    { hpMul: 3.5, clearGold: 68, groups: [{ type: 'iron', count: 6, interval: 1.05 }, { type: 'wisp', count: 10, interval: 0.32 }] },
    { hpMul: 3.8, clearGold: 76, groups: [{ type: 'iron', count: 5, interval: 0.95 }, { type: 'wraith', count: 8, interval: 0.45 }, { type: 'wisp', count: 8, interval: 0.3 }] },
    {
      hpMul: 4.1,
      clearGold: 180,
      groups: [
        { type: 'wraith', count: 8, interval: 0.42 },
        { type: 'boss3', count: 1, interval: 1, gap: 2.6 },
        { type: 'iron', count: 4, interval: 0.9 },
        { type: 'wisp', count: 8, interval: 0.28 }
      ]
    }
  ]
};

globalThis.GEOMSIN_BALANCE = GEOMSIN_BALANCE;
