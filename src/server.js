import http from 'node:http';
import { createApp } from './app.js';
import { AdminAuth, protectAdminSurface } from './core/admin-auth.js';

const app = createApp();
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
    adminAuth: adminAuth.mode()
  })}\n`);
});

const shutdown = (signal) => {
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), level: 'info', event: 'shutdown', signal })}\n`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
