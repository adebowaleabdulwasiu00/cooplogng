const { app, BrowserWindow, dialog, shell, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
let autoUpdater = null;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch (e) {
  console.log('[Electron] electron-updater not installed, auto-update disabled.');
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

// Bound Chromium's HTTP/disk cache: the renderer otherwise grows its cache
// folder unboundedly on long-lived desktop installs (contributes to the
// sustained disk activity seen next to high memory use).
try {
  app.commandLine.appendSwitch('disk-cache-size', '104857600');
} catch (e) { /* flags must be set early; ignore if too late */ }

let mainWindow = null;
const START_URL = process.env.ELECTRON_START_URL || '';

const DEFAULT_ZOOM = 0.85;
const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.0;
let currentZoom = DEFAULT_ZOOM;

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadZoom() {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf8');
    const z = JSON.parse(raw).zoom;
    if (typeof z === 'number' && z >= ZOOM_MIN && z <= ZOOM_MAX) currentZoom = z;
  } catch (e) { /* first run — keep default */ }
}

function saveZoom() {
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify({ zoom: currentZoom }));
  } catch (e) { console.log('[Electron] Could not save zoom setting.'); }
}

function applyZoom(notify) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.setZoomFactor(currentZoom);
  if (notify !== false) {
    try { mainWindow.webContents.send('zoom-changed', currentZoom); } catch (e) {}
  }
}

function setZoom(z) {
  currentZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));
  saveZoom();
  applyZoom();
  return currentZoom;
}

function sendStatus(msg) {
  console.log('[Update] ' + msg);
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('update-status', msg);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'CoopLog',
    backgroundColor: '#0f172a',
    show: false,
    icon: path.join(__dirname, '..', 'public', 'logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Pinned on: Occluded/minimized windows must throttle timers instead of
      // running sync + dashboard refresh loops at full speed (web tabs get
      // this from the browser automatically; Electron needs it stated).
      backgroundThrottling: true
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.setTitle('CoopLog');
  // Keep desktop title as plain "CoopLog" even though
  // dist/index.html uses "Cooperative Log App" for the web tab.
  mainWindow.on('page-title-updated', (e) => e.preventDefault());
  loadZoom();
  applyZoom(false);

  // Zoom must be re-applied on every full page load (e.g. login -> dashboard),
  // otherwise Chromium resets it and the user sees a resize flash.
  mainWindow.webContents.on('did-finish-load', () => applyZoom(false));
  mainWindow.webContents.on('did-navigate', () => applyZoom(false));

  // Show only when ready so the user never sees the unzoomed page.
  let shown = false;
  const showNow = () => {
    if (shown || !mainWindow || mainWindow.isDestroyed()) return;
    shown = true;
    mainWindow.maximize();
    mainWindow.show();
  };
  mainWindow.once('ready-to-show', () => {
    console.log('[Electron] Window ready, showing.');
    showNow();
  });

  // Safety net: never leave the user staring at nothing. If first paint
  // never completes (slow disk, page error), show anyway and log why.
  setTimeout(() => {
    if (!shown) {
      console.log('[Electron] WARNING: window was not ready after 15s, forcing show.');
      showNow();
    }
  }, 15000);

  // Diagnostics: surface page/crash problems in the terminal.
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.log('[Electron] Page failed to load: ' + code + ' ' + desc + ' (' + url + ')');
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.log('[Electron] Renderer gone: ' + (details && details.reason));
  });
  mainWindow.webContents.on('unresponsive', () => {
    console.log('[Electron] WARNING: window is unresponsive.');
  });
  mainWindow.webContents.on('console-message', (_e, _level, message) => {
    if (/error|failed|uncaught/i.test(message)) {
      console.log('[Page] ' + message);
    }
  });

  // Keyboard shortcuts: F5 / Ctrl+R refresh, Ctrl + +/-/0 zoom.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const ctrl = input.control || input.meta;
    if (input.key === 'F5' || (ctrl && input.key.toLowerCase() === 'r')) {
      event.preventDefault();
      mainWindow.webContents.reload();
    } else if (ctrl && (input.key === '+' || input.key === '=')) {
      event.preventDefault();
      setZoom(currentZoom + ZOOM_STEP);
    } else if (ctrl && input.key === '-') {
      event.preventDefault();
      setZoom(currentZoom - ZOOM_STEP);
    } else if (ctrl && input.key === '0') {
      event.preventDefault();
      setZoom(DEFAULT_ZOOM);
    }
  });

  if (START_URL) {
    mainWindow.loadURL(START_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

ipcMain.handle('app-version', () => app.getVersion());
ipcMain.handle('zoom-in', () => setZoom(currentZoom + ZOOM_STEP));
ipcMain.handle('zoom-out', () => setZoom(currentZoom - ZOOM_STEP));
ipcMain.handle('zoom-reset', () => setZoom(DEFAULT_ZOOM));
ipcMain.handle('zoom-get', () => currentZoom);
ipcMain.handle('app-refresh', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload();
});

function setupAutoUpdate() {
  if (!autoUpdater || !app.isPackaged) {
    console.log('[Electron] Auto-update active only in packaged exe.');
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => sendStatus('Checking for updates...'));
  autoUpdater.on('update-available', (info) => sendStatus('Update available: v' + info.version));
  autoUpdater.on('update-not-available', () => sendStatus('You are on the latest version.'));
  autoUpdater.on('error', (err) => sendStatus('Update error: ' + (err && err.message ? err.message : err)));
  autoUpdater.on('download-progress', (p) => {
    if (mainWindow) mainWindow.setProgressBar(p.percent / 100);
  });
  autoUpdater.on('update-downloaded', (info) => {
    sendStatus('Update downloaded: v' + info.version);
    if (mainWindow) mainWindow.setProgressBar(-1);
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update ready',
      message: 'CoopLog v' + info.version + ' downloaded. Restart now to install?',
      buttons: ['Restart now', 'Later'],
      defaultId: 0
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall(false, true);
    });
  });

  // Deferred so the update check never contends with startup DB init + sync.
  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify().catch((e) => console.error(e));
  }, 30000);
  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  }, 4 * 60 * 60 * 1000);
}

app.whenReady().then(() => {
  createWindow();
  setupAutoUpdate();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
