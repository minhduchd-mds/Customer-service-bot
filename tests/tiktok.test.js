import test from 'node:test';
import assert from 'node:assert/strict';
import { hmacHex } from '../src/lib/crypto.js';
import { verifyTikTokSignature } from '../src/connectors/tiktok.js';

test('TikTok signature verifies HMAC of timestamp dot raw body', () => {
  const secret = 'client-secret';
  const rawBody = Buffer.from('{"event":"authorization.removed"}');
  const timestamp = 1_700_000_000;
  const signature = hmacHex('sha256', secret, `${timestamp}.${rawBody.toString('utf8')}`);
  const result = verifyTikTokSignature({ header: `t=${timestamp},s=${signature}`, clientSecret: secret, rawBody, toleranceSeconds: 300, nowSeconds: () => timestamp + 5 });
  assert.deepEqual(result, { ok: true });
});

test('TikTok signature rejects stale payload', () => {
  const rawBody = Buffer.from('{}');
  const secret = 'client-secret';
  const timestamp = 100;
  const signature = hmacHex('sha256', secret, `${timestamp}.${rawBody.toString('utf8')}`);
  const result = verifyTikTokSignature({ header: `t=${timestamp},s=${signature}`, clientSecret: secret, rawBody, toleranceSeconds: 30, nowSeconds: () => 200 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'stale_tiktok_signature');
});
