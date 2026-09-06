import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AdminAuth, isLoopbackAddress, isPublicRuntimePath, protectAdminSurface } from '../src/core/admin-auth.js';

async function withServer(auth, run) {
  const handler = (_request, response) => {
    const body = JSON.stringify({ ok: true });
    response.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
    response.end(body);
  };
  const server = http.createServer(protectAdminSurface(handler, auth));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('admin auth recognizes loopback and narrow public runtime paths', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true);
  assert.equal(isLoopbackAddress('::1'), true);
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
  assert.equal(isLoopbackAddress('10.0.0.4'), false);
  assert.equal(isPublicRuntimePath('/api/health'), true);
  assert.equal(isPublicRuntimePath('/webhooks/zalo'), true);
  assert.equal(isPublicRuntimePath('/connect/example'), true);
  assert.equal(isPublicRuntimePath('/api/bots'), false);
  assert.equal(isPublicRuntimePath('/'), false);
});

test('configured admin token protects dashboard and management API but leaves provider surfaces public', async () => {
  const auth = new AdminAuth({ user: 'admin', token: 'correct-horse-battery-staple' });
  await withServer(auth, async (origin) => {
    const root = await fetch(`${origin}/`);
    assert.equal(root.status, 401);
    assert.match(root.headers.get('www-authenticate') || '', /Basic/i);

    const api = await fetch(`${origin}/api/bots`);
    assert.equal(api.status, 401);

    const health = await fetch(`${origin}/api/health`);
    assert.equal(health.status, 200);

    const webhook = await fetch(`${origin}/webhooks/telegram`);
    assert.equal(webhook.status, 200);

    const authorized = await fetch(`${origin}/api/bots`, {
      headers: { authorization: `Basic ${Buffer.from('admin:correct-horse-battery-staple').toString('base64')}` }
    });
    assert.equal(authorized.status, 200);
  });
});

test('missing admin token allows loopback only and fails closed for remote management', () => {
  const auth = new AdminAuth({ user: 'admin', token: '' });
  assert.equal(auth.authorize({ socket: { remoteAddress: '127.0.0.1' }, headers: {} }), true);
  assert.equal(auth.authorize({ socket: { remoteAddress: '10.20.30.40' }, headers: {} }), false);
  assert.equal(auth.mode(), 'loopback-only');
});

test('admin credential comparison rejects wrong username or token', () => {
  const auth = new AdminAuth({ user: 'admin', token: 'secret-token' });
  const request = (value) => ({ socket: { remoteAddress: '10.0.0.8' }, headers: { authorization: `Basic ${Buffer.from(value).toString('base64')}` } });
  assert.equal(auth.authorize(request('admin:secret-token')), true);
  assert.equal(auth.authorize(request('operator:secret-token')), false);
  assert.equal(auth.authorize(request('admin:wrong-token')), false);
});
