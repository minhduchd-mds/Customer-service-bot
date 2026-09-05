import test from 'node:test';
import assert from 'node:assert/strict';
import { ConversationQueueFullError, ConversationScheduler } from '../src/core/conversation-scheduler.js';
import { Router9 } from '../src/core/router9.js';
import { IdempotencyStore } from '../src/core/idempotency.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('conversation scheduler serializes tasks for one conversation in arrival order', async () => {
  const scheduler = new ConversationScheduler();
  const events = [];
  let active = 0;
  let maxActive = 0;
  const task = (id, delay) => scheduler.run('bot:web:customer-1', async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    events.push(`start-${id}`);
    await sleep(delay);
    events.push(`end-${id}`);
    active -= 1;
    return id;
  });

  const results = await Promise.all([task(1, 25), task(2, 1), task(3, 1)]);
  assert.deepEqual(results, [1, 2, 3]);
  assert.deepEqual(events, ['start-1', 'end-1', 'start-2', 'end-2', 'start-3', 'end-3']);
  assert.equal(maxActive, 1);
  assert.equal(scheduler.snapshot().pending, 0);
});

test('conversation scheduler keeps independent conversations concurrent', async () => {
  const scheduler = new ConversationScheduler();
  let active = 0;
  let maxActive = 0;
  const work = (key) => scheduler.run(key, async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await sleep(20);
    active -= 1;
  });

  await Promise.all([work('bot:web:a'), work('bot:web:b')]);
  assert.equal(maxActive, 2);
});

test('conversation scheduler rejects overload before unbounded queue growth', async () => {
  const scheduler = new ConversationScheduler({ maxPerConversation: 1, maxPending: 8 });
  let release;
  const blocker = new Promise((resolve) => { release = resolve; });
  const first = scheduler.run('bot:web:busy', () => blocker);
  assert.throws(
    () => scheduler.run('bot:web:busy', async () => 'second'),
    (error) => error instanceof ConversationQueueFullError && error.scope === 'conversation'
  );
  assert.equal(scheduler.snapshot().rejected, 1);
  release('done');
  assert.equal(await first, 'done');
});

test('Router9 serializes AI work for the same normalized conversation', async () => {
  let activeAi = 0;
  let maxActiveAi = 0;
  const connector = {
    verify: () => ({ ok: true }),
    normalize: (payload) => ({
      channel: 'web',
      eventId: payload.id,
      eventType: 'message',
      senderId: 'customer-1',
      conversationId: 'conversation-1',
      recipientId: 'bot',
      text: payload.text,
      timestamp: Date.now(),
      replyAllowed: true,
      raw: payload
    }),
    send: async () => ({ delivered: true })
  };
  const router = new Router9({
    idempotency: new IdempotencyStore({ ttlSeconds: 60 }),
    knowledge: { search: async () => [] },
    ai: {
      enabled: true,
      reply: async () => {
        activeAi += 1;
        maxActiveAi = Math.max(maxActiveAi, activeAi);
        await sleep(15);
        activeAi -= 1;
        return 'ok';
      }
    },
    workflow: { emit: async () => ({ delivered: false }) },
    logger: { info() {}, warn() {}, error() {} }
  });

  const request = (id) => router.handle({
    connector,
    rawBody: Buffer.from('{}'),
    payload: { id, text: `message ${id}` },
    headers: {},
    url: new URL('https://example.test/webhook'),
    dispatch: false
  });

  const [first, second] = await Promise.all([request('a'), request('b')]);
  assert.equal(first.accepted, true);
  assert.equal(second.accepted, true);
  assert.equal(maxActiveAi, 1);
  assert.equal(router.snapshotMetrics().queue.pending, 0);
});
