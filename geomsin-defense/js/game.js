/* Simulation for 전생검신. No DOM. Rendering lives in render.js. */
'use strict';

function mulberry32(seed) {
  var a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function distToSeg(px, py, ax, ay, bx, by) {
  var abx = bx - ax;
  var aby = by - ay;
  var apx = px - ax;
  var apy = py - ay;
  var ab2 = abx * abx + aby * aby || 1;
  var t = (apx * abx + apy * aby) / ab2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  var cx = ax + abx * t;
  var cy = ay + aby * t;
  var dx = px - cx;
  var dy = py - cy;
  return { d: Math.hypot(dx, dy), t: t };
}

function computeLayout(w, h, cols, rows) {
  w = Math.max(160, w);
  h = Math.max(200, h);
  cols = cols || 4;
  rows = rows || 3;
  var lanes = rows + 1;
  var padX = Math.max(10, Math.min(18, w * 0.035));
  var padTop = 62;
  var padBottom = 10;
  var gapX = Math.max(6, Math.min(10, w * 0.018));
  var innerW = w - padX * 2;
  var innerH = Math.max(160, h - padTop - padBottom);
  var cellW = (innerW - gapX * (cols - 1)) / cols;
  var laneY = [];
  var cells = [];
  var lane;
  var c;
  var i;
  var laneBand = Math.max(16, Math.min(30, innerH * 0.05));
  var cellH = (innerH - laneBand * lanes) / rows;
  if (cellH > cellW * 1.12) cellH = cellW * 1.12;
  if (cellH > 118) {
    cellH = 118;
    laneBand = Math.min(laneBand, 26);
  }
  if (cellH < 42) {
    laneBand = 14;
    cellH = Math.max(36, (innerH - laneBand * lanes) / rows);
  }
  var blockH = cellH * rows + laneBand * lanes;
  var y = padTop + Math.max(0, (innerH - blockH) / 2);
  for (lane = 0; lane < lanes; lane++) {
    y += laneBand / 2;
    laneY.push(y);
    y += laneBand / 2;
    if (lane < rows) {
      for (c = 0; c < cols; c++) {
        var x = padX + c * (cellW + gapX);
        cells.push({
          x: x,
          y: y,
          w: cellW,
          h: cellH,
          cx: x + cellW / 2,
          cy: y + cellH / 2,
          col: c,
          row: lane
        });
      }
      y += cellH;
    }
  }
  var laneSlot = laneBand;
  var left = padX + 6;
  var right = w - padX - 6;
  var points = [{ x: left, y: laneY[0] }];
  for (i = 0; i < laneY.length; i++) {
    var fromLeft = i % 2 === 0;
    var endX = fromLeft ? right : left;
    points.push({ x: endX, y: laneY[i] });
    if (i < laneY.length - 1) points.push({ x: endX, y: laneY[i + 1] });
  }
  var segs = [];
  var start = 0;
  for (i = 0; i < points.length - 1; i++) {
    var a = points[i];
    var b = points[i + 1];
    var len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 0.5) continue;
    segs.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, len: len, start: start });
    start += len;
  }
  var pathWidth = Math.max(10, Math.min(18, laneSlot * 0.7));
  return {
    w: w,
    h: h,
    points: points,
    segs: segs,
    pathLen: start,
    cells: cells,
    laneY: laneY,
    pathWidth: pathWidth,
    spawn: points[0],
    exit: points[points.length - 1]
  };
}

function pointAt(layout, progress) {
  var dist = Math.max(0, Math.min(1, progress)) * layout.pathLen;
  var segs = layout.segs;
  var i;
  for (i = 0; i < segs.length; i++) {
    var s = segs[i];
    if (dist <= s.start + s.len || i === segs.length - 1) {
      var t = s.len > 0 ? (dist - s.start) / s.len : 0;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      return {
        x: s.ax + (s.bx - s.ax) * t,
        y: s.ay + (s.by - s.ay) * t
      };
    }
  }
  return { x: layout.exit.x, y: layout.exit.y };
}

function GeomsinGame(opts) {
  opts = opts || {};
  this.balance = opts.balance || globalThis.GEOMSIN_BALANCE;
  this.reduceMotion = !!opts.reduceMotion;
  var seed = opts.seed != null ? opts.seed : ((Date.now() ^ (Math.random() * 0x100000000)) >>> 0);
  this.rng = mulberry32(seed >>> 0);
  this.seed = seed >>> 0;
  this.onEvent = null;
  this.familyMap = {};
  var i;
  for (i = 0; i < this.balance.families.length; i++) {
    this.familyMap[this.balance.families[i].id] = this.balance.families[i];
  }
  this.validate();
  this.viewW = 400;
  this.viewH = 640;
  this.layout = null;
  this.best = this.loadBest();
  this.codex = this.loadCodex();
  this.reset(false);
}

GeomsinGame.prototype.validate = function () {
  var b = this.balance;
  var level;
  var i;
  if (b.tiers.length < 2) throw new Error('Need at least two tiers');
  for (level = 1; level <= b.meta.maxSummonLevel; level++) {
    if (!b.weights[level] || b.weights[level].length !== b.tiers.length) {
      throw new Error('weights[' + level + '] must list every tier');
    }
  }
  for (i = 0; i < b.recipes.length; i++) {
    var recipe = b.recipes[i];
    if (!this.familyMap[recipe.result]) throw new Error('Unknown recipe result ' + recipe.result);
    var n;
    for (n = 0; n < recipe.needs.length; n++) {
      if (!this.familyMap[recipe.needs[n].family]) {
        throw new Error('Unknown recipe family ' + recipe.needs[n].family);
      }
    }
  }
  for (i = 0; i < b.waves.length; i++) {
    var groups = b.waves[i].groups;
    var g;
    for (g = 0; g < groups.length; g++) {
      if (!b.enemies[groups[g].type]) throw new Error('Unknown enemy ' + groups[g].type);
    }
  }
  if (!b.endless || !b.endless.patterns || !b.endless.patterns.length) {
    throw new Error('endless.patterns required');
  }
  if (!b.enemies[b.endless.bossAnchor] || !b.enemies[b.endless.bossAnchor].boss) {
    throw new Error('Unknown endless boss anchor ' + b.endless.bossAnchor);
  }
  var p;
  for (p = 0; p < b.endless.patterns.length; p++) {
    var pattern = b.endless.patterns[p];
    if (!pattern || !pattern.length) throw new Error('Empty endless pattern');
    for (g = 0; g < pattern.length; g++) {
      var kind = b.enemies[pattern[g].type];
      if (!kind || kind.boss) throw new Error('Unknown endless enemy ' + pattern[g].type);
    }
  }
  var bosses = b.endless.bosses || [];
  if (!bosses.length) throw new Error('endless.bosses required');
  for (i = 0; i < bosses.length; i++) {
    if (!b.enemies[bosses[i]] || !b.enemies[bosses[i]].boss) {
      throw new Error('Unknown endless boss ' + bosses[i]);
    }
  }
};

GeomsinGame.prototype.loadBest = function () {
  var empty = { bestWave: 0, wins: 0, bestWinSeconds: null, bestKills: 0 };
  try {
    var raw = localStorage.getItem(this.balance.meta.storageKey);
    if (!raw) return empty;
    var data = JSON.parse(raw);
    return {
      bestWave: data.bestWave || 0,
      wins: data.wins || 0,
      bestWinSeconds: data.bestWinSeconds == null ? null : data.bestWinSeconds,
      bestKills: data.bestKills || 0
    };
  } catch (err) {
    return empty;
  }
};

GeomsinGame.prototype.persistBest = function () {
  try {
    localStorage.setItem(this.balance.meta.storageKey, JSON.stringify(this.best));
  } catch (err) { /* ignore quota / private mode */ }
};

GeomsinGame.prototype.loadCodex = function () {
  var seen = {};
  try {
    var raw = localStorage.getItem(this.balance.meta.codexKey);
    if (!raw) return { seen: seen };
    var data = JSON.parse(raw);
    var list = data && data.seen;
    var i;
    if (!Array.isArray(list)) return { seen: seen };
    for (i = 0; i < list.length; i++) {
      var key = list[i];
      if (typeof key !== 'string') continue;
      var parts = key.split(':');
      if (parts.length !== 2 || !this.familyMap[parts[0]]) continue;
      var tier = Number(parts[1]);
      if (!tier || tier < 1 || tier > this.balance.tiers.length) continue;
      seen[parts[0] + ':' + tier] = 1;
    }
  } catch (err) { /* ignore broken storage */ }
  return { seen: seen };
};

GeomsinGame.prototype.persistCodex = function () {
  try {
    var seen = [];
    var key;
    for (key in this.codex.seen) {
      if (this.codex.seen[key]) seen.push(key);
    }
    seen.sort();
    localStorage.setItem(this.balance.meta.codexKey, JSON.stringify({ seen: seen }));
  } catch (err) { /* ignore quota / private mode */ }
};

GeomsinGame.prototype.rememberUnit = function (familyId, tier) {
  if (!familyId || !tier || !this.codex) return;
  var key = familyId + ':' + tier;
  if (this.codex.seen[key]) return;
  this.codex.seen[key] = 1;
  this.persistCodex();
};

GeomsinGame.prototype.codexProgress = function () {
  var families = this.balance.families;
  var tiers = this.balance.tiers;
  var familyHits = 0;
  var tierHits = 0;
  var f;
  var t;
  for (f = 0; f < families.length; f++) {
    var any = false;
    for (t = 0; t < tiers.length; t++) {
      if (this.codex.seen[families[f].id + ':' + tiers[t].tier]) {
        any = true;
        tierHits += 1;
      }
    }
    if (any) familyHits += 1;
  }
  return {
    families: familyHits,
    familyTotal: families.length,
    tiers: tierHits,
    tierTotal: families.length * tiers.length
  };
};

GeomsinGame.prototype.codexRows = function () {
  var self = this;
  var tiers = this.balance.tiers;
  var rows = this.balance.families.map(function (family) {
    var knownTiers = [];
    var any = false;
    var i;
    for (i = 0; i < tiers.length; i++) {
      var known = !!self.codex.seen[family.id + ':' + tiers[i].tier];
      if (known) any = true;
      knownTiers.push({ tier: tiers[i].tier, name: tiers[i].name, known: known });
    }
    return {
      id: family.id,
      known: any,
      pool: !!family.pool,
      name: any ? family.name : (family.pool ? '소환되지 않은 검' : '비급의 검'),
      epithet: any ? family.epithet : '',
      flavor: any ? family.flavor : (family.pool
        ? '금화로 불러 본 뒤에 이름이 열린다.'
        : '비급으로만 깨어난다. 재료를 맞춰 보면 도감에 남는다.'),
      skill: any ? (self.balance.skillNames[family.skill] || family.skill) : '',
      color: any ? family.color : '#4a3842',
      tiers: knownTiers
    };
  });
  var known = [];
  var locked = [];
  rows.forEach(function (row) {
    if (row.known) known.push(row);
    else locked.push(row);
  });
  return known.concat(locked);
};

GeomsinGame.prototype.reset = function (keepView) {
  var meta = this.balance.meta;
  var count = meta.cols * meta.rows;
  this.phase = 'title';
  this.hold = false;
  this.endless = false;
  this.campaignWon = false;
  this.time = 0;
  this.anim = 0;
  this.prepLeft = 0;
  this.combatTime = 0;
  this.wave = 0;
  this.gold = meta.startGold;
  this.goldEarned = 0;
  this.lives = meta.startLives;
  this.kills = 0;
  this.leaked = 0;
  this.merges = 0;
  this.crafts = 0;
  this.summonLevel = 1;
  this.dry = 0;
  this.hand = null;
  this.selected = null;
  this.hoverIndex = -1;
  this.cells = new Array(count);
  var i;
  for (i = 0; i < count; i++) this.cells[i] = null;
  this.enemies = [];
  this.queue = [];
  this.spawnIndex = 0;
  this.fx = [];
  this.banner = null;
  this.shake = 0;
  this.status = '회검각에서 검을 고르시오.';
  this.uid = 1;
  this.decor = [
    { type: 'shade', progress: 0.08, rate: 0.045 },
    { type: 'wisp', progress: 0.3, rate: 0.08 },
    { type: 'wraith', progress: 0.55, rate: 0.06 },
    { type: 'iron', progress: 0.78, rate: 0.03 }
  ];
  if (!keepView) this.layout = null;
  else this.ensureLayout();
};

GeomsinGame.prototype.setView = function (w, h) {
  if (this.layout && Math.abs(w - this.viewW) < 0.5 && Math.abs(h - this.viewH) < 0.5) return;
  this.viewW = w;
  this.viewH = h;
  this.layout = computeLayout(w, h, this.balance.meta.cols, this.balance.meta.rows);
  this.syncPositions();
};

GeomsinGame.prototype.ensureLayout = function () {
  if (!this.layout) this.setView(this.viewW || 400, this.viewH || 640);
};

GeomsinGame.prototype.fam = function (id) {
  var family = this.familyMap[id];
  if (!family) throw new Error('Unknown family ' + id);
  return family;
};

GeomsinGame.prototype.tierInfo = function (tier) {
  return this.balance.tiers[tier - 1];
};

/* Farthest cell-to-road distance. Along-road reach is family.range × cell width. */
GeomsinGame.prototype.laneGap = function () {
  this.ensureLayout();
  if (this.layout.laneGap) return this.layout.laneGap;
  var worst = 1;
  var i;
  var s;
  for (i = 0; i < this.layout.cells.length; i++) {
    var cell = this.layout.cells[i];
    var best = Infinity;
    for (s = 0; s < this.layout.segs.length; s++) {
      var seg = this.layout.segs[s];
      var dist = distToSeg(cell.cx, cell.cy, seg.ax, seg.ay, seg.bx, seg.by).d;
      if (dist < best) best = dist;
    }
    if (best > worst) worst = best;
  }
  this.layout.laneGap = worst;
  return worst;
};

GeomsinGame.prototype.skillOf = function (unit) {
  var family = this.fam(unit.family);
  var tier = this.tierInfo(unit.tier);
  var gap = this.laneGap();
  var cellW = this.layout.cells[0].w;
  var along = family.range * tier.rangeMul;
  var slow = 0;
  if (family.slow) slow = Math.max(0.3, family.slow - (unit.tier - 1) * 0.03);
  return {
    type: family.skill,
    hits: family.hits || 1,
    splash: (family.splash || 0) * tier.rangeMul * cellW,
    range: Math.hypot(gap, along * cellW),
    slow: slow,
    slowTime: family.slowTime ? family.slowTime * (1 + (unit.tier - 1) * 0.08) : 0,
    buff: family.buff ? family.buff * (1 + (unit.tier - 1) * 0.12) : 0,
    aura: family.aura ? family.aura * tier.rangeMul * cellW : 0,
    pierceWidth: this.balance.meta.pierceWidth * tier.rangeMul * cellW,
    color: family.color
  };
};

GeomsinGame.prototype.damageOf = function (unit) {
  return this.fam(unit.family).damage * this.tierInfo(unit.tier).damageMul;
};

GeomsinGame.prototype.intervalOf = function (unit) {
  return this.fam(unit.family).interval * this.tierInfo(unit.tier).intervalMul;
};

GeomsinGame.prototype.unitLabel = function (unit) {
  if (!unit) return '';
  return this.fam(unit.family).name + ' · ' + this.tierInfo(unit.tier).name;
};

GeomsinGame.prototype.skillLabel = function (unit) {
  var family = this.fam(unit.family);
  var names = this.balance.skillNames;
  var parts = [names[family.skill] || family.skill];
  if (family.slow && family.skill !== 'slow') parts.push(names.slow);
  if (family.buff && family.skill !== 'buff') parts.push(names.buff);
  if (family.splash && family.skill === 'pierce') parts.push(names.area);
  return parts.join('+');
};

GeomsinGame.prototype.emit = function (name) {
  if (typeof this.onEvent === 'function') this.onEvent(name);
};

GeomsinGame.prototype.say = function (text) {
  this.status = text;
};

GeomsinGame.prototype.playable = function () {
  return (this.phase === 'prep' || this.phase === 'combat') && !this.hold;
};

GeomsinGame.prototype.start = function () {
  this.reset(true);
  this.phase = 'prep';
  this.prepLeft = this.balance.meta.firstPrepSeconds;
  this.say('소환한 뒤, 빈 칸을 눌러 검을 세우시오.');
  this.banner = { title: '회검각', sub: '첫 파도 전에 검을 세우시오', until: this.anim + 2.8 };
  this.emit('ui');
};

GeomsinGame.prototype.createUnit = function (familyId, tier, paid) {
  var interval = this.fam(familyId).interval * this.tierInfo(tier).intervalMul;
  var unit = {
    uid: ++this.uid,
    family: familyId,
    tier: tier,
    paid: paid || 0,
    cooldown: this.rng() * interval * 0.35,
    born: this.anim,
    buffMul: 1,
    x: 0,
    y: 0
  };
  this.rememberUnit(familyId, tier);
  return unit;
};

GeomsinGame.prototype.rollTier = function () {
  var weights = this.balance.weights[this.summonLevel];
  var total = 0;
  var i;
  for (i = 0; i < weights.length; i++) total += weights[i];
  var x = this.rng() * total;
  var tier = weights.length;
  for (i = 0; i < weights.length; i++) {
    x -= weights[i];
    if (x <= 0) {
      tier = i + 1;
      break;
    }
  }
  var pityEvery = this.balance.meta.pityEvery;
  var pityTier = this.balance.meta.pityTier || 3;
  if (pityEvery > 0 && this.dry >= pityEvery) tier = Math.max(tier, pityTier);
  if (tier >= pityTier) this.dry = 0;
  else this.dry += 1;
  return tier;
};

GeomsinGame.prototype.rollUnit = function (paid) {
  var pool = [];
  var i;
  for (i = 0; i < this.balance.families.length; i++) {
    if (this.balance.families[i].pool) pool.push(this.balance.families[i]);
  }
  var family = pool[Math.floor(this.rng() * pool.length)];
  return this.createUnit(family.id, this.rollTier(), paid);
};

GeomsinGame.prototype.summonCost = function () {
  return this.balance.meta.summonCost;
};

GeomsinGame.prototype.upgradeCost = function () {
  return this.balance.meta.upgradeBase * this.summonLevel;
};

GeomsinGame.prototype.emptyIndexes = function () {
  var list = [];
  var i;
  for (i = 0; i < this.cells.length; i++) if (!this.cells[i]) list.push(i);
  return list;
};

GeomsinGame.prototype.summon = function () {
  if (!this.playable()) return;
  if (this.hand) {
    this.say('먼저 손에 든 검을 빈 칸에 놓으시오.');
    return;
  }
  if (!this.emptyIndexes().length) {
    this.say('보드가 가득 찼다. 합체하거나 방출해 자리를 비우시오.');
    return;
  }
  var cost = this.summonCost();
  if (this.gold < cost) {
    this.say('금화가 부족하다.');
    return;
  }
  this.gold -= cost;
  this.hand = this.rollUnit(cost);
  this.say('손 · ' + this.unitLabel(this.hand) + ' · 빈 칸을 누르시오.');
  this.emit('summon');
};

GeomsinGame.prototype.reroll = function () {
  if (!this.playable()) return;
  if (!this.hand) {
    this.say('손에 든 검이 없다.');
    return;
  }
  var cost = this.balance.meta.rerollCost;
  if (this.gold < cost) {
    this.say('금화가 부족하다.');
    return;
  }
  this.gold -= cost;
  var paid = this.hand.paid;
  this.hand = this.rollUnit(paid);
  this.say('재굴림 · ' + this.unitLabel(this.hand));
  this.emit('ui');
};

GeomsinGame.prototype.upgrade = function () {
  if (!this.playable()) return;
  if (this.summonLevel >= this.balance.meta.maxSummonLevel) {
    this.say('각성이 이미 정점이다.');
    return;
  }
  var cost = this.upgradeCost();
  if (this.gold < cost) {
    this.say('금화가 부족하다.');
    return;
  }
  this.gold -= cost;
  this.summonLevel += 1;
  this.say('각성 ' + this.summonLevel + '단. 더 깊은 검이 나올 수 있다.');
  this.emit('ui');
};

GeomsinGame.prototype.sellValue = function (unit) {
  if (!unit) return 0;
  return this.balance.sellByTier[unit.tier] || 0;
};

GeomsinGame.prototype.pendingSellValue = function () {
  if (this.selected != null && this.cells[this.selected]) return this.sellValue(this.cells[this.selected]);
  if (this.hand) return this.sellValue(this.hand);
  return 0;
};

GeomsinGame.prototype.sell = function () {
  if (!this.playable()) return;
  var value = 0;
  if (this.selected != null && this.cells[this.selected]) {
    value = this.sellValue(this.cells[this.selected]);
    this.cells[this.selected] = null;
    this.selected = null;
  } else if (this.hand) {
    value = this.sellValue(this.hand);
    this.hand = null;
  } else {
    this.say('방출할 검이 없다.');
    return;
  }
  this.gold += value;
  this.say('방출 +' + value);
  this.emit('ui');
};

GeomsinGame.prototype.countSame = function (unit) {
  if (!unit) return 0;
  var n = 0;
  var i;
  for (i = 0; i < this.cells.length; i++) {
    var other = this.cells[i];
    if (other && other.family === unit.family && other.tier === unit.tier) n += 1;
  }
  return n;
};

GeomsinGame.prototype.place = function (index) {
  var unit = this.hand;
  this.hand = null;
  this.cells[index] = unit;
  this.selected = index;
  this.syncPositions();
  var merged = this.resolveMerges(index);
  var placed = this.cells[this.selected] || unit;
  if (!merged) {
    var outside = placed && !this.fam(placed.family).buff && !this.reachesPath(placed);
    this.say(outside ? ('배치 · ' + this.unitLabel(placed) + ' · 검로 밖') : ('배치 · ' + this.unitLabel(placed)));
  }
  this.emit('place');
};

GeomsinGame.prototype.relocate = function (from, to) {
  var moving = this.cells[from];
  var occupant = this.cells[to];
  this.cells[to] = moving;
  this.cells[from] = occupant;
  this.selected = to;
  this.syncPositions();
  var merged = this.resolveMerges(to);
  if (occupant && this.cells[from] && this.cells[from].uid === occupant.uid) {
    merged = this.resolveMerges(from) || merged;
  }
  if (!merged) this.say(occupant ? '자리를 바꿨다.' : '자리를 옮겼다.');
  this.emit('ui');
};

GeomsinGame.prototype.resolveMerges = function (index) {
  var merged = false;
  var guard = 0;
  while (guard < 8) {
    guard += 1;
    var unit = this.cells[index];
    if (!unit || unit.tier >= this.balance.tiers.length) return merged;
    var matches = [];
    var i;
    for (i = 0; i < this.cells.length; i++) {
      var other = this.cells[i];
      if (other && other.family === unit.family && other.tier === unit.tier) matches.push(i);
    }
    if (matches.length < 3) return merged;
    var consume = matches.slice(0, 3);
    var stay = consume.indexOf(index) >= 0 ? index : consume[0];
    var family = unit.family;
    var nextTier = unit.tier + 1;
    for (i = 0; i < consume.length; i++) this.cells[consume[i]] = null;
    var created = this.createUnit(family, nextTier, 0);
    this.cells[stay] = created;
    this.selected = stay;
    index = stay;
    this.merges += 1;
    merged = true;
    this.syncPositions();
    this.burstAt(created.x, created.y, this.fam(family).color);
    this.say('합체 · ' + this.unitLabel(created));
    this.emit('merge');
    if (!this.reduceMotion && typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(18); } catch (err) { /* ignore */ }
    }
  }
  return merged;
};

GeomsinGame.prototype.burstAt = function (x, y, color) {
  this.fx.push({ kind: 'burst', x: x, y: y, color: color || '#f0d48a', life: 0.45, max: 0.45 });
  if (this.fx.length > 80) this.fx.splice(0, this.fx.length - 80);
};

GeomsinGame.prototype.onCell = function (index) {
  if (!this.playable()) return;
  if (index < 0 || index >= this.cells.length) return;
  var occupant = this.cells[index];
  if (this.hand) {
    if (occupant) this.say('빈 칸에 놓으시오.');
    else this.place(index);
    return;
  }
  if (this.selected != null && this.selected !== index && this.cells[this.selected]) {
    this.relocate(this.selected, index);
    return;
  }
  if (!occupant) {
    this.selected = null;
    return;
  }
  this.selected = this.selected === index ? null : index;
};

GeomsinGame.prototype.hitCell = function (x, y) {
  this.ensureLayout();
  var cells = this.layout.cells;
  var i;
  for (i = 0; i < cells.length; i++) {
    var c = cells[i];
    if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) return i;
  }
  return -1;
};

GeomsinGame.prototype.pointerDown = function (x, y) {
  this.hoverIndex = this.hitCell(x, y);
};

GeomsinGame.prototype.pointerMove = function (x, y) {
  this.hoverIndex = this.hitCell(x, y);
};

GeomsinGame.prototype.pointerUp = function (x, y) {
  var index = this.hitCell(x, y);
  this.hoverIndex = index;
  if (index < 0) {
    if (!this.hand && this.playable()) this.selected = null;
    return;
  }
  this.onCell(index);
};

GeomsinGame.prototype.reachesPath = function (unit) {
  this.syncPositions();
  var range = this.skillOf(unit).range;
  var segs = this.layout.segs;
  var i;
  for (i = 0; i < segs.length; i++) {
    var s = segs[i];
    if (distToSeg(unit.x, unit.y, s.ax, s.ay, s.bx, s.by).d <= range) return true;
  }
  return false;
};

GeomsinGame.prototype.matchRecipe = function (recipe) {
  var used = {};
  var picks = [];
  var n;
  for (n = 0; n < recipe.needs.length; n++) {
    var need = recipe.needs[n];
    var found = -1;
    var foundTier = 99;
    var i;
    for (i = 0; i < this.cells.length; i++) {
      if (used[i]) continue;
      var unit = this.cells[i];
      if (!unit || unit.family !== need.family || unit.tier < need.tier) continue;
      if (unit.tier < foundTier) {
        foundTier = unit.tier;
        found = i;
      }
    }
    if (found < 0) return null;
    used[found] = true;
    picks.push(found);
  }
  return picks;
};

GeomsinGame.prototype.recipeRows = function () {
  var self = this;
  return this.balance.recipes.map(function (recipe) {
    return {
      id: recipe.id,
      name: recipe.name,
      blurb: recipe.blurb,
      ready: !!self.matchRecipe(recipe),
      resultName: self.fam(recipe.result).name,
      resultTier: self.tierInfo(recipe.tier).name,
      needs: recipe.needs.map(function (need) {
        return self.fam(need.family).name + ' ' + self.tierInfo(need.tier).name + '+';
      }).join(' · ')
    };
  });
};

GeomsinGame.prototype.craft = function (id) {
  if (!this.playable() && !(this.hold && (this.phase === 'prep' || this.phase === 'combat'))) return;
  var recipe = null;
  var i;
  for (i = 0; i < this.balance.recipes.length; i++) {
    if (this.balance.recipes[i].id === id) recipe = this.balance.recipes[i];
  }
  if (!recipe) return;
  var picks = this.matchRecipe(recipe);
  if (!picks) {
    this.say('비급의 재료가 부족하다.');
    return;
  }
  for (i = 0; i < picks.length; i++) this.cells[picks[i]] = null;
  var stay = picks[0];
  var created = this.createUnit(recipe.result, recipe.tier, 0);
  this.cells[stay] = created;
  this.selected = stay;
  this.crafts += 1;
  this.syncPositions();
  this.burstAt(created.x, created.y, this.fam(recipe.result).color);
  this.resolveMerges(stay);
  this.say('비급 · ' + recipe.name);
  this.emit('craft');
};

GeomsinGame.prototype.waveDef = function (index) {
  if (index >= 0 && index < this.balance.waves.length) return this.balance.waves[index];
  return this.makeEndlessWave(index);
};

GeomsinGame.prototype.makeEndlessWave = function (index) {
  var spec = this.balance.endless;
  var scripted = this.balance.waves.length;
  var extra = index - scripted + 1;
  if (extra < 1) extra = 1;
  var waveNo = index + 1;
  var last = this.balance.waves[scripted - 1];
  var pattern = spec.patterns[(extra - 1) % spec.patterns.length];
  var countMul = 1 + spec.countGrowth * (extra - 1);
  var intervalMul = Math.pow(spec.intervalMul, extra - 1);
  var groups = [];
  var i;
  for (i = 0; i < pattern.length; i++) {
    var src = pattern[i];
    groups.push({
      type: src.type,
      count: Math.max(1, Math.round(src.count * countMul)),
      interval: Math.max(spec.minInterval, Math.round(src.interval * intervalMul * 100) / 100)
    });
  }
  var bossWave = spec.bossEvery > 0 && waveNo % spec.bossEvery === 0;
  var bossHp = null;
  var bossGoldMul = 1;
  if (bossWave) {
    var bossOrdinal = Math.floor(waveNo / spec.bossEvery) - 1;
    var bossType = spec.bosses[((bossOrdinal % spec.bosses.length) + spec.bosses.length) % spec.bosses.length];
    var anchor = this.balance.enemies[spec.bossAnchor];
    groups.splice(Math.floor(groups.length / 2), 0, {
      type: bossType,
      count: 1,
      interval: spec.bossInterval,
      gap: spec.bossGap
    });
    bossHp = Math.max(1, Math.round(anchor.hp * Math.pow(spec.bossHpGrowth, extra)));
    bossGoldMul = Math.pow(spec.bossGoldGrowth, extra);
  }
  return {
    hpMul: last.hpMul * Math.pow(spec.hpGrowth, extra),
    speedMul: Math.min(spec.speedCap, Math.pow(spec.speedGrowth, extra)),
    goldMul: Math.pow(spec.goldGrowth, extra),
    bossGoldMul: bossGoldMul,
    bossHp: bossHp,
    clearGold: Math.round(spec.clearGoldBase + spec.clearGoldAdd * (extra - 1) + (bossWave ? spec.bossClearBonus : 0)),
    groups: groups,
    endless: true
  };
};

GeomsinGame.prototype.wavePreview = function (index) {
  var wave = this.waveDef(index);
  if (!wave) return '';
  var parts = [];
  var i;
  for (i = 0; i < wave.groups.length; i++) {
    var group = wave.groups[i];
    var enemy = this.balance.enemies[group.type];
    parts.push(enemy.name + ' ' + group.count);
  }
  return parts.join(' · ');
};

GeomsinGame.prototype.callWave = function () {
  if (this.hold) return;
  if (this.phase !== 'prep') {
    if (this.phase === 'combat') this.say('이미 전투 중이다.');
    return;
  }
  this.prepLeft = 0;
  this.beginWave();
};

GeomsinGame.prototype.beginWave = function () {
  if (this.phase !== 'prep') return;
  this.wave += 1;
  var wave = this.waveDef(this.wave - 1);
  this.phase = 'combat';
  this.combatTime = 0;
  this.queue = this.buildQueue(wave);
  this.spawnIndex = 0;
  this.enemies = [];
  if (this.wave > this.best.bestWave) {
    this.best.bestWave = this.wave;
    this.persistBest();
  }
  var bossName = '';
  var i;
  for (i = 0; i < wave.groups.length; i++) {
    var enemy = this.balance.enemies[wave.groups[i].type];
    if (enemy.boss) bossName = enemy.name;
  }
  var last = !this.endless && this.wave === this.balance.waves.length;
  if (bossName) {
    this.banner = { title: '우두머리', sub: bossName, until: this.anim + 2.6 };
    this.say('제 ' + this.wave + '파 · 우두머리 ' + bossName);
    this.shake = Math.min(1, this.shake + 0.7);
    this.emit('boss');
  } else {
    this.banner = {
      title: '제 ' + this.wave + '파',
      sub: last ? '마지막 파도' : (this.endless ? '검로는 끝나지 않는다' : '잔념이 검로에 들어선다'),
      until: this.anim + 1.8
    };
    this.say('제 ' + this.wave + '파가 시작된다.');
    this.emit('ui');
  }
};

GeomsinGame.prototype.buildQueue = function (wave) {
  var queue = [];
  var t = 0.45;
  var g;
  for (g = 0; g < wave.groups.length; g++) {
    var group = wave.groups[g];
    if (group.gap) t += group.gap;
    var n;
    for (n = 0; n < group.count; n++) {
      queue.push({ type: group.type, at: t });
      t += group.interval;
    }
  }
  return queue;
};

GeomsinGame.prototype.spawnEnemy = function (type) {
  var proto = this.balance.enemies[type];
  var wave = this.waveDef(this.wave - 1);
  var hp;
  if (proto.boss && wave.bossHp != null) hp = wave.bossHp;
  else hp = proto.hp * (proto.boss ? 1 : wave.hpMul);
  hp = Math.max(1, Math.round(hp));
  var speedMul = wave.speedMul || 1;
  var goldScale = proto.boss ? (wave.bossGoldMul || 1) : (wave.goldMul || 1);
  this.enemies.push({
    uid: ++this.uid,
    type: type,
    name: proto.name,
    hp: hp,
    maxHp: hp,
    speed: proto.speed * speedMul,
    gold: Math.max(1, Math.round(proto.gold * goldScale)),
    leak: proto.leak,
    radius: proto.radius,
    color: proto.color,
    shape: proto.shape,
    boss: proto.boss,
    slowResist: proto.slowResist || 0,
    progress: 0,
    slowFactor: 1,
    slowUntil: 0,
    dead: false,
    flash: 0,
    x: 0,
    y: 0
  });
};

GeomsinGame.prototype.syncPositions = function () {
  if (!this.layout) return;
  var i;
  for (i = 0; i < this.cells.length; i++) {
    var unit = this.cells[i];
    if (!unit) continue;
    unit.x = this.layout.cells[i].cx;
    unit.y = this.layout.cells[i].cy;
  }
  for (i = 0; i < this.enemies.length; i++) {
    var enemy = this.enemies[i];
    var pos = pointAt(this.layout, enemy.progress);
    enemy.x = pos.x;
    enemy.y = pos.y;
    enemy.drawRadius = Math.max(8, enemy.radius * Math.min(1.35, Math.max(0.85, this.layout.cells[0].h / 78)));
  }
  for (i = 0; i < this.decor.length; i++) {
    var decor = this.decor[i];
    var dpos = pointAt(this.layout, decor.progress);
    decor.x = dpos.x;
    decor.y = dpos.y;
    var proto = this.balance.enemies[decor.type];
    decor.color = proto.color;
    decor.shape = proto.shape;
    decor.boss = false;
    decor.drawRadius = Math.max(8, proto.radius * Math.min(1.35, Math.max(0.85, this.layout.cells[0].h / 78)));
    decor.name = proto.name;
  }
};

GeomsinGame.prototype.update = function (dt) {
  if (dt > 0.05) dt = 0.05;
  if (dt < 0) dt = 0;
  this.anim += dt;
  this.ensureLayout();
  if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 1.7);
  this.updateFx(dt);
  if (this.hold) return;
  if (this.phase === 'title') {
    this.updateDecor(dt);
    return;
  }
  if (this.phase === 'won' || this.phase === 'lost' || this.phase === 'gate') return;
  this.time += dt;
  if (this.phase === 'prep') {
    this.prepLeft -= dt;
    if (this.prepLeft <= 0) this.beginWave();
    return;
  }
  if (this.phase !== 'combat') return;
  this.combatTime += dt;
  this.spawnPending();
  if (this.phase !== 'combat') return;
  this.moveEnemies(dt);
  if (this.phase !== 'combat') return;
  this.syncPositions();
  this.applyAuras();
  this.updateUnits(dt);
  this.cleanupEnemies();
  this.checkWaveClear();
};

GeomsinGame.prototype.updateDecor = function (dt) {
  var i;
  for (i = 0; i < this.decor.length; i++) {
    var decor = this.decor[i];
    decor.progress += decor.rate * dt;
    if (decor.progress > 1) decor.progress -= 1;
  }
  this.syncPositions();
};

GeomsinGame.prototype.updateFx = function (dt) {
  var i;
  for (i = 0; i < this.fx.length; i++) this.fx[i].life -= dt;
  if (this.fx.length) {
    var next = [];
    for (i = 0; i < this.fx.length; i++) if (this.fx[i].life > 0) next.push(this.fx[i]);
    this.fx = next;
  }
};

GeomsinGame.prototype.spawnPending = function () {
  while (this.spawnIndex < this.queue.length && this.combatTime >= this.queue[this.spawnIndex].at) {
    this.spawnEnemy(this.queue[this.spawnIndex].type);
    this.spawnIndex += 1;
  }
};

GeomsinGame.prototype.moveEnemies = function (dt) {
  var pathRef = this.balance.meta.pathRef;
  var i;
  for (i = 0; i < this.enemies.length; i++) {
    var enemy = this.enemies[i];
    if (enemy.dead) continue;
    if (enemy.flash > 0) enemy.flash -= dt;
    var slowed = this.time < enemy.slowUntil;
    var factor = slowed ? enemy.slowFactor : 1;
    if (!slowed) enemy.slowFactor = 1;
    enemy.progress += (enemy.speed / pathRef) * factor * dt;
    if (enemy.progress >= 1) this.leak(enemy);
    if (this.phase !== 'combat') return;
  }
};

GeomsinGame.prototype.applyAuras = function () {
  var units = [];
  var i;
  for (i = 0; i < this.cells.length; i++) if (this.cells[i]) units.push(this.cells[i]);
  for (i = 0; i < units.length; i++) units[i].buffAdd = 0;
  for (i = 0; i < units.length; i++) {
    var skill = this.skillOf(units[i]);
    if (!skill.buff || !skill.aura) continue;
    var j;
    for (j = 0; j < units.length; j++) {
      var dx = units[j].x - units[i].x;
      var dy = units[j].y - units[i].y;
      if (dx * dx + dy * dy <= skill.aura * skill.aura) units[j].buffAdd += skill.buff;
    }
  }
  var cap = this.balance.meta.buffCap;
  for (i = 0; i < units.length; i++) {
    var bonus = units[i].buffAdd || 0;
    if (bonus > cap) bonus = cap;
    units[i].buffMul = 1 + bonus;
  }
};

GeomsinGame.prototype.updateUnits = function (dt) {
  var i;
  for (i = 0; i < this.cells.length; i++) {
    var unit = this.cells[i];
    if (!unit) continue;
    var speed = unit.buffMul || 1;
    if (unit.cooldown > 0) unit.cooldown -= dt * speed;
    if (unit.cooldown <= 0) {
      if (this.performAttack(unit)) unit.cooldown += this.intervalOf(unit);
    }
  }
};

GeomsinGame.prototype.livingEnemies = function () {
  var list = [];
  var i;
  for (i = 0; i < this.enemies.length; i++) if (!this.enemies[i].dead) list.push(this.enemies[i]);
  return list;
};

GeomsinGame.prototype.inRange = function (unit, range) {
  var list = [];
  var i;
  for (i = 0; i < this.enemies.length; i++) {
    var enemy = this.enemies[i];
    if (enemy.dead) continue;
    var dx = enemy.x - unit.x;
    var dy = enemy.y - unit.y;
    var reach = range + (enemy.drawRadius || enemy.radius);
    if (dx * dx + dy * dy <= reach * reach) list.push(enemy);
  }
  return list;
};

GeomsinGame.prototype.frontmost = function (list) {
  var best = list[0];
  var i;
  for (i = 1; i < list.length; i++) if (list[i].progress > best.progress) best = list[i];
  return best;
};

GeomsinGame.prototype.performAttack = function (unit) {
  var skill = this.skillOf(unit);
  var targets = this.inRange(unit, skill.range);
  if (!targets.length) return false;
  var family = this.fam(unit.family);
  var damage = this.damageOf(unit);
  var hitList = [];
  var primary = null;
  if (skill.type === 'area') {
    primary = this.pickAreaTarget(targets, skill.splash);
    hitList = this.around(primary, skill.splash, skill.hits);
  } else if (skill.type === 'pierce') {
    hitList = this.pierceTargets(unit, targets, skill);
    primary = hitList[hitList.length - 1] || hitList[0];
    if (skill.splash && primary) {
      var extra = this.around(primary, skill.splash, skill.hits);
      var seen = {};
      var i;
      for (i = 0; i < hitList.length; i++) seen[hitList[i].uid] = true;
      for (i = 0; i < extra.length; i++) if (!seen[extra[i].uid]) hitList.push(extra[i]);
    }
  } else {
    primary = this.frontmost(targets);
    hitList = [primary];
  }
  var h;
  for (h = 0; h < hitList.length; h++) {
    var amount = damage;
    if (skill.type === 'area' && hitList[h] !== primary) amount = damage * 0.7;
    if (skill.type === 'pierce' && skill.splash && h >= skill.hits) amount = damage * 0.65;
    this.hit(hitList[h], amount, skill);
  }
  if (primary) {
    var life = skill.type === 'area' ? 0.22 : 0.12;
    this.fx.push({
      kind: 'line',
      x1: unit.x,
      y1: unit.y,
      x2: primary.x,
      y2: primary.y,
      color: family.color,
      life: life,
      max: life
    });
    if (skill.type === 'area') {
      this.fx.push({
        kind: 'ring',
        x: primary.x,
        y: primary.y,
        r: skill.splash,
        color: family.color,
        life: 0.24,
        max: 0.24
      });
    } else {
      this.fx.push({
        kind: 'slash',
        x: primary.x,
        y: primary.y,
        angle: Math.atan2(primary.y - unit.y, primary.x - unit.x),
        color: family.color,
        life: 0.16,
        max: 0.16
      });
    }
    if (this.fx.length > 80) this.fx.splice(0, this.fx.length - 80);
  }
  this.emit('hit');
  return true;
};

GeomsinGame.prototype.pickAreaTarget = function (targets, splash) {
  var best = targets[0];
  var bestScore = -1;
  var i;
  for (i = 0; i < targets.length; i++) {
    var count = this.around(targets[i], splash, 99).length;
    var score = count * 1000 + targets[i].progress;
    if (score > bestScore) {
      bestScore = score;
      best = targets[i];
    }
  }
  return best;
};

GeomsinGame.prototype.around = function (origin, splash, limit) {
  var list = [];
  var i;
  for (i = 0; i < this.enemies.length; i++) {
    var enemy = this.enemies[i];
    if (enemy.dead) continue;
    var dx = enemy.x - origin.x;
    var dy = enemy.y - origin.y;
    var reach = splash + (enemy.drawRadius || enemy.radius) * 0.4;
    if (dx * dx + dy * dy <= reach * reach) list.push(enemy);
  }
  list.sort(function (a, b) { return b.progress - a.progress; });
  if (list.length > limit) list = list.slice(0, limit);
  return list;
};

GeomsinGame.prototype.pierceTargets = function (unit, targets, skill) {
  var lead = this.frontmost(targets);
  var width = skill.pierceWidth;
  var scored = [];
  var i;
  for (i = 0; i < targets.length; i++) {
    var enemy = targets[i];
    var dist = distToSeg(enemy.x, enemy.y, unit.x, unit.y, lead.x, lead.y);
    if (dist.d <= width + (enemy.drawRadius || enemy.radius)) scored.push(enemy);
  }
  scored.sort(function (a, b) { return b.progress - a.progress; });
  if (!scored.length) scored.push(lead);
  else if (scored.indexOf(lead) < 0) scored.unshift(lead);
  return scored.slice(0, skill.hits);
};

GeomsinGame.prototype.hit = function (enemy, damage, skill) {
  if (!enemy || enemy.dead) return;
  enemy.hp -= damage;
  enemy.flash = 0.08;
  if (skill.slow) {
    var applied = 1 - (1 - skill.slow) * (1 - (enemy.slowResist || 0));
    enemy.slowFactor = Math.min(enemy.slowFactor, applied);
    enemy.slowUntil = Math.max(enemy.slowUntil, this.time + skill.slowTime);
  }
  if (enemy.hp <= 0) this.kill(enemy);
};

GeomsinGame.prototype.kill = function (enemy) {
  if (enemy.dead) return;
  enemy.dead = true;
  this.kills += 1;
  this.gold += enemy.gold;
  this.goldEarned += enemy.gold;
  this.fx.push({
    kind: 'text',
    text: '+' + enemy.gold,
    x: enemy.x,
    y: enemy.y,
    color: '#e6c27a',
    life: 0.7,
    max: 0.7
  });
  this.fx.push({
    kind: 'ring',
    x: enemy.x,
    y: enemy.y,
    r: enemy.drawRadius || enemy.radius,
    color: '#f4ead8',
    life: 0.28,
    max: 0.28
  });
  if (this.kills > this.best.bestKills) {
    this.best.bestKills = this.kills;
    this.persistBest();
  }
};

GeomsinGame.prototype.leak = function (enemy) {
  if (enemy.dead) return;
  enemy.dead = true;
  this.lives -= enemy.leak;
  this.leaked += 1;
  var exit = this.layout ? this.layout.exit : { x: enemy.x, y: enemy.y };
  this.fx.push({
    kind: 'text',
    text: '-' + enemy.leak,
    x: exit.x,
    y: exit.y,
    color: '#ff6b5a',
    life: 0.8,
    max: 0.8
  });
  this.shake = Math.min(1, this.shake + (enemy.boss ? 0.85 : 0.4));
  this.say(enemy.boss ? ('우두머리 ' + enemy.name + ', 문이 뚫렸다.') : '잔념이 문을 넘었다.');
  this.emit('leak');
  if (!this.reduceMotion && typeof navigator !== 'undefined' && navigator.vibrate) {
    try { navigator.vibrate(enemy.boss ? 50 : 24); } catch (err) { /* ignore */ }
  }
  if (this.lives <= 0) {
    this.lives = 0;
    this.finish('lost');
  }
};

GeomsinGame.prototype.cleanupEnemies = function () {
  if (!this.enemies.length) return;
  var next = [];
  var i;
  for (i = 0; i < this.enemies.length; i++) if (!this.enemies[i].dead) next.push(this.enemies[i]);
  this.enemies = next;
};

GeomsinGame.prototype.checkWaveClear = function () {
  if (this.phase !== 'combat') return;
  if (this.spawnIndex < this.queue.length) return;
  if (this.enemies.length) return;
  var wave = this.waveDef(this.wave - 1);
  this.gold += wave.clearGold;
  this.goldEarned += wave.clearGold;
  if (!this.endless && this.wave >= this.balance.waves.length) {
    this.reachGate();
    return;
  }
  this.phase = 'prep';
  this.prepLeft = this.balance.meta.prepSeconds;
  this.say('제 ' + this.wave + '파를 막았다. +' + wave.clearGold);
  this.emit('ui');
};

GeomsinGame.prototype.recordCampaignWin = function () {
  if (this.campaignWon) return;
  this.campaignWon = true;
  this.best.wins += 1;
  if (this.best.bestWinSeconds == null || this.time < this.best.bestWinSeconds) {
    this.best.bestWinSeconds = this.time;
  }
  if (this.wave > this.best.bestWave) this.best.bestWave = this.wave;
  if (this.kills > this.best.bestKills) this.best.bestKills = this.kills;
  this.persistBest();
};

GeomsinGame.prototype.reachGate = function () {
  if (this.phase === 'gate' || this.phase === 'won' || this.phase === 'lost') return;
  this.phase = 'gate';
  this.hold = false;
  this.recordCampaignWin();
  this.banner = { title: '검신 귀환', sub: '여기서 마치거나, 더 나아간다', until: this.anim + 8 };
  this.say('열다섯 파도를 막았다. 계속 진행하면 검로가 이어진다.');
  this.emit('win');
};

GeomsinGame.prototype.continueEndless = function () {
  if (this.phase !== 'gate') return;
  this.endless = true;
  this.phase = 'prep';
  this.prepLeft = this.balance.meta.prepSeconds;
  this.banner = { title: '무한', sub: '난이도는 파도마다 오른다', until: this.anim + 2.4 };
  this.say('검로가 이어진다. 제 ' + (this.wave + 1) + '파.');
  this.emit('ui');
};

GeomsinGame.prototype.claimVictory = function () {
  if (this.phase !== 'gate') return;
  this.phase = 'won';
  this.hold = false;
  this.banner = { title: '검신 귀환', sub: '열다섯 파도를 베었다', until: this.anim + 6 };
  this.say('검신이 돌아왔다.');
  this.emit('ui');
};

GeomsinGame.prototype.finish = function (result) {
  if (this.phase === 'won' || this.phase === 'lost' || this.phase === 'gate') return;
  this.phase = result;
  this.hold = false;
  if (result === 'won') {
    this.recordCampaignWin();
    this.banner = { title: '검신 귀환', sub: '열다섯 파도를 베었다', until: this.anim + 6 };
    this.say('검신이 돌아왔다.');
  } else {
    this.banner = { title: '검이 꺾였다', sub: '기록은 이 기기에 남는다', until: this.anim + 6 };
    this.say('문이 뚫렸다.');
  }
  if (this.wave > this.best.bestWave) this.best.bestWave = this.wave;
  if (this.kills > this.best.bestKills) this.best.bestKills = this.kills;
  this.persistBest();
  this.emit(result);
};

GeomsinGame.prototype.inspectText = function () {
  var unit = null;
  var where = '';
  if (this.hand) {
    unit = this.hand;
    where = '손';
  } else if (this.selected != null && this.cells[this.selected]) {
    unit = this.cells[this.selected];
    where = '배치';
  }
  if (!unit) {
    if (this.phase === 'prep' || this.phase === 'combat') return '칸을 누르면 검의 설명을 본다. 고른 검은 끌어 옮길 수 있다.';
    return '';
  }
  var family = this.fam(unit.family);
  var damage = Math.round(this.damageOf(unit));
  var interval = this.intervalOf(unit);
  var copies = this.countSame(unit);
  var cap = unit.tier >= this.balance.tiers.length ? '합체 끝' : ('같은 검 ' + copies + '/3');
  return where + ' · ' + this.unitLabel(unit) + ' · ' + this.skillLabel(unit) +
    ' · 공격 ' + damage + ' · 간격 ' + interval.toFixed(2) + '초 · ' + cap + ' · ' + family.flavor;
};

GeomsinGame.prototype.previewText = function () {
  if (this.phase === 'title') return '전생의 검객을 불러, 검로를 막는다.';
  if (this.phase === 'prep') {
    var next = this.wave + 1;
    var tag = this.endless ? '무한 ' : '다음 ';
    return tag + next + '파 · ' + this.wavePreview(next - 1) + ' · ' + Math.ceil(this.prepLeft) + '초';
  }
  if (this.phase === 'combat') {
    var head = this.endless ? '무한 ' : '제 ';
    return head + this.wave + '파 전투 · 적 ' + this.livingEnemies().length;
  }
  if (this.phase === 'gate') return '열다섯 파도를 막았다. 계속할 것인가.';
  if (this.phase === 'won') return '회검각의 문이 조용히 열렸다.';
  if (this.phase === 'lost') return this.endless ? '무한의 검로에서 검이 꺾였다.' : '잔념이 문턱을 넘었다.';
  return '';
};

GeomsinGame.prototype.displayWave = function () {
  if (this.phase === 'prep') return this.wave + 1;
  return Math.max(this.wave, this.phase === 'title' ? 0 : 1);
};

GeomsinGame.prototype.clockText = function () {
  var t = Math.max(0, Math.floor(this.time));
  var m = Math.floor(t / 60);
  var s = t % 60;
  return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
};

globalThis.GeomsinGameKit = {
  Game: GeomsinGame,
  computeLayout: computeLayout,
  pointAt: pointAt,
  distToSeg: distToSeg,
  mulberry32: mulberry32
};
