import { randomBytes } from 'node:crypto';
import { HttpError } from '../lib/http.js';

const CHANNELS = new Set(['zalo', 'facebook', 'telegram', 'tiktok', 'web']);

export class ConnectSessionStore {
  constructor({ ttlSeconds = 600, publicBaseUrl = '', now = () => Date.now() } = {}) {
    this.ttlMs = ttlSeconds * 1000;
    this.publicBaseUrl = normalizeBaseUrl(publicBaseUrl);
    this.now = now;
    this.items = new Map();
  }

  setPublicBaseUrl(value = '') {
    this.publicBaseUrl = normalizeBaseUrl(value);
    return this.publicBaseUrl;
  }

  create({ botId, channel }) {
    if (!botId) throw new Error('bot_id_required');
    if (!CHANNELS.has(channel)) throw new Error('unsupported_channel');
    if (!this.publicBaseUrl || isLoopbackBase(this.publicBaseUrl)) {
      throw new HttpError(
        409,
        'No phone-reachable connection URL is available. Connect Windows to Wi-Fi/Ethernet or configure a public HTTPS PUBLIC_BASE_URL, then create the QR again.',
        'connect_base_url_unavailable'
      );
    }
    this.cleanup();
    const token = randomBytes(18).toString('base64url');
    const createdAt = this.now();
    const item = {
      token,
      botId,
      channel,
      status: 'pending',
      createdAt,
      expiresAt: createdAt + this.ttlMs,
      connectionUrl: `${this.publicBaseUrl}/connect/${token}`
    };
    this.items.set(token, item);
    return { ...item };
  }

  get(token) {
    this.cleanup();
    const item = this.items.get(token);
    return item ? { ...item } : null;
  }

  update(token, patch = {}) {
    this.cleanup();
    const item = this.items.get(token);
    if (!item) return null;
    if (['pending', 'authorizing', 'connected', 'failed', 'expired'].includes(patch.status)) item.status = patch.status;
    if (patch.providerState != null) item.providerState = String(patch.providerState).slice(0, 256);
    if (patch.error != null) item.error = String(patch.error).slice(0, 500);
    return { ...item };
  }

  cleanup() {
    const now = this.now();
    for (const [token, item] of this.items) {
      if (item.expiresAt <= now) this.items.delete(token);
    }
  }
}

function normalizeBaseUrl(value = '') {
  return String(value || '').trim().replace(/\/$/, '');
}

function isLoopbackBase(value = '') {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
  } catch {
    return true;
  }
}
