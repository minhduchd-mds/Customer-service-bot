import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/[...path].js';
import staticRouter from '../api/router.js';

function responseStub() {
  return {
    statusCode: 200,
    payload: null,
    body: null,
    headers: new Map(),
    status(value) { this.statusCode = value; return this; },
    json(value) { this.payload = value; return this; },
    send(value) { this.body = Buffer.isBuffer(value) ? value.toString('utf8') : String(value); return this; },
    setHeader(name, value) { this.headers.set(String(name).toLowerCase(), value); },
    end(value = '') { this.body = String(value); return this; }
  };
}

async function call({ path = null, url = '/', method = 'GET', body = null, headers = {} } = {}, fn = handler) {
  const response = responseStub();
  const request = { method, body, url, headers: { host: 'console.example.vercel.app', 'x-forwarded-proto': 'https', ...headers }, query: path == null ? {} : { path } };
  await fn(request, response);
  return response;
}

test('static Vercel router and fallback URL parsing reach health instead of 404', async () => {
  delete globalThis.__botHubVercelPreview;
  const direct = await call({ path: 'health', url: '/api/router?path=health' }, staticRouter);
  assert.equal(direct.statusCode, 200);
  assert.equal(direct.payload.ok, true);
  assert.equal(direct.payload.mode, 'vercel-preview');

  const fallback = await call({ url: '/api/health' });
  assert.equal(fallback.statusCode, 200);
  assert.equal(fallback.payload.product, 'Bot Hub');
});

test('Vercel never acknowledges signed provider webhooks as dispatched', async () => {
  const response = await call({ path: 'webhooks/bot-a/zalo', method: 'POST', body: { event: 'message' } });
  assert.equal(response.statusCode, 503);
  assert.equal(response.payload.error, 'direct_runtime_webhook_required');
});

test('Vercel QR preview token remains actionable after preview store cold-start', async () => {
  delete globalThis.__botHubVercelPreview;
  const createdBot = await call({ path: 'bots', method: 'POST', body: { name: 'Preview Shop' } });
  assert.equal(createdBot.statusCode, 201);
  const botId = createdBot.payload.bot.id;

  const createdSession = await call({ path: 'connect/sessions', method: 'POST', body: { botId, channel: 'zalo' } });
  assert.equal(createdSession.statusCode, 201);
  const token = createdSession.payload.session.token;
  assert.match(token, /^p\./);

  delete globalThis.__botHubVercelPreview;
  const page = await call({ path: `connect/${token}`, url: `/connect/${token}` });
  assert.equal(page.statusCode, 200);
  assert.match(page.body || '', /Connect Zalo OA/);

  const status = await call({ path: `connect/sessions/${token}` });
  assert.equal(status.statusCode, 200);
  assert.equal(status.payload.session.channel, 'zalo');
});

test('Vercel OAuth callback and runtime-only surfaces fail truthfully in preview mode', async () => {
  const callback = await call({ path: 'connect/callback/zalo', url: '/connect/callback/zalo?state=missing' });
  assert.equal(callback.statusCode, 503);
  assert.match(callback.body || '', /Live runtime required/);

  const credentials = await call({ path: 'credentials/status' });
  assert.equal(credentials.statusCode, 503);
  assert.equal(credentials.payload.error, 'live_runtime_required');

  const widget = await call({ path: 'widget.js' });
  assert.equal(widget.statusCode, 503);
  assert.equal(widget.payload.error, 'live_runtime_required');
});
