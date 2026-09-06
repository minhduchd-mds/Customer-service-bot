import { headerValue, normalizedEvent } from './base.js';
import { safeEqualText } from '../lib/crypto.js';

export class ZaloConnector {
  constructor(config) { this.config = config; this.id = 'zalo'; }
  status() {
    return {
      id: this.id,
      inboundConfigured: Boolean(this.config.webhookSecret),
      outboundConfigured: Boolean(this.config.oaAccessToken && this.config.sendUrl),
      note: 'Outbound endpoint is permission/product dependent and must be configured from current Zalo Developers documentation.'
    };
  }
  verify({ headers, url }) {
    // Zalo app/OA webhook security can vary by product/version. We require an operator-defined shared secret at the edge
    // instead of pretending an undocumented signature header is universal. Configure the reverse proxy/provider path to send it.
    if (!this.config.webhookSecret) return { ok: false, reason: 'zalo_webhook_secret_not_configured' };
    const headerSecret = headerValue(headers, 'x-bot-webhook-secret');
    const querySecret = url?.searchParams?.get('secret') || '';
    return safeEqualText(headerSecret, this.config.webhookSecret) || safeEqualText(querySecret, this.config.webhookSecret)
      ? { ok: true }
      : { ok: false, reason: 'invalid_zalo_shared_secret' };
  }
  normalize(payload) {
    const senderId = payload.sender?.id || payload.sender?.user_id || payload.user_id || '';
    const recipientId = payload.recipient?.id || payload.oa_id || '';
    const message = payload.message || {};
    const text = message.text || payload.text || payload.message?.content || '';
    const eventName = payload.event_name || payload.event || 'message';
    return normalizedEvent({
      channel: this.id,
      eventId: String(message.msg_id || payload.message_id || payload.timestamp || `${senderId}:${Date.now()}`),
      eventType: String(eventName),
      senderId: String(senderId),
      conversationId: String(senderId),
      recipientId: String(recipientId),
      text: typeof text === 'string' ? text : '',
      timestamp: Number(payload.timestamp || Date.now()),
      replyAllowed: Boolean(senderId && typeof text === 'string' && text),
      raw: payload
    });
  }
  async send(event, text) {
    if (!this.config.sendUrl || !this.config.oaAccessToken || !event.senderId) return { delivered: false, reason: 'zalo_outbound_not_configured' };
    const response = await fetch(this.config.sendUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', access_token: this.config.oaAccessToken },
      body: JSON.stringify({ recipient: { user_id: event.senderId }, message: { text } })
    });
    if (!response.ok) throw new Error(`Zalo send failed with ${response.status}`);
    return { delivered: true };
  }
}
