'use strict';

(() => {
  const world = document.getElementById('pet-world');
  const art = document.getElementById('hamster');
  const bridge = window.hamster;
  const demo = !bridge && new URLSearchParams(location.search).has('demo');
  const modes = new Set(['walk', 'idle', 'pet', 'sleep', 'drag', 'feed']);
  let state = { mode: 'idle', direction: 1, phase: 0, affection: 0, paused: false };
  let previousMode = 'idle';
  let snackTimer;
  let dragging = false;
  let manualMode = false;
  let unsubscribe;

  if (demo) document.documentElement.classList.add('demo');

  function update(next) {
    const beginSnack = next.mode === 'feed' && state.mode !== 'feed';
    state = { ...state, ...next };
    world.dataset.mode = modes.has(state.mode) ? state.mode : 'idle';
    world.dataset.direction = state.direction === -1 ? '-1' : '1';
    world.classList.toggle('paused', !!state.paused);
    world.setAttribute('aria-label', state.mode === 'pet' ? 'Pip ferme les yeux et savoure ses caresses' : state.mode === 'sleep' ? 'Pip dort paisiblement' : 'Pip, un petit hamster');
    document.querySelectorAll('[data-mode].active').forEach(el => { if (el !== world) el.classList.remove('active'); });
    document.querySelector(`button[data-mode="${world.dataset.mode}"]`)?.classList.add('active');
    if (beginSnack) snack();
  }

  function snack() {
    clearTimeout(snackTimer);
    world.classList.add('snacking');
    snackTimer = setTimeout(() => world.classList.remove('snacking'), 2200);
  }

  function action(type) {
    if (bridge && typeof bridge.action === 'function') bridge.action(type);
  }

  if (bridge && typeof bridge.onState === 'function') {
    unsubscribe = bridge.onState(next => {
      update(next);
      if (next.snacking || next.feed) snack();
    });
  }

  art.addEventListener('contextmenu', event => {
    event.preventDefault();
    action('menu');
  });

  art.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragging = true;
    if (bridge) action('drag-start');
    try { art.setPointerCapture(event.pointerId); } catch (_) { /* Window may have already moved. */ }
  });

  function endDrag(event) {
    if (!dragging) return;
    dragging = false;
    if (bridge) action('drag-end');
    if (event && art.hasPointerCapture?.(event.pointerId)) art.releasePointerCapture(event.pointerId);
  }

  art.addEventListener('pointerup', endDrag);
  art.addEventListener('pointercancel', endDrag);
  art.addEventListener('lostpointercapture', endDrag);
  window.addEventListener('blur', () => { if (dragging) { dragging = false; action('drag-end'); } });

  art.addEventListener('dblclick', event => {
    event.preventDefault();
    snack();
    action('feed');
  });

  if (!bridge) {
    art.addEventListener('pointerenter', () => { previousMode = state.mode === 'pet' ? previousMode : state.mode; update({ mode: 'pet' }); });
    art.addEventListener('pointerleave', () => update({ mode: previousMode }));
    document.querySelectorAll('button[data-mode]').forEach(button => {
      button.addEventListener('click', () => {
        manualMode = true;
        previousMode = button.dataset.mode;
        update({ mode: previousMode });
      });
    });
    document.getElementById('demo-feed').addEventListener('click', snack);
    let elapsed = 0;
    const autonomous = setInterval(() => {
      if (manualMode || state.mode === 'pet') return;
      elapsed += 1;
      update({ mode: elapsed % 14 < 7 ? 'idle' : 'walk', direction: Math.floor(elapsed / 14) % 2 ? -1 : 1 });
    }, 1000);
    window.addEventListener('beforeunload', () => clearInterval(autonomous), { once: true });
  }

  window.addEventListener('beforeunload', () => {
    clearTimeout(snackTimer);
    if (typeof unsubscribe === 'function') unsubscribe();
  }, { once: true });
  update(state);
})();
