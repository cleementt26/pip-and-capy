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
