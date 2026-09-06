import { createHmac, timingSafeEqual } from 'node:crypto';

export function hmacHex(algorithm, secret, value) {
  return createHmac(algorithm, secret).update(value).digest('hex');
}

export function safeEqualText(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function verifyPrefixedHmac({ header, prefix, algorithm = 'sha256', secret, body }) {
  if (!secret || !header?.startsWith(prefix)) return false;
  const expected = `${prefix}${hmacHex(algorithm, secret, body)}`;
  return safeEqualText(header, expected);
}
