import { normalizedEvent } from './base.js';

const DEFAULT_BASE_URL = 'https://bot-api.zaloplatforms.com';

export class ZaloBotConnector {
  constructor(config = {}, logger = null) {
    this.id = 'zalo-bot';
    this.token = String(config.token || '').trim();
    this.baseUrl = String(config.baseUrl || DEFAULT_BASE_URL).trim().replace(/\/$/, '');
    this.pollTimeoutSeconds = clamp(Number(config.pollTimeoutSeconds) || 25, 1, 50);
    this.logger = logger;
    this.runtime = {
      polling: 'idle',
      assignedBotId: null,
      lastPollAt: null,
      lastUpdateAt: null,
      lastError: null
    };
  }

  get configured() {
    return Boolean(this.token);
  }

  status() {
    return {
      id: this.id,
      label: 'Zalo Bot (Official)',
      inboundConfigured: this.configured,
      outboundConfigured: this.configured,
      connectMethod: 'bot-token-polling',
      runtime: { ...this.runtime },
      note: 'Official Zalo Bot API. Local Docker/desktop can receive messages by long polling without a public webhook.'
    };
  }

  updateRuntime(patch = {}) {
    this.runtime = { ...this.runtime, ...patch };
  }

  verify() {
    return { ok: false, reason: 'zalo_bot_uses_trusted_polling_or_webhook_adapter' };
  }

  normalize(update = {}) {
    const message = update?.message || {};
    const chatId = value(message?.chat?.id);
    const senderId = value(message?.from?.id || chatId);
    const text = typeof message?.text === 'string' ? message.text : '';
    const messageId = value(message?.message_id);
    const updateId = value(update?.update_id);
    return normalizedEvent({
      channel: this.id,
      eventId: updateId || messageId,
      eventType: text ? 'message' : String(message?.message_type || 'message'),
      senderId,
      conversationId: chatId || senderId,
      recipientId: 'zalo-bot',
      text,
      timestamp: normalizeTimestamp(message?.date),
      replyAllowed: Boolean((chatId || senderId) && text),
      raw: update
    });
  }

  async probe({ signal } = {}) {
    if (!this.configured) return { ok: false, reason: 'zalo_bot_token_not_configured' };
    try {
      const result = await this.request('getMe', {}, { signal, timeoutMs: 10_000 });
      return {
        ok: true,
        bot: result && typeof result === 'object'
          ? { id: value(result.id), name: String(result.name || result.username || '').slice(0, 120) }
          : null
      };
    } catch (error) {
      return { ok: false, reason: 'zalo_bot_probe_failed', detail: safeError(error) };
    }
  }

  async poll({ offset, timeoutSeconds = this.pollTimeoutSeconds, limit = 50, signal } = {}) {
    if (!this.configured) return [];
    const timeout = clamp(Number(timeoutSeconds) || this.pollTimeoutSeconds, 1, 50);
    const result = await this.request('getUpdates', {
      timeout,
      offset: Number.isFinite(Number(offset)) ? Number(offset) : undefined,
      limit: clamp(Number(limit) || 50, 1, 100)
    }, { signal, timeoutMs: (timeout + 8) * 1000 });
    this.updateRuntime({ polling: 'running', lastPollAt: new Date().toISOString(), lastError: null });
    return Array.isArray(result) ? result : [];
  }

  async send(event, text) {
    if (!this.configured) return { delivered: false, reason: 'zalo_bot_token_not_configured' };
    const chatId = String(event?.conversationId || event?.senderId || '').trim();
    if (!chatId || !text) return { delivered: false, reason: 'zalo_bot_missing_chat_or_text' };
    await this.request('sendMessage', { chat_id: chatId, text: String(text).slice(0, 10000) }, { timeoutMs: 15_000 });
    return { delivered: true };
  }

  async request(method, payload = {}, { signal, timeoutMs = 15_000 } = {}) {
    if (!this.configured) throw new Error('Zalo Bot token is not configured');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const mergedSignal = mergeSignals(signal, controller.signal);
    try {
      const response = await fetch(`${this.baseUrl}/bot${encodeURIComponent(this.token)}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'customer-service-bot/0.6' },
        body: JSON.stringify(compact(payload)),
        signal: mergedSignal
      });
      const raw = await response.text();
      let body = null;
      try { body = raw ? JSON.parse(raw) : {}; } catch { throw new Error(`Zalo Bot API ${method} returned invalid JSON`); }
      if (!response.ok || body?.ok === false) {
        const description = String(body?.description || body?.message || `HTTP ${response.status}`).slice(0, 240);
        const error = new Error(`Zalo Bot API ${method} failed: ${description}`);
        error.status = response.status;
        error.retryAfter = Number(body?.parameters?.retry_after || 0) || null;
        throw error;
      }
      return body?.result;
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error(`Zalo Bot API ${method} timed out`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

function compact(value) {
  return Object.fromEntries(Object.entries(value || {}).filter(([, item]) => item !== undefined && item !== null));
}

function value(input) {
  return input == null ? '' : String(input);
}

function normalizeTimestamp(value) {
  const number = Number(value || Date.now());
  if (!Number.isFinite(number)) return Date.now();
  return number < 1e12 ? number * 1000 : number;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function safeError(error) {
  return String(error?.message || 'unknown').replace(/bot[^/\s]+/gi, 'bot[redacted]').slice(0, 300);
}

function mergeSignals(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a.aborted || b.aborted) return AbortSignal.abort();
  const controller = new AbortController();
  const abort = () => controller.abort();
  a.addEventListener('abort', abort, { once: true });
  b.addEventListener('abort', abort, { once: true });
  return controller.signal;
}
