import http from 'node:http';
import { createApp } from './app.js';
import { AdminAuth, protectAdminSurface } from './core/admin-auth.js';
import { attachConversationPersistence } from './core/conversation-runtime.js';

const app = attachConversationPersistence(createApp());
const adminAuth = new AdminAuth(app.config.admin);
const server = http.createServer(protectAdminSurface(app.handler, adminAuth));
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
    conversationStore: app.conversations?.snapshot?.().backend || 'disabled'
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
