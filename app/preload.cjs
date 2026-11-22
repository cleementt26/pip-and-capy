'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const allowedActions = new Set(['drag-start', 'drag-end', 'feed', 'menu']);
contextBridge.exposeInMainWorld('hamster', {
  action(type) { if (allowedActions.has(type)) ipcRenderer.send('pet:action', type); },
  onState(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('pet:state', listener);
    return () => ipcRenderer.removeListener('pet:state', listener);
  }
});
contextBridge.exposeInMainWorld('companions', {
  chooseSpecies(species) { if (species === 'hamster' || species === 'capybara') ipcRenderer.send('pet:choose-species', species); },
  cancel() { ipcRenderer.send('launcher:cancel'); },
  onSelection(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('launcher:state', listener);
    ipcRenderer.send('launcher:ready');
    return () => ipcRenderer.removeListener('launcher:state', listener);
  }
});
