/* Canvas drawing for 전생검신. Swords and yokai are drawn here — no image assets.
   drawGeomsinSword is shared with the codex. */
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

var GEOMSIN_TIER_ACCENT = ['#c8c2b4', '#6ec8e0', '#b48cff', '#f0b429', '#ff5d6c'];
var GEOMSIN_FOE_TOP = {
  shade: 1.34,
  wraith: 1.42,
  iron: 1.4,
  wisp: 1.72,
  boss1: 1.72,
  boss2: 1.48,
  boss3: 1.68
};
var geomMixCache = {};

function geomMix(hex, toward, t) {
  var key = hex + '|' + toward + '|' + t;
  var hit = geomMixCache[key];
  if (hit) return hit;
  var n = parseInt(hex.slice(1), 16);
  var m = parseInt(toward.slice(1), 16);
  var r = ((n >> 16) & 255) + ((((m >> 16) & 255) - ((n >> 16) & 255)) * t);
  var g = ((n >> 8) & 255) + ((((m >> 8) & 255) - ((n >> 8) & 255)) * t);
  var b = (n & 255) + (((m & 255) - (n & 255)) * t);
  var out = 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
  geomMixCache[key] = out;
  return out;
}

function geomRim(ctx, ink, accent, tier) {
  ctx.lineJoin = 'round';
  if (tier >= 4) {
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2.6;
    ctx.stroke();
  }
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.2;
  ctx.stroke();
}

function geomHilt(ctx, ink, accent, tier, halfW) {
  ctx.fillStyle = ink;
  ctx.fillRect(-halfW, 5.2, halfW * 2, 3.3);
  ctx.fillStyle = accent;
  ctx.fillRect(-halfW, 5.2, halfW * 2, 0.95);
  if (tier >= 3) {
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.moveTo(-halfW, 8.5);
    ctx.lineTo(-halfW - 5.4, 3.4);
    ctx.lineTo(-halfW + 0.4, 5.2);
    ctx.closePath();
    ctx.moveTo(halfW, 8.5);
    ctx.lineTo(halfW + 5.4, 3.4);
    ctx.lineTo(halfW - 0.4, 5.2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = accent;
    ctx.fillRect(-halfW - 4.6, 3.5, 2.3, 2.3);
    ctx.fillRect(halfW + 2.3, 3.5, 2.3, 2.3);
  }
  ctx.fillStyle = ink;
  ctx.fillRect(-1.85, 8.5, 3.7, 7);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 0.95;
  ctx.beginPath();
  ctx.moveTo(-1.85, 10.2);
  ctx.lineTo(1.85, 11.3);
  ctx.moveTo(-1.85, 12.5);
  ctx.lineTo(1.85, 13.6);
  ctx.stroke();
  ctx.fillStyle = tier >= 2 ? accent : ink;
  ctx.beginPath();
  ctx.arc(0, 17.3, tier >= 5 ? 2.9 : 2.2, 0, Math.PI * 2);
  ctx.fill();
  if (tier >= 2) {
    ctx.strokeStyle = '#fff6ea';
    ctx.lineWidth = 0.75;
    ctx.stroke();
  }
}

function geomSwordClassic(ctx, mid, hi, shade, ink, accent, tier) {
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.moveTo(0, -23);
  ctx.lineTo(4.7, -1);
  ctx.lineTo(2.6, 5.2);
  ctx.lineTo(-2.6, 5.2);
  ctx.lineTo(-4.7, -1);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = mid;
  ctx.beginPath();
  ctx.moveTo(0, -21.6);
  ctx.lineTo(2.7, -1);
  ctx.lineTo(1.3, 5.2);
  ctx.lineTo(-2.5, 5.2);
  ctx.lineTo(-4.4, -1);
  ctx.closePath();
  ctx.fill();
  geomRim(ctx, ink, accent, tier);
  ctx.strokeStyle = hi;
  ctx.lineWidth = 1.15;
  ctx.beginPath();
  ctx.moveTo(0, -17);
  ctx.lineTo(-0.5, 3);
  ctx.stroke();
  geomHilt(ctx, ink, accent, tier, 8);
}

function geomSwordNeedle(ctx, mid, hi, shade, ink, accent, tier) {
  ctx.fillStyle = mid;
  ctx.beginPath();
  ctx.moveTo(0, -24);
  ctx.lineTo(1.7, 1.5);
  ctx.lineTo(0.85, 6);
  ctx.lineTo(-0.85, 6);
  ctx.lineTo(-1.7, 1.5);
  ctx.closePath();
  ctx.fill();
  geomRim(ctx, ink, accent, tier);
  ctx.fillStyle = hi;
  ctx.beginPath();
  ctx.ellipse(0, -21.6, 1.7, 2.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.arc(0, 6.4, 4.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 6.4, 2.7, 0, Math.PI * 2);
  ctx.stroke();
  geomHilt(ctx, ink, accent, tier, 2.2);
}

function geomSwordFlame(ctx, mid, hi, shade, ink, accent, tier) {
  ctx.beginPath();
  ctx.moveTo(0, -24);
  ctx.quadraticCurveTo(9, -15, 3.4, -8);
  ctx.quadraticCurveTo(9.4, -1, 2.5, 5.2);
  ctx.lineTo(-2.3, 5.2);
  ctx.quadraticCurveTo(-8.2, 0, -2.6, -8);
  ctx.quadraticCurveTo(-7.2, -15, 0, -24);
  ctx.closePath();
  ctx.fillStyle = shade;
  ctx.fill();
  ctx.fillStyle = mid;
  ctx.fill();
  geomRim(ctx, ink, accent, tier);
  ctx.fillStyle = hi;
  ctx.beginPath();
  ctx.moveTo(0, -16);
  ctx.quadraticCurveTo(3.4, -10, 0.5, -4);
  ctx.quadraticCurveTo(2.6, 0, 0, 2.4);
  ctx.quadraticCurveTo(-1.6, -1, -0.5, -8);
  ctx.quadraticCurveTo(-2.2, -12, 0, -16);
  ctx.fill();
  geomHilt(ctx, ink, accent, tier, 7.2);
}

function geomSwordCrystal(ctx, mid, hi, shade, ink, accent, tier) {
  ctx.beginPath();
  ctx.moveTo(0, -24);
  ctx.lineTo(6.4, -10);
  ctx.lineTo(8, -1.5);
  ctx.lineTo(3.3, 5.2);
  ctx.lineTo(-3.3, 5.2);
  ctx.lineTo(-8, -1.5);
  ctx.lineTo(-6.4, -10);
  ctx.closePath();
  ctx.fillStyle = mid;
  ctx.fill();
  geomRim(ctx, ink, accent, tier);
  ctx.fillStyle = hi;
  ctx.beginPath();
  ctx.moveTo(0, -19);
  ctx.lineTo(3.3, -8);
  ctx.lineTo(0, 1.2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.moveTo(-6.6, -2);
  ctx.lineTo(-12.2, 1.4);
  ctx.lineTo(-5.6, 2.2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.05;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(7, -4.5);
  ctx.lineTo(12.4, -0.6);
  ctx.lineTo(5.8, 0.6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  geomHilt(ctx, ink, accent, tier, 6.4);
}

function geomSwordBanner(ctx, mid, hi, shade, ink, accent, tier) {
  ctx.fillStyle = ink;
  ctx.fillRect(5.4, -4, 2.2, 16);
  ctx.fillStyle = mid;
  ctx.beginPath();
  ctx.moveTo(7.6, -2);
  ctx.lineTo(15.6, 2.2);
  ctx.lineTo(7.6, 6.4);
  ctx.closePath();
  ctx.fill();
  geomRim(ctx, ink, accent, tier);
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(11, 2.2, 1.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.moveTo(0, -16);
  ctx.lineTo(3.5, 5.2);
  ctx.lineTo(-3.5, 5.2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = mid;
  ctx.beginPath();
  ctx.moveTo(0, -14.6);
  ctx.lineTo(2.1, 5.2);
  ctx.lineTo(-2.2, 5.2);
  ctx.closePath();
  ctx.fill();
  geomRim(ctx, ink, accent, tier);
  ctx.strokeStyle = hi;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -11);
  ctx.lineTo(0, 3);
  ctx.stroke();
  geomHilt(ctx, ink, accent, tier, 6.6);
}

function geomSwordCrescent(ctx, mid, hi, shade, ink, accent, tier) {
  ctx.beginPath();
  ctx.moveTo(-1.5, -23);
  ctx.bezierCurveTo(12, -20, 13, -2, 1.2, 5.4);
  ctx.bezierCurveTo(7.2, -2, 6.4, -16, -1.5, -23);
  ctx.closePath();
  ctx.fillStyle = shade;
  ctx.fill();
  ctx.fillStyle = mid;
  ctx.fill();
  geomRim(ctx, ink, accent, tier);
  ctx.fillStyle = hi;
  ctx.beginPath();
  ctx.arc(-2.2, -16, 2.1, 0, Math.PI * 2);
  ctx.fill();
  geomHilt(ctx, ink, accent, tier, 5.5);
}

function geomSwordFork(ctx, mid, hi, shade, ink, accent, tier) {
  ctx.fillStyle = '#c5d8ff';
  ctx.beginPath();
  ctx.moveTo(-0.4, 5.2);
  ctx.lineTo(-2.4, -2);
  ctx.lineTo(-8.2, -22);
  ctx.lineTo(-3.4, -16);
  ctx.lineTo(0.2, 5.2);
  ctx.closePath();
  ctx.fill();
  geomRim(ctx, ink, '#7eb0e8', tier);
  ctx.fillStyle = '#ffb09a';
  ctx.beginPath();
  ctx.moveTo(0.4, 5.2);
  ctx.lineTo(2.4, -2);
  ctx.lineTo(8.2, -22);
  ctx.lineTo(3.4, -16);
  ctx.lineTo(-0.2, 5.2);
  ctx.closePath();
  ctx.fill();
  geomRim(ctx, ink, '#e07a62', tier);
  geomHilt(ctx, ink, accent, tier, 7.4);
}

function geomSwordTriad(ctx, mid, hi, shade, ink, accent, tier) {
  var blades = [
    [-7.2, -14, '#9ad7ea', 1.75],
    [0, -22.5, mid, 2.05],
    [7.2, -14, '#d5defa', 1.75]
  ];
  var i;
  for (i = 0; i < blades.length; i++) {
    var b = blades[i];
    ctx.fillStyle = b[2];
    ctx.beginPath();
    ctx.moveTo(b[0], b[1]);
    ctx.lineTo(b[0] + b[3], 5.2);
    ctx.lineTo(b[0] - b[3], 5.2);
    ctx.closePath();
    ctx.fill();
    geomRim(ctx, ink, accent, tier >= 4 && i === 1 ? tier : 1);
  }
  geomHilt(ctx, ink, accent, tier, 10);
}

function geomSwordCleaver(ctx, mid, hi, shade, ink, accent, tier) {
  ctx.beginPath();
  ctx.moveTo(-3.4, 5.2);
  ctx.lineTo(-5.2, -6);
  ctx.lineTo(-5.2, -20);
  ctx.lineTo(8.2, -20);
  ctx.lineTo(8.8, -7);
  ctx.lineTo(3.4, 5.2);
  ctx.closePath();
  ctx.fillStyle = shade;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-2.2, 5.2);
  ctx.lineTo(-3.6, -6);
  ctx.lineTo(-3.6, -18.2);
  ctx.lineTo(6.6, -18.2);
  ctx.lineTo(7.1, -7);
  ctx.lineTo(2.2, 5.2);
  ctx.closePath();
  ctx.fillStyle = mid;
  ctx.fill();
  geomRim(ctx, ink, accent, tier);
  ctx.fillStyle = hi;
  ctx.beginPath();
  ctx.arc(1.4, -12.2, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(1.8, -12.2, 1.8, 0, Math.PI * 2);
  ctx.fill();
  geomHilt(ctx, ink, accent, tier, 6.2);
}

function geomSwordDivine(ctx, mid, hi, shade, ink, accent, tier) {
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.7;
  ctx.beginPath();
  ctx.arc(0, -3.5, 8.4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = hi;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.arc(0, -3.5, 6.3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.moveTo(0, -23);
  ctx.lineTo(3.3, -4);
  ctx.lineTo(2.2, 5.4);
  ctx.lineTo(-2.2, 5.4);
  ctx.lineTo(-3.3, -4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = mid;
  ctx.beginPath();
  ctx.moveTo(0, -21.4);
  ctx.lineTo(1.8, -4);
  ctx.lineTo(1, 5.4);
  ctx.lineTo(-2.1, 5.4);
  ctx.lineTo(-3.1, -4);
  ctx.closePath();
  ctx.fill();
  geomRim(ctx, ink, accent, tier);
  ctx.strokeStyle = hi;
  ctx.lineWidth = 1.15;
  ctx.beginPath();
  ctx.moveTo(0, -20);
  ctx.lineTo(0, 2);
  ctx.stroke();
  geomHilt(ctx, ink, accent, tier, 7.6);
}

function geomSwordSealed(ctx) {
  var ink = '#3a2c34';
  var cloth = '#8a7568';
  ctx.fillStyle = '#6e6168';
  ctx.beginPath();
  ctx.moveTo(0, -22);
  ctx.lineTo(3.6, 5.2);
  ctx.lineTo(-3.6, 5.2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.strokeStyle = cloth;
  ctx.lineWidth = 2.3;
  ctx.beginPath();
  ctx.moveTo(-3.2, -14);
  ctx.lineTo(3.2, -9);
  ctx.moveTo(-3.2, -6);
  ctx.lineTo(3.2, -1);
  ctx.moveTo(-3.2, 2);
  ctx.lineTo(3, 6.2);
  ctx.stroke();
  geomHilt(ctx, ink, '#6a5a64', 1, 7);
}

function geomBladeShape(ctx, id, pal, tier) {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (id === 'sealed') geomSwordSealed(ctx);
  else if (id === 'cheongmyeong') geomSwordNeedle(ctx, pal.mid, pal.hi, pal.shade, pal.ink, pal.accent, tier);
  else if (id === 'jeokyeom') geomSwordFlame(ctx, pal.mid, pal.hi, pal.shade, pal.ink, pal.accent, tier);
  else if (id === 'hanbing') geomSwordCrystal(ctx, pal.mid, pal.hi, pal.shade, pal.ink, pal.accent, tier);
  else if (id === 'jingak') geomSwordBanner(ctx, pal.mid, pal.hi, pal.shade, pal.ink, pal.accent, tier);
  else if (id === 'wolheun') geomSwordCrescent(ctx, pal.mid, pal.hi, pal.shade, pal.ink, pal.accent, tier);
  else if (id === 'sanggeuk') geomSwordFork(ctx, pal.mid, pal.hi, pal.shade, pal.ink, pal.accent, tier);
  else if (id === 'samjae') geomSwordTriad(ctx, pal.mid, pal.hi, pal.shade, pal.ink, pal.accent, tier);
  else if (id === 'saebyeok') geomSwordCleaver(ctx, pal.mid, pal.hi, pal.shade, pal.ink, pal.accent, tier);
  else if (id === 'mujeong') geomSwordDivine(ctx, pal.mid, pal.hi, pal.shade, pal.ink, pal.accent, tier);
  else geomSwordClassic(ctx, pal.mid, pal.hi, pal.shade, pal.ink, pal.accent, tier);
}

function drawGeomsinSword(ctx, family, tier, x, y, scale, opts) {
  opts = opts || {};
  tier = tier || 1;
  if (tier < 1) tier = 1;
  if (tier > 5) tier = 5;
  var locked = !!opts.locked;
  var id = locked ? 'sealed' : ((family && family.id) || 'hoegeom');
  var accent = GEOMSIN_TIER_ACCENT[tier - 1];
  var color = locked ? '#8d7d88' : family.color;
  var ink = locked ? '#3a2a32' : family.ink;
  if (opts.ghost && !locked) {
    color = geomMix(color, '#9a8c96', 0.42);
    ink = '#c3b6be';
    accent = geomMix(accent, '#9a8c96', 0.35);
  }
  ctx.save();
  ctx.translate(x, y);
  var grow = locked ? 1 : (0.96 + tier * 0.03);
  ctx.scale(scale || 1, (scale || 1) * grow);
  if (opts.ghost) ctx.globalAlpha *= 0.78;
  if (opts.shadow !== false) {
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(0, 18, 12, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (!locked && !opts.ghost && tier >= 5) {
    ctx.save();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.55;
    ctx.beginPath();
    ctx.arc(0, -2, 13.4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha *= 0.55;
    ctx.beginPath();
    ctx.arc(0, -2, 16, 0.5, Math.PI * 1.45);
    ctx.stroke();
    ctx.restore();
  }
  geomBladeShape(ctx, id, {
    mid: color,
    hi: geomMix(color, '#fff8ee', locked ? 0.15 : 0.62),
    shade: geomMix(color, '#1a1014', 0.32),
    ink: ink,
    accent: accent
  }, locked ? 1 : tier);
  ctx.restore();
}

function geomGhost(ctx, game, unit, x, y, cell) {
  var family = game.fam(unit.family);
  drawGeomsinSword(ctx, family, unit.tier, x, y, Math.max(0.7, cell / 78), { ghost: true, shadow: false });
}

function geomUnits(ctx, game) {
  var i;
  for (i = 0; i < game.cells.length; i++) {
    var unit = game.cells[i];
    if (!unit) continue;
    var cell = game.layout.cells[i];
    var family = game.fam(unit.family);
    var scale = Math.max(0.78, Math.min(1.55, Math.min(cell.w, cell.h) / 62));
    var age = game.anim - unit.born;
    var pop = age < 0.22 ? 0.55 + 0.45 * (age / 0.22) : 1;
    ctx.save();
    ctx.translate(unit.x, unit.y);
    ctx.scale(pop, pop);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(0, 16 * scale, 12 * scale, 4 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    if (unit.swing > 0 && !game.reduceMotion) {
      var aim = unit.aim == null ? -Math.PI / 2 : unit.aim;
      var mag = Math.sin(Math.max(0, Math.min(1, unit.swing)) * Math.PI);
      ctx.translate(Math.cos(aim) * 8 * scale * mag, Math.sin(aim) * 8 * scale * mag);
      ctx.rotate((aim + Math.PI / 2) * mag * 0.72);
    }
    drawGeomsinSword(ctx, family, unit.tier, 0, 0, scale, { shadow: false });
    ctx.restore();

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
      var pipY = Math.min(30 * scale, cell.h * 0.4);
      var tierColor = GEOMSIN_TIER_ACCENT[unit.tier - 1] || '#fff';
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
      ctx.moveTo(15 * scale, -17 * scale);
      ctx.lineTo(19 * scale, -11 * scale);
      ctx.lineTo(15 * scale, -13 * scale);
      ctx.lineTo(11 * scale, -11 * scale);
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

function geomFoeOutline(ctx, r) {
  ctx.strokeStyle = 'rgba(22, 10, 14, 0.78)';
  ctx.lineWidth = Math.max(1.25, r * 0.07);
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function geomShade(ctx, r, color) {
  var deep = geomMix(color, '#241018', 0.48);
  var face = geomMix(color, '#fffaf6', 0.84);
  ctx.beginPath();
  ctx.moveTo(0, -r * 1.08);
  ctx.bezierCurveTo(r * 0.95, -r * 0.62, r * 0.82, r * 0.02, r * 0.58, r * 0.38);
  ctx.quadraticCurveTo(r * 0.7, r * 0.72, r * 0.22, r * 0.5);
  ctx.quadraticCurveTo(r * 0.12, r * 0.88, -r * 0.08, r * 0.5);
  ctx.quadraticCurveTo(-r * 0.55, r * 0.78, -r * 0.58, r * 0.38);
  ctx.bezierCurveTo(-r * 0.82, r * 0.02, -r * 0.95, -r * 0.62, 0, -r * 1.08);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  geomFoeOutline(ctx, r);
  ctx.fillStyle = deep;
  ctx.beginPath();
  ctx.ellipse(0, -r * 0.58, r * 0.4, r * 0.36, 0, Math.PI, 0, true);
  ctx.fill();
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.ellipse(0, -r * 0.22, r * 0.32, r * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#24141c';
  ctx.beginPath();
  ctx.ellipse(-r * 0.13, -r * 0.26, r * 0.1, r * 0.06, -0.4, 0, Math.PI * 2);
  ctx.ellipse(r * 0.13, -r * 0.26, r * 0.1, r * 0.06, 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#8eb4d8';
  ctx.beginPath();
  ctx.moveTo(-r * 0.14, -r * 0.16);
  ctx.lineTo(-r * 0.05, r * 0.02);
  ctx.lineTo(-r * 0.22, r * 0.02);
  ctx.closePath();
  ctx.fill();
}

function geomWraith(ctx, r, color) {
  var deep = geomMix(color, '#2a1018', 0.55);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.95);
  ctx.lineTo(r * 0.46, -r * 0.2);
  ctx.lineTo(r * 0.22, r * 0.48);
  ctx.lineTo(r * 0.4, r * 1.05);
  ctx.lineTo(-r * 0.02, r * 0.62);
  ctx.lineTo(-r * 0.4, r * 1.08);
  ctx.lineTo(-r * 0.52, r * 0.12);
  ctx.lineTo(-r * 0.22, -r * 0.4);
  ctx.closePath();
  ctx.fill();
  geomFoeOutline(ctx, r);
  ctx.fillStyle = geomMix(color, '#fff4f6', 0.28);
  ctx.beginPath();
  ctx.moveTo(r * 0.02, -r * 0.2);
  ctx.lineTo(r * 1.42, -r * 0.48);
  ctx.lineTo(r * 0.12, r * 0.16);
  ctx.closePath();
  ctx.fill();
  geomFoeOutline(ctx, r);
  ctx.fillStyle = deep;
  ctx.beginPath();
  ctx.moveTo(-r * 0.1, -r * 0.48);
  ctx.lineTo(-r * 0.38, -r * 1.05);
  ctx.lineTo(0, -r * 0.28);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(r * 0.08, -r * 0.5);
  ctx.lineTo(r * 0.34, -r * 1.08);
  ctx.lineTo(r * 0.02, -r * 0.26);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#1a0c10';
  ctx.fillRect(-r * 0.22, -r * 0.18, r * 0.5, r * 0.16);
  ctx.fillStyle = '#ffe4ea';
  ctx.fillRect(-r * 0.12, -r * 0.14, r * 0.12, r * 0.08);
  ctx.fillRect(r * 0.08, -r * 0.14, r * 0.12, r * 0.08);
}

function geomIron(ctx, r, color) {
  var deep = geomMix(color, '#1a1814', 0.5);
  ctx.fillStyle = deep;
  ctx.beginPath();
  ctx.arc(-r * 0.64, -r * 0.02, r * 0.4, 0, Math.PI * 2);
  ctx.arc(r * 0.64, -r * 0.02, r * 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  geomRoundRect(ctx, -r * 0.5, -r * 0.22, r, r * 1.08, r * 0.12);
  ctx.fill();
  geomFoeOutline(ctx, r);
  ctx.fillStyle = deep;
  ctx.fillRect(-r * 0.5, r * 0.22, r, r * 0.16);
  ctx.beginPath();
  ctx.moveTo(-r * 0.48, -r * 0.1);
  ctx.lineTo(-r * 0.32, -r * 0.78);
  ctx.lineTo(0, -r * 1.22);
  ctx.lineTo(r * 0.32, -r * 0.78);
  ctx.lineTo(r * 0.48, -r * 0.1);
  ctx.closePath();
  ctx.fill();
  geomFoeOutline(ctx, r);
  ctx.fillStyle = '#8d3a32';
  ctx.fillRect(-r * 0.07, -r * 1.36, r * 0.14, r * 0.24);
  ctx.fillStyle = '#14110e';
  ctx.fillRect(-r * 0.3, -r * 0.46, r * 0.6, r * 0.15);
  ctx.fillStyle = '#f3e6bc';
  ctx.fillRect(-r * 0.18, -r * 0.42, r * 0.1, r * 0.08);
  ctx.fillRect(r * 0.08, -r * 0.42, r * 0.1, r * 0.08);
  ctx.fillStyle = '#5e5a54';
  var i;
  for (i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(-r * 0.26 + i * r * 0.26, r * 0.05, Math.max(1.1, r * 0.07), 0, Math.PI * 2);
    ctx.fill();
  }
}

function geomWisp(ctx, r, color, anim) {
  var flick = Math.sin((anim || 0) * 7) * r * 0.08;
  ctx.fillStyle = geomMix(color, '#ffd7a2', 0.28);
  ctx.beginPath();
  ctx.moveTo(0, -r * 1.62 + flick);
  ctx.quadraticCurveTo(r * 1.15, -r * 0.4, r * 0.42, r * 0.62);
  ctx.quadraticCurveTo(r * 0.12, r * 0.12, 0, r * 0.78);
  ctx.quadraticCurveTo(-r * 0.12, r * 0.12, -r * 0.42, r * 0.62);
  ctx.quadraticCurveTo(-r * 1.15, -r * 0.4, 0, -r * 1.62 + flick);
  ctx.closePath();
  ctx.fill();
  geomFoeOutline(ctx, r);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(r * 0.1, -r * 0.15);
  ctx.quadraticCurveTo(r * 1.25, r * 0.2, r * 0.28, r * 0.5);
  ctx.quadraticCurveTo(r * 0.45, 0, r * 0.1, -r * 0.15);
  ctx.fill();
  ctx.fillStyle = '#fff3c2';
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.9);
  ctx.quadraticCurveTo(r * 0.4, -r * 0.05, 0, r * 0.32);
  ctx.quadraticCurveTo(-r * 0.4, -r * 0.05, 0, -r * 0.9);
  ctx.fill();
  ctx.fillStyle = '#5c2412';
  ctx.beginPath();
  ctx.moveTo(-r * 0.06, -r * 0.55);
  ctx.lineTo(-r * 0.58, -r * 1.2);
  ctx.lineTo(r * 0.02, -r * 0.32);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(r * 0.06, -r * 0.55);
  ctx.lineTo(r * 0.58, -r * 1.2);
  ctx.lineTo(-r * 0.02, -r * 0.32);
  ctx.fill();
  ctx.fillStyle = '#3a140c';
  ctx.beginPath();
  ctx.arc(-r * 0.14, -r * 0.12, Math.max(1.15, r * 0.13), 0, Math.PI * 2);
  ctx.arc(r * 0.14, -r * 0.12, Math.max(1.15, r * 0.13), 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#3a140c';
  ctx.lineWidth = Math.max(1.1, r * 0.1);
  ctx.beginPath();
  ctx.arc(0, r * 0.02, r * 0.18, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
  var baseAlpha = ctx.globalAlpha;
  var i;
  for (i = 0; i < 3; i++) {
    var a = (anim || 0) * 2.2 + i * 2.1;
    ctx.globalAlpha = baseAlpha * 0.8;
    ctx.fillStyle = i === 1 ? '#fff1c4' : color;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * r * 0.95, r * 0.45 + Math.sin(a * 1.4) * r * 0.35, 1.35, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = baseAlpha;
}

function geomBossOni(ctx, r, color, anim) {
  var deep = geomMix(color, '#2a0c08', 0.5);
  var hi = geomMix(color, '#ffd0b0', 0.4);
  var flick = Math.sin((anim || 0) * 8) * r * 0.04;
  ctx.fillStyle = '#ffb15a';
  ctx.beginPath();
  ctx.moveTo(-r * 0.15, -r * 0.2);
  ctx.lineTo(-r * 0.55, -r * 1.05 + flick);
  ctx.lineTo(-r * 0.08, -r * 0.45);
  ctx.lineTo(0, -r * 1.22 - flick);
  ctx.lineTo(r * 0.08, -r * 0.45);
  ctx.lineTo(r * 0.55, -r * 0.98 + flick);
  ctx.lineTo(r * 0.15, -r * 0.2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#f6e6c4';
  ctx.strokeStyle = deep;
  ctx.lineWidth = Math.max(1.3, r * 0.05);
  ctx.beginPath();
  ctx.moveTo(-r * 0.22, -r * 0.35);
  ctx.quadraticCurveTo(-r * 0.95, -r * 0.95, -r * 1.22, -r * 1.55);
  ctx.quadraticCurveTo(-r * 0.68, -r * 0.78, -r * 0.08, -r * 0.28);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(r * 0.22, -r * 0.35);
  ctx.quadraticCurveTo(r * 0.95, -r * 0.95, r * 1.22, -r * 1.55);
  ctx.quadraticCurveTo(r * 0.68, -r * 0.78, r * 0.08, -r * 0.28);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(0, r * 0.15, r * 0.95, r * 0.78, 0, 0, Math.PI * 2);
  ctx.fill();
  geomFoeOutline(ctx, r);
  ctx.fillStyle = hi;
  ctx.beginPath();
  ctx.ellipse(0, r * 0.32, r * 0.4, r * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1a0a08';
  ctx.beginPath();
  ctx.ellipse(-r * 0.32, -r * 0.05, r * 0.16, r * 0.1, -0.35, 0, Math.PI * 2);
  ctx.ellipse(r * 0.32, -r * 0.05, r * 0.16, r * 0.1, 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffd24a';
  ctx.beginPath();
  ctx.arc(-r * 0.3, -r * 0.05, r * 0.055, 0, Math.PI * 2);
  ctx.arc(r * 0.3, -r * 0.05, r * 0.055, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = deep;
  ctx.lineWidth = Math.max(2, r * 0.08);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-r * 0.52, -r * 0.26);
  ctx.lineTo(-r * 0.12, -r * 0.14);
  ctx.moveTo(r * 0.52, -r * 0.26);
  ctx.lineTo(r * 0.12, -r * 0.14);
  ctx.stroke();
  ctx.fillStyle = '#2a100c';
  ctx.beginPath();
  ctx.ellipse(0, r * 0.28, r * 0.28, r * 0.14, 0, 0, Math.PI);
  ctx.fill();
  ctx.fillStyle = '#fff6e8';
  ctx.beginPath();
  ctx.moveTo(-r * 0.16, r * 0.24);
  ctx.lineTo(-r * 0.08, r * 0.46);
  ctx.lineTo(-r * 0.01, r * 0.24);
  ctx.moveTo(r * 0.16, r * 0.24);
  ctx.lineTo(r * 0.08, r * 0.46);
  ctx.lineTo(r * 0.01, r * 0.24);
  ctx.fill();
}

function geomBossMask(ctx, r, color) {
  var deep = geomMix(color, '#161820', 0.62);
  ctx.fillStyle = deep;
  ctx.beginPath();
  ctx.moveTo(-r * 0.78, -r * 0.75);
  ctx.lineTo(-r * 1.28, r * 0.2);
  ctx.lineTo(-r * 0.66, r * 0.02);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(r * 0.78, -r * 0.9);
  ctx.lineTo(r * 1.3, 0);
  ctx.lineTo(r * 0.64, r * 0.12);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(16, 16, 24, 0.7)';
  ctx.lineWidth = Math.max(1.1, r * 0.045);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-r * 0.4, -r * 0.32);
  ctx.lineTo(-r * 0.62, r * 1.08);
  ctx.lineTo(-r * 0.18, r * 0.7);
  ctx.lineTo(0, r * 1.22);
  ctx.lineTo(r * 0.2, r * 0.68);
  ctx.lineTo(r * 0.58, r * 1.05);
  ctx.lineTo(r * 0.38, -r * 0.32);
  ctx.closePath();
  ctx.fill();
  geomFoeOutline(ctx, r);
  ctx.fillStyle = geomMix(color, '#ffffff', 0.62);
  ctx.beginPath();
  ctx.moveTo(0, -r * 1.32);
  ctx.quadraticCurveTo(r * 0.5, -r * 1.05, r * 0.4, -r * 0.52);
  ctx.quadraticCurveTo(r * 0.16, -r * 0.22, 0, -r * 0.28);
  ctx.quadraticCurveTo(-r * 0.16, -r * 0.22, -r * 0.4, -r * 0.52);
  ctx.quadraticCurveTo(-r * 0.5, -r * 1.05, 0, -r * 1.32);
  ctx.closePath();
  ctx.fill();
  geomFoeOutline(ctx, r);
  ctx.strokeStyle = deep;
  ctx.lineWidth = Math.max(1.3, r * 0.045);
  ctx.beginPath();
  ctx.moveTo(0, -r * 1.12);
  ctx.lineTo(-r * 0.05, -r * 0.82);
  ctx.lineTo(r * 0.06, -r * 0.5);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-r * 0.14, -r * 0.48);
  ctx.lineTo(r * 0.14, -r * 0.48);
  ctx.stroke();
}

function geomBossJudge(ctx, r, color, anim) {
  var deep = geomMix(color, '#2a1c08', 0.55);
  var hi = geomMix(color, '#fff6d4', 0.5);
  ctx.strokeStyle = hi;
  ctx.lineWidth = Math.max(2, r * 0.07);
  ctx.beginPath();
  ctx.arc(0, -r * 0.12, r * 1.15, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = deep;
  ctx.lineWidth = Math.max(1.1, r * 0.035);
  ctx.beginPath();
  ctx.arc(0, -r * 0.12, r * 1.32, (anim || 0) * 0.3, Math.PI * 1.15 + (anim || 0) * 0.3);
  ctx.stroke();
  ctx.fillStyle = deep;
  ctx.beginPath();
  ctx.moveTo(0, -r * 1.42);
  ctx.lineTo(r * 0.14, r * 0.15);
  ctx.lineTo(r * 0.08, r * 0.95);
  ctx.lineTo(-r * 0.08, r * 0.95);
  ctx.lineTo(-r * 0.14, r * 0.15);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-r * 0.88, -r * 0.12);
  ctx.lineTo(-r * 0.7, r * 0.88);
  ctx.lineTo(r * 0.7, r * 0.88);
  ctx.lineTo(r * 0.88, -r * 0.12);
  ctx.lineTo(r * 0.42, -r * 0.48);
  ctx.lineTo(-r * 0.42, -r * 0.48);
  ctx.closePath();
  ctx.fill();
  geomFoeOutline(ctx, r);
  ctx.strokeStyle = deep;
  ctx.lineWidth = Math.max(1.3, r * 0.045);
  ctx.beginPath();
  ctx.moveTo(-r * 0.62, r * 0.08);
  ctx.lineTo(r * 0.62, r * 0.08);
  ctx.moveTo(-r * 0.56, r * 0.34);
  ctx.lineTo(r * 0.56, r * 0.34);
  ctx.moveTo(-r * 0.5, r * 0.6);
  ctx.lineTo(r * 0.5, r * 0.6);
  ctx.stroke();
  ctx.fillStyle = hi;
  ctx.beginPath();
  ctx.moveTo(-r * 0.52, -r * 0.5);
  ctx.lineTo(-r * 0.36, -r * 1.28);
  ctx.lineTo(-r * 0.12, -r * 0.46);
  ctx.lineTo(0, -r * 1.52);
  ctx.lineTo(r * 0.12, -r * 0.46);
  ctx.lineTo(r * 0.36, -r * 1.28);
  ctx.lineTo(r * 0.52, -r * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = deep;
  ctx.lineWidth = Math.max(1.2, r * 0.04);
  ctx.stroke();
  ctx.fillStyle = geomMix(color, '#fffaf0', 0.28);
  ctx.beginPath();
  ctx.ellipse(0, -r * 0.18, r * 0.3, r * 0.24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1a1208';
  ctx.beginPath();
  ctx.moveTo(-r * 0.24, -r * 0.26);
  ctx.lineTo(-r * 0.05, -r * 0.2);
  ctx.lineTo(-r * 0.22, -r * 0.12);
  ctx.closePath();
  ctx.moveTo(r * 0.24, -r * 0.26);
  ctx.lineTo(r * 0.05, -r * 0.2);
  ctx.lineTo(r * 0.22, -r * 0.12);
  ctx.closePath();
  ctx.fill();
}

function geomFoeBody(ctx, kind, color, r, anim) {
  if (kind === 'wraith') geomWraith(ctx, r, color);
  else if (kind === 'iron') geomIron(ctx, r, color);
  else if (kind === 'wisp') geomWisp(ctx, r, color, anim);
  else if (kind === 'boss1') geomBossOni(ctx, r, color, anim);
  else if (kind === 'boss2') geomBossMask(ctx, r, color);
  else if (kind === 'boss3') geomBossJudge(ctx, r, color, anim);
  else geomShade(ctx, r, color);
}

function geomFrost(ctx, r, anim) {
  ctx.save();
  ctx.strokeStyle = '#d5e6ff';
  ctx.lineWidth = 1.7;
  ctx.beginPath();
  ctx.arc(0, 0, r + 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#f4f8ff';
  var s;
  for (s = 0; s < 4; s++) {
    var a = anim * 0.6 + s * Math.PI / 2;
    var cx = Math.cos(a) * (r + 1.5);
    var cy = Math.sin(a) * (r + 1.5);
    ctx.beginPath();
    ctx.moveTo(cx, cy - 3.5);
    ctx.lineTo(cx + 2.6, cy);
    ctx.lineTo(cx, cy + 3.5);
    ctx.lineTo(cx - 2.6, cy);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function geomEnemy(ctx, enemy, game) {
  if (enemy.x == null) return;
  var r = (enemy.drawRadius || 12) * 1.1;
  var kind = enemy.type || enemy.shape || 'shade';
  if (kind === 'boss') kind = 'boss1';
  var wobble = 0;
  var anim = 0;
  if (!game.reduceMotion) {
    anim = game.anim;
    var amp = (kind === 'iron' || kind === 'boss2' || kind === 'boss3') ? 0.4 : (kind === 'wisp' ? 1.7 : 0.95);
    var speed = kind === 'wisp' ? 6.2 : 2.5;
    wobble = Math.sin(game.anim * speed + (enemy.progress || 0) * 12 + (enemy.uid || 0)) * amp;
  }
  ctx.save();
  ctx.translate(enemy.x, enemy.y + wobble);
  ctx.scale(enemy.face || 1, 1);
  if (enemy.flash > 0) {
    var squash = Math.min(1, enemy.flash / 0.14);
    ctx.scale(1 + 0.12 * squash, 1 - 0.08 * squash);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.beginPath();
  ctx.ellipse(0, r * 0.98, r * (kind === 'iron' || kind === 'boss1' ? 1.05 : 0.7), r * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  geomFoeBody(ctx, kind, enemy.color || '#d2c6d6', r, anim);
  if (enemy.flash > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(0.4, enemy.flash / 0.14);
    geomFoeBody(ctx, kind, '#fff6ea', r, anim);
    ctx.restore();
  }
  if (enemy.slowUntil && game.time < enemy.slowUntil) geomFrost(ctx, r, anim);
  ctx.restore();

  if (enemy.maxHp && (enemy.boss || enemy.hp < enemy.maxHp)) {
    var top = GEOMSIN_FOE_TOP[kind] || 1.25;
    var bw = Math.max(18, r * 2.1);
    var pct = Math.max(0, enemy.hp / enemy.maxHp);
    var by = enemy.y - r * top - 5;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(enemy.x - bw / 2, by, bw, 4);
    ctx.fillStyle = enemy.boss ? '#e6c27a' : '#d2554a';
    ctx.fillRect(enemy.x - bw / 2, by, Math.max(0, bw * pct), 4);
    if (enemy.boss && enemy.name) {
      ctx.fillStyle = '#f4ead8';
      ctx.font = '700 12px ' + GEOMSIN_FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(enemy.name, enemy.x, by - 1);
    }
  }
}

function geomBeam(ctx, x1, y1, x2, y2, color) {
  var dx = x2 - x1;
  var dy = y2 - y1;
  var len = Math.hypot(dx, dy) || 1;
  var nx = -dy / len;
  var ny = dx / len;
  ctx.fillStyle = hexAlpha(color, 0.5);
  ctx.beginPath();
  ctx.moveTo(x1 + nx * 0.7, y1 + ny * 0.7);
  ctx.lineTo(x2 + nx * 4.4, y2 + ny * 4.4);
  ctx.lineTo(x2 - nx * 4.4, y2 - ny * 4.4);
  ctx.lineTo(x1 - nx * 0.7, y1 - ny * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#fff8ea';
  ctx.lineWidth = 1.35;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function geomFx(ctx, game) {
  var i;
  for (i = 0; i < game.fx.length; i++) {
    var fx = game.fx[i];
    var alpha = Math.max(0, fx.life / fx.max);
    ctx.save();
    ctx.globalAlpha = alpha;
    if (fx.kind === 'line') {
      geomBeam(ctx, fx.x1, fx.y1, fx.x2, fx.y2, fx.color);
    } else if (fx.kind === 'slash') {
      ctx.translate(fx.x, fx.y);
      ctx.rotate(fx.angle || 0);
      ctx.strokeStyle = fx.color;
      ctx.lineWidth = 3.2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(0, 0, 16, -1.2, 1.05);
      ctx.stroke();
      ctx.strokeStyle = '#fff8ea';
      ctx.lineWidth = 1.45;
      ctx.beginPath();
      ctx.arc(0, 0, 9.5, -0.95, 0.8);
      ctx.stroke();
    } else if (fx.kind === 'ring' || fx.kind === 'burst') {
      var p = 1 - alpha;
      var radius = fx.kind === 'burst' ? 8 + 28 * p : (fx.r || 20) * (0.72 + 0.4 * p);
      ctx.strokeStyle = fx.color;
      ctx.lineWidth = fx.kind === 'burst' ? 3 : 2.4;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      if (fx.kind === 'burst') {
        ctx.lineWidth = 2;
        var b;
        for (b = 0; b < 6; b++) {
          var a = (b / 6) * Math.PI * 2 + 0.4;
          ctx.beginPath();
          ctx.moveTo(fx.x + Math.cos(a) * radius * 0.45, fx.y + Math.sin(a) * radius * 0.45);
          ctx.lineTo(fx.x + Math.cos(a) * (radius + 7), fx.y + Math.sin(a) * (radius + 7));
          ctx.stroke();
        }
      }
    } else if (fx.kind === 'soul') {
      var rise = 1 - alpha;
      var soulKind = fx.type || fx.shape || 'shade';
      if (soulKind === 'boss') soulKind = 'boss1';
      ctx.save();
      ctx.translate(fx.x, fx.y - 6 - rise * 28);
      ctx.globalAlpha = alpha * 0.82;
      ctx.scale(1 + rise * 0.4, 1 + rise * 0.16);
      geomFoeBody(ctx, soulKind, fx.color || '#d2c6d6', fx.r || 14, 0);
      ctx.restore();
      ctx.strokeStyle = fx.color || '#f4ead8';
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      var s;
      for (s = 0; s < 5; s++) {
        var ang = -Math.PI / 2 + (s - 2) * 0.55;
        var inner = (fx.r || 14) * 0.15;
        var outer = (fx.r || 14) + 6 + rise * 18;
        ctx.globalAlpha = alpha * 0.9;
        ctx.beginPath();
        ctx.moveTo(fx.x + Math.cos(ang) * inner, fx.y + Math.sin(ang) * inner);
        ctx.lineTo(fx.x + Math.cos(ang) * outer, fx.y + Math.sin(ang) * outer - rise * 10);
        ctx.stroke();
      }
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
globalThis.drawGeomsinSword = drawGeomsinSword;
