import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/[...path].js';

function mockResponse() {
  const headers = new Map();
  return {
    statusCode: 200,
    body: null,
    headers,
    setHeader(key, value) { headers.set(String(key).toLowerCase(), value); },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    send(payload) { this.body = payload; return this; },
    end(payload) { this.body = payload; return this; }
  };
}

async function call(path, { method = 'GET', body = null, accept = 'application/json' } = {}) {
  const segments = path.replace(/^\/api\//, '').replace(/^\//, '').split('/').filter(Boolean);
  const request = { method, query: { path: segments }, headers: { host: 'preview.vercel.app', 'x-forwarded-proto': 'https', accept, 'content-type': 'application/json' }, body };
  const response = mockResponse();
  await handler(request, response);
  return response;
}

test('Vercel API falls back to usable preview mode when BOT_RUNTIME_URL is not configured', async () => {
  const previous = process.env.BOT_RUNTIME_URL;
  delete process.env.BOT_RUNTIME_URL;
  try {
    const health = await call('/api/health');
    assert.equal(health.statusCode, 200);
    assert.equal(health.body.mode, 'vercel-preview');

    const created = await call('/api/bots', { method: 'POST', body: { name: 'Vercel Bot', purpose: 'sales', scenarioTemplate: 'product-introduction' } });
    assert.equal(created.statusCode, 201);
    assert.match(created.body.bot.id, /^bot_preview_/);

    const qr = await call('/api/connect/sessions', { method: 'POST', body: { botId: created.body.bot.id, channel: 'zalo' } });
    assert.equal(qr.statusCode, 201);
    assert.match(qr.body.session.connectionUrl, /^https:\/\/preview\.vercel\.app\/connect\//);
    assert.match(qr.body.qrSvg || '', /<svg/);

    const page = await call(`/api/connect/${qr.body.session.token}`, { accept: 'text/html' });
    assert.equal(page.statusCode, 200);
    assert.match(String(page.body), /I have configured this channel/);
  } finally {
    if (previous == null) delete process.env.BOT_RUNTIME_URL;
    else process.env.BOT_RUNTIME_URL = previous;
  }
});
