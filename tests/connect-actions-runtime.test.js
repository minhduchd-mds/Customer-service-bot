import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { attachConnectionActions } from '../src/core/connect-actions-runtime.js';

async function withRuntime(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'connect-actions-'));
  const runtime = attachConnectionActions(createApp({
    config: {
      host: '127.0.0.1', port: 0, publicBaseUrl: 'http://192.168.1.10:9999', logLevel: 'silent', maxBodyBytes: 1024 * 1024,
      idempotencyTtlSeconds: 60, botStoreFile: path.join(dir, 'bots.json'), platformSettingsFile: path.join(dir, 'platform.json'),
      skillStoreFile: path.join(dir, 'skills.json'), traceLimit: 20, conversationMemoryTurns: 6,
      connect: { ttlSeconds: 600, telegramHelpUrl: 'https://t.me/BotFather', zaloAuthUrlTemplate: '', facebookAuthUrlTemplate: '', tiktokAuthUrlTemplate: '' },
      ai: { baseUrl: '', apiKey: '', model: '', fallbacks: [], timeoutMs: 1000, systemPrompt: '' },
      n8n: {}, telegram: {}, facebook: {}, zalo: {}, tiktok: {}, knowledge: { root: path.join(dir, 'repos'), maxFiles: 10, maxFileBytes: 1024 },
      admin: {}, webConsole: { origins: [] }, conversations: { file: path.join(dir, 'conversations.sqlite') }
    },
    logger: { info() {}, warn() {}, error() {}, debug() {} }
  }));
  const server = http.createServer(runtime.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await run({ runtime, base }); } finally { await new Promise((resolve) => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
}

test('QR handoff page exposes actionable provider checklist and confirm updates channel state', async () => {
  await withRuntime(async ({ runtime, base }) => {
    const bot = await runtime.bots.create({ name: 'QR Bot', purpose: 'sales' });
    const session = runtime.connectSessions.create({ botId: bot.id, channel: 'zalo' });
    await runtime.bots.upsertChannel(bot.id, 'zalo', { status: 'pending', connectionId: session.token });

    const page = await fetch(`${base}/connect/${session.token}`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Webhook \/ callback URL/);
    assert.match(html, /I have configured this channel/);
    assert.match(html, /personal web-session automation/);

    const confirmed = await fetch(`${base}/connect/${session.token}/confirm`, { method: 'POST', headers: { accept: 'application/json' } });
    assert.equal(confirmed.status, 200);
    const payload = await confirmed.json();
    assert.equal(payload.status, 'setup_reviewed');
    const updated = await runtime.bots.get(bot.id);
    assert.equal(updated.channels.find((item) => item.channel === 'zalo').status, 'setup_reviewed');
  });
});
