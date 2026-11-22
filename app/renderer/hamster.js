'use strict';

(() => {
  const world = document.getElementById('pet-world');
  const art = document.getElementById('hamster');
  const bridge = window.hamster;
  const demo = !bridge && new URLSearchParams(location.search).has('demo');
  const modes = new Set(['walk', 'idle', 'pet', 'sleep', 'drag', 'feed']);
  const speciesOptions = new Set(['hamster', 'capybara']);
  const defaultAppearance = { hat: 'none', glasses: 'none', outfit: 'none', color: 'sage' };
  const appearanceOptions = {
    hat: new Set(['none', 'beanie', 'cap', 'crown', 'flower', 'cowboy']),
    glasses: new Set(['none', 'round', 'sun', 'heart']),
    outfit: new Set(['none', 'hoodie', 'mariniere', 'scarf', 'overalls']),
    color: new Set(['sage', 'blue', 'rose', 'lavender', 'orange'])
  };
  let state = { mode: 'idle', direction: 1, phase: 0, affection: 0, paused: false, species: 'hamster', appearance: { ...defaultAppearance } };
  let previousMode = 'idle';
  let snackTimer;
  let dragging = false;
  let manualMode = false;
  let unsubscribe;
  let appearanceKey = '';

  if (demo) document.documentElement.classList.add('demo');

  function normalizeAppearance(input) {
    const value = input && typeof input === 'object' ? input : {};
    return Object.fromEntries(Object.keys(defaultAppearance).map(key => [key, appearanceOptions[key].has(value[key]) ? value[key] : defaultAppearance[key]]));
  }

  function applyAppearance(input) {
    const appearance = normalizeAppearance(input);
    const key = Object.values(appearance).join('|');
    if (key !== appearanceKey) {
      for (const [category, value] of Object.entries(appearance)) world.dataset[category] = value;
      if (demo) document.querySelectorAll('[data-appearance]').forEach(select => { select.value = appearance[select.dataset.appearance]; });
      appearanceKey = key;
    }
    return appearance;
  }

  function update(next) {
    next = next && typeof next === 'object' ? next : {};
    const beginSnack = next.mode === 'feed' && state.mode !== 'feed';
    state = { ...state, ...next };
    state.species = speciesOptions.has(state.species) ? state.species : 'hamster';
    world.dataset.species = state.species;
    state.appearance = applyAppearance(state.appearance);
    world.dataset.mode = modes.has(state.mode) ? state.mode : 'idle';
    world.dataset.direction = state.direction === -1 ? '-1' : '1';
    world.classList.toggle('paused', !!state.paused);
    const companion = state.species === 'capybara' ? 'Capy, le capybara' : 'Pip, le hamster';
    world.setAttribute('aria-label', state.mode === 'pet' ? `${companion}, ferme les yeux et savoure ses caresses` : state.mode === 'sleep' ? `${companion}, dort paisiblement` : companion);
    if (demo) { const speciesSelect = document.getElementById('demo-species'); if (speciesSelect) speciesSelect.value = state.species; }
    document.querySelectorAll('[data-mode].active').forEach(el => { if (el !== world) el.classList.remove('active'); });
    document.querySelector(`button[data-mode="${world.dataset.mode}"]`)?.classList.add('active');
    if (beginSnack) snack();
  }

  if (demo) {
    let looks = { hamster: { ...defaultAppearance }, capybara: { ...defaultAppearance } };
    try {
      const saved = JSON.parse(localStorage.getItem('pip-demo-companions'));
      if (saved && typeof saved === 'object') {
        state.species = speciesOptions.has(saved.species) ? saved.species : 'hamster';
        looks = { hamster: normalizeAppearance(saved.looks?.hamster), capybara: normalizeAppearance(saved.looks?.capybara) };
      } else {
        looks.hamster = normalizeAppearance(JSON.parse(localStorage.getItem('pip-demo-appearance')));
      }
    } catch (_) { /* The preview works when storage is blocked or contains invalid data. */ }
    const params = new URLSearchParams(location.search);
    if (speciesOptions.has(params.get('species'))) state.species = params.get('species');
    state.appearance = { ...looks[state.species] };
    for (const key of Object.keys(defaultAppearance)) if (appearanceOptions[key].has(params.get(key))) state.appearance[key] = params.get(key);
    const saveDemo = () => {
      looks[state.species] = normalizeAppearance(state.appearance);
      try { localStorage.setItem('pip-demo-companions', JSON.stringify({ species: state.species, looks })); } catch (_) { /* Optional demo persistence only. */ }
    };
    document.querySelectorAll('[data-appearance]').forEach(select => {
      select.addEventListener('change', () => {
        update({ appearance: { ...state.appearance, [select.dataset.appearance]: select.value } });
        saveDemo();
      });
    });
    document.getElementById('demo-reset-look')?.addEventListener('click', () => {
      update({ appearance: { ...defaultAppearance } });
      saveDemo();
    });
    document.getElementById('demo-species')?.addEventListener('change', event => {
      looks[state.species] = normalizeAppearance(state.appearance);
      const species = speciesOptions.has(event.target.value) ? event.target.value : 'hamster';
      update({ species, appearance: { ...looks[species] } });
      saveDemo();
    });
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
