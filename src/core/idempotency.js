export class IdempotencyStore {
  constructor({ ttlSeconds = 86400, now = () => Date.now() } = {}) {
    this.ttlMs = ttlSeconds * 1000;
    this.now = now;
    this.items = new Map();
  }

  seen(key) {
    if (!key) return false;
    this.cleanup();
    const expiresAt = this.items.get(key);
    if (expiresAt && expiresAt > this.now()) return true;
    this.items.set(key, this.now() + this.ttlMs);
    return false;
  }

  cleanup() {
    const now = this.now();
    for (const [key, expiresAt] of this.items) {
      if (expiresAt <= now) this.items.delete(key);
    }
  }

  get size() {
    this.cleanup();
    return this.items.size;
  }
}
