import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { attachConversationPersistence } from '../src/core/conversation-runtime.js';

async function withRuntime(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'conversation-runtime-'));
  const router = {
    logger: { warn() {}, error() {} },
    async handle(input) {
      return {
        accepted: true,
        botId: input.bot?.id || null,
        event: { channel: 'telegram', eventId: 'e1', senderId: 'u1', conversationId: 'c1', text: 'Need agent' },
        intent: 'handoff', skill: { slug: 'human-handoff' }, reply: 'I will connect you.', handoff: true, responseSource: 'scenario'
      };
    }
  };
  const runtime = attachConversationPersistence({
    config: { publicBaseUrl: 'http://127.0.0.1', maxBodyBytes: 1024 * 1024, conversations: { file: path.join(dir, 'conversations.sqlite') } },
    router,
    handler(req, res) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"not_found"}'); }
  });
  const server = http.createServer(runtime.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await run({ runtime, base }); } finally {
    await new Promise((resolve) => server.close(resolve));
    runtime.conversations.close();
    await rm(dir, { recursive: true, force: true });
  }
}

async function api(base, pathname, options = {}) {
  const response = await fetch(`${base}${pathname}`, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  return { response, payload: await response.json() };
}

test('runtime decorator persists dispatch results but skips simulations', async () => {
  await withRuntime(async ({ runtime }) => {
    const live = await runtime.router.handle({ dispatch: true, bot: { id: 'bot-a' } });
    assert.equal(live.persistence.stored, true);
    assert.equal(runtime.conversations.listConversations().length, 1);
    await runtime.router.handle({ dispatch: false, bot: { id: 'bot-a' } });
    assert.equal(runtime.conversations.listConversations().length, 1);
  });
});

test('conversation management API lists, reads, resolves and deletes durable records', async () => {
  await withRuntime(async ({ runtime, base }) => {
    const result = await runtime.router.handle({ dispatch: true, bot: { id: 'bot-a' } });
    const convId = result.persistence.conversationId;
    const ticketId = result.persistence.ticketId;

    const listed = await api(base, '/api/conversations?botId=bot-a');
    assert.equal(listed.response.status, 200);
    assert.equal(listed.payload.conversations.length, 1);

    const detail = await api(base, `/api/conversations/${convId}`);
    assert.equal(detail.payload.conversation.messages.length, 2);

    const resolved = await api(base, `/api/tickets/${ticketId}`, { method: 'PATCH', body: JSON.stringify({ status: 'resolved', priority: 'high' }) });
    assert.equal(resolved.payload.ticket.status, 'resolved');

    const read = await api(base, `/api/conversations/${convId}`, { method: 'PATCH', body: JSON.stringify({ markRead: true }) });
    assert.equal(read.payload.conversation.unreadCount, 0);
    assert.equal(read.payload.conversation.status, 'resolved');

    const deleted = await api(base, `/api/conversations/${convId}`, { method: 'DELETE' });
    assert.equal(deleted.payload.deleted, true);
  });
});

test('conversation runtime serves the durable inbox assets on the protected management surface', async () => {
  await withRuntime(async ({ base }) => {
    const script = await fetch(`${base}/inbox.js`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type') || '', /javascript/);
    assert.match(await script.text(), /Loading durable conversations/);

    const stylesheet = await fetch(`${base}/inbox.css`);
    assert.equal(stylesheet.status, 200);
    assert.match(stylesheet.headers.get('content-type') || '', /text\/css/);
  });
});
