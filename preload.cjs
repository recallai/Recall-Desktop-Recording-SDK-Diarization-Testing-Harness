const { contextBridge, ipcRenderer } = require('electron/renderer');

function subscribe(channel, callback) {
  const listener = (_event, data) => callback(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('recorder', Object.freeze({
  getSnapshot: () => ipcRenderer.invoke('recorder:get-snapshot'),
  start: () => ipcRenderer.invoke('recorder:start'),
  stop: () => ipcRenderer.invoke('recorder:stop'),
  export: () => ipcRenderer.invoke('recorder:export'),
  onState: (callback) => subscribe('recorder:state', callback),
  onTranscript: (callback) => subscribe('recorder:transcript', callback),
  onReset: (callback) => subscribe('recorder:reset', callback),
}));
