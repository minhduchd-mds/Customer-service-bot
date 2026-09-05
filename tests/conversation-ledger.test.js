import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ConversationLedger, redactSensitiveContent } from '../src/core/conversation-ledger.js';

async function withLedger(run, options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'conversation-ledger-'));
  const ledger = new ConversationLedger({ file: path.join(dir, 'conversations.sqlite'), ...options });
  try { await run(ledger); } finally { ledger.close(); await rm(dir, { recursive: true, force: true }); }
}

const event = (overrides = {}) => ({
  channel: 'telegram', eventId: 'evt-1', senderId: '123456', conversationId: 'chat-1', text: 'I need a human', ...overrides
});

test('conversation ledger persists a privacy-bounded handoff and creates one active ticket', async () => {
  await withLedger(async (ledger) => {
    const stored = await ledger.recordTurn({ botId: 'bot-a', event: event({ text: 'password: hunter2 card 4111 1111 1111 1111' }), intent: 'handoff', skill: { slug: 'human-handoff' }, reply: 'Connecting you.', handoff: true, responseSource: 'scenario' });
    assert.equal(stored.stored, true);
    assert.ok(stored.ticketId);
    const list = ledger.listConversations({ botId: 'bot-a' });
    assert.equal(list.length, 1);
    assert.match(list[0].senderRef, /^customer_/);
    assert.equal(JSON.stringify(list[0]).includes('123456'), false);
    const detail = ledger.getConversation(stored.conversationId);
    assert.equal(detail.messages.length, 2);
    assert.match(detail.messages[0].content, /password=\[REDACTED\]/i);
    assert.match(detail.messages[0].content, /\[PAYMENT_CARD_REDACTED\]/);
    assert.equal(detail.tickets.length, 1);
    await ledger.recordTurn({ botId: 'bot-a', event: event({ eventId: 'evt-2', text: 'still waiting' }), intent: 'handoff', skill: { slug: 'human-handoff' }, reply: 'Still queued.', handoff: true });
    assert.equal(ledger.listTickets({ botId: 'bot-a', status: 'open' }).length, 1);
  });
});

test('conversation ledger is idempotent for the same event and direction', async () => {
  await withLedger(async (ledger) => {
    await ledger.recordTurn({ botId: 'bot-a', event: event(), reply: 'hello' });
    const duplicate = await ledger.recordTurn({ botId: 'bot-a', event: event(), reply: 'hello' });
    assert.equal(duplicate.duplicate, true);
    const detail = ledger.getConversation(ledger.listConversations()[0].id);
    assert.equal(detail.messages.length, 2);
    assert.equal(detail.unreadCount, 1);
  });
});

test('resolving a handoff ticket resolves its conversation and explicit delete cascades', async () => {
  await withLedger(async (ledger) => {
    const stored = await ledger.recordTurn({ botId: 'bot-a', event: event(), handoff: true, reply: 'handoff' });
    const ticket = ledger.updateTicket(stored.ticketId, { status: 'resolved', priority: 'high' });
    assert.equal(ticket.status, 'resolved');
    assert.equal(ticket.priority, 'high');
    assert.equal(ledger.getConversation(stored.conversationId).status, 'resolved');
    assert.equal(ledger.deleteConversation(stored.conversationId), true);
    assert.equal(ledger.getConversation(stored.conversationId), null);
    assert.equal(ledger.listTickets().length, 0);
  });
});

test('retention removes old resolved conversations but preserves active handoff tickets', async () => {
  let current = new Date('2026-01-01T00:00:00Z');
  await withLedger(async (ledger) => {
    const old = await ledger.recordTurn({ botId: 'bot-a', event: event({ eventId: 'old', conversationId: 'old-chat' }), reply: 'done' });
    ledger.updateConversation(old.conversationId, { status: 'resolved' });
    const handoff = await ledger.recordTurn({ botId: 'bot-a', event: event({ eventId: 'handoff', conversationId: 'handoff-chat' }), reply: 'queued', handoff: true });
    current = new Date('2026-02-15T00:00:00Z');
    const pruned = ledger.prune();
    assert.equal(pruned.removedConversations, 1);
    assert.equal(ledger.getConversation(old.conversationId), null);
    assert.ok(ledger.getConversation(handoff.conversationId));
  }, { retentionDays: 30, now: () => current });
});

test('redaction does not remove ordinary non-sensitive order numbers', () => {
  assert.equal(redactSensitiveContent('Order 202609060001 is delayed'), 'Order 202609060001 is delayed');
});
