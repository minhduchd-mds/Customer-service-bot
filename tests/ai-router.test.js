import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AiRouter } from '../src/core/ai-router.js';

async function withServer(handler, run) {
  const server = http.createServer(handler);
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

function context(text = 'Tôi cần hỗ trợ') {
  return {
    event: { channel: 'web', text },
    intent: 'support',
    skill: { slug: 'support-triage', description: 'Support', instructions: 'Use verified support knowledge.' },
    knowledge: [],
    botKnowledge: [],
    history: [],
    bot: { id: 'bot_test', name: 'Test', purpose: 'support', intelligenceMode: 'hybrid', ai: {} }
  };
}

test('AI router reports the actual fallback provider after primary failure', async () => {
  await withServer((request, response) => {
    if (request.url === '/primary/chat/completions') {
      response.writeHead(503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'overloaded' }));
      return;
    }
    if (request.url === '/backup/chat/completions') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: 'Backup provider answer' } }] }));
      return;
    }
    response.writeHead(404).end();
  }, async (origin) => {
    const router = new AiRouter({
      name: 'primary',
      baseUrl: `${origin}/primary`, apiKey: 'primary-key', model: 'primary-model',
      fallbacks: [{ name: 'backup', baseUrl: `${origin}/backup`, apiKey: 'backup-key', model: 'backup-model' }],
      timeoutMs: 2_000,
      systemPrompt: 'Customer service system prompt.'
    }, { warn() {} });

    const result = await router.replyDetailed(context());
    assert.equal(result.source, 'ai');
    assert.equal(result.text, 'Backup provider answer');
    assert.deepEqual(result.provider, { name: 'backup', model: 'backup-model' });
  });
});

test('AI router marks deterministic fallback when all configured providers fail', async () => {
  await withServer((_request, response) => {
    response.writeHead(503, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'unavailable' }));
  }, async (origin) => {
    const router = new AiRouter({
      name: 'primary',
      baseUrl: `${origin}/primary`, apiKey: 'primary-key', model: 'primary-model',
      fallbacks: [{ name: 'backup', baseUrl: `${origin}/backup`, apiKey: 'backup-key', model: 'backup-model' }],
      timeoutMs: 2_000,
      systemPrompt: 'Customer service system prompt.'
    }, { warn() {} });

    const result = await router.replyDetailed(context('Ứng dụng bị lỗi'));
    assert.equal(result.source, 'fallback');
    assert.equal(result.provider, null);
    assert.match(result.text, /mô tả thêm|nhận được tin nhắn/i);
  });
});
