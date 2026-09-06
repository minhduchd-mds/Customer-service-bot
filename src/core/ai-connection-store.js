import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const PROVIDERS = new Set(['openai', 'anthropic', 'gemini', 'ollama', 'openai-compatible']);
const AUTH_MODES = new Set(['api-key', 'oauth', 'local', 'none']);
const HEALTH = new Set(['pending_verification', 'healthy', 'needs_attention', 'rate_limited', 'quota_exceeded', 'payment_required', 'credential_revoked', 'model_unavailable', 'offline']);

const clone = (value) => JSON.parse(JSON.stringify(value));
const clean = (value, max = 500) => String(value || '').replace(/\u0000/g, '').trim().slice(0, max);

function cleanEndpoint(value = '') {
  const text = clean(value, 1000);
  if (!text) return '';
  const url = new URL(text);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('invalid_ai_endpoint');
  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/$/, '');
}

function normalizeBudget(value = {}) {
  const number = (input, fallback = 0) => {
    const parsed = Number(input);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };
  const onExceeded = ['fallback', 'local', 'handoff', 'stop'].includes(value.onExceeded) ? value.onExceeded : 'fallback';
  return {
    monthlyRequestLimit: Math.floor(number(value.monthlyRequestLimit)),
    dailyRequestLimit: Math.floor(number(value.dailyRequestLimit)),
    monthlyUsdLimit: number(value.monthlyUsdLimit),
    maxOutputTokens: Math.max(128, Math.min(Math.floor(number(value.maxOutputTokens, 2048)), 32768)),
    onExceeded
  };
}

function freshUsage(now = new Date()) {
  return {
    month: now.toISOString().slice(0, 7),
    day: now.toISOString().slice(0, 10),
    monthlyRequests: 0,
    dailyRequests: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0
  };
}

export class AiConnectionStore {
  constructor({ file = './data/state/ai-connections.json', logger, now = () => new Date() } = {}) {
    this.file = path.resolve(file);
    this.logger = logger;
    this.now = now;
    this.records = new Map();
    this.loaded = false;
  }

  async load() {
    if (this.loaded) return this;
    try {
      const payload = JSON.parse(await readFile(this.file, 'utf8'));
      this.records = new Map((payload.connections || []).map((item) => [item.id, item]));
    } catch (error) {
      if (error?.code !== 'ENOENT') this.logger?.warn?.({ event: 'ai_connection_store_load_failed', reason: error?.message || 'unknown' });
      this.records = new Map();
    }
    this.loaded = true;
    return this;
  }

  async list({ botId = null, provider = null, enabled = null } = {}) {
    await this.load();
    return Array.from(this.records.values())
      .filter((item) => !botId || item.botId === botId || item.botId === 'global')
      .filter((item) => !provider || item.provider === provider)
      .filter((item) => enabled == null || item.enabled === enabled)
      .sort((a, b) => Number(a.priority || 100) - Number(b.priority || 100) || String(a.createdAt).localeCompare(String(b.createdAt)))
      .map((item) => clone(item));
  }

  async get(id) {
    await this.load();
    const item = this.records.get(clean(id, 128));
    return item ? clone(item) : null;
  }

  async create(input = {}) {
    await this.load();
    const provider = clean(input.provider, 64);
    const authMode = clean(input.authMode, 32);
    if (!PROVIDERS.has(provider)) throw Object.assign(new Error('unsupported_ai_provider'), { code: 'unsupported_ai_provider' });
    if (!AUTH_MODES.has(authMode)) throw Object.assign(new Error('unsupported_ai_auth_mode'), { code: 'unsupported_ai_auth_mode' });
    const now = this.now();
    const id = `aic_${randomUUID().replaceAll('-', '').slice(0, 24)}`;
    const item = {
      id,
      botId: clean(input.botId || 'global', 128) || 'global',
      provider,
      authMode,
      name: clean(input.name || provider, 120),
      credentialId: clean(input.credentialId, 128) || null,
      endpoint: cleanEndpoint(input.endpoint || ''),
      projectId: clean(input.projectId, 180),
      selectedModel: clean(input.selectedModel, 220),
      enabled: input.enabled !== false,
      priority: Math.max(1, Math.min(Number(input.priority) || 100, 1000)),
      budget: normalizeBudget(input.budget),
      health: { status: 'pending_verification', lastCheckedAt: null, latencyMs: null, modelsCount: 0, lastError: null },
      usage: freshUsage(now),
      expiresAt: input.expiresAt ? new Date(input.expiresAt).toISOString() : null,
      metadata: sanitizeMetadata(input.metadata),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };
    this.records.set(id, item);
    await this.persist();
    return clone(item);
  }

  async update(id, patch = {}) {
    await this.load();
    const key = clean(id, 128);
    const item = this.records.get(key);
    if (!item) return null;
    if (patch.name != null) item.name = clean(patch.name, 120) || item.name;
    if (patch.credentialId !== undefined) item.credentialId = clean(patch.credentialId, 128) || null;
    if (patch.endpoint != null) item.endpoint = cleanEndpoint(patch.endpoint);
    if (patch.projectId != null) item.projectId = clean(patch.projectId, 180);
    if (patch.selectedModel != null) item.selectedModel = clean(patch.selectedModel, 220);
    if (typeof patch.enabled === 'boolean') item.enabled = patch.enabled;
    if (patch.priority != null) item.priority = Math.max(1, Math.min(Number(patch.priority) || item.priority, 1000));
    if (patch.budget) item.budget = normalizeBudget({ ...item.budget, ...patch.budget });
    if (patch.health) item.health = normalizeHealth({ ...item.health, ...patch.health });
    if (patch.expiresAt !== undefined) item.expiresAt = patch.expiresAt ? new Date(patch.expiresAt).toISOString() : null;
    if (patch.metadata) item.metadata = sanitizeMetadata({ ...item.metadata, ...patch.metadata });
    item.updatedAt = this.now().toISOString();
    await this.persist();
    return clone(item);
  }

  async delete(id) {
    await this.load();
    const removed = this.records.delete(clean(id, 128));
    if (removed) await this.persist();
    return removed;
  }

  async recordUsage(id, usage = {}, estimatedCostUsd = 0) {
    await this.load();
    const item = this.records.get(clean(id, 128));
    if (!item) return null;
    const now = this.now();
    const month = now.toISOString().slice(0, 7);
    const day = now.toISOString().slice(0, 10);
    if (!item.usage || item.usage.month !== month) item.usage = freshUsage(now);
    if (item.usage.day !== day) {
      item.usage.day = day;
      item.usage.dailyRequests = 0;
    }
    item.usage.monthlyRequests += 1;
    item.usage.dailyRequests += 1;
    item.usage.inputTokens += Math.max(0, Number(usage.inputTokens) || 0);
    item.usage.outputTokens += Math.max(0, Number(usage.outputTokens) || 0);
    item.usage.totalTokens += Math.max(0, Number(usage.totalTokens) || Number(usage.inputTokens || 0) + Number(usage.outputTokens || 0));
    item.usage.estimatedCostUsd += Math.max(0, Number(estimatedCostUsd) || 0);
    item.updatedAt = now.toISOString();
    await this.persist();
    return clone(item);
  }

  budgetState(connection) {
    const item = connection || {};
    const budget = item.budget || normalizeBudget();
    const usage = item.usage || freshUsage(this.now());
    const reasons = [];
    if (budget.monthlyRequestLimit > 0 && usage.monthlyRequests >= budget.monthlyRequestLimit) reasons.push('monthly_request_limit');
    if (budget.dailyRequestLimit > 0 && usage.dailyRequests >= budget.dailyRequestLimit) reasons.push('daily_request_limit');
    if (budget.monthlyUsdLimit > 0 && usage.estimatedCostUsd >= budget.monthlyUsdLimit) reasons.push('monthly_cost_limit');
    return { allowed: reasons.length === 0, reasons, onExceeded: budget.onExceeded || 'fallback' };
  }

  async persist() {
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    const payload = JSON.stringify({ version: 1, updatedAt: this.now().toISOString(), connections: Array.from(this.records.values()) }, null, 2);
    await writeFile(tmp, payload, { encoding: 'utf8', mode: 0o600 });
    await rename(tmp, this.file);
  }
}

function normalizeHealth(value = {}) {
  const status = HEALTH.has(value.status) ? value.status : 'needs_attention';
  return {
    status,
    lastCheckedAt: value.lastCheckedAt || null,
    latencyMs: value.latencyMs == null ? null : Math.max(0, Number(value.latencyMs) || 0),
    modelsCount: Math.max(0, Number(value.modelsCount) || 0),
    lastError: value.lastError ? clean(value.lastError, 500) : null
  };
}

function sanitizeMetadata(input = {}) {
  const result = {};
  for (const [key, value] of Object.entries(input || {})) {
    const safeKey = clean(key, 60);
    if (!safeKey || /secret|token|password|key/i.test(safeKey)) continue;
    result[safeKey] = clean(value, 500);
  }
  return result;
}
