import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { attachWebWidget, signWidgetGrant } from '../src/core/web-widget-runtime.js';

async function withWidget(run) {
  const runtime = {
    config: {
      publicBaseUrl: '',
      maxBodyBytes: 1024 * 1024,
      webWidget: {
        enabled: true,
        allowedOrigins: ['https://shop.example'],
        maxMessageChars: 2000,
        signingKey: 'widget-test-signing-key',
        tokenTtlSeconds: 900
      }
    },
    bots: {
      async get(id) { return id === 'bot-a' ? { id: 'bot-a', name: 'Shop Assistant' } : null; }
    },
    router: {
      async handle(input) {
        return { accepted: true, reply: `reply:${input.payload.text}`, intent: 'support', handoff: false, responseSource: 'test', traceId: 'trace-1' };
      }
    },
    handler(_request, response) { response.writeHead(404); response.end(); }
  };
  attachWebWidget(runtime);
  const server = http.createServer(runtime.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try { await run({ runtime, origin }); } finally { await new Promise((resolve) => server.close(resolve)); }
}

function extractToken(html) {
  return html.match(/const token=("[^"]+")/)?.[1] ? JSON.parse(html.match(/const token=("[^"]+")/)[1]) : '';
}

test('web widget exposes bootstrap script but protects frame embedding with explicit parent origin policy', async () => {
  await withWidget(async ({ origin }) => {
    const script = await fetch(`${origin}/widget.js?botId=bot-a`);
    assert.equal(script.status, 200);
    assert.match(await script.text(), /parentOrigin = location\.origin/);

    const denied = await fetch(`${origin}/widget.html?botId=bot-a&parentOrigin=${encodeURIComponent('https://evil.example')}`);
    assert.equal(denied.status, 403);

    const unknown = await fetch(`${origin}/widget.html?botId=missing&parentOrigin=${encodeURIComponent('https://shop.example')}`);
    assert.equal(unknown.status, 404);

    const frame = await fetch(`${origin}/widget.html?botId=bot-a&parentOrigin=${encodeURIComponent('https://shop.example')}`);
    assert.equal(frame.status, 200);
    assert.match(frame.headers.get('content-security-policy') || '', /frame-ancestors https:\/\/shop\.example/);
    assert.equal(frame.headers.get('x-frame-options'), null);
    const html = await frame.text();
    assert.ok(extractToken(html));
  });
});

test('web widget message endpoint requires an untampered unexpired bot-bound grant', async () => {
  await withWidget(async ({ runtime, origin }) => {
    const frame = await fetch(`${origin}/widget.html?botId=bot-a&parentOrigin=${encodeURIComponent('https://shop.example')}`);
    const token = extractToken(await frame.text());

    const ok = await fetch(`${origin}/api/widget/bot-a/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bot-hub-widget-token': token },
      body: JSON.stringify({ text: 'hello', sessionId: 'visitor-1' })
    });
    assert.equal(ok.status, 200);
    const payload = await ok.json();
    assert.equal(payload.reply, 'reply:hello');

    const tampered = await fetch(`${origin}/api/widget/bot-a/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bot-hub-widget-token': `${token}x` },
      body: JSON.stringify({ text: 'hello' })
    });
    assert.equal(tampered.status, 403);

    const expired = signWidgetGrant({ botId: 'bot-a', parentOrigin: 'https://shop.example', expiresAt: Date.now() - 1 }, runtime.webWidget.signingKey);
    const expiredResponse = await fetch(`${origin}/api/widget/bot-a/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bot-hub-widget-token': expired },
      body: JSON.stringify({ text: 'hello' })
    });
    assert.equal(expiredResponse.status, 403);
  });
});
