import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { HttpError, json, parseJson, readRawBody, text } from '../lib/http.js';
import { AiConnectionStore } from './ai-connection-store.js';
import { AiProviderRegistry, ProviderRequestError } from './ai-provider-registry.js';
import { ConnectedAiRouter } from './connected-ai-router.js';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');
const assets = new Map([
  ['/ai-connections.js', ['ai-connections.js', 'text/javascript; charset=utf-8']],
  ['/ai-connections.css', ['ai-connections.css', 'text/css; charset=utf-8']],
  ['/deployment-center.js', ['deployment-center.js', 'text/javascript; charset=utf-8']],
  ['/deployment-center.css', ['deployment-center.css', 'text/css; charset=utf-8']]
]);

export async function attachAiConnections(runtime) {
  if (!runtime?.credentialVault || !runtime?.router || !runtime?.config || typeof runtime.handler !== 'function') throw new Error('ai_connections_require_credential_vault');
  if (runtime.aiConnections) return runtime;
  const store = new AiConnectionStore({ file: runtime.config.aiConnections?.file, logger: runtime.router.logger });
  await store.load();
  const registry = new AiProviderRegistry({ timeoutMs: runtime.config.aiConnections?.timeoutMs || runtime.config.ai?.timeoutMs, fetchImpl: globalThis.fetch });
  const manager = new AiConnectionManager({ store, registry, vault: runtime.credentialVault, config: runtime.config, logger: runtime.router.logger });
  const legacy = runtime.router.ai;
  runtime.router.ai = new ConnectedAiRouter({ manager, legacy, systemPrompt: runtime.config.ai?.systemPrompt, logger: runtime.router.logger });
  const nextHandler = runtime.handler;
  runtime.handler = aiConnectionsHandler({ nextHandler, manager, config: runtime.config, logger: runtime.router.logger });
  runtime.aiConnections = manager;
  return runtime;
}

export class AiConnectionManager {
  constructor({ store, registry, vault, config, logger }) {
    this.store = store;
    this.registry = registry;
    this.vault = vault;
    this.config = config;
    this.logger = logger;
    this.oauthSessions = new Map();
  }

  catalog() {
    return this.registry.catalog().map((item) => ({
      ...item,
      oauthReady: item.id === 'gemini' ? Boolean(this.config.aiConnections?.geminiOAuth?.clientId) : false
    }));
  }

  async list(filters = {}) { return this.store.list(filters); }
  async get(id) { return this.store.get(id); }
  budgetState(connection) { return this.store.budgetState(connection); }

  async eligibleConnections(botId) {
    const items = await this.store.list({ botId, enabled: true });
    return items.filter((item) => item.health?.status === 'healthy' && item.selectedModel);
  }

  async create(payload = {}) {
    const provider = String(payload.provider || '').trim();
    const definition = this.registry.definition(provider);
    const authMode = String(payload.authMode || definition.authModes[0] || '').trim();
    if (!definition.authModes.includes(authMode)) throw new HttpError(400, 'Authentication mode is not supported for this provider', 'unsupported_ai_auth_mode');

    let credentialId = null;
    if (!['local', 'none'].includes(authMode)) {
      const secrets = authMode === 'oauth'
        ? compactSecrets(payload.secrets, ['accessToken', 'refreshToken'])
        : compactSecrets({ apiKey: payload.apiKey || payload.secrets?.apiKey }, ['apiKey']);
      if (!Object.keys(secrets).length) throw new HttpError(400, `${definition.label} credential is required`, 'ai_credential_required');
      const credential = await this.vault.save({
        botId: payload.botId || 'global', type: 'ai-provider', name: payload.name || `${definition.label} connection`, secrets,
        metadata: { provider, authMode, projectId: payload.projectId || '' }
      });
      credentialId = credential.id;
    }

    const connection = await this.store.create({
      botId: payload.botId, provider, authMode, name: payload.name || definition.label, credentialId,
      endpoint: payload.endpoint, projectId: payload.projectId, selectedModel: payload.selectedModel || payload.model,
      priority: payload.priority, budget: payload.budget, metadata: { accountLabel: payload.accountLabel || '' }, expiresAt: payload.expiresAt
    });
    const verification = await this.verify(connection.id);
    return verification;
  }

  async update(id, payload = {}) {
    let connection = await this.store.get(id);
    if (!connection) throw new HttpError(404, 'AI connection not found', 'ai_connection_not_found');
    if (payload.apiKey || payload.secrets?.apiKey) {
      const current = connection.credentialId ? this.vault.list().find((item) => item.id === connection.credentialId) : null;
      const credential = await this.vault.save({
        botId: connection.botId, type: 'ai-provider', name: current?.name || connection.name,
        secrets: { apiKey: payload.apiKey || payload.secrets.apiKey }, metadata: { provider: connection.provider, authMode: 'api-key', projectId: payload.projectId ?? connection.projectId }
      });
      payload.credentialId = credential.id;
    }
    connection = await this.store.update(id, payload);
    if (payload.apiKey || payload.projectId != null || payload.endpoint != null || payload.selectedModel != null) return this.verify(id);
    return { connection, connected: connection.health?.status === 'healthy' };
  }

  async remove(id) {
    const connection = await this.store.get(id);
    if (!connection) return false;
    if (connection.credentialId) await this.vault.delete(connection.credentialId);
    return this.store.delete(id);
  }

  async models(id) {
    const connection = await this.requireConnection(id);
    const secrets = await this.resolveSecrets(connection);
    const result = await this.registry.adapter(connection, secrets).validate();
    return result.models;
  }

  async verify(id) {
    let connection = await this.requireConnection(id);
    const started = Date.now();
    try {
      const secrets = await this.resolveSecrets(connection);
      const result = await this.registry.adapter(connection, secrets).validate();
      const models = result.models || [];
      let selectedModel = connection.selectedModel;
      if (selectedModel && !models.some((item) => item.id === selectedModel)) selectedModel = '';
      if (!selectedModel) selectedModel = models[0]?.id || '';
      const status = models.length ? 'healthy' : 'model_unavailable';
      connection = await this.store.update(id, {
        selectedModel,
        health: { status, lastCheckedAt: new Date().toISOString(), latencyMs: result.latencyMs ?? Date.now() - started, modelsCount: models.length, lastError: models.length ? null : 'No usable model was returned by the provider.' }
      });
      return { connection, connected: status === 'healthy', models };
    } catch (error) {
      connection = await this.markFailure(id, error);
      return { connection, connected: false, models: [], error: { code: error?.code || 'provider_verification_failed', message: String(error?.message || 'Provider verification failed').slice(0, 500) } };
    }
  }

  async testReply(id, input = 'Reply with exactly: Bot Hub connection OK') {
    const connection = await this.requireConnection(id);
    if (connection.health?.status !== 'healthy') {
      const verification = await this.verify(id);
      if (!verification.connected) throw new HttpError(409, 'AI connection is not healthy', 'ai_connection_unhealthy');
    }
    return this.generate(await this.requireConnection(id), {
      system: 'You are a connection health test. Do not use tools. Return a short plain-text answer.',
      input: String(input || '').slice(0, 1000)
    });
  }

  async generate(connection, prompt) {
    const budget = this.store.budgetState(connection);
    if (!budget.allowed) throw Object.assign(new Error(`AI budget exceeded: ${budget.reasons.join(', ')}`), { code: 'ai_budget_exceeded' });
    const secrets = await this.resolveSecrets(connection);
    const adapter = this.registry.adapter(connection, secrets);
    const result = await adapter.generate({
      model: connection.selectedModel, system: prompt.system, input: prompt.input, maxOutputTokens: connection.budget?.maxOutputTokens || 2048
    });
    await this.store.recordUsage(connection.id, result.usage || {}, 0);
    await this.store.update(connection.id, { health: { status: 'healthy', lastCheckedAt: new Date().toISOString(), latencyMs: result.latencyMs, modelsCount: connection.health?.modelsCount || 1, lastError: null } });
    return result;
  }

  async markFailure(id, error) {
    const current = await this.store.get(id);
    if (!current) return null;
    const status = healthStatus(error);
    return this.store.update(id, { health: { status, lastCheckedAt: new Date().toISOString(), latencyMs: null, modelsCount: current.health?.modelsCount || 0, lastError: String(error?.message || error?.code || 'provider_failed').slice(0, 500) } });
  }

  async resolveSecrets(connection) {
    let current = connection;
    if (current.provider === 'gemini' && current.authMode === 'oauth' && current.expiresAt && new Date(current.expiresAt).getTime() <= Date.now() + 60_000) {
      current = await this.refreshGeminiOAuth(current);
    }
    if (!current.credentialId) return {};
    const secrets = await this.vault.reveal(current.credentialId);
    if (!secrets) throw new ProviderRequestError('Stored AI credential was not found', { code: 'credential_revoked', provider: current.provider });
    return secrets;
  }

  async refreshGeminiOAuth(connection) {
    const oauth = this.config.aiConnections?.geminiOAuth || {};
    const existing = await this.vault.reveal(connection.credentialId);
    if (!existing?.refreshToken || !oauth.clientId) throw new ProviderRequestError('Gemini OAuth needs re-authorization', { code: 'credential_revoked', provider: 'gemini' });
    const body = new URLSearchParams({ client_id: oauth.clientId, grant_type: 'refresh_token', refresh_token: existing.refreshToken });
    if (oauth.clientSecret) body.set('client_secret', oauth.clientSecret);
    const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(15_000) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.access_token) throw new ProviderRequestError(payload?.error_description || 'Gemini OAuth refresh failed', { status: response.status, code: 'credential_revoked', provider: 'gemini' });
    const record = this.vault.list().find((item) => item.id === connection.credentialId);
    const credential = await this.vault.save({
      botId: connection.botId, type: 'ai-provider', name: record?.name || connection.name,
      secrets: { accessToken: payload.access_token, refreshToken: payload.refresh_token || existing.refreshToken },
      metadata: { provider: 'gemini', authMode: 'oauth', projectId: connection.projectId }
    });
    const expiresAt = new Date(Date.now() + Math.max(60, Number(payload.expires_in) || 3600) * 1000).toISOString();
    return this.store.update(connection.id, { credentialId: credential.id, expiresAt });
  }

  async startGeminiOAuth({ request, botId = 'global', projectId = '', name = 'Gemini OAuth' } = {}) {
    const oauth = this.config.aiConnections?.geminiOAuth || {};
    if (!oauth.clientId) throw new HttpError(409, 'Gemini OAuth is not configured on this Bot Hub runtime', 'gemini_oauth_not_configured');
    this.cleanupOauthSessions();
    const state = randomBytes(24).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const redirectUri = oauth.redirectUri || `${requestOrigin(request, this.config.publicBaseUrl)}/api/ai/oauth/gemini/callback`;
    const expiresAt = Date.now() + Math.max(120, Number(this.config.aiConnections?.oauthSessionTtlSeconds) || 600) * 1000;
    this.oauthSessions.set(state, { state, verifier, botId, projectId, name, redirectUri, expiresAt });
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: oauth.clientId, redirect_uri: redirectUri, response_type: 'code', access_type: 'offline', prompt: 'consent',
      scope: (oauth.scopes || ['openid', 'email', 'https://www.googleapis.com/auth/cloud-platform']).join(' '), state,
      code_challenge: challenge, code_challenge_method: 'S256'
    }).toString();
    return { authorizeUrl: url.toString(), state, expiresAt: new Date(expiresAt).toISOString(), redirectUri };
  }

  async finishGeminiOAuth({ code, state, error }) {
    this.cleanupOauthSessions();
    const session = this.oauthSessions.get(String(state || ''));
    this.oauthSessions.delete(String(state || ''));
    if (!session || session.expiresAt <= Date.now()) throw new HttpError(400, 'Gemini OAuth session expired', 'oauth_session_expired');
    if (error) throw new HttpError(400, `Google authorization failed: ${error}`, 'oauth_authorization_denied');
    if (!code) throw new HttpError(400, 'OAuth authorization code is missing', 'oauth_code_missing');
    const oauth = this.config.aiConnections?.geminiOAuth || {};
    const body = new URLSearchParams({ client_id: oauth.clientId, code: String(code), code_verifier: session.verifier, grant_type: 'authorization_code', redirect_uri: session.redirectUri });
    if (oauth.clientSecret) body.set('client_secret', oauth.clientSecret);
    const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(15_000) });
    const token = await response.json().catch(() => ({}));
    if (!response.ok || !token.access_token) throw new HttpError(400, token?.error_description || 'Google token exchange failed', 'oauth_token_exchange_failed');
    const expiresAt = new Date(Date.now() + Math.max(60, Number(token.expires_in) || 3600) * 1000).toISOString();
    const credential = await this.vault.save({
      botId: session.botId, type: 'ai-provider', name: session.name,
      secrets: { accessToken: token.access_token, refreshToken: token.refresh_token || '' },
      metadata: { provider: 'gemini', authMode: 'oauth', projectId: session.projectId }
    });
    const connection = await this.store.create({ botId: session.botId, provider: 'gemini', authMode: 'oauth', name: session.name, credentialId: credential.id, projectId: session.projectId, expiresAt, priority: 50 });
    if (!session.projectId) {
      const pending = await this.store.update(connection.id, { health: { status: 'needs_attention', lastCheckedAt: new Date().toISOString(), modelsCount: 0, lastError: 'Google Cloud project ID is required before Gemini inference can be verified.' } });
      return { connection: pending, connected: false, needsProjectId: true };
    }
    return this.verify(connection.id);
  }

  async requireConnection(id) {
    const item = await this.store.get(id);
    if (!item) throw new HttpError(404, 'AI connection not found', 'ai_connection_not_found');
    return item;
  }

  cleanupOauthSessions() {
    const now = Date.now();
    for (const [key, item] of this.oauthSessions) if (item.expiresAt <= now) this.oauthSessions.delete(key);
  }
}

export function aiConnectionsHandler({ nextHandler, manager, config, logger }) {
  return async (request, response) => {
    const url = new URL(request.url || '/', config.publicBaseUrl || `http://${request.headers.host || 'localhost'}`);
    try {
      if (request.method === 'GET' && assets.has(url.pathname)) {
        const [file, contentType] = assets.get(url.pathname);
        const body = await readFile(path.join(publicDir, file), 'utf8');
        return text(response, 200, body, contentType);
      }
      if (request.method === 'GET' && url.pathname === '/api/ai/providers') return json(response, 200, { providers: manager.catalog() });
      if (request.method === 'GET' && url.pathname === '/api/ai/connections') return json(response, 200, { connections: await manager.list({ botId: url.searchParams.get('botId'), provider: url.searchParams.get('provider') }) });
      if (request.method === 'POST' && url.pathname === '/api/ai/connections') return json(response, 201, await manager.create(await requestJson(request, config.maxBodyBytes)));
      if (request.method === 'POST' && url.pathname === '/api/ai/oauth/gemini/start') return json(response, 201, await manager.startGeminiOAuth({ request, ...(await requestJson(request, config.maxBodyBytes)) }));
      if (request.method === 'GET' && url.pathname === '/api/ai/oauth/gemini/callback') {
        const result = await manager.finishGeminiOAuth({ code: url.searchParams.get('code'), state: url.searchParams.get('state'), error: url.searchParams.get('error') });
        return text(response, 200, oauthCompletePage(result), 'text/html; charset=utf-8');
      }
      const match = url.pathname.match(/^\/api\/ai\/connections\/(aic_[a-f0-9]+)(?:\/(models|test|test-reply))?$/);
      if (match) {
        const id = match[1];
        const action = match[2] || '';
        if (request.method === 'GET' && !action) return json(response, 200, { connection: await manager.requireConnection(id) });
        if (request.method === 'GET' && action === 'models') return json(response, 200, { models: await manager.models(id) });
        if (request.method === 'PATCH' && !action) return json(response, 200, await manager.update(id, await requestJson(request, config.maxBodyBytes)));
        if (request.method === 'DELETE' && !action) {
          const removed = await manager.remove(id);
          if (!removed) throw new HttpError(404, 'AI connection not found', 'ai_connection_not_found');
          return json(response, 200, { deleted: true, id });
        }
        if (request.method === 'POST' && action === 'test') return json(response, 200, await manager.verify(id));
        if (request.method === 'POST' && action === 'test-reply') {
          const payload = await requestJson(request, config.maxBodyBytes);
          return json(response, 200, { result: await manager.testReply(id, payload.text) });
        }
      }
    } catch (error) {
      const statusCode = error instanceof HttpError ? error.statusCode : providerHttpStatus(error);
      logger?.error?.({ event: 'ai_connections_api_failed', method: request.method, path: url.pathname, statusCode, reason: error?.message || 'unknown' });
      return json(response, statusCode, { error: error?.code || 'ai_connection_failed', message: statusCode >= 500 ? 'AI connection operation failed' : String(error?.message || 'AI connection failed').slice(0, 500) });
    }
    return nextHandler(request, response);
  };
}

async function requestJson(request, maxBodyBytes) {
  const raw = await readRawBody(request, maxBodyBytes);
  return raw.length ? parseJson(raw) : {};
}
function compactSecrets(input = {}, keys = []) {
  const result = {};
  for (const key of keys) if (input?.[key]) result[key] = String(input[key]).trim();
  return result;
}
function providerHttpStatus(error) {
  if (error instanceof ProviderRequestError) {
    if (['credential_required', 'endpoint_required', 'model_required'].includes(error.code)) return 400;
    if (['credential_revoked', 'permission_denied'].includes(error.code)) return 401;
    if (error.code === 'rate_limited') return 429;
    return 502;
  }
  if (['unsupported_ai_provider', 'unsupported_ai_auth_mode', 'invalid_ai_endpoint'].includes(error?.code || error?.message)) return 400;
  return 500;
}
function healthStatus(error) {
  const code = error?.code || '';
  if (code === 'credential_revoked' || code === 'credential_required') return 'credential_revoked';
  if (code === 'payment_required') return 'payment_required';
  if (code === 'rate_limited') return 'rate_limited';
  if (code === 'model_unavailable' || code === 'model_required') return 'model_unavailable';
  if (code === 'provider_offline' || code === 'provider_timeout') return 'offline';
  return 'needs_attention';
}
function requestOrigin(request, configured = '') {
  if (configured) return String(configured).replace(/\/$/, '');
  const host = request.headers?.host || '127.0.0.1';
  const proto = String(request.headers?.['x-forwarded-proto'] || '').split(',')[0].trim() || (host.startsWith('127.0.0.1') || host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}
function oauthCompletePage(result) {
  const connected = Boolean(result?.connected);
  const message = connected ? 'Gemini is verified and ready for Bot Hub.' : result?.needsProjectId ? 'Google authorization succeeded. Return to Bot Hub and enter the Google Cloud project ID to finish verification.' : 'Authorization returned, but the connection still needs verification.';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bot Hub · Gemini</title><style>body{margin:0;background:#f5f5f7;color:#1d1d1f;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.card{max-width:560px;margin:10vh auto;background:#fff;border-radius:28px;padding:36px;box-shadow:0 30px 100px #0001}.mark{width:52px;height:52px;border-radius:16px;background:${connected ? '#34c759' : '#ff9f0a'};color:#fff;display:grid;place-items:center;font-size:24px}h1{font-size:36px;letter-spacing:-.04em}p{color:#6e6e73;line-height:1.6}</style></head><body><main class="card"><div class="mark">${connected ? '✓' : '!'}</div><h1>Gemini authorization returned</h1><p>${escapeHtml(message)}</p><p>You can close this tab and return to Bot Hub.</p></main></body></html>`;
}
function escapeHtml(value = '') { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
