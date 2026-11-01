/* Tiny WebAudio tones. No samples, no network. */
'use strict';

function GeomsinAudio(muteKey) {
  this.muteKey = muteKey;
  this.ctx = null;
  this.muted = false;
  this.lastHit = 0;
  try {
    this.muted = localStorage.getItem(muteKey) === '1';
  } catch (err) {
    this.muted = false;
  }
}

GeomsinAudio.prototype.ensure = function () {
  if (this.ctx) return this.ctx;
  var Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Ctx) return null;
  try {
    this.ctx = new Ctx();
  } catch (err) {
    this.ctx = null;
  }
  return this.ctx;
};

GeomsinAudio.prototype.resume = function () {
  var ctx = this.ensure();
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(function () {});
  }
};

GeomsinAudio.prototype.toggle = function () {
  this.muted = !this.muted;
  try {
    localStorage.setItem(this.muteKey, this.muted ? '1' : '0');
  } catch (err) { /* private mode */ }
  return this.muted;
};

GeomsinAudio.prototype.tone = function (freq, dur, type, gain, delay) {
  if (this.muted) return;
  var ctx = this.ensure();
  if (!ctx) return;
  var t = ctx.currentTime + (delay || 0);
  var osc = ctx.createOscillator();
  var amp = ctx.createGain();
  osc.type = type || 'sine';
  osc.frequency.setValueAtTime(freq, t);
  amp.gain.setValueAtTime(gain, t);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(amp);
  amp.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
};

GeomsinAudio.prototype.play = function (name) {
  if (this.muted) return;
  if (name === 'hit') {
    var now = Date.now();
    if (now - this.lastHit < 70) return;
    this.lastHit = now;
    this.tone(520, 0.04, 'triangle', 0.03);
    return;
  }
  if (name === 'place') this.tone(420, 0.06, 'sine', 0.04);
  else if (name === 'summon') {
    this.tone(392, 0.08, 'sine', 0.05);
    this.tone(588, 0.1, 'sine', 0.04, 0.06);
  } else if (name === 'merge') {
    this.tone(523, 0.09, 'triangle', 0.05);
    this.tone(659, 0.1, 'triangle', 0.05, 0.07);
    this.tone(784, 0.14, 'triangle', 0.05, 0.14);
  } else if (name === 'craft') {
    this.tone(349, 0.1, 'sine', 0.05);
    this.tone(523, 0.12, 'sine', 0.05, 0.08);
    this.tone(698, 0.16, 'sine', 0.05, 0.16);
  } else if (name === 'leak') this.tone(110, 0.22, 'sawtooth', 0.04);
  else if (name === 'boss') {
    this.tone(98, 0.28, 'sawtooth', 0.04);
    this.tone(146, 0.28, 'triangle', 0.04, 0.05);
  } else if (name === 'win') {
    [523, 659, 784, 1046].forEach(function (f, i) {
      this.tone(f, 0.18, 'sine', 0.05, i * 0.09);
    }, this);
  } else if (name === 'lose') {
    this.tone(311, 0.2, 'triangle', 0.05);
    this.tone(233, 0.28, 'triangle', 0.05, 0.12);
    this.tone(174, 0.36, 'sine', 0.05, 0.26);
  } else if (name === 'ui') this.tone(640, 0.04, 'sine', 0.03);
};

globalThis.GeomsinAudio = GeomsinAudio;
