/* DOM, input, and the frame loop. */
'use strict';

var balance = globalThis.GEOMSIN_BALANCE;
var canvas = document.getElementById('view');
var ctx = canvas.getContext('2d');
var stage = document.getElementById('stage');
var audio = new globalThis.GeomsinAudio(balance.meta.muteKey);
var reduceMotion = false;
try {
  reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
} catch (err) {
  reduceMotion = false;
}

var game = new globalThis.GeomsinGameKit.Game({ reduceMotion: reduceMotion });
game.onEvent = function (name) {
  audio.play(name);
  if (name === 'craft') renderRecipes(true);
};
globalThis.__geomsin = game;

var hud = document.getElementById('hud');
var preview = document.getElementById('preview');
var inspect = document.getElementById('inspect');
var statusEl = document.getElementById('status');
var live = document.getElementById('live');
var title = document.getElementById('title');
var gameover = document.getElementById('gameover');
var gate = document.getElementById('gate');
var codex = document.getElementById('codex');
var codexList = document.getElementById('codex-list');
var recipe = document.getElementById('recipe');
var recipeList = document.getElementById('recipe-list');
var lastStatus = '';
var recipeSig = '';
var codexOpen = false;

function formatClock(seconds) {
  if (seconds == null || !isFinite(seconds)) return '—';
  var t = Math.max(0, Math.floor(seconds));
  var m = Math.floor(t / 60);
  var s = t % 60;
  return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
}

function bestLine(best) {
  if (!best.bestWave && !best.wins && !best.bestKills) return '아직 기록이 없다.';
  var line = '최고 도달 ' + best.bestWave + '파 · 처치 ' + best.bestKills;
  if (best.wins) line += ' · 승리 ' + best.wins + '회 · 최단 ' + formatClock(best.bestWinSeconds);
  return line;
}

function waveFraction(current) {
  if (!current) return '—';
  if (game.endless || current > balance.waves.length) return current + ' · 무한';
  return current + ' / ' + balance.waves.length;
}

function renderRecipes(force) {
  var rows = game.recipeRows();
  var sig = rows.map(function (row) { return row.id + (row.ready ? '1' : '0'); }).join('|');
  if (!force && sig === recipeSig) return;
  recipeSig = sig;
  recipeList.textContent = '';
  rows.forEach(function (row) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'recipe-btn' + (row.ready ? ' is-ready' : '');
    button.setAttribute('data-recipe', row.id);
    var name = document.createElement('b');
    name.textContent = row.name + ' · ' + row.resultTier;
    var need = document.createElement('span');
    need.textContent = row.needs;
    var blurb = document.createElement('small');
    blurb.textContent = row.blurb;
    button.appendChild(name);
    button.appendChild(need);
    button.appendChild(blurb);
    recipeList.appendChild(button);
  });
}

function setText(id, text) {
  var node = document.getElementById(id);
  if (node.textContent !== text) node.textContent = text;
}

function syncUi() {
  var phase = game.phase;
  var playing = phase === 'prep' || phase === 'combat';
  hud.hidden = phase === 'title';
  document.getElementById('dock').hidden = !playing;
  preview.hidden = !playing;
  inspect.hidden = !playing;
  statusEl.hidden = !playing;
  if (phase !== 'title') codexOpen = false;
  title.hidden = phase !== 'title' || codexOpen;
  codex.hidden = !codexOpen;
  gate.hidden = phase !== 'gate';
  gameover.hidden = phase !== 'won' && phase !== 'lost';
  if (!recipe.hidden && !playing) closeRecipe();

  var shownWave = game.displayWave();
  setText('hud-wave', waveFraction(shownWave));
  setText('hud-gold', String(game.gold));
  setText('hud-lives', String(game.lives));
  setText('hud-time', game.clockText());
  var livesEl = document.getElementById('hud-lives');
  livesEl.className = game.lives <= 5 ? 'danger' : '';

  preview.textContent = game.previewText();
  inspect.textContent = game.inspectText();

  var summonLabel = game.hand ? '배치 대기' : '소환';
  var summonCost = game.hand ? game.unitLabel(game.hand) : String(game.summonCost());
  setText('lbl-summon', summonLabel);
  setText('cost-summon', summonCost);
  var summonBtn = document.getElementById('btn-summon');
  summonBtn.classList.toggle('is-wait', !!game.hand);
  summonBtn.classList.toggle('is-broke', !game.hand && game.gold < game.summonCost());

  setText('cost-reroll', String(balance.meta.rerollCost));
  document.getElementById('btn-reroll').classList.toggle('is-broke', !game.hand || game.gold < balance.meta.rerollCost);

  var maxed = game.summonLevel >= balance.meta.maxSummonLevel;
  setText('lbl-upgrade', '각성 ' + game.summonLevel);
  setText('cost-upgrade', maxed ? '정점' : String(game.upgradeCost()));
  document.getElementById('btn-upgrade').classList.toggle('is-broke', !maxed && game.gold < game.upgradeCost());

  var ready = 0;
  var rows = game.recipeRows();
  var r;
  for (r = 0; r < rows.length; r++) if (rows[r].ready) ready += 1;
  setText('cost-recipe', ready ? (ready + '개') : '조합');
  document.getElementById('btn-recipe').classList.toggle('is-ready', ready > 0);

  var sell = game.pendingSellValue();
  setText('cost-sell', sell ? ('+' + sell) : '—');

  if (phase === 'prep') {
    setText('lbl-call', '출진');
    setText('cost-call', Math.ceil(game.prepLeft) + '초');
  } else if (phase === 'combat') {
    setText('lbl-call', '전투');
    setText('cost-call', '적 ' + game.livingEnemies().length);
  } else {
    setText('lbl-call', '출진');
    setText('cost-call', '—');
  }

  if (game.status !== lastStatus) {
    lastStatus = game.status;
    statusEl.textContent = game.status;
    live.textContent = game.status;
  }

  setText('btn-mute', audio.muted ? '소리 끔' : '소리');
  document.getElementById('btn-mute').setAttribute('aria-pressed', audio.muted ? 'true' : 'false');

  setText('title-best', bestLine(game.best));
  if (phase === 'won' || phase === 'lost') {
    document.getElementById('over-kicker').textContent = phase === 'won' ? '회검각의 문' : '제 ' + game.wave + '파';
    document.getElementById('over-title').textContent = phase === 'won' ? '검신이 돌아왔다' : '검이 꺾였다';
    document.getElementById('over-flavor').textContent = phase === 'won'
      ? '열다섯 번째 파도가 걷혔다. 전생의 검이 당신의 손에 남는다.'
      : (game.endless
        ? '무한의 검로에서 잔념이 문턱을 넘었다. 열다섯 파도의 승리는 기록에 남아 있다.'
        : '잔념이 문턱을 넘었다. 검은 다시 재 속에 묻힌다.');
    setText('stat-wave', waveFraction(game.wave));
    setText('stat-kills', String(game.kills));
    setText('stat-merges', String(game.merges));
    setText('stat-leaks', String(game.leaked));
    setText('stat-time', game.clockText());
    setText('stat-gold', String(game.goldEarned));
    setText('over-best', bestLine(game.best));
  }
  if (phase === 'gate') {
    setText('gate-wave', game.wave + ' / ' + balance.waves.length);
    setText('gate-kills', String(game.kills));
    setText('gate-time', game.clockText());
    setText('gate-best', bestLine(game.best));
  }

  if (!recipe.hidden) renderRecipes(false);
}

function resize() {
  var rect = stage.getBoundingClientRect();
  var w = Math.max(1, rect.width);
  var h = Math.max(1, rect.height);
  var dpr = Math.min(2, window.devicePixelRatio || 1);
  var bw = Math.round(w * dpr);
  var bh = Math.round(h * dpr);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  game.setView(w, h);
}

function openRecipe() {
  if (game.phase !== 'prep' && game.phase !== 'combat') return;
  game.hold = true;
  recipe.hidden = false;
  renderRecipes(true);
  audio.play('ui');
}

function closeRecipe() {
  recipe.hidden = true;
  game.hold = false;
}

function renderCodex() {
  var progress = game.codexProgress();
  setText(
    'codex-progress',
    '발견한 검 ' + progress.families + ' / ' + progress.familyTotal +
      ' · 등급 ' + progress.tiers + ' / ' + progress.tierTotal
  );
  codexList.textContent = '';
  game.codexRows().forEach(function (row) {
    var card = document.createElement('article');
    card.className = 'codex-card' + (row.known ? '' : ' is-locked');
    card.setAttribute('data-family', row.id);
    var swatch = document.createElement('i');
    swatch.className = 'codex-swatch';
    swatch.style.background = row.color;
    swatch.setAttribute('aria-hidden', 'true');
    var body = document.createElement('div');
    body.className = 'codex-body';
    var name = document.createElement('b');
    name.textContent = row.known && row.epithet ? (row.name + ' · ' + row.epithet) : row.name;
    var meta = document.createElement('span');
    meta.className = 'codex-meta';
    meta.textContent = row.known
      ? ((row.pool ? '소환' : '비급') + (row.skill ? (' · ' + row.skill) : ''))
      : (row.pool ? '소환' : '비급');
    var tiers = document.createElement('span');
    tiers.className = 'codex-tiers';
    row.tiers.forEach(function (tier, index) {
      if (index) tiers.appendChild(document.createTextNode(' '));
      var mark = document.createElement('em');
      mark.className = tier.known ? 'is-known' : 'is-miss';
      mark.textContent = tier.known ? tier.name : '미지';
      tiers.appendChild(mark);
    });
    var flavor = document.createElement('small');
    flavor.textContent = row.flavor;
    body.appendChild(name);
    body.appendChild(meta);
    body.appendChild(tiers);
    body.appendChild(flavor);
    card.appendChild(swatch);
    card.appendChild(body);
    codexList.appendChild(card);
  });
}

function openCodex() {
  if (game.phase !== 'title') return;
  codexOpen = true;
  codex.hidden = false;
  title.hidden = true;
  renderCodex();
  audio.play('ui');
}

function closeCodex() {
  codexOpen = false;
  codex.hidden = true;
  if (game.phase === 'title') title.hidden = false;
}

function onKey(event) {
  if (event.repeat) return;
  var key = event.key.toLowerCase();
  var phase = game.phase;
  if (!codex.hidden && key !== 'escape' && key !== 'enter' && key !== ' ') return;
  if (key === 'escape') {
    if (!codex.hidden) {
      closeCodex();
      event.preventDefault();
    } else if (!recipe.hidden) {
      closeRecipe();
      event.preventDefault();
    } else if (phase === 'gate') {
      game.claimVictory();
      event.preventDefault();
    } else if (game.selected != null) {
      game.selected = null;
      event.preventDefault();
    }
    return;
  }
  if (!codex.hidden && (key === 'enter' || key === ' ')) {
    closeCodex();
    event.preventDefault();
    return;
  }
  if (phase === 'gate' && key === 'enter') {
    audio.resume();
    game.continueEndless();
    event.preventDefault();
    return;
  }
  if (phase === 'title' && (key === 'enter' || key === ' ')) {
    audio.resume();
    game.start();
    event.preventDefault();
    return;
  }
  if ((phase === 'won' || phase === 'lost') && (key === 'enter' || key === 'r')) {
    audio.resume();
    game.start();
    event.preventDefault();
    return;
  }
  if (phase !== 'prep' && phase !== 'combat') return;
  var handled = true;
  if (key === 'm') audio.toggle();
  else if (key === 'b') {
    if (recipe.hidden) openRecipe();
    else closeRecipe();
  } else if (!recipe.hidden) {
    handled = false;
  } else if (key === ' ' || key === 's') game.summon();
  else if (key === 'r') game.reroll();
  else if (key === 'u') game.upgrade();
  else if (key === 'x') game.sell();
  else if (key === 'enter') game.callWave();
  else handled = false;
  if (handled) event.preventDefault();
}

function canvasPoint(event) {
  var rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

document.getElementById('btn-start').addEventListener('click', function () {
  audio.resume();
  game.start();
});
document.getElementById('btn-codex').addEventListener('click', function () {
  audio.resume();
  openCodex();
});
document.getElementById('codex-close').addEventListener('click', function () {
  closeCodex();
});
codex.addEventListener('click', function (event) {
  if (event.target === codex) closeCodex();
});
document.getElementById('btn-endless').addEventListener('click', function () {
  audio.resume();
  game.continueEndless();
});
document.getElementById('btn-claim').addEventListener('click', function () {
  audio.resume();
  game.claimVictory();
});
document.getElementById('btn-restart').addEventListener('click', function () {
  audio.resume();
  game.start();
});
document.getElementById('btn-summon').addEventListener('click', function () {
  audio.resume();
  game.summon();
});
document.getElementById('btn-reroll').addEventListener('click', function () {
  audio.resume();
  game.reroll();
});
document.getElementById('btn-upgrade').addEventListener('click', function () {
  audio.resume();
  game.upgrade();
});
document.getElementById('btn-sell').addEventListener('click', function () {
  audio.resume();
  game.sell();
});
document.getElementById('btn-call').addEventListener('click', function () {
  audio.resume();
  game.callWave();
});
document.getElementById('btn-recipe').addEventListener('click', function () {
  audio.resume();
  openRecipe();
});
document.getElementById('recipe-close').addEventListener('click', function () {
  closeRecipe();
});
recipe.addEventListener('click', function (event) {
  if (event.target === recipe) closeRecipe();
});
recipeList.addEventListener('click', function (event) {
  var button = event.target.closest('[data-recipe]');
  if (!button) return;
  audio.resume();
  game.craft(button.getAttribute('data-recipe'));
  renderRecipes(true);
});
document.getElementById('btn-mute').addEventListener('click', function () {
  audio.resume();
  audio.toggle();
});

canvas.addEventListener('pointerdown', function (event) {
  if (game.phase === 'title' || game.phase === 'won' || game.phase === 'lost' || game.phase === 'gate' || game.hold) return;
  event.preventDefault();
  audio.resume();
  canvas.setPointerCapture(event.pointerId);
  var point = canvasPoint(event);
  game.pointerDown(point.x, point.y);
});
canvas.addEventListener('pointermove', function (event) {
  var point = canvasPoint(event);
  game.pointerMove(point.x, point.y);
});
canvas.addEventListener('pointerup', function (event) {
  if (game.phase === 'title' || game.phase === 'won' || game.phase === 'lost' || game.phase === 'gate' || game.hold) return;
  var point = canvasPoint(event);
  game.pointerUp(point.x, point.y);
});
canvas.addEventListener('pointercancel', function () {
  game.hoverIndex = -1;
});
canvas.addEventListener('contextmenu', function (event) { event.preventDefault(); });

document.addEventListener('keydown', onKey);
document.addEventListener('touchmove', function (event) {
  if (event.target.closest('.panel')) return;
  event.preventDefault();
}, { passive: false });
document.addEventListener('gesturestart', function (event) { event.preventDefault(); });

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
if (window.ResizeObserver) new ResizeObserver(resize).observe(stage);

var last = 0;
function frame(now) {
  if (!last) last = now;
  var dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!document.hidden) game.update(dt);
  ctx.setTransform(Math.min(2, window.devicePixelRatio || 1), 0, 0, Math.min(2, window.devicePixelRatio || 1), 0, 0);
  drawGeomsin(ctx, game);
  syncUi();
  requestAnimationFrame(frame);
}

resize();
syncUi();
requestAnimationFrame(frame);
