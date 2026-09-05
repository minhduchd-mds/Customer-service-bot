import test from 'node:test';
import assert from 'node:assert/strict';
import { TelegramConnector } from '../src/connectors/telegram.js';
import { FacebookConnector } from '../src/connectors/facebook.js';
import { ZaloConnector } from '../src/connectors/zalo.js';

test('Telegram normalizes a text message', () => {
  const connector = new TelegramConnector({ botToken: '', webhookSecret: 'abc' });
  assert.equal(connector.verify({ headers: { 'x-telegram-bot-api-secret-token': 'abc' } }).ok, true);
  const event = connector.normalize({ update_id: 9, message: { message_id: 4, date: 10, from: { id: 3 }, chat: { id: 2 }, text: 'hello' } });
  assert.equal(event.channel, 'telegram');
  assert.equal(event.eventId, '9');
  assert.equal(event.senderId, '3');
  assert.equal(event.text, 'hello');
});

test('Facebook challenge requires matching verify token', () => {
  const connector = new FacebookConnector({ verifyToken: 'token', appSecret: 'secret', pageAccessToken: '', graphVersion: 'v24.0' });
  const url = new URL('https://bot.example/webhooks/facebook?hub.mode=subscribe&hub.verify_token=token&hub.challenge=42');
  assert.deepEqual(connector.verifyChallenge(url), { ok: true, challenge: '42' });
});

test('Zalo normalizer is tolerant to common OA message fields', () => {
  const connector = new ZaloConnector({ webhookSecret: 'edge-secret', oaAccessToken: '', sendUrl: '' });
  const event = connector.normalize({ event_name: 'user_send_text', sender: { id: 'u1' }, recipient: { id: 'oa1' }, message: { msg_id: 'm1', text: 'Xin chào' }, timestamp: 123 });
  assert.equal(event.eventId, 'm1');
  assert.equal(event.senderId, 'u1');
  assert.equal(event.text, 'Xin chào');
});
