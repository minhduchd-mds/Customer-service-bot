import { headerValue, normalizedEvent } from './base.js';
import { verifyPrefixedHmac } from '../lib/crypto.js';

export class FacebookConnector {
  constructor(config) { this.config = config; this.id = 'facebook'; }
  status() {
    return {
      id: this.id,
      inboundConfigured: Boolean(this.config.verifyToken && this.config.appSecret),
      outboundConfigured: Boolean(this.config.pageAccessToken)
    };
  }
  verifyChallenge(url) {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    if (mode === 'subscribe' && token && token === this.config.verifyToken) return { ok: true, challenge: challenge || '' };
    return { ok: false };
  }
  verify({ headers, rawBody }) {
    if (!this.config.appSecret) return { ok: false, reason: 'facebook_app_secret_not_configured' };
    const signature = headerValue(headers, 'x-hub-signature-256');
    return verifyPrefixedHmac({ header: signature, prefix: 'sha256=', secret: this.config.appSecret, body: rawBody })
      ? { ok: true }
      : { ok: false, reason: 'invalid_facebook_signature' };
  }
  normalize(payload) {
    const messaging = payload.entry?.flatMap((entry) => entry.messaging || []) || [];
    const item = messaging[0] || {};
    return normalizedEvent({
      channel: this.id,
      eventId: String(item.message?.mid || item.postback?.mid || `${item.sender?.id || 'unknown'}:${item.timestamp || Date.now()}`),
      eventType: item.postback ? 'postback' : item.message ? 'message' : 'event',
      senderId: String(item.sender?.id || ''),
      conversationId: String(item.sender?.id || ''),
      recipientId: String(item.recipient?.id || ''),
      text: item.message?.text || item.postback?.payload || '',
      timestamp: Number(item.timestamp || Date.now()),
      replyAllowed: Boolean(item.sender?.id && (item.message?.text || item.postback?.payload)),
      raw: payload
    });
  }
  async send(event, text) {
    if (!this.config.pageAccessToken || !event.senderId) return { delivered: false, reason: 'facebook_outbound_not_configured' };
    const endpoint = `https://graph.facebook.com/${this.config.graphVersion}/me/messages?access_token=${encodeURIComponent(this.config.pageAccessToken)}`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ recipient: { id: event.senderId }, messaging_type: 'RESPONSE', message: { text } })
    });
    if (!response.ok) throw new Error(`Facebook send failed with ${response.status}`);
    return { delivered: true };
  }
}
