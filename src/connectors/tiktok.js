import { headerValue, normalizedEvent } from './base.js';
import { hmacHex, safeEqualText } from '../lib/crypto.js';

export function verifyTikTokSignature({ header, clientSecret, rawBody, toleranceSeconds = 300, nowSeconds = () => Math.floor(Date.now() / 1000) }) {
  if (!header || !clientSecret) return { ok: false, reason: 'missing_tiktok_signature_or_secret' };
  const parts = Object.fromEntries(String(header).split(',').map((part) => {
    const [key, ...rest] = part.trim().split('=');
    return [key, rest.join('=')];
  }));
  const timestamp = Number(parts.t);
  const signature = parts.s || '';
  if (!Number.isFinite(timestamp) || !signature) return { ok: false, reason: 'malformed_tiktok_signature' };
  if (Math.abs(nowSeconds() - timestamp) > toleranceSeconds) return { ok: false, reason: 'stale_tiktok_signature' };
  const signedPayload = `${timestamp}.${rawBody.toString('utf8')}`;
  const expected = hmacHex('sha256', clientSecret, signedPayload);
  return safeEqualText(signature, expected) ? { ok: true } : { ok: false, reason: 'invalid_tiktok_signature' };
}

export class TikTokConnector {
  constructor(config) { this.config = config; this.id = 'tiktok'; }
  status() {
    return {
      id: this.id,
      inboundConfigured: Boolean(this.config.clientSecret),
      outboundConfigured: Boolean(this.config.sendUrl && this.config.accessToken),
      note: 'Public developer webhooks are event callbacks. Customer messaging outbound is enabled only when an approved endpoint is configured.'
    };
  }
  verify({ headers, rawBody }) {
    return verifyTikTokSignature({
      header: headerValue(headers, 'tiktok-signature'),
      clientSecret: this.config.clientSecret,
      rawBody,
      toleranceSeconds: this.config.signatureToleranceSeconds
    });
  }
  normalize(payload) {
    let content = {};
    try { content = typeof payload.content === 'string' ? JSON.parse(payload.content) : (payload.content || {}); } catch { content = { raw: payload.content }; }
    const text = content.text || content.message || payload.text || '';
    const eventId = content.message_id || content.event_id || content.trade_order_id || content.share_id || `${payload.event || 'event'}:${payload.user_openid || 'anon'}:${payload.create_time || Date.now()}`;
    return normalizedEvent({
      channel: this.id,
      eventId: String(eventId),
      eventType: String(payload.event || 'event'),
      senderId: String(payload.user_openid || content.open_id || ''),
      conversationId: String(content.conversation_id || payload.user_openid || ''),
      recipientId: String(payload.client_key || ''),
      text: typeof text === 'string' ? text : '',
      timestamp: payload.create_time ? Number(payload.create_time) * 1000 : Date.now(),
      replyAllowed: Boolean(text && this.config.sendUrl && this.config.accessToken),
      raw: payload
    });
  }
  async send(event, text) {
    if (!this.config.sendUrl || !this.config.accessToken) return { delivered: false, reason: 'tiktok_outbound_not_configured' };
    const response = await fetch(this.config.sendUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.config.accessToken}` },
      body: JSON.stringify({ recipient_id: event.senderId, text })
    });
    if (!response.ok) throw new Error(`TikTok outbound failed with ${response.status}`);
    return { delivered: true };
  }
}
