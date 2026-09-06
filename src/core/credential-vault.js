import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SUPPORTED_TYPES = new Set(['ai-provider', 'telegram', 'facebook', 'zalo', 'tiktok', 'n8n', 'custom']);
const SECRET_KEYS = new Set(['apiKey', 'accessToken', 'refreshToken', 'botToken', 'appSecret', 'clientSecret', 'sharedSecret', 'webhookSecret', 'pageAccessToken', 'oaAccessToken']);

function clean(value, max = 500) {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, max);
}

function stableHash(value, size = 16) {
  return createHash('sha256').update(String(value || '')).digest('hex').slice(0, size);
}

function keyFingerprint(secret) {
  return createHash('sha256').update(secret).digest('hex').slice(0, 12);
}

function normalizeMasterKey(value) {
  const raw = clean(value, 5000);
  if (!raw) return null;
  if (/^[a-f0-9]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  if (/^[A-Za-z0-9+/=]{43,88}$/.test(raw)) {
    try {
      const decoded = Buffer.from(raw, 'base64');
      if (decoded.length >= 32) return decoded.subarray(0, 32);
    } catch {}
  }
  return createHash('sha256').update(raw).digest();
}

function ensureLocalKey(file) {
  const keyFile = path.resolve(file);
  mkdirSync(path.dirname(keyFile), { recursive: true });
  if (!existsSync(keyFile)) {
    const value = randomBytes(32).toString('hex');
    writeFileSync(keyFile, value, { mode: 0o600 });
  }
  return normalizeMasterKey(readFileSync(keyFile, 'utf8'));
}

export class CredentialVault {
  constructor({ file = './data/state/credentials.json', masterKey = '', localKeyFile = '', allowLocalKey = false, now = () => new Date() } = {}) {
    this.file = path.resolve(file);
    this.now = now;
    this.records = new Map();
    this.key = normalizeMasterKey(masterKey);
    this.mode = this.key ? 'env-key' : 'disabled';
    if (!this.key && allowLocalKey) {
      this.key = ensureLocalKey(localKeyFile || `${this.file}.key`);
      this.mode = 'local-key';
    }
    this.keyId = this.key ? keyFingerprint(this.key) : null;
    mkdirSync(path.dirname(this.file), { recursive: true });
  }

  async load() {
    try {
      const raw = await readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      this.records = new Map((parsed.records || []).map((item) => [item.id, item]));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.records = new Map();
    }
    return this;
  }

  enabled() { return Boolean(this.key); }

  status() {
    return { enabled: this.enabled(), mode: this.mode, keyId: this.keyId, records: this.records.size, file: this.file };
  }

  list({ botId = null, type = null } = {}) {
    return Array.from(this.records.values())
      .filter((record) => !botId || record.botId === botId)
      .filter((record) => !type || record.type === type)
      .map((record) => this.publicRecord(record))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async save({ botId = 'global', type = 'custom', name = '', secrets = {}, metadata = {} } = {}) {
    if (!this.key) throw Object.assign(new Error('credential_vault_disabled'), { code: 'credential_vault_disabled' });
    const safeType = SUPPORTED_TYPES.has(type) ? type : 'custom';
    const safeBotId = clean(botId || 'global', 128);
    const safeName = clean(name || `${safeType} credential`, 120);
    const cleanSecrets = filterSecrets(secrets);
    if (!Object.keys(cleanSecrets).length) throw Object.assign(new Error('credential_secret_required'), { code: 'credential_secret_required' });
    const id = `cred_${stableHash(`${safeBotId}:${safeType}:${safeName}`)}`;
    const now = this.now().toISOString();
    const record = {
      id,
      botId: safeBotId,
      type: safeType,
      name: safeName,
      metadata: sanitizeMetadata(metadata),
      secretKeys: Object.keys(cleanSecrets).sort(),
      ciphertext: this.encrypt(JSON.stringify(cleanSecrets), `${id}:${safeBotId}:${safeType}`),
      keyId: this.keyId,
      createdAt: this.records.get(id)?.createdAt || now,
      updatedAt: now
    };
    this.records.set(id, record);
    await this.flush();
    return this.publicRecord(record);
  }

  async delete(id) {
    const removed = this.records.delete(clean(id, 128));
    if (removed) await this.flush();
    return removed;
  }

  async reveal(id) {
    if (!this.key) throw Object.assign(new Error('credential_vault_disabled'), { code: 'credential_vault_disabled' });
    const record = this.records.get(clean(id, 128));
    if (!record) return null;
    return JSON.parse(this.decrypt(record.ciphertext, `${record.id}:${record.botId}:${record.type}`));
  }

  encrypt(plaintext, aad) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(aad));
    const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
  }

  decrypt(value, aad) {
    const parts = String(value || '').split('.');
    if (parts.length !== 4 || parts[0] !== 'v1') throw Object.assign(new Error('invalid_ciphertext'), { code: 'invalid_ciphertext' });
    const [, ivText, tagText, bodyText] = parts;
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivText, 'base64url'));
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(bodyText, 'base64url')), decipher.final()]).toString('utf8');
  }

  async flush() {
    const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    const payload = JSON.stringify({ version: 1, updatedAt: this.now().toISOString(), keyId: this.keyId, records: Array.from(this.records.values()) }, null, 2);
    await writeFile(tmp, payload, { mode: 0o600 });
    await rename(tmp, this.file);
  }

  publicRecord(record) {
    return { id: record.id, botId: record.botId, type: record.type, name: record.name, metadata: record.metadata || {}, secretKeys: record.secretKeys || [], keyId: record.keyId, createdAt: record.createdAt, updatedAt: record.updatedAt };
  }
}

export function safeCredentialEquals(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

function filterSecrets(input = {}) {
  const result = {};
  for (const [key, value] of Object.entries(input || {})) {
    if (!SECRET_KEYS.has(key)) continue;
    const secret = clean(value, 5000);
    if (secret) result[key] = secret;
  }
  return result;
}

function sanitizeMetadata(input = {}) {
  const result = {};
  for (const [key, value] of Object.entries(input || {})) {
    if (SECRET_KEYS.has(key)) continue;
    result[clean(key, 60)] = clean(value, 300);
  }
  return result;
}
