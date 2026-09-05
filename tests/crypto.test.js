import test from 'node:test';
import assert from 'node:assert/strict';
import { hmacHex, verifyPrefixedHmac } from '../src/lib/crypto.js';

test('verifyPrefixedHmac validates raw body', () => {
  const body = Buffer.from('{"hello":"world"}');
  const secret = 'secret';
  const header = `sha256=${hmacHex('sha256', secret, body)}`;
  assert.equal(verifyPrefixedHmac({ header, prefix: 'sha256=', secret, body }), true);
  assert.equal(verifyPrefixedHmac({ header, prefix: 'sha256=', secret: 'wrong', body }), false);
});
