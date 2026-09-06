import { app, BrowserWindow, shell } from 'electron';
import http from 'node:http';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { createApp } from '../src/app.js';
import { attachAiConnections } from '../src/core/ai-connections-runtime.js';
import { attachConnectionActions } from '../src/core/connect-actions-runtime.js';
import { attachConversationPersistence } from '../src/core/conversation-runtime.js';
import { attachCredentialVault } from '../src/core/credential-runtime.js';
import { attachOperationsCenter } from '../src/core/operations-runtime.js';
import { attachWebWidget } from '../src/core/web-widget-runtime.js';
import { isLoopbackUrl, selectLanAddress } from './network.js';

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
      console.log(JSON.stringify({ ok: true, event: 'desktop_smoke_test_passed', origin: localOrigin, qrOrigin: runtime.qrOrigin, qrSource: runtime.qrSource }));
      app.exit(0);
      return;
    }

    mainWindow = createWindow(localOrigin);
  } catch (error) {
    console.error('Desktop startup failed:', error?.stack || error?.message || String(error));
    app.exit(1);
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && localOrigin && !SMOKE_TEST) mainWindow = createWindow(localOrigin);
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
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
  process.env.CREDENTIAL_VAULT_FILE = path.join(stateDir, 'credentials.json');
  process.env.CREDENTIAL_VAULT_LOCAL_KEY_FILE = path.join(stateDir, 'credentials.key');
  process.env.CREDENTIAL_VAULT_ALLOW_LOCAL_KEY = 'true';
  process.env.AI_CONNECTION_STORE_FILE = path.join(stateDir, 'ai-connections.json');
  process.env.WEB_WIDGET_ENABLED = 'true';
  process.env.KNOWLEDGE_ROOT = knowledgeDir;

  let runtime = createApp();
  await attachCredentialVault(runtime);
  await attachAiConnections(runtime);
  runtime = attachWebWidget(attachOperationsCenter(attachConversationPersistence(attachConnectionActions(runtime))));
  const server = http.createServer(runtime.handler);
  tuneServer(server);
  await listen(server, '127.0.0.1');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Unable to resolve local desktop server port');
  const origin = `http://127.0.0.1:${address.port}`;

  const configured = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
  const configuredPublicBase = configured && !isLoopbackUrl(configured) ? configured : '';
  let qrOrigin = configuredPublicBase || null;
  let qrSource = configuredPublicBase ? 'public' : 'unavailable';
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
      console.warn('No phone-reachable LAN IPv4 address found. QR creation is disabled until Wi-Fi/Ethernet or a public HTTPS URL is available.');
    }
  }

  runtime.connectSessions.setPublicBaseUrl(qrOrigin || '');
  return { server, handoffServer: qrHandoffServer, runtime, origin, qrOrigin, qrSource };
}

async function runDesktopSmokeTest(origin, qrOrigin, qrSource) {
  const health = await getJson(`${origin}/api/health`, 'health');
  if (health?.ok !== true || health?.product !== 'Bot Hub') throw new Error('Desktop health payload is invalid');

  const bots = await getJson(`${origin}/api/bots`, 'bots');
  if (!Array.isArray(bots?.bots)) throw new Error('Desktop bots endpoint payload is invalid');

  const skills = await getJson(`${origin}/api/skills`, 'skills');
  if (!Array.isArray(skills?.skills) || !skills.skills.length) throw new Error('Desktop skills endpoint payload is invalid');

  const deployment = await getJson(`${origin}/api/deployment`, 'deployment');
  if (!deployment?.deployment || typeof deployment?.dockerEnv !== 'string') throw new Error('Desktop deployment payload is invalid');

  const conversations = await getJson(`${origin}/api/conversations`, 'conversations');
  if (!Array.isArray(conversations?.conversations)) throw new Error('Desktop conversations payload is invalid');

  const operations = await getJson(`${origin}/api/operations/doctor`, 'operations doctor');
  if (!operations?.doctor || operations.doctor.state?.backend !== 'sqlite') throw new Error('Desktop operations payload is invalid');

  const credentials = await getJson(`${origin}/api/credentials/status`, 'credential vault');
  if (!credentials?.vault?.enabled || credentials.vault.mode !== 'local-key') throw new Error('Desktop credential vault is not enabled with a local key');

  const providers = await getJson(`${origin}/api/ai/providers`, 'AI providers');
  if (!Array.isArray(providers?.providers) || !providers.providers.some((item) => item.id === 'openai') || !providers.providers.some((item) => item.id === 'gemini')) throw new Error('Desktop AI provider catalog is unavailable');

  const aiConnections = await getJson(`${origin}/api/ai/connections`, 'AI connections');
  if (!Array.isArray(aiConnections?.connections)) throw new Error('Desktop AI connection store is unavailable');

  const widgetScript = await fetch(`${origin}/widget.js`, { signal: AbortSignal.timeout(10_000) });
  if (!widgetScript.ok || !String(widgetScript.headers.get('content-type') || '').includes('javascript')) throw new Error('Desktop web widget asset is unavailable');

  if (qrSource === 'lan' && qrOrigin) {
    const handoffResponse = await fetch(`${qrOrigin}/connect/desktop-smoke-invalid`, { signal: AbortSignal.timeout(10_000) });
    if (handoffResponse.status !== 404) throw new Error(`Desktop LAN handoff returned unexpected status ${handoffResponse.status}`);
    const postResponse = await fetch(`${qrOrigin}/connect/desktop-smoke-invalid/confirm`, { method: 'POST', signal: AbortSignal.timeout(10_000) });
    if (postResponse.status !== 404) throw new Error(`Desktop LAN handoff POST returned unexpected status ${postResponse.status}`);
  }
}

async function getJson(url, label) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Desktop ${label} endpoint returned ${response.status}`);
  return response.json();
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
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, devTools: !app.isPackaged }
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
    try { pathname = new URL(request.url || '/', 'http://handoff.local').pathname; }
    catch {
      response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Bad request');
      return;
    }
    if ((request.method === 'GET' || request.method === 'POST') && pathname.startsWith('/connect/')) return appHandler(request, response);
    response.writeHead(404, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    response.end(JSON.stringify({ error: 'not_found' }));
  };
}

function tuneServer(server) { server.keepAliveTimeout = 65_000; server.headersTimeout = 70_000; }
function listen(server, host) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(0, host, () => { server.off('error', onError); resolve(); });
  });
}
function isLocalUrl(url, origin) { try { return new URL(url).origin === origin; } catch { return false; } }
function closeServer(server) { return new Promise((resolve) => { if (!server?.listening) return resolve(); server.close(() => resolve()); }); }
