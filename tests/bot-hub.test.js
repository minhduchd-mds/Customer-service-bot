import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { qrMatrix, qrSvg } from '../src/lib/qr.js';

async function withServer(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bot-hub-'));
  const config = loadConfig({
    HOST: '127.0.0.1',
    PORT: '0',
    PUBLIC_BASE_URL: 'http://127.0.0.1',
    BOT_STORE_FILE: path.join(dir, 'bots.json'),
    CONNECT_SESSION_TTL_SECONDS: '60',
    KNOWLEDGE_ROOT: path.join(dir, 'repos')
  });
  const app = createApp({ config, logger: { info() {}, warn() {}, error() {}, debug() {} } });
  const server = http.createServer(app.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    await run({ base, app });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
}

async function request(base, pathname, options = {}) {
  const response = await fetch(`${base}${pathname}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

test('Bot Hub supports create → connect → teach → go live → simulate', async () => {
  await withServer(async ({ base }) => {
    const created = await request(base, '/api/bots', {
      method: 'POST',
      body: JSON.stringify({ name: 'Sales Bot', purpose: 'sales', intelligenceMode: 'hybrid' })
    });
    assert.equal(created.response.status, 201);
    const botId = created.payload.bot.id;

    const connected = await request(base, '/api/connect/sessions', {
      method: 'POST',
      body: JSON.stringify({ botId, channel: 'web' })
    });
    assert.equal(connected.response.status, 201);
    assert.equal(connected.payload.instant, true);
    assert.equal(connected.payload.bot.channels[0].status, 'connected');

    const scenario = await request(base, `/api/bots/${encodeURIComponent(botId)}/scenario`, {
      method: 'PUT',
      body: JSON.stringify({ template: 'sales' })
    });
    assert.equal(scenario.response.status, 200);
    assert.equal(scenario.payload.bot.scenario.template, 'sales');

    const taught = await request(base, `/api/bots/${encodeURIComponent(botId)}/knowledge`, {
      method: 'POST',
      body: JSON.stringify({ type: 'text', name: 'Store policy', value: 'Bảo hành 12 tháng.' })
    });
    assert.equal(taught.response.status, 201);
    assert.equal(taught.payload.bot.knowledgeSources.length, 1);

    const live = await request(base, `/api/bots/${encodeURIComponent(botId)}/go-live`, { method: 'POST', body: '{}' });
    assert.equal(live.response.status, 200);
    assert.equal(live.payload.bot.status, 'running');

    const simulated = await request(base, `/api/bots/${encodeURIComponent(botId)}/simulate`, {
      method: 'POST',
      body: JSON.stringify({ channel: 'telegram', text: 'Sản phẩm này giá bao nhiêu?' })
    });
    assert.equal(simulated.response.status, 200);
    assert.equal(simulated.payload.accepted, true);
    assert.equal(simulated.payload.responseSource, 'scenario');
    assert.equal(simulated.payload.trace.length, 9);
  });
});

test('QR generator emits a fixed Version 5-L matrix and SVG', () => {
  const matrix = qrMatrix('https://bot.example.com/connect/abc123');
  assert.equal(matrix.length, 37);
  assert.equal(matrix.every((row) => row.length === 37), true);
  assert.equal(matrix[0][0], true);
  const svg = qrSvg('https://bot.example.com/connect/abc123');
  assert.match(svg, /viewBox="0 0 45 45"/);
  assert.match(svg, /Connection QR code/);
});

test('QR generator rejects oversized connection payloads', () => {
  assert.throws(() => qrMatrix(`https://example.com/${'a'.repeat(200)}`), /qr_payload_too_long/);
});
