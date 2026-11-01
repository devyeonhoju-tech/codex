/* Canvas drawing for 전생검신. Shapes only — no image assets. */
'use strict';

var GEOMSIN_FONT = '"Apple SD Gothic Neo", "Noto Sans KR", "Noto Sans CJK KR", "NanumGothic", "Malgun Gothic", "WenQuanYi Micro Hei", sans-serif';

function geomRoundRect(ctx, x, y, w, h, r) {
  var rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function geomDressing(layout) {
  if (layout.dressing) return layout.dressing;
  var motes = [];
  var s = 9001;
  var i;
  for (i = 0; i < 26; i++) {
    s = (s * 48271) % 2147483647;
    var mx = (s % 1000) / 1000;
    s = (s * 48271) % 2147483647;
    var my = (s % 1000) / 1000;
    motes.push({ x: mx, y: my, r: 0.7 + (s % 10) / 8 });
  }
  layout.dressing = motes;
  return motes;
}

function geomBackground(ctx, w, h, anim, layout) {
  var sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#3a2230');
  sky.addColorStop(0.45, '#1c1218');
  sky.addColorStop(1, '#120d10');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  var moonX = w * 0.82;
  var moonY = h * 0.08;
  var glow = ctx.createRadialGradient(moonX, moonY, 4, moonX, moonY, w * 0.42);
  glow.addColorStop(0, 'rgba(244, 214, 170, 0.28)');
  glow.addColorStop(1, 'rgba(244, 214, 170, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#f3e0c0';
  ctx.beginPath();
  ctx.arc(moonX, moonY, Math.max(10, w * 0.035), 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#3a2230';
  ctx.beginPath();
  ctx.arc(moonX + 6, moonY - 2, Math.max(8, w * 0.028), 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(232, 196, 150, 0.045)';
  ctx.fillRect(w * 0.08, h * 0.02, 8, h * 0.22);
  ctx.fillRect(w * 0.9, h * 0.02, 8, h * 0.18);
  ctx.beginPath();
  ctx.moveTo(w * 0.04, h * 0.02);
  ctx.lineTo(w * 0.16, h * 0.02);
  ctx.lineTo(w * 0.14, h * 0.055);
  ctx.lineTo(w * 0.06, h * 0.055);
  ctx.closePath();
  ctx.fill();

  var motes = geomDressing(layout);
  ctx.fillStyle = 'rgba(244, 234, 216, 0.18)';
  var i;
  for (i = 0; i < motes.length; i++) {
    var m = motes[i];
    var drift = Math.sin(anim * 0.7 + i) * 4;
    ctx.beginPath();
    ctx.arc(m.x * w, m.y * h + drift, m.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function geomPath(ctx, layout) {
  var segs = layout.segs;
  if (!segs.length) return;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#1a1014';
  ctx.lineWidth = layout.pathWidth + 8;
  ctx.beginPath();
  ctx.moveTo(segs[0].ax, segs[0].ay);
  var i;
  for (i = 0; i < segs.length; i++) ctx.lineTo(segs[i].bx, segs[i].by);
  ctx.stroke();

  ctx.strokeStyle = '#6a5348';
  ctx.lineWidth = layout.pathWidth;
  ctx.stroke();

  ctx.strokeStyle = 'rgba(226, 182, 87, 0.35)';
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 9]);
  ctx.stroke();
  ctx.setLineDash([]);

  var spawn = layout.spawn;
  ctx.fillStyle = '#e6c27a';
  ctx.beginPath();
  ctx.arc(spawn.x, spawn.y, 5, 0, Math.PI * 2);
  ctx.fill();

  var exit = layout.exit;
  var prev = layout.points[layout.points.length - 2];
  var dx = exit.x - prev.x;
  var dy = exit.y - prev.y;
  var len = Math.hypot(dx, dy) || 1;
  var inwardX = -dx / len;
  var inwardY = -dy / len;
  var gx = exit.x + inwardX * 2;
  var gy = exit.y + inwardY * 2;
  ctx.fillStyle = '#c4473a';
  ctx.fillRect(gx - 11, gy - 16, 3, 18);
  ctx.fillRect(gx + 8, gy - 16, 3, 18);
  ctx.fillRect(gx - 13, gy - 18, 26, 4);
  ctx.fillStyle = '#f4ead8';
  ctx.font = '700 12px ' + GEOMSIN_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('문', gx, gy - 20);
}

function geomCells(ctx, game) {
  var layout = game.layout;
  var i;
  for (i = 0; i < layout.cells.length; i++) {
    var cell = layout.cells[i];
    var unit = game.cells[i];
    var selected = game.selected === i;
    var radius = Math.min(12, cell.w * 0.12, cell.h * 0.16);
    geomRoundRect(ctx, cell.x, cell.y, cell.w, cell.h, radius);
    ctx.fillStyle = selected ? '#3a2832' : '#241820';
    ctx.fill();
    ctx.lineWidth = selected ? 2.5 : 1.25;
    if (unit && game.countSame(unit) >= 2 && unit.tier < game.balance.tiers.length) {
      ctx.strokeStyle = game.fam(unit.family).color;
    } else if (selected) {
      ctx.strokeStyle = '#e6c27a';
    } else {
      ctx.strokeStyle = '#4a3842';
    }
    ctx.stroke();

    if (!unit && game.hand && game.playable()) {
      var pulse = 0.35 + Math.sin(game.anim * 4 + i) * 0.15;
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = '#e6c27a';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 4]);
      geomRoundRect(ctx, cell.x + 3, cell.y + 3, cell.w - 6, cell.h - 6, radius);
      ctx.stroke();
      ctx.restore();
    }
  }

  if (game.hand && game.hoverIndex >= 0 && !game.cells[game.hoverIndex] && game.playable()) {
    var hover = layout.cells[game.hoverIndex];
    geomGhost(ctx, game, game.hand, hover.cx, hover.cy, Math.min(hover.w, hover.h));
    geomRange(ctx, game, game.hand, hover.cx, hover.cy, 'rgba(230, 194, 122, 0.16)', '#e6c27a');
  }

  if (game.selected != null && game.cells[game.selected] && !game.hand) {
    var chosen = game.cells[game.selected];
    var family = game.fam(chosen.family);
    geomRange(ctx, game, chosen, chosen.x, chosen.y, hexAlpha(family.color, 0.12), family.color);
    var skill = game.skillOf(chosen);
    if (skill.aura) {
      ctx.save();
      ctx.strokeStyle = '#e6c27a';
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.arc(chosen.x, chosen.y, skill.aura, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}

function hexAlpha(hex, alpha) {
  var n = parseInt(hex.slice(1), 16);
  var r = (n >> 16) & 255;
  var g = (n >> 8) & 255;
  var b = n & 255;
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

function geomRange(ctx, game, unit, x, y, fill, stroke) {
  var range = game.skillOf(unit).range;
  ctx.save();
  ctx.strokeStyle = stroke || fill;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 1.25;
  ctx.setLineDash([5, 6]);
  ctx.beginPath();
  ctx.arc(x, y, range, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function geomBlade(ctx, color, ink, scale) {
  ctx.save();
  ctx.scale(scale, scale);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -22);
  ctx.lineTo(4.2, -6);
  ctx.lineTo(3, 8);
  ctx.lineTo(-3, 8);
  ctx.lineTo(-4.2, -6);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -18);
  ctx.lineTo(0, 6);
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.fillRect(-9, 8, 18, 3.2);
  ctx.fillRect(-2.1, 11, 4.2, 8);
  ctx.beginPath();
  ctx.arc(0, 21, 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function geomGhost(ctx, game, unit, x, y, cell) {
  var family = game.fam(unit.family);
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.translate(x, y);
  geomBlade(ctx, family.color, family.ink, Math.max(0.7, cell / 78));
  ctx.restore();
}

function geomUnits(ctx, game) {
  var i;
  for (i = 0; i < game.cells.length; i++) {
    var unit = game.cells[i];
    if (!unit) continue;
    var cell = game.layout.cells[i];
    var family = game.fam(unit.family);
    var scale = Math.max(0.78, Math.min(1.6, Math.min(cell.w, cell.h) / 58));
    var age = game.anim - unit.born;
    var pop = age < 0.22 ? 0.55 + 0.45 * (age / 0.22) : 1;
    ctx.save();
    ctx.translate(unit.x, unit.y);
    ctx.scale(pop, pop);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(0, 16 * scale, 12 * scale, 4 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    geomBlade(ctx, family.color, family.ink, scale);

    var interval = game.intervalOf(unit);
    var ready = 1 - Math.max(0, unit.cooldown) / interval;
    ctx.strokeStyle = 'rgba(230, 194, 122, 0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 16 * scale, -Math.PI / 2, -Math.PI / 2 + Math.max(0.02, ready) * Math.PI * 2);
    ctx.stroke();

    if (cell.h >= 50) {
      var pips = unit.tier;
      var pipR = Math.max(2.1, 2.6 * scale);
      var gap = pipR * 2.5;
      var startX = -((pips - 1) * gap) / 2;
      var pipY = Math.min(28 * scale, cell.h * 0.38);
      var tierColor = ['#c8c2b4', '#6ec8e0', '#b48cff', '#f0b429', '#ff5d6c'][unit.tier - 1] || '#fff';
      var p;
      for (p = 0; p < pips; p++) {
        ctx.fillStyle = tierColor;
        ctx.beginPath();
        ctx.arc(startX + p * gap, pipY, pipR, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (unit.buffMul > 1.02) {
      ctx.fillStyle = '#e6c27a';
      ctx.beginPath();
      ctx.moveTo(14 * scale, -18 * scale);
      ctx.lineTo(18 * scale, -12 * scale);
      ctx.lineTo(14 * scale, -14 * scale);
      ctx.lineTo(10 * scale, -12 * scale);
      ctx.closePath();
      ctx.fill();
    }

    var copies = game.countSame(unit);
    if (copies >= 2 && unit.tier < game.balance.tiers.length) {
      ctx.fillStyle = '#1a1014';
      ctx.strokeStyle = family.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(-16 * scale, -16 * scale, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#f4ead8';
      ctx.font = '700 9px ' + GEOMSIN_FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(copies), -16 * scale, -16 * scale);
    }
    ctx.restore();

    if (cell.h >= 54) {
      ctx.fillStyle = '#f4ead8';
      ctx.font = '600 ' + Math.max(10, Math.round(12 * Math.min(1.1, scale))) + 'px ' + GEOMSIN_FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(family.name, unit.x, cell.y + Math.min(16, cell.h * 0.16));
    }
  }
}

function geomEnemies(ctx, list, game) {
  var i;
  for (i = 0; i < list.length; i++) geomEnemy(ctx, list[i], game);
}

function geomEnemy(ctx, enemy, game) {
  if (enemy.x == null) return;
  var r = (enemy.drawRadius || 12) * 1.18;
  var wobble = Math.sin(game.anim * 3 + (enemy.progress || 0) * 12) * 1.5;
  ctx.save();
  ctx.translate(enemy.x, enemy.y + wobble);
  if (enemy.flash > 0) ctx.globalAlpha = 0.55;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(0, r * 0.85, r * 0.85, r * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();

  if (enemy.shape === 'wisp') {
    var grd = ctx.createRadialGradient(0, 0, 1, 0, 0, r);
    grd.addColorStop(0, '#ffe1b0');
    grd.addColorStop(0.45, enemy.color);
    grd.addColorStop(1, 'rgba(224, 122, 61, 0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.35, 0, Math.PI * 2);
    ctx.fill();
  } else if (enemy.shape === 'iron') {
    ctx.fillStyle = enemy.color;
    ctx.beginPath();
    var k;
    for (k = 0; k < 6; k++) {
      var a = Math.PI / 6 + (k * Math.PI) / 3;
      var px = Math.cos(a) * r;
      var py = Math.sin(a) * r;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#2a241c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-r * 0.7, 0);
    ctx.lineTo(r * 0.7, 0);
    ctx.stroke();
  } else if (enemy.shape === 'wraith') {
    ctx.fillStyle = enemy.color;
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.25);
    ctx.lineTo(r * 0.7, r * 0.4);
    ctx.lineTo(0, r * 0.9);
    ctx.lineTo(-r * 0.7, r * 0.4);
    ctx.closePath();
    ctx.fill();
  } else if (enemy.shape === 'boss') {
    ctx.fillStyle = enemy.color;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2a140f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-r * 0.2, -r * 0.7);
    ctx.quadraticCurveTo(-r * 0.95, -r * 1.45, -r * 0.15, -r * 1.15);
    ctx.moveTo(r * 0.2, -r * 0.7);
    ctx.quadraticCurveTo(r * 0.95, -r * 1.45, r * 0.15, -r * 1.15);
    ctx.stroke();
    ctx.fillStyle = '#1a1014';
    ctx.fillRect(-r * 0.45, -r * 0.08, r * 0.9, r * 0.16);
    ctx.fillStyle = '#f4ead8';
    ctx.fillRect(-r * 0.12, -r * 0.08, r * 0.08, r * 0.16);
  } else {
    ctx.fillStyle = enemy.color;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.78, r, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.arc(-r * 0.28, -r * 0.1, r * 0.12, 0, Math.PI * 2);
    ctx.arc(r * 0.28, -r * 0.1, r * 0.12, 0, Math.PI * 2);
    ctx.fill();
  }

  if (enemy.slowUntil && game.time < enemy.slowUntil) {
    ctx.strokeStyle = '#c9d4ff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, r + 3, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  if (enemy.maxHp && (enemy.boss || enemy.hp < enemy.maxHp)) {
    var bw = Math.max(16, r * 2.3);
    var pct = Math.max(0, enemy.hp / enemy.maxHp);
    var by = enemy.y - r - 8;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(enemy.x - bw / 2, by, bw, 4);
    ctx.fillStyle = enemy.boss ? '#e6c27a' : '#d2554a';
    ctx.fillRect(enemy.x - bw / 2, by, bw * pct, 4);
  }
  if (enemy.boss && enemy.name) {
    ctx.fillStyle = '#f4ead8';
    ctx.font = '700 12px ' + GEOMSIN_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(enemy.name, enemy.x, enemy.y - r - 12);
  }
}

function geomFx(ctx, game) {
  var i;
  for (i = 0; i < game.fx.length; i++) {
    var fx = game.fx[i];
    var alpha = Math.max(0, fx.life / fx.max);
    ctx.save();
    ctx.globalAlpha = alpha;
    if (fx.kind === 'line') {
      ctx.strokeStyle = fx.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(fx.x1, fx.y1);
      ctx.lineTo(fx.x2, fx.y2);
      ctx.stroke();
    } else if (fx.kind === 'slash') {
      ctx.translate(fx.x, fx.y);
      ctx.rotate(fx.angle || 0);
      ctx.strokeStyle = fx.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 12, -1, 1);
      ctx.stroke();
    } else if (fx.kind === 'ring' || fx.kind === 'burst') {
      var p = 1 - alpha;
      var radius = fx.kind === 'burst' ? 8 + 28 * p : (fx.r || 20) * (0.75 + 0.35 * p);
      ctx.strokeStyle = fx.color;
      ctx.lineWidth = fx.kind === 'burst' ? 3 : 2;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    } else if (fx.kind === 'text') {
      ctx.fillStyle = fx.color;
      ctx.font = '700 13px ' + GEOMSIN_FONT;
      ctx.textAlign = 'center';
      ctx.fillText(fx.text, fx.x, fx.y - (1 - alpha) * 16);
    }
    ctx.restore();
  }
}

function geomBanner(ctx, game, w) {
  if (!game.banner || game.anim >= game.banner.until) return;
  var remain = game.banner.until - game.anim;
  var alpha = remain < 0.4 ? remain / 0.4 : 1;
  ctx.save();
  ctx.globalAlpha = Math.max(0, alpha);
  ctx.fillStyle = 'rgba(20, 12, 16, 0.72)';
  geomRoundRect(ctx, w * 0.18, 8, w * 0.64, 46, 10);
  ctx.fill();
  ctx.strokeStyle = '#e6c27a';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = '#f4ead8';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 16px ' + GEOMSIN_FONT;
  ctx.fillText(game.banner.title, w / 2, 24);
  ctx.fillStyle = '#e6c27a';
  ctx.font = '12px ' + GEOMSIN_FONT;
  ctx.fillText(game.banner.sub, w / 2, 42);
  ctx.restore();
}

function geomVignette(ctx, w, h, lives) {
  var alpha = 0.12 + (5 - lives) * 0.045;
  var grd = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.7);
  grd.addColorStop(0, 'rgba(196, 71, 58, 0)');
  grd.addColorStop(1, 'rgba(196, 71, 58, ' + alpha + ')');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h);
}

function drawGeomsin(ctx, game) {
  if (!game.layout) return;
  var w = game.viewW;
  var h = game.viewH;
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  if (game.shake > 0 && !game.reduceMotion) {
    var mag = game.shake * 5;
    ctx.translate(Math.sin(game.anim * 62) * mag, Math.cos(game.anim * 54) * mag * 0.55);
  }
  geomBackground(ctx, w, h, game.anim, game.layout);
  geomPath(ctx, game.layout);
  geomCells(ctx, game);
  if (game.phase === 'title') geomEnemies(ctx, game.decor, game);
  else geomEnemies(ctx, game.enemies, game);
  geomUnits(ctx, game);
  geomFx(ctx, game);
  geomBanner(ctx, game, w);
  ctx.restore();
  if (game.lives > 0 && game.lives <= 5 && (game.phase === 'combat' || game.phase === 'prep')) {
    geomVignette(ctx, w, h, game.lives);
  }
}

globalThis.drawGeomsin = drawGeomsin;
