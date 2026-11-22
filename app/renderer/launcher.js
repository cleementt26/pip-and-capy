'use strict';
(() => {
  const bridge = window.companions;
  const form = document.getElementById('choose-form');
  const invite = document.getElementById('invite');
  let unsubscribe;
  if (bridge?.onSelection) unsubscribe = bridge.onSelection(state => {
    if (state.species === 'hamster' || state.species === 'capybara') form.elements.species.value = state.species;
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const species = form.elements.species.value;
    if (species !== 'hamster' && species !== 'capybara') return;
    if (bridge?.chooseSpecies) { invite.disabled = true; bridge.chooseSpecies(species); }
  });
  document.getElementById('cancel').addEventListener('click', () => bridge?.cancel?.());
  window.addEventListener('beforeunload', () => { if (typeof unsubscribe === 'function') unsubscribe(); }, { once: true });
})();
