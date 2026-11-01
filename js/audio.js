(function (Gloam) {
  'use strict';

  function AudioBus() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.lastShot = 0;
    this.lastGem = 0;
  }

  AudioBus.prototype.unlock = function () {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!this.ctx) {
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.22;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  };

  AudioBus.prototype.toggle = function () {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.22;
    return this.muted;
  };

  AudioBus.prototype.tone = function (freq, dur, type, gain, slideTo) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const amp = this.ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(Math.max(40, freq), t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t0 + dur);
    amp.gain.setValueAtTime(gain, t0);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(amp);
    amp.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  };

  AudioBus.prototype.shoot = function () {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    if (now - this.lastShot < 0.07) return;
    this.lastShot = now;
    this.tone(640, 0.05, 'square', 0.035, 280);
  };

  AudioBus.prototype.kill = function () {
    this.tone(196, 0.09, 'triangle', 0.05, 90);
  };

  AudioBus.prototype.gem = function () {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    if (now - this.lastGem < 0.05) return;
    this.lastGem = now;
    this.tone(880, 0.06, 'sine', 0.04, 1320);
  };

  AudioBus.prototype.hurt = function () {
    this.tone(140, 0.14, 'sawtooth', 0.06, 70);
  };

  AudioBus.prototype.level = function () {
    this.tone(392, 0.12, 'triangle', 0.06);
    const bus = this;
    window.setTimeout(function () { bus.tone(523, 0.16, 'triangle', 0.06); }, 90);
  };

  AudioBus.prototype.pick = function () {
    this.tone(660, 0.08, 'sine', 0.05, 880);
  };

  AudioBus.prototype.wave = function () {
    this.tone(160, 0.28, 'sine', 0.05, 90);
  };

  AudioBus.prototype.sting = function () {
    this.tone(220, 0.3, 'triangle', 0.05, 440);
  };

  AudioBus.prototype.die = function () {
    this.tone(300, 0.45, 'sawtooth', 0.06, 55);
  };

  Gloam.AudioBus = AudioBus;
})(window.Gloam = window.Gloam || {});
