import { app, BrowserWindow, shell } from 'electron';
import http from 'node:http';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { createApp } from '../src/app.js';
import { attachConversationPersistence } from '../src/core/conversation-runtime.js';
import { selectLanAddress } from './network.js';

const APP_NAME = 'Customer Service Bot';
const SMOKE_TEST = process.argv.includes('--desktop-smoke-test');
let mainWindow = null;
let localServer = null;
let handoffServer = null;
let embeddedRuntime = null;
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
    handoffServer = runtime.handoffServer;
    embeddedRuntime = runtime.runtime;
    localOrigin = runtime.origin;

    if (SMOKE_TEST) {
      await runDesktopSmokeTest(localOrigin, runtime.qrOrigin, runtime.qrSource);
      await closeServer(handoffServer);
      await closeServer(localServer);
      handoffServer = null;
      localServer = null;
      try { embeddedRuntime?.conversations?.close?.(); } catch {}
      embeddedRuntime = null;
      console.log(JSON.stringify({
        ok: true,
        event: 'desktop_smoke_test_passed',
        origin: localOrigin,
        qrOrigin: runtime.qrOrigin,
        qrSource: runtime.qrSource
      }));
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
  if (handoffServer) handoffServer.close();
  if (localServer) localServer.close();
  try { embeddedRuntime?.conversations?.close?.(); } catch {}
  embeddedRuntime = null;
});

async function startEmbeddedRuntime() {
  const userData = app.getPath('userData');
  const stateDir = path.join(userData, 'state');
  const knowledgeDir = path.join(userData, 'knowledge');
  await mkdir(stateDir, { recursive: true });
  await mkdir(knowledgeDir, { recursive: true });

  process.env.HOST = '127.0.0.1';
  process.env.BOT_STORE_FILE = path.join(stateDir, 'bots.json');
  process.env.PLATFORM_SETTINGS_FILE = path.join(stateDir, 'platform-settings.json');
  process.env.SKILL_STORE_FILE = path.join(stateDir, 'skills.json');
  process.env.CONVERSATION_DB_FILE = path.join(stateDir, 'conversations.sqlite');
  process.env.KNOWLEDGE_ROOT = knowledgeDir;

  const runtime = attachConversationPersistence(createApp());
  const server = http.createServer(runtime.handler);
  tuneServer(server);
  await listen(server, '127.0.0.1');

  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Unable to resolve local desktop server port');
  const origin = `http://127.0.0.1:${address.port}`;

  const configuredPublicBase = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
  let qrOrigin = configuredPublicBase || origin;
  let qrSource = configuredPublicBase ? 'public' : 'loopback';
  let qrHandoffServer = null;

  if (!configuredPublicBase) {
    const lanAddress = selectLanAddress();
    if (lanAddress) {
      qrHandoffServer = http.createServer(connectOnlyHandler(runtime.handler));
      tuneServer(qrHandoffServer);
      await listen(qrHandoffServer, '0.0.0.0');
      const handoffAddress = qrHandoffServer.address();
      if (!handoffAddress || typeof handoffAddress === 'string') throw new Error('Unable to resolve QR handoff server port');
      qrOrigin = `http://${lanAddress}:${handoffAddress.port}`;
      qrSource = 'lan';
    } else {
      console.warn('No reachable LAN IPv4 address found. QR handoff will remain localhost-only until PUBLIC_BASE_URL is configured.');
    }
  }

  runtime.connectSessions.publicBaseUrl = qrOrigin;
  return { server, handoffServer: qrHandoffServer, runtime, origin, qrOrigin, qrSource };
}

async function runDesktopSmokeTest(origin, qrOrigin, qrSource) {
  const healthResponse = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(10_000) });
  if (!healthResponse.ok) throw new Error(`Desktop health endpoint returned ${healthResponse.status}`);
  const health = await healthResponse.json();
  if (health?.ok !== true || health?.product !== 'Bot Hub') throw new Error('Desktop health payload is invalid');

  const botsResponse = await fetch(`${origin}/api/bots`, { signal: AbortSignal.timeout(10_000) });
  if (!botsResponse.ok) throw new Error(`Desktop bots endpoint returned ${botsResponse.status}`);
  const bots = await botsResponse.json();
  if (!Array.isArray(bots?.bots)) throw new Error('Desktop bots endpoint payload is invalid');

  const skillsResponse = await fetch(`${origin}/api/skills`, { signal: AbortSignal.timeout(10_000) });
  if (!skillsResponse.ok) throw new Error(`Desktop skills endpoint returned ${skillsResponse.status}`);
  const skills = await skillsResponse.json();
  if (!Array.isArray(skills?.skills) || !skills.skills.length) throw new Error('Desktop skills endpoint payload is invalid');

  const deploymentResponse = await fetch(`${origin}/api/deployment`, { signal: AbortSignal.timeout(10_000) });
  if (!deploymentResponse.ok) throw new Error(`Desktop deployment endpoint returned ${deploymentResponse.status}`);
  const deployment = await deploymentResponse.json();
  if (!deployment?.deployment || typeof deployment?.dockerEnv !== 'string') throw new Error('Desktop deployment payload is invalid');

  const conversationsResponse = await fetch(`${origin}/api/conversations`, { signal: AbortSignal.timeout(10_000) });
  if (!conversationsResponse.ok) throw new Error(`Desktop conversations endpoint returned ${conversationsResponse.status}`);
  const conversations = await conversationsResponse.json();
  if (!Array.isArray(conversations?.conversations)) throw new Error('Desktop conversations payload is invalid');

  if (qrSource === 'lan') {
    const handoffResponse = await fetch(`${qrOrigin}/connect/desktop-smoke-invalid`, { signal: AbortSignal.timeout(10_000) });
    if (handoffResponse.status !== 404) throw new Error(`Desktop LAN handoff returned unexpected status ${handoffResponse.status}`);
  }
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

function connectOnlyHandler(appHandler) {
  return (request, response) => {
    let pathname = '';
    try {
      pathname = new URL(request.url || '/', 'http://handoff.local').pathname;
    } catch {
      response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Bad request');
      return;
    }
    if (request.method === 'GET' && pathname.startsWith('/connect/')) return appHandler(request, response);
    response.writeHead(404, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    response.end(JSON.stringify({ error: 'not_found' }));
  };
}

function tuneServer(server) {
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;
}

function listen(server, host) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(0, host, () => {
      server.off('error', onError);
      resolve();
    });
  });
}

function isLocalUrl(url, origin) {
  try { return new URL(url).origin === origin; } catch { return false; }
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (!server?.listening) return resolve();
    server.close(() => resolve());
  });
}
