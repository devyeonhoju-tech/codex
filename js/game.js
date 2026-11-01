(function (Gloam) {
  'use strict';

  const T = Gloam.TUNING;

  function hash(x, y) {
    let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }

  function loadRecords() {
    try {
      const raw = localStorage.getItem('gloam.best.v1');
      if (!raw) return { time: 0, score: 0 };
      const data = JSON.parse(raw);
      return {
        time: Number(data.time) || 0,
        score: Number(data.score) || 0,
      };
    } catch (err) {
      return { time: 0, score: 0 };
    }
  }

  function saveRecords(records) {
    try {
      localStorage.setItem('gloam.best.v1', JSON.stringify(records));
    } catch (err) { /* private mode or a full disk */ }
  }

  function Game(canvas, input, audio, ui) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.input = input;
    this.audio = audio;
    this.ui = ui;
    this.w = 1;
    this.h = 1;
    this.records = loadRecords();
    this.reset();
    this.state = 'title';
    this.resize();
  }

  Game.prototype.reset = function () {
    this.player = {
      x: 0,
      y: 0,
      r: T.playerRadius,
      hp: T.playerHp,
      maxHp: T.playerHp,
      speed: T.playerSpeed,
      facing: 0,
      invuln: 0,
      xp: 0,
      level: 1,
      xpToNext: Gloam.xpToNext(1),
      pickup: T.pickup,
      damage: 1,
      haste: 1,
      projectiles: 1,
      pierce: 0,
      size: 1,
      regen: 0,
      ranks: {},
      attackCd: 0.2,
    };
    this.enemies = [];
    this.projectiles = [];
    this.gems = [];
    this.particles = [];
    this.floaters = [];
    this.time = 0;
    this.kills = 0;
    this.spawnAcc = 0.85;
    this.bursts = 0;
    this.pendingLevels = 0;
    this.choices = [];
    this.shake = 0;
    this.hurtFlash = 0;
    this.waveFlash = 0;
    this.nextId = 1;
    this.camX = 0;
    this.camY = 0;
  };

  Game.prototype.resize = function () {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, rect.width);
    this.h = Math.max(1, rect.height);
    this.canvas.width = Math.floor(this.w * dpr);
    this.canvas.height = Math.floor(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  Game.prototype.begin = function () {
    if (this.state === 'playing' || this.state === 'levelup') return;
    this.reset();
    this.state = 'playing';
    this.spawnEnemy(Math.random() * Math.PI * 2);
    this.ui.onBegin();
    this.audio.unlock();
    this.audio.sting();
  };

  Game.prototype.toggleMute = function () {
    this.ui.setMuted(this.audio.toggle());
  };

  Game.prototype.handlePresses = function (codes) {
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      if (code === 'KeyM') {
        this.toggleMute();
        continue;
      }
      if (this.state === 'title' && (code === 'Enter' || code === 'Space')) {
        this.begin();
        return;
      }
      if (this.state === 'gameover' && (code === 'Enter' || code === 'Space' || code === 'KeyR')) {
        this.begin();
        return;
      }
      if (this.state === 'levelup') {
        const index = code === 'Digit1' || code === 'Numpad1' ? 0
          : code === 'Digit2' || code === 'Numpad2' ? 1
            : code === 'Digit3' || code === 'Numpad3' ? 2
              : -1;
        if (index >= 0) {
          this.chooseUpgrade(index);
          return;
        }
      }
    }
  };

  Game.prototype.chooseUpgrade = function (index) {
    if (this.state !== 'levelup') return;
    const choice = this.choices[index];
    if (!choice) return;
    choice.apply(this.player);
    this.audio.pick();
    this.choices = [];
    this.ui.hideLevelUp();
    if (this.player.hp <= 0) {
      this.endRun();
      return;
    }
    if (this.pendingLevels > 0) this.openLevelUp();
    else this.state = 'playing';
  };

  Game.prototype.openLevelUp = function () {
    this.pendingLevels -= 1;
    this.state = 'levelup';
    this.choices = Gloam.rollUpgrades(this.player, 3);
    this.audio.level();
    this.ui.showLevelUp(this.choices, this.player.level);
  };

  Game.prototype.addXp = function (amount) {
    this.player.xp += amount;
    while (this.player.xp >= this.player.xpToNext) {
      this.player.xp -= this.player.xpToNext;
      this.player.level += 1;
      this.player.xpToNext = Gloam.xpToNext(this.player.level);
      this.pendingLevels += 1;
    }
  };

  Game.prototype.endRun = function () {
    if (this.state === 'gameover') return;
    this.state = 'gameover';
    this.player.hp = 0;
    this.ui.hideLevelUp();
    const stats = {
      time: this.time,
      level: this.player.level,
      kills: this.kills,
      score: Math.floor(this.kills * 100 + this.time * 8),
    };
    const fresh = stats.time > this.records.time || stats.score > this.records.score || (this.records.time === 0 && this.records.score === 0 && (stats.time > 0 || stats.kills > 0));
    if (stats.time > this.records.time) this.records.time = stats.time;
    if (stats.score > this.records.score) this.records.score = stats.score;
    saveRecords(this.records);
    this.audio.die();
    this.ui.showGameOver(stats, {
      time: this.records.time,
      score: this.records.score,
      fresh: fresh,
    });
  };

  Game.prototype.spawnEnemy = function (angle) {
    if (this.enemies.length >= T.enemyCap) return;
    const kind = Gloam.pickKind(this.time);
    const ang = angle == null ? Math.random() * Math.PI * 2 : angle;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const reachX = Math.abs(c) < 0.001 ? Infinity : (this.w * 0.5 + 36) / Math.abs(c);
    const reachY = Math.abs(s) < 0.001 ? Infinity : (this.h * 0.5 + 36) / Math.abs(s);
    const dist = Math.min(reachX, reachY) + kind.r;
    const scale = 1 + this.time * 0.014;
    const hp = Math.max(1, Math.round(kind.hp * scale));
    this.enemies.push({
      id: this.nextId++,
      kind: kind.id,
      x: this.player.x + Math.cos(ang) * dist,
      y: this.player.y + Math.sin(ang) * dist,
      r: kind.r,
      hp: hp,
      maxHp: hp,
      speed: kind.speed * Math.min(1.45, 1 + this.time * 0.0022),
      damage: kind.damage + Math.floor(this.time / 50),
      xp: kind.xp,
      color: kind.color,
      flash: 0,
      alive: true,
      bob: Math.random() * Math.PI * 2,
    });
  };

  Game.prototype.nearestEnemy = function () {
    const p = this.player;
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e.alive) continue;
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  };

  Game.prototype.fireAt = function (target) {
    const p = this.player;
    const base = Math.atan2(target.y - p.y, target.x - p.x);
    const n = p.projectiles;
    const step = 0.18;
    for (let i = 0; i < n; i++) {
      const ang = base + (i - (n - 1) / 2) * step;
      const x = p.x + Math.cos(ang) * 16;
      const y = p.y + Math.sin(ang) * 16;
      this.projectiles.push({
        x: x,
        y: y,
        px: x,
        py: y,
        ang: ang,
        r: T.projectileRadius * p.size,
        damage: T.baseDamage * p.damage,
        life: T.projectileLife,
        pierce: p.pierce,
        hit: new Set(),
      });
    }
    this.audio.shoot();
  };

  Game.prototype.hurtEnemy = function (enemy, amount) {
    if (!enemy.alive) return;
    const dmg = Math.max(1, Math.round(amount));
    enemy.hp -= dmg;
    enemy.flash = 0.09;
    this.floaters.push({
      x: enemy.x,
      y: enemy.y - enemy.r,
      text: String(dmg),
      life: 0.45,
      max: 0.45,
      vy: -36,
      color: '#f7f1e4',
    });
    if (enemy.hp <= 0) this.killEnemy(enemy);
  };

  Game.prototype.killEnemy = function (enemy) {
    if (!enemy.alive) return;
    enemy.alive = false;
    enemy.hp = 0;
    this.kills += 1;
    this.audio.kill();
    this.burst(enemy.x, enemy.y, enemy.color, 12);
    for (let i = 0; i < enemy.xp; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 28 + Math.random() * 55;
      this.gems.push({
        x: enemy.x,
        y: enemy.y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        r: 5,
        value: 1,
        pull: false,
        age: 0,
        dead: false,
      });
    }
  };

  Game.prototype.burst = function (x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 30 + Math.random() * 150;
      this.particles.push({
        x: x,
        y: y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 0.28 + Math.random() * 0.32,
        max: 0.6,
        r: 1.4 + Math.random() * 2.1,
        color: color,
      });
    }
    if (this.particles.length > 260) {
      this.particles.splice(0, this.particles.length - 260);
    }
  };

  Game.prototype.updateDirector = function (dt) {
    const time = this.time;
    const interval = Math.max(0.36, 1.2 - time * 0.008);
    const batch = 2 + Math.floor(time / 22);
    this.spawnAcc += dt;
    if (this.spawnAcc >= interval) {
      this.spawnAcc = Math.min(this.spawnAcc - interval, interval);
      const arc = Math.random() * Math.PI * 2;
      const n = Math.min(batch, 8);
      for (let i = 0; i < n; i++) {
        const ang = arc + (Math.PI * 2 * i) / n + (Math.random() - 0.5) * 0.4;
        this.spawnEnemy(ang);
      }
    }
    const wave = Math.floor(time / 32);
    if (wave > this.bursts) {
      this.bursts = wave;
      this.waveFlash = 0.45;
      this.audio.wave();
      const arcs = 2 + Math.min(2, wave);
      for (let a = 0; a < arcs; a++) {
        const arc = Math.random() * Math.PI * 2;
        const extra = 3 + wave;
        for (let i = 0; i < extra; i++) {
          this.spawnEnemy(arc + (Math.random() - 0.5) * 0.9);
        }
      }
    }
  };

  Game.prototype.update = function (dt) {
    const p = this.player;
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 30);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    this.waveFlash = Math.max(0, this.waveFlash - dt);
    p.invuln = Math.max(0, p.invuln - dt);
    if (p.regen > 0 && p.hp < p.maxHp && p.hp > 0) {
      p.hp = Math.min(p.maxHp, p.hp + p.regen * dt);
    }

    const axis = this.input.axis();
    if (axis.x || axis.y) {
      p.facing = Math.atan2(axis.y, axis.x);
      p.x += axis.x * p.speed * dt;
      p.y += axis.y * p.speed * dt;
    }

    p.attackCd -= dt;
    if (p.attackCd <= 0) {
      const target = this.nearestEnemy();
      if (target) {
        this.fireAt(target);
        p.attackCd = T.baseCooldown / p.haste;
      } else {
        p.attackCd = 0;
      }
    }

    this.updateDirector(dt);

    for (let i = 0; i < this.projectiles.length; i++) {
      const shot = this.projectiles[i];
      shot.life -= dt;
      shot.px = shot.x;
      shot.py = shot.y;
      shot.x += Math.cos(shot.ang) * T.projectileSpeed * dt;
      shot.y += Math.sin(shot.ang) * T.projectileSpeed * dt;
      if (shot.life <= 0) continue;
      for (let j = 0; j < this.enemies.length; j++) {
        const enemy = this.enemies[j];
        if (!enemy.alive || shot.hit.has(enemy.id)) continue;
        const dx = enemy.x - shot.x;
        const dy = enemy.y - shot.y;
        if (dx * dx + dy * dy <= (enemy.r + shot.r) * (enemy.r + shot.r)) {
          shot.hit.add(enemy.id);
          this.hurtEnemy(enemy, shot.damage);
          this.burst(shot.x, shot.y, '#fff1c4', 3);
          if (shot.pierce > 0) shot.pierce -= 1;
          else shot.life = 0;
          if (shot.life <= 0) break;
        }
      }
    }

    for (let i = 0; i < this.enemies.length; i++) {
      const enemy = this.enemies[i];
      if (!enemy.alive) continue;
      const dx = p.x - enemy.x;
      const dy = p.y - enemy.y;
      const dist = Math.hypot(dx, dy) || 1;
      enemy.x += (dx / dist) * enemy.speed * dt;
      enemy.y += (dy / dist) * enemy.speed * dt;
      if (enemy.kind === 'skitter') {
        const sway = Math.sin(this.time * 6 + enemy.bob) * 90 * dt;
        enemy.x += (-dy / dist) * sway;
        enemy.y += (dx / dist) * sway;
      }
      enemy.flash = Math.max(0, enemy.flash - dt);
      const far = (enemy.x - p.x) * (enemy.x - p.x) + (enemy.y - p.y) * (enemy.y - p.y);
      if (far > T.despawn * T.despawn) enemy.alive = false;
    }

    for (let i = 0; i < this.enemies.length; i++) {
      const a = this.enemies[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < this.enemies.length; j++) {
        const b = this.enemies[j];
        if (!b.alive) continue;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        const min = a.r + b.r;
        if (d2 === 0) {
          b.x += 1;
          dx = 1;
          d2 = 1;
        }
        if (d2 < min * min) {
          const dist = Math.sqrt(d2);
          const push = (min - dist) * 0.5;
          const nx = dx / dist;
          const ny = dy / dist;
          a.x -= nx * push;
          a.y -= ny * push;
          b.x += nx * push;
          b.y += ny * push;
        }
      }
    }

    for (let i = 0; i < this.enemies.length; i++) {
      const enemy = this.enemies[i];
      if (!enemy.alive) continue;
      let dx = p.x - enemy.x;
      let dy = p.y - enemy.y;
      let dist = Math.hypot(dx, dy);
      const min = p.r + enemy.r;
      if (dist === 0) {
        dx = 1;
        dy = 0;
        dist = 1;
      }
      if (dist < min) {
        const push = min - dist + 0.4;
        p.x += (dx / dist) * push;
        p.y += (dy / dist) * push;
        if (p.invuln <= 0) {
          p.hp -= enemy.damage;
          p.invuln = T.iframe;
          this.shake = 11;
          this.hurtFlash = 0.28;
          this.audio.hurt();
          this.floaters.push({
            x: p.x,
            y: p.y - 22,
            text: '-' + enemy.damage,
            life: 0.7,
            max: 0.7,
            vy: -28,
            color: '#ff9a8a',
          });
        }
      }
    }

    for (let i = 0; i < this.gems.length; i++) {
      const gem = this.gems[i];
      gem.age += dt;
      const dx = p.x - gem.x;
      const dy = p.y - gem.y;
      const dist = Math.hypot(dx, dy);
      if (dist < p.r + gem.r + 8) {
        gem.dead = true;
        this.addXp(gem.value);
        this.audio.gem();
        continue;
      }
      if (gem.pull || dist < p.pickup) {
        gem.pull = true;
        const sp = Math.min(680, 200 + gem.age * 260);
        const safe = dist || 1;
        gem.x += (dx / safe) * sp * dt;
        gem.y += (dy / safe) * sp * dt;
      } else {
        gem.x += gem.vx * dt;
        gem.y += gem.vy * dt;
        const damp = Math.exp(-2.4 * dt);
        gem.vx *= damp;
        gem.vy *= damp;
      }
    }

    if (this.gems.length > T.gemCap) {
      this.gems.sort(function (a, b) {
        const da = (a.x - p.x) * (a.x - p.x) + (a.y - p.y) * (a.y - p.y);
        const db = (b.x - p.x) * (b.x - p.x) + (b.y - p.y) * (b.y - p.y);
        return db - da;
      });
      this.gems.length = T.gemCap;
    }

    for (let i = 0; i < this.particles.length; i++) {
      const bit = this.particles[i];
      bit.x += bit.vx * dt;
      bit.y += bit.vy * dt;
      const damp = Math.exp(-1.6 * dt);
      bit.vx *= damp;
      bit.vy *= damp;
      bit.life -= dt;
    }
    for (let i = 0; i < this.floaters.length; i++) {
      const floater = this.floaters[i];
      floater.y += floater.vy * dt;
      floater.life -= dt;
    }

    this.enemies = this.enemies.filter(function (e) { return e.alive; });
    this.projectiles = this.projectiles.filter(function (s) { return s.life > 0; });
    this.gems = this.gems.filter(function (g) { return !g.dead; });
    this.particles = this.particles.filter(function (bit) { return bit.life > 0; });
    this.floaters = this.floaters.filter(function (f) { return f.life > 0; });
    if (this.floaters.length > 40) this.floaters.splice(0, this.floaters.length - 40);

    if (p.hp <= 0) {
      p.hp = 0;
      this.endRun();
      return;
    }
    if (this.pendingLevels > 0 && this.state === 'playing') this.openLevelUp();
  };

  Game.prototype.worldToScreen = function (x, y) {
    return { x: x - this.camX, y: y - this.camY };
  };

  Game.prototype.visible = function (x, y, margin) {
    const sx = x - this.camX;
    const sy = y - this.camY;
    return sx > -margin && sy > -margin && sx < this.w + margin && sy < this.h + margin;
  };

  Game.prototype.draw = function () {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    const now = performance.now() / 1000;
    const p = this.player;
    const mag = this.shake;
    const jx = mag ? (Math.random() - 0.5) * mag : 0;
    const jy = mag ? (Math.random() - 0.5) * mag : 0;
    this.camX = p.x - w / 2 + jx;
    this.camY = p.y - h / 2 + jy;

    const sky = ctx.createRadialGradient(w * 0.5, h * 0.42, 40, w * 0.5, h * 0.4, Math.max(w, h) * 0.75);
    sky.addColorStop(0, '#1b2433');
    sky.addColorStop(1, '#07080d');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    for (let i = 0; i < 42; i++) {
      const x = hash(i, 3) * w;
      const y = hash(i, 9) * h * 0.62;
      ctx.globalAlpha = 0.18 + hash(i, 5) * 0.55;
      ctx.fillStyle = '#f4ecdc';
      ctx.fillRect(x, y, hash(i, 8) > 0.8 ? 2 : 1.4, hash(i, 8) > 0.8 ? 2 : 1.4);
    }
    ctx.globalAlpha = 1;

    const mx = w * 0.8;
    const my = h * 0.16;
    ctx.fillStyle = 'rgba(244, 236, 214, 0.08)';
    ctx.beginPath();
    ctx.arc(mx, my, 78, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f4ecd8';
    ctx.beginPath();
    ctx.arc(mx, my, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(198, 186, 156, 0.7)';
    ctx.beginPath();
    ctx.arc(mx - 8, my - 6, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(mx + 9, my + 7, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(mx + 3, my - 12, 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(-this.camX, -this.camY);
    this.drawGround(ctx);
    this.drawGems(ctx, now);
    this.drawShadows(ctx);
    for (let i = 0; i < this.enemies.length; i++) {
      if (this.visible(this.enemies[i].x, this.enemies[i].y, 80)) {
        this.drawEnemy(ctx, this.enemies[i], now);
      }
    }
    this.drawProjectiles(ctx);
    this.drawParticles(ctx);
    this.drawPlayer(ctx, now);
    this.drawFloaters(ctx);
    ctx.restore();

    const vignette = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.28, w / 2, h / 2, Math.max(w, h) * 0.68);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.48)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);

    if (this.state !== 'title' && p.maxHp > 0 && p.hp < p.maxHp * 0.32) {
      const alpha = (1 - p.hp / (p.maxHp * 0.32)) * 0.38;
      const danger = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.62);
      danger.addColorStop(0, 'rgba(120, 0, 0, 0)');
      danger.addColorStop(1, 'rgba(140, 16, 16, ' + alpha + ')');
      ctx.fillStyle = danger;
      ctx.fillRect(0, 0, w, h);
    }
    if (this.hurtFlash > 0) {
      ctx.fillStyle = 'rgba(255, 70, 54, ' + (this.hurtFlash * 0.45) + ')';
      ctx.fillRect(0, 0, w, h);
    }
    if (this.waveFlash > 0) {
      ctx.strokeStyle = 'rgba(232, 205, 154, ' + (this.waveFlash * 0.9) + ')';
      ctx.lineWidth = 3;
      ctx.strokeRect(8, 8, w - 16, h - 16);
    }
  };

  Game.prototype.drawGround = function (ctx) {
    const grid = 72;
    const x0 = Math.floor(this.camX / grid) * grid;
    const y0 = Math.floor(this.camY / grid) * grid;
    const x1 = this.camX + this.w + grid;
    const y1 = this.camY + this.h + grid;
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(186, 204, 224, 0.07)';
    ctx.lineWidth = 1;
    for (let x = x0; x < x1; x += grid) {
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y1);
    }
    for (let y = y0; y < y1; y += grid) {
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
    }
    ctx.stroke();

    const cell = 160;
    const c0 = Math.floor(this.camX / cell) - 1;
    const r0 = Math.floor(this.camY / cell) - 1;
    const c1 = Math.floor((this.camX + this.w) / cell) + 1;
    const r1 = Math.floor((this.camY + this.h) / cell) + 1;
    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        const n = hash(cx, cy);
        if (n < 0.78) continue;
        const px = cx * cell + hash(cx + 11, cy) * cell;
        const py = cy * cell + hash(cx, cy + 17) * cell;
        if (n > 0.96) {
          ctx.fillStyle = '#2a3140';
          ctx.beginPath();
          ctx.moveTo(px, py - 22);
          ctx.lineTo(px + 8, py);
          ctx.lineTo(px - 8, py);
          ctx.fill();
          ctx.fillRect(px - 10, py, 20, 3);
        } else {
          ctx.fillStyle = n > 0.9 ? '#30384a' : '#232937';
          ctx.beginPath();
          ctx.ellipse(px, py, 3 + n * 6, 2 + n * 3, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  };

  Game.prototype.drawShadows = function (ctx) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!this.visible(e.x, e.y, 40)) continue;
      ctx.beginPath();
      ctx.ellipse(e.x, e.y + e.r * 0.75, e.r * 0.85, e.r * 0.32, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    const p = this.player;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + 12, 12, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
  };

  Game.prototype.drawEnemy = function (ctx, enemy, now) {
    const bob = Math.sin(now * 3 + enemy.bob) * 1.6;
    ctx.save();
    ctx.translate(enemy.x, enemy.y + bob);
    if (enemy.flash > 0) ctx.fillStyle = '#fff7ef';
    else ctx.fillStyle = enemy.color;

    if (enemy.kind === 'skitter') {
      ctx.beginPath();
      ctx.moveTo(0, -enemy.r);
      ctx.lineTo(enemy.r * 0.78, 0);
      ctx.lineTo(0, enemy.r);
      ctx.lineTo(-enemy.r * 0.78, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#2a1608';
      ctx.fillRect(-4.2, -2, 2.2, 2.2);
      ctx.fillRect(2, -2, 2.2, 2.2);
    } else if (enemy.kind === 'brute') {
      roundBox(ctx, -enemy.r, -enemy.r * 0.8, enemy.r * 2, enemy.r * 1.65, 8);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-enemy.r * 0.45, -enemy.r * 0.7);
      ctx.lineTo(-enemy.r * 0.9, -enemy.r * 1.35);
      ctx.lineTo(-enemy.r * 0.1, -enemy.r * 0.62);
      ctx.moveTo(enemy.r * 0.45, -enemy.r * 0.7);
      ctx.lineTo(enemy.r * 0.9, -enemy.r * 1.35);
      ctx.lineTo(enemy.r * 0.1, -enemy.r * 0.62);
      ctx.fill();
      ctx.fillStyle = '#1b1024';
      ctx.beginPath();
      ctx.arc(-7, -2, 2.4, 0, Math.PI * 2);
      ctx.arc(7, -2, 2.4, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.ellipse(0, 0, enemy.r, enemy.r * 0.86, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#2a0d0c';
      ctx.beginPath();
      ctx.arc(-5, -1, 2.1, 0, Math.PI * 2);
      ctx.arc(5, -1, 2.1, 0, Math.PI * 2);
      ctx.fill();
    }

    if (enemy.hp < enemy.maxHp) {
      const width = enemy.r * 2;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(-enemy.r, -enemy.r - 9, width, 3);
      ctx.fillStyle = '#f2efe6';
      ctx.fillRect(-enemy.r, -enemy.r - 9, width * Math.max(0, enemy.hp / enemy.maxHp), 3);
    }
    ctx.restore();
  };

  Game.prototype.drawProjectiles = function (ctx) {
    ctx.lineCap = 'round';
    for (let i = 0; i < this.projectiles.length; i++) {
      const shot = this.projectiles[i];
      if (!this.visible(shot.x, shot.y, 30)) continue;
      ctx.strokeStyle = 'rgba(255, 236, 186, 0.35)';
      ctx.lineWidth = shot.r * 2.4;
      ctx.beginPath();
      ctx.moveTo(shot.px, shot.py);
      ctx.lineTo(shot.x, shot.y);
      ctx.stroke();
      ctx.strokeStyle = '#fff8e4';
      ctx.lineWidth = Math.max(1.5, shot.r * 0.85);
      ctx.beginPath();
      ctx.moveTo(shot.px, shot.py);
      ctx.lineTo(shot.x, shot.y);
      ctx.stroke();
    }
  };

  Game.prototype.drawGems = function (ctx, now) {
    for (let i = 0; i < this.gems.length; i++) {
      const gem = this.gems[i];
      if (!this.visible(gem.x, gem.y, 30)) continue;
      const lift = Math.sin(now * 4 + gem.age) * 1.5;
      ctx.save();
      ctx.translate(gem.x, gem.y + lift);
      ctx.rotate(Math.sin(now * 2 + gem.age) * 0.25);
      ctx.fillStyle = '#123f38';
      diamond(ctx, gem.r + 2);
      ctx.fill();
      ctx.fillStyle = '#8ff6e2';
      diamond(ctx, gem.r * 0.62);
      ctx.fill();
      ctx.restore();
    }
  };

  Game.prototype.drawParticles = function (ctx) {
    for (let i = 0; i < this.particles.length; i++) {
      const bit = this.particles[i];
      ctx.globalAlpha = Math.max(0, bit.life / bit.max);
      ctx.fillStyle = bit.color;
      ctx.beginPath();
      ctx.arc(bit.x, bit.y, bit.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };

  Game.prototype.drawPlayer = function (ctx, now) {
    const p = this.player;
    const bob = Math.sin(now * 5) * 1.2;
    const dir = Math.cos(p.facing) >= 0 ? 1 : -1;
    const blink = p.invuln > 0 && Math.floor(now * 16) % 2 === 0;
    ctx.save();
    ctx.translate(p.x, p.y + bob);
    ctx.scale(dir * 1.28, 1.28);
    ctx.globalAlpha = blink ? 0.45 : 1;

    ctx.fillStyle = '#141820';
    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.quadraticCurveTo(16, -2, 13, 12);
    ctx.lineTo(-13, 12);
    ctx.quadraticCurveTo(-16, -2, 0, -18);
    ctx.fill();
    ctx.strokeStyle = '#d7b57a';
    ctx.lineWidth = 1.25;
    ctx.stroke();

    ctx.fillStyle = '#f0d3c6';
    ctx.beginPath();
    ctx.arc(0, -7, 6.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff3b3b';
    ctx.fillRect(-3.6, -8.2, 2, 2.3);
    ctx.fillRect(1.6, -8.2, 2, 2.3);

    const orbit = now * 2.4;
    const ox = Math.cos(orbit) * 22;
    const oy = Math.sin(orbit) * 10 - 2;
    ctx.fillStyle = '#f6e2a8';
    ctx.beginPath();
    ctx.moveTo(ox, oy - 5);
    ctx.lineTo(ox + 3.5, oy);
    ctx.lineTo(ox, oy + 5);
    ctx.lineTo(ox - 3.5, oy);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  };

  Game.prototype.drawFloaters = function (ctx) {
    ctx.font = '700 13px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < this.floaters.length; i++) {
      const floater = this.floaters[i];
      ctx.globalAlpha = Math.max(0, floater.life / floater.max);
      ctx.fillStyle = floater.color;
      ctx.fillText(floater.text, floater.x, floater.y);
    }
    ctx.globalAlpha = 1;
  };

  Game.prototype.snapshot = function () {
    return {
      state: this.state,
      time: this.time,
      kills: this.kills,
      level: this.player.level,
      hp: this.player.hp,
      maxHp: this.player.maxHp,
      xp: this.player.xp,
      xpToNext: this.player.xpToNext,
      enemies: this.enemies.length,
      gems: this.gems.length,
      projectiles: this.projectiles.length,
      x: this.player.x,
      y: this.player.y,
      ranks: Object.assign({}, this.player.ranks),
      speed: this.player.speed,
      pickup: this.player.pickup,
      projectilesOwned: this.player.projectiles,
      pending: this.pendingLevels,
    };
  };

  function diamond(ctx, r) {
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r * 0.72, 0);
    ctx.lineTo(0, r);
    ctx.lineTo(-r * 0.72, 0);
    ctx.closePath();
  }

  function roundBox(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  Gloam.Game = Game;
})(window.Gloam = window.Gloam || {});
