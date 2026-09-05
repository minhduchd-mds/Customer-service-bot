import { app, BrowserWindow, shell } from 'electron';
import http from 'node:http';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { createApp } from '../src/app.js';

const APP_NAME = 'Customer Service Bot';
const SMOKE_TEST = process.argv.includes('--desktop-smoke-test');
let mainWindow = null;
let localServer = null;
let localOrigin = '';

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

app.setName(APP_NAME);
app.setAppUserModelId('com.minhduchd.customerservicebot');

app.whenReady().then(async () => {
  try {
    const runtime = await startEmbeddedRuntime();
    localServer = runtime.server;
    localOrigin = runtime.origin;

    if (SMOKE_TEST) {
      await runDesktopSmokeTest(localOrigin);
      await closeServer(localServer);
      localServer = null;
      console.log(JSON.stringify({ ok: true, event: 'desktop_smoke_test_passed', origin: localOrigin }));
      app.exit(0);
      return;
    }

    mainWindow = createWindow(localOrigin);
  } catch (error) {
    const detail = error?.stack || error?.message || String(error);
    console.error('Desktop startup failed:', detail);
    app.exit(1);
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && localOrigin && !SMOKE_TEST) {
    mainWindow = createWindow(localOrigin);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (localServer) localServer.close();
});

async function startEmbeddedRuntime() {
  const userData = app.getPath('userData');
  const stateDir = path.join(userData, 'state');
  const knowledgeDir = path.join(userData, 'knowledge');
  await mkdir(stateDir, { recursive: true });
  await mkdir(knowledgeDir, { recursive: true });

  process.env.HOST = '127.0.0.1';
  process.env.BOT_STORE_FILE = path.join(stateDir, 'bots.json');
  process.env.KNOWLEDGE_ROOT = knowledgeDir;

  const runtime = createApp();
  const server = http.createServer(runtime.handler);
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;

  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Unable to resolve local desktop server port');
  const origin = `http://127.0.0.1:${address.port}`;

  // QR sessions should point to the real public callback when configured;
  // otherwise they point to the embedded local runtime for desktop-only flows.
  runtime.connectSessions.publicBaseUrl = (process.env.PUBLIC_BASE_URL || origin).replace(/\/$/, '');

  return { server, runtime, origin };
}

async function runDesktopSmokeTest(origin) {
  const healthResponse = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(10_000) });
  if (!healthResponse.ok) throw new Error(`Desktop health endpoint returned ${healthResponse.status}`);
  const health = await healthResponse.json();
  if (health?.ok !== true || health?.product !== 'Bot Hub') throw new Error('Desktop health payload is invalid');

  const botsResponse = await fetch(`${origin}/api/bots`, { signal: AbortSignal.timeout(10_000) });
  if (!botsResponse.ok) throw new Error(`Desktop bots endpoint returned ${botsResponse.status}`);
  const bots = await botsResponse.json();
  if (!Array.isArray(bots?.bots)) throw new Error('Desktop bots endpoint payload is invalid');
}

function createWindow(origin) {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#F5F5F7',
    title: APP_NAME,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged
    }
  });

  window.once('ready-to-show', () => window.show());

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isLocalUrl(url, origin)) return { action: 'allow' };
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (isLocalUrl(url, origin)) return;
    event.preventDefault();
    void shell.openExternal(url);
  });

  void window.loadURL(origin);
  return window;
}

function isLocalUrl(url, origin) {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (!server?.listening) return resolve();
    server.close(() => resolve());
  });
}
