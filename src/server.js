import http from 'node:http';
import { createApp } from './app.js';

const app = createApp();
const server = http.createServer(app.handler);
server.keepAliveTimeout = 65_000;
server.headersTimeout = 70_000;

server.listen(app.config.port, app.config.host, () => {
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), level: 'info', event: 'server_started', host: app.config.host, port: app.config.port })}\n`);
});

const shutdown = (signal) => {
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), level: 'info', event: 'shutdown', signal })}\n`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
