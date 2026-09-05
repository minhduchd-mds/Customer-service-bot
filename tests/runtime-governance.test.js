import test from 'node:test';
import assert from 'node:assert/strict';
import { ConversationMemory } from '../src/core/conversation-memory.js';
import { ToolPolicy } from '../src/core/tool-policy.js';
import { TraceStore } from '../src/core/trace-store.js';

test('tool policy supports conservative profiles and explicit deny', () => {
  const policy = new ToolPolicy();
  assert.equal(policy.allows(null, 'channel.reply'), true);
  assert.equal(policy.allows({ toolPolicy: { profile: 'read-only', allow: [], deny: [] } }, 'channel.reply'), false);
  assert.equal(policy.allows({ toolPolicy: { profile: 'customer-service', allow: [], deny: ['ai.reply'] } }, 'ai.reply'), false);
  assert.equal(policy.allows({ toolPolicy: { profile: 'read-only', allow: ['human.handoff'], deny: [] } }, 'human.handoff'), true);
});

test('conversation memory is bounded and isolated by bot/channel/sender', () => {
  const memory = new ConversationMemory({ maxTurns: 2 });
  const a = memory.key({ botId: 'a', channel: 'zalo', senderId: 'u1' });
  const b = memory.key({ botId: 'b', channel: 'zalo', senderId: 'u1' });
  for (let index = 0; index < 8; index += 1) memory.remember(a, { role: index % 2 ? 'assistant' : 'user', content: `m${index}` });
  memory.remember(b, { role: 'user', content: 'other bot' });
  assert.equal(memory.history(a).length, 4);
  assert.equal(memory.history(a)[0].content, 'm4');
  assert.equal(memory.history(b).length, 1);
});

test('trace store records operational metadata without customer message bodies', () => {
  const traces = new TraceStore({ limit: 20 });
  const id = traces.record({
    botId: 'bot_a', channel: 'zalo', eventId: 'event_1', intent: 'support', skill: 'support-triage',
    stages: [{ stage: 1, name: 'ingress', ok: true }], durationMs: 12
  });
  const trace = traces.get(id);
  assert.equal(trace.skill, 'support-triage');
  const serialized = JSON.stringify(trace);
  assert.equal(serialized.includes('customer message'), false);
  assert.equal(serialized.includes('rawBody'), false);
});
