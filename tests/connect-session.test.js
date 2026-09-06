import test from 'node:test';
import assert from 'node:assert/strict';
import { ConnectSessionStore } from '../src/core/connect-session.js';

test('connect sessions reject localhost QR origins instead of generating unreachable phone links', () => {
  const store = new ConnectSessionStore({ publicBaseUrl: 'http://127.0.0.1:59979' });
  assert.throws(
    () => store.create({ botId: 'bot-1', channel: 'zalo' }),
    (error) => error?.code === 'connect_base_url_unavailable' && error?.statusCode === 409
  );
});

test('connect sessions accept LAN handoff origins', () => {
  const store = new ConnectSessionStore({ publicBaseUrl: 'http://192.168.1.25:59979' });
  const session = store.create({ botId: 'bot-1', channel: 'zalo' });
  assert.match(session.connectionUrl, /^http:\/\/192\.168\.1\.25:59979\/connect\//);
});

test('connect sessions accept public HTTPS origins', () => {
  const store = new ConnectSessionStore({ publicBaseUrl: 'https://bot.example.com/' });
  const session = store.create({ botId: 'bot-1', channel: 'facebook' });
  assert.match(session.connectionUrl, /^https:\/\/bot\.example\.com\/connect\//);
});
