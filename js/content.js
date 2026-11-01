(function (Gloam) {
  'use strict';

  // Single place to retune the run. Ranks stack by reapplying these formulas.
  Gloam.TUNING = {
    playerHp: 100,
    playerSpeed: 188,
    playerRadius: 13,
    iframe: 0.4,
    baseDamage: 16,
    baseCooldown: 0.52,
    projectileSpeed: 520,
    projectileLife: 0.68,
    projectileRadius: 4.5,
    pickup: 128,
    enemyCap: 120,
    gemCap: 320,
    despawn: 1900,
  };

  Gloam.xpToNext = function (level) {
    return 3 + level;
  };

  Gloam.formatTime = function (t) {
    const s = Math.max(0, Math.floor(t));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
  };

  Gloam.KINDS = [
    {
      id: 'shambler',
      arrive: 0,
      r: 16,
      hp: 30,
      speed: 96,
      damage: 10,
      xp: 1,
      color: '#d25a4a',
      weight: function () { return 1.45; },
    },
    {
      id: 'skitter',
      arrive: 18,
      r: 11,
      hp: 12,
      speed: 206,
      damage: 8,
      xp: 1,
      color: '#e2a23a',
      weight: function (time) { return 0.45 + Math.min(0.9, time / 140); },
    },
    {
      id: 'brute',
      arrive: 45,
      r: 26,
      hp: 96,
      speed: 48,
      damage: 16,
      xp: 3,
      color: '#7d5cb0',
      weight: function (time) { return Math.min(0.6, Math.max(0, (time - 45) / 170)); },
    },
  ];

  Gloam.pickKind = function (time) {
    const kinds = Gloam.KINDS.filter(function (k) { return time >= k.arrive; });
    let total = 0;
    const weights = kinds.map(function (k) {
      const w = k.weight(time);
      total += w;
      return w;
    });
    if (total <= 0) return kinds[0];
    let roll = Math.random() * total;
    for (let i = 0; i < kinds.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return kinds[i];
    }
    return kinds[0];
  };

  function rankOf(player, id) {
    return player.ranks[id] || 0;
  }

  Gloam.UPGRADES = [
    {
      id: 'might',
      name: 'Might',
      desc: 'Bolts deal 20% more damage.',
      max: 8,
      apply: function (p) {
        p.ranks.might = rankOf(p, 'might') + 1;
        p.damage = 1.2 ** p.ranks.might;
      },
    },
    {
      id: 'haste',
      name: 'Haste',
      desc: 'You attack 15% faster.',
      max: 6,
      apply: function (p) {
        p.ranks.haste = rankOf(p, 'haste') + 1;
        p.haste = 1 + 0.15 * p.ranks.haste;
      },
    },
    {
      id: 'volley',
      name: 'Volley',
      desc: 'Fire one more bolt each attack.',
      max: 4,
      apply: function (p) {
        p.ranks.volley = rankOf(p, 'volley') + 1;
        p.projectiles = 1 + p.ranks.volley;
      },
    },
    {
      id: 'swiftness',
      name: 'Swiftness',
      desc: 'Move 12% faster.',
      max: 6,
      apply: function (p) {
        p.ranks.swiftness = rankOf(p, 'swiftness') + 1;
        p.speed = Gloam.TUNING.playerSpeed * (1 + 0.12 * p.ranks.swiftness);
      },
    },
    {
      id: 'magnetism',
      name: 'Magnetism',
      desc: 'Gems fly to you from farther away.',
      max: 5,
      apply: function (p) {
        p.ranks.magnetism = rankOf(p, 'magnetism') + 1;
        p.pickup = Gloam.TUNING.pickup + p.ranks.magnetism * 58;
      },
    },
    {
      id: 'vitality',
      name: 'Vitality',
      desc: 'Gain 25 max health and heal 25.',
      max: 6,
      apply: function (p) {
        p.ranks.vitality = rankOf(p, 'vitality') + 1;
        p.maxHp += 25;
        p.hp = Math.min(p.maxHp, p.hp + 25);
      },
    },
    {
      id: 'pierce',
      name: 'Pierce',
      desc: 'Bolts pass through one more enemy.',
      max: 4,
      apply: function (p) {
        p.ranks.pierce = rankOf(p, 'pierce') + 1;
        p.pierce = p.ranks.pierce;
      },
    },
    {
      id: 'widen',
      name: 'Widen',
      desc: 'Bolts are 20% larger.',
      max: 5,
      apply: function (p) {
        p.ranks.widen = rankOf(p, 'widen') + 1;
        p.size = 1 + 0.2 * p.ranks.widen;
      },
    },
    {
      id: 'thirst',
      name: 'Thirst',
      desc: 'Regenerate 0.6 health each second.',
      max: 5,
      apply: function (p) {
        p.ranks.thirst = rankOf(p, 'thirst') + 1;
        p.regen = p.ranks.thirst * 0.6;
      },
    },
  ];

  function shuffle(list) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = list[i];
      list[i] = list[j];
      list[j] = tmp;
    }
    return list;
  }

  Gloam.rollUpgrades = function (player, count) {
    const pool = Gloam.UPGRADES.filter(function (u) {
      return rankOf(player, u.id) < u.max;
    });
    if (pool.length === 0) {
      return [{
        id: 'second-wind',
        name: 'Second Wind',
        desc: 'Recover 40 health. There is nothing left to learn.',
        max: 99,
        rank: 0,
        apply: function (p) { p.hp = Math.min(p.maxHp, p.hp + 40); },
      }];
    }
    return shuffle(pool.slice()).slice(0, Math.min(count, pool.length)).map(function (u) {
      return {
        id: u.id,
        name: u.name,
        desc: u.desc,
        max: u.max,
        rank: rankOf(player, u.id),
        apply: u.apply,
      };
    });
  };

  Gloam.rankLabel = function (choice) {
    if (choice.id === 'second-wind') return 'A breath, not a lesson';
    return 'Rank ' + (choice.rank + 1) + ' of ' + choice.max;
  };
})(window.Gloam = window.Gloam || {});
