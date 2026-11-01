(function (Gloam) {
  'use strict';

  const app = document.getElementById('app');
  const canvas = document.getElementById('view');
  const hud = document.getElementById('hud');
  const hint = document.getElementById('hint');
  const title = document.getElementById('title');
  const levelup = document.getElementById('levelup');
  const levelupLevel = document.getElementById('levelup-level');
  const cards = document.getElementById('cards');
  const gameover = document.getElementById('gameover');
  const mute = document.getElementById('mute');
  const live = document.getElementById('live');

  const hudLevel = document.getElementById('hud-level');
  const hudTimer = document.getElementById('hud-timer');
  const hudKills = document.getElementById('hud-kills');
  const hpFill = document.getElementById('hp-fill');
  const hpText = document.getElementById('hp-text');
  const hpMeter = document.getElementById('hp-meter');
  const xpFill = document.getElementById('xp-fill');
  const xpMeter = document.getElementById('xp-meter');

  const statTime = document.getElementById('stat-time');
  const statLevel = document.getElementById('stat-level');
  const statKills = document.getElementById('stat-kills');
  const statScore = document.getElementById('stat-score');
  const statBest = document.getElementById('stat-best');

  let hintTimer = 0;

  function say(text) {
    live.textContent = text;
  }

  const ui = {
    onBegin: function () {
      title.hidden = true;
      gameover.hidden = true;
      levelup.hidden = true;
      hud.hidden = false;
      hint.classList.remove('gone');
      window.clearTimeout(hintTimer);
      hintTimer = window.setTimeout(function () { hint.classList.add('gone'); }, 6500);
      ui.setMuted(audio.muted);
      say('The night begins.');
    },
    showLevelUp: function (choices, level) {
      levelup.hidden = false;
      levelupLevel.textContent = String(level);
      cards.replaceChildren();
      choices.forEach(function (choice, index) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'card';
        button.dataset.id = choice.id;
        const key = document.createElement('span');
        key.className = 'key';
        key.textContent = String(index + 1);
        const name = document.createElement('strong');
        name.textContent = choice.name;
        const desc = document.createElement('em');
        desc.textContent = choice.desc;
        const rank = document.createElement('small');
        rank.textContent = Gloam.rankLabel(choice);
        button.append(key, name, desc, rank);
        button.addEventListener('click', function () { game.chooseUpgrade(index); });
        cards.appendChild(button);
      });
      const first = cards.querySelector('button');
      if (first) first.focus();
      say('Level ' + level + '. Choose an upgrade.');
    },
    hideLevelUp: function () {
      levelup.hidden = true;
      cards.replaceChildren();
    },
    showGameOver: function (stats, best) {
      hud.hidden = true;
      levelup.hidden = true;
      gameover.hidden = false;
      statTime.textContent = Gloam.formatTime(stats.time);
      statLevel.textContent = String(stats.level);
      statKills.textContent = String(stats.kills);
      statScore.textContent = stats.score.toLocaleString('en-US');
      const bestLine = 'Best ' + Gloam.formatTime(best.time) + '  ·  score ' + best.score.toLocaleString('en-US');
      statBest.textContent = best.fresh ? bestLine + '  ·  new best' : bestLine;
      document.getElementById('restart').focus();
      say('You fell. Survived ' + Gloam.formatTime(stats.time) + ', ' + stats.kills + ' kills.');
    },
    setMuted: function (muted) {
      mute.textContent = muted ? 'Sound off' : 'Sound on';
      mute.setAttribute('aria-pressed', muted ? 'true' : 'false');
      mute.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
    },
    sync: function (game) {
      if (hud.hidden) return;
      const player = game.player;
      hudLevel.textContent = String(player.level);
      hudTimer.textContent = Gloam.formatTime(game.time);
      hudKills.textContent = String(game.kills);
      const hpPct = player.maxHp > 0 ? Math.max(0, player.hp / player.maxHp) : 0;
      hpFill.style.width = (hpPct * 100) + '%';
      const shown = player.hp <= 0 ? 0 : Math.ceil(player.hp);
      hpText.textContent = shown + ' / ' + player.maxHp;
      hpMeter.setAttribute('aria-valuenow', String(shown));
      hpMeter.setAttribute('aria-valuemax', String(player.maxHp));
      hpMeter.classList.toggle('low', hpPct > 0 && hpPct <= 0.3);
      const xpPct = player.xpToNext > 0 ? player.xp / player.xpToNext : 0;
      xpFill.style.width = (Math.max(0, Math.min(1, xpPct)) * 100) + '%';
      xpMeter.setAttribute('aria-valuenow', String(Math.floor(player.xp)));
      xpMeter.setAttribute('aria-valuemax', String(player.xpToNext));
    },
  };

  const input = Gloam.createInput(app);
  const audio = new Gloam.AudioBus();
  const game = new Gloam.Game(canvas, input, audio, ui);
  window.gloam = game;

  document.getElementById('start').addEventListener('click', function () {
    audio.unlock();
    game.begin();
  });
  document.getElementById('restart').addEventListener('click', function () {
    audio.unlock();
    game.begin();
  });
  mute.addEventListener('click', function () {
    audio.unlock();
    game.toggleMute();
  });

  window.addEventListener('resize', function () { game.resize(); });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    game.handlePresses(input.consume());
    if (game.state === 'playing') game.update(dt);
    game.draw();
    ui.sync(game);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  document.getElementById('start').focus();
})(window.Gloam = window.Gloam || {});
