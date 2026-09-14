const { existsSync } = require('node:fs');
const { writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const RecallAiSdk = require('@recallai/desktop-sdk');
const { createRecorder } = require('./recorder');
const { recordingFilename } = require('./transcript');

const envPath = join(__dirname, '.env.local');
if (existsSync(envPath)) process.loadEnvFile(envPath);

const apiUrl = process.env.RECALL_API_URL || 'https://us-west-2.recall.ai';
let mainWindow = null;
let recorder = null;
let quitting = false;

function send(channel, data) {
  if (!mainWindow?.isDestroyed()) mainWindow.webContents.send(channel, data);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 720,
    minWidth: 520,
    minHeight: 480,
    show: false,
    backgroundColor: '#f5f7fb',
    title: 'Recall Meeting Recorder',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadFile(join(__dirname, 'public', 'index.html'));
}

function action(handler) {
  return async () => {
    try {
      await handler();
      return { ok: true };
    } catch (cause) {
      return { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
    }
  };
}

function registerIpc() {
  ipcMain.handle('recorder:get-snapshot', () => recorder.getSnapshot());
  ipcMain.handle('recorder:initialize-permissions', action(() => recorder.initializePermissions()));
  ipcMain.handle('recorder:start', action(() => recorder.startRecording()));
  ipcMain.handle('recorder:stop', action(() => recorder.stopRecording()));
  ipcMain.handle('recorder:export', action(async () => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export transcript',
      defaultPath: join(app.getPath('documents'), recordingFilename()),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePath) return;
    await writeFile(filePath, `${JSON.stringify(recorder.getExportData(), null, 2)}\n`, 'utf8');
  }));
}

app.whenReady().then(() => {
  recorder = createRecorder({
    sdk: RecallAiSdk,
    apiKey: process.env.RECALL_API_KEY,
    apiUrl,
  });
  recorder.events.on('state', (state) => send('recorder:state', state));
  recorder.events.on('transcript', (entry) => send('recorder:transcript', entry));
  recorder.events.on('reset', () => send('recorder:reset'));
  registerIpc();
  createWindow();
  recorder.initialize().catch((error) => console.error('Desktop SDK initialization failed:', error));
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => app.quit());

app.on('before-quit', (event) => {
  if (quitting || !recorder) return;
  event.preventDefault();
  quitting = true;
  recorder.close()
    .catch((error) => console.error('Shutdown failed:', error))
    .finally(() => app.quit());
});
