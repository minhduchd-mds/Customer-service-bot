import http from 'node:http';
import { createApp } from './app.js';
import { AdminAuth, protectAdminSurface } from './core/admin-auth.js';
import { attachConnectionActions } from './core/connect-actions-runtime.js';
import { attachConversationPersistence } from './core/conversation-runtime.js';
import { attachCredentialVault } from './core/credential-runtime.js';
import { attachOperationsCenter } from './core/operations-runtime.js';
import { attachWebWidget } from './core/web-widget-runtime.js';
import { applyWebConsoleCors } from './core/web-console-cors.js';

let app = createApp();
await attachCredentialVault(app);
app = attachWebWidget(attachOperationsCenter(attachConversationPersistence(attachConnectionActions(app))));
const adminAuth = new AdminAuth(app.config.admin);
const protectedHandler = protectAdminSurface(app.handler, adminAuth);
const server = http.createServer((request, response) => {
  const cors = applyWebConsoleCors(request, response, app.config.webConsole);
  if (cors.handled) return;
  return protectedHandler(request, response);
});
server.keepAliveTimeout = 65_000;
server.headersTimeout = 70_000;

server.listen(app.config.port, app.config.host, () => {
  process.stdout.write(`${JSON.stringify({
    ts: new Date().toISOString(),
    level: 'info',
    event: 'server_started',
    host: app.config.host,
    port: app.config.port,
    adminAuth: adminAuth.mode(),
    webConsoleOrigins: app.config.webConsole?.origins?.length || 0,
    connectionActions: Boolean(app.connectionActions),
    conversationStore: app.conversations?.snapshot?.().backend || 'disabled',
    credentialVault: app.credentialVault?.status?.().mode || 'disabled',
    webWidget: Boolean(app.webWidget?.enabled),
    operations: Boolean(app.operations)
  })}\n`);
});

const shutdown = (signal) => {
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), level: 'info', event: 'shutdown', signal })}\n`);
  server.close(() => {
    try { app.conversations?.close?.(); } catch {}
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
