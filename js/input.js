(function (Gloam) {
  'use strict';

  Gloam.createInput = function (root) {
    const keys = new Set();
    const queue = [];
    let pointerId = null;
    let originX = 0;
    let originY = 0;
    let ax = 0;
    let ay = 0;
    const stick = document.getElementById('stick');
    const knob = document.getElementById('knob');
    const maxR = 46;

    function freshKey(e) {
      if (e.code === 'Space' && e.target instanceof HTMLButtonElement) return;
      if (e.code === 'ArrowUp' || e.code === 'ArrowDown' || e.code === 'ArrowLeft' || e.code === 'ArrowRight' || e.code === 'Space') {
        e.preventDefault();
      }
      const first = !keys.has(e.code);
      keys.add(e.code);
      if (first) queue.push(e.code);
    }

    window.addEventListener('keydown', freshKey);
    window.addEventListener('keyup', function (e) { keys.delete(e.code); });
    window.addEventListener('blur', function () {
      keys.clear();
      endStick();
    });

    function placeStick(cx, cy, kx, ky) {
      stick.hidden = false;
      stick.style.left = cx + 'px';
      stick.style.top = cy + 'px';
      knob.style.transform = 'translate(' + kx + 'px,' + ky + 'px)';
    }

    function endStick() {
      pointerId = null;
      ax = 0;
      ay = 0;
      stick.hidden = true;
      knob.style.transform = 'translate(0px,0px)';
    }

    function onOverlay(target) {
      return target && target.closest && target.closest('button, a, input, .overlay:not([hidden])');
    }

    function onDown(e) {
      if (e.button !== 0 || pointerId !== null) return;
      if (onOverlay(e.target)) return;
      if (e.cancelable) e.preventDefault();
      pointerId = e.pointerId;
      originX = e.clientX;
      originY = e.clientY;
      ax = 0;
      ay = 0;
      placeStick(originX, originY, 0, 0);
      if (root.setPointerCapture) {
        try { root.setPointerCapture(e.pointerId); } catch (err) { /* already released */ }
      }
    }

    function onMove(e) {
      if (e.pointerId !== pointerId) return;
      if (e.cancelable) e.preventDefault();
      const dx = e.clientX - originX;
      const dy = e.clientY - originY;
      const dist = Math.hypot(dx, dy);
      const nx = dist ? dx / dist : 0;
      const ny = dist ? dy / dist : 0;
      const clamped = Math.min(dist, maxR);
      ax = (nx * clamped) / maxR;
      ay = (ny * clamped) / maxR;
      if (Math.hypot(ax, ay) < 0.12) { ax = 0; ay = 0; }
      placeStick(originX, originY, nx * clamped, ny * clamped);
    }

    function onUp(e) {
      if (e.pointerId !== pointerId) return;
      endStick();
    }

    root.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);

    window.addEventListener('touchmove', function (e) {
      if (onOverlay(e.target)) return;
      if (e.cancelable) e.preventDefault();
    }, { passive: false });

    document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
    document.addEventListener('gesturechange', function (e) { e.preventDefault(); });

    return {
      axis: function () {
        let x = ax;
        let y = ay;
        if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
        if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
        if (keys.has('KeyW') || keys.has('ArrowUp')) y -= 1;
        if (keys.has('KeyS') || keys.has('ArrowDown')) y += 1;
        const m = Math.hypot(x, y);
        if (m > 1) { x /= m; y /= m; }
        return { x: x, y: y };
      },
      consume: function () {
        const out = queue.slice();
        queue.length = 0;
        return out;
      },
    };
  };
})(window.Gloam = window.Gloam || {});
