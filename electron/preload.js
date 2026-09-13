const { contextBridge, ipcRenderer, webFrame } = require('electron');

// Apply the saved zoom as early as possible (preload runs before page
// scripts), so full loads (startup, login reload, F5) start at the right
// zoom. Async on purpose: a blocking call here could stall first paint.
try {
  ipcRenderer.invoke('zoom-get').then((savedZoom) => {
    if (typeof savedZoom === 'number' && savedZoom > 0) {
      webFrame.setZoomFactor(savedZoom);
    }
  }).catch(() => {});
} catch (e) { /* main process applies it on load instead */ }

contextBridge.exposeInMainWorld('cooplog', {
  platform: process.platform,
  versions: {
    node: process.versions.node,
    electron: process.versions.electron,
    chrome: process.versions.chrome
  },
  getAppVersion: () => ipcRenderer.invoke('app-version'),
  zoomIn: () => ipcRenderer.invoke('zoom-in'),
  zoomOut: () => ipcRenderer.invoke('zoom-out'),
  zoomReset: () => ipcRenderer.invoke('zoom-reset'),
  zoomGet: () => ipcRenderer.invoke('zoom-get'),
  refreshApp: () => ipcRenderer.invoke('app-refresh'),
  onZoomChanged: (cb) => {
    const listener = (_e, z) => cb(z);
    ipcRenderer.on('zoom-changed', listener);
    return () => ipcRenderer.removeListener('zoom-changed', listener);
  },
  onUpdateStatus: (cb) => {
    const listener = (_e, msg) => cb(msg);
    ipcRenderer.on('update-status', listener);
    return () => ipcRenderer.removeListener('update-status', listener);
  }
});
