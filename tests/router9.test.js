import test from 'node:test';
import assert from 'node:assert/strict';
import { Router9 } from '../src/core/router9.js';
import { IdempotencyStore } from '../src/core/idempotency.js';

function harness() {
  const connector = {
    id: 'test',
    verify: () => ({ ok: true }),
    normalize: (payload) => ({ channel: 'test', eventId: payload.id, eventType: 'message', senderId: 'u', conversationId: 'u', recipientId: 'bot', text: payload.text, timestamp: Date.now(), replyAllowed: true, raw: payload }),
    send: async () => ({ delivered: true })
  };
  const router = new Router9({
    idempotency: new IdempotencyStore({ ttlSeconds: 60 }),
    knowledge: { search: async () => [{ path: 'repo/README.md', score: 2, excerpt: 'known answer' }] },
    ai: { enabled: false, reply: async ({ intent }) => `reply:${intent}` },
    workflow: { emit: async () => ({ delivered: true }) },
    logger: { info() {}, warn() {}, error() {} }
  });
  return { router, connector };
}

test('Router9 executes all nine stages', async () => {
  const { router, connector } = harness();
  const payload = { id: '1', text: 'Tôi cần hỗ trợ' };
  const result = await router.handle({ connector, rawBody: Buffer.from(JSON.stringify(payload)), payload, headers: {}, url: new URL('https://example.test'), dispatch: true });
  assert.equal(result.accepted, true);
  assert.equal(result.trace.length, 9);
  assert.equal(result.outbound.delivered, true);
  assert.equal(result.intent, 'support');
});

test('Router9 drops duplicate events safely', async () => {
  const { router, connector } = harness();
  const payload = { id: 'same', text: 'hello' };
  const args = { connector, rawBody: Buffer.from(JSON.stringify(payload)), payload, headers: {}, url: new URL('https://example.test'), dispatch: false };
  const first = await router.handle(args);
  const second = await router.handle(args);
  assert.equal(first.duplicate, undefined);
  assert.equal(second.duplicate, true);
});

test('Router9 rejects failed authenticity checks before processing', async () => {
  const { router } = harness();
  const connector = { verify: () => ({ ok: false, reason: 'bad_signature' }), normalize: () => { throw new Error('must not run'); } };
  const result = await router.handle({ connector, rawBody: Buffer.from('{}'), payload: {}, headers: {}, url: new URL('https://example.test') });
  assert.equal(result.accepted, false);
  assert.equal(result.statusCode, 401);
  assert.equal(result.trace.length, 2);
});
