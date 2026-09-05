import { headerValue, normalizedEvent } from './base.js';

export class TelegramConnector {
  constructor(config) { this.config = config; this.id = 'telegram'; }
  status() {
    return { id: this.id, inboundConfigured: Boolean(this.config.webhookSecret), outboundConfigured: Boolean(this.config.botToken) };
  }
  verify({ headers }) {
    if (!this.config.webhookSecret) return { ok: false, reason: 'telegram_webhook_secret_not_configured' };
    const received = headerValue(headers, 'x-telegram-bot-api-secret-token');
    return received === this.config.webhookSecret ? { ok: true } : { ok: false, reason: 'invalid_telegram_secret' };
  }
  normalize(payload) {
    const message = payload.message || payload.edited_message || payload.channel_post || {};
    const text = message.text || message.caption || '';
    return normalizedEvent({
      channel: this.id,
      eventId: payload.update_id != null ? String(payload.update_id) : `telegram:${message.message_id ?? Date.now()}`,
      eventType: payload.edited_message ? 'message.edited' : 'message',
      senderId: String(message.from?.id ?? ''),
      conversationId: String(message.chat?.id ?? ''),
      recipientId: String(message.chat?.id ?? ''),
      text,
      timestamp: message.date ? message.date * 1000 : Date.now(),
      replyAllowed: Boolean(message.chat?.id && text),
      raw: payload
    });
  }
  async send(event, text) {
    if (!this.config.botToken || !event.conversationId) return { delivered: false, reason: 'telegram_outbound_not_configured' };
    const response = await fetch(`https://api.telegram.org/bot${this.config.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: event.conversationId, text })
    });
    if (!response.ok) throw new Error(`Telegram send failed with ${response.status}`);
    return { delivered: true };
  }
}
