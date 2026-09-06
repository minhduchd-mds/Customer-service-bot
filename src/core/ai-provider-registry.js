const PROVIDER_DEFINITIONS = Object.freeze({
  openai: {
    id: 'openai', label: 'OpenAI', family: 'GPT', authModes: ['api-key'], defaultEndpoint: 'https://api.openai.com/v1',
    capabilities: ['chat', 'vision', 'tools', 'json', 'streaming'], freeFirst: false,
    accountNote: 'ChatGPT subscriptions and OpenAI API billing are separate. Bot Hub requires an OpenAI Platform API credential for automated replies.'
  },
  anthropic: {
    id: 'anthropic', label: 'Anthropic Claude', family: 'Claude', authModes: ['api-key'], defaultEndpoint: 'https://api.anthropic.com/v1',
    capabilities: ['chat', 'vision', 'tools', 'json', 'streaming'], freeFirst: false,
    accountNote: 'Claude consumer subscriptions are not reused as API credentials. Connect a Claude Platform API key or an approved enterprise route.'
  },
  gemini: {
    id: 'gemini', label: 'Google Gemini', family: 'Gemini', authModes: ['api-key', 'oauth'], defaultEndpoint: 'https://generativelanguage.googleapis.com',
    capabilities: ['chat', 'vision', 'tools', 'json', 'streaming'], freeFirst: true,
    accountNote: 'Gemini API supports API-key authentication and OAuth. OAuth still requires an enabled Google Cloud project/API and appropriate project permissions.'
  },
  ollama: {
    id: 'ollama', label: 'Local AI', family: 'Ollama', authModes: ['local'], defaultEndpoint: 'http://127.0.0.1:11434',
    capabilities: ['chat', 'local'], freeFirst: true,
    accountNote: 'Runs on the user machine. No cloud API credential is required; model availability depends on the local Ollama runtime.'
  },
  'openai-compatible': {
    id: 'openai-compatible', label: 'OpenAI-compatible', family: 'Custom', authModes: ['api-key', 'none'], defaultEndpoint: '',
    capabilities: ['chat'], freeFirst: true,
    accountNote: 'Advanced compatibility mode for trusted OpenAI-compatible endpoints. Capabilities depend on the selected provider.'
  }
});

export function providerCatalog() {
  return Object.values(PROVIDER_DEFINITIONS).map((item) => ({ ...item, authModes: [...item.authModes], capabilities: [...item.capabilities] }));
}

export class ProviderRequestError extends Error {
  constructor(message, { status = 0, code = 'provider_request_failed', provider = '' } = {}) {
    super(message);
    this.name = 'ProviderRequestError';
    this.status = Number(status) || 0;
    this.code = code;
    this.provider = provider;
  }
}

export class AiProviderRegistry {
  constructor({ timeoutMs = 20_000, fetchImpl = globalThis.fetch } = {}) {
    this.timeoutMs = Math.max(1000, Number(timeoutMs) || 20_000);
    this.fetch = fetchImpl;
  }

  catalog() { return providerCatalog(); }

  definition(provider) {
    const value = PROVIDER_DEFINITIONS[String(provider || '')];
    if (!value) throw new ProviderRequestError('Unsupported AI provider', { code: 'unsupported_ai_provider', provider });
    return value;
  }

  adapter(connection, secrets = {}) {
    const definition = this.definition(connection?.provider);
    const config = { connection, secrets, definition, timeoutMs: this.timeoutMs, fetchImpl: this.fetch };
    if (definition.id === 'openai') return new OpenAiAdapter(config);
    if (definition.id === 'anthropic') return new AnthropicAdapter(config);
    if (definition.id === 'gemini') return new GeminiAdapter(config);
    if (definition.id === 'ollama') return new OllamaAdapter(config);
    return new OpenAiCompatibleAdapter(config);
  }
}

class BaseAdapter {
  constructor({ connection, secrets, definition, timeoutMs, fetchImpl }) {
    this.connection = connection || {};
    this.secrets = secrets || {};
    this.definition = definition;
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
    this.baseUrl = normalizeBase(this.connection.endpoint || definition.defaultEndpoint);
  }

  async request(url, init = {}) {
    const started = Date.now();
    let response;
    try {
      response = await this.fetch(url, { ...init, signal: init.signal || AbortSignal.timeout(this.timeoutMs) });
    } catch (error) {
      const code = error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'provider_timeout' : 'provider_offline';
      throw new ProviderRequestError(error?.message || code, { code, provider: this.definition.id });
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = providerMessage(payload) || `${this.definition.label} returned ${response.status}`;
      throw new ProviderRequestError(message, { status: response.status, code: statusCode(response.status), provider: this.definition.id });
    }
    return { payload, latencyMs: Date.now() - started };
  }

  async validate() {
    const started = Date.now();
    const models = await this.listModels();
    return { ok: true, models, latencyMs: Date.now() - started };
  }
}

class OpenAiAdapter extends BaseAdapter {
  headers() {
    if (!this.secrets.apiKey) throw new ProviderRequestError('OpenAI API key is required', { code: 'credential_required', provider: 'openai' });
    return { authorization: `Bearer ${this.secrets.apiKey}`, 'content-type': 'application/json' };
  }
  async listModels() {
    const { payload } = await this.request(`${this.baseUrl}/models`, { headers: this.headers() });
    return normalizeModels(payload?.data, 'id');
  }
  async generate({ model, system, input, maxOutputTokens = 2048 }) {
    if (!model) throw new ProviderRequestError('Select an OpenAI model first', { code: 'model_required', provider: 'openai' });
    const { payload, latencyMs } = await this.request(`${this.baseUrl}/responses`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify({ model, instructions: system, input, max_output_tokens: maxOutputTokens })
    });
    const text = openAiResponseText(payload);
    if (!text) throw new ProviderRequestError('OpenAI returned no text output', { code: 'empty_provider_response', provider: 'openai' });
    return { text, latencyMs, usage: normalizeUsage(payload?.usage, 'openai') };
  }
}

class AnthropicAdapter extends BaseAdapter {
  headers() {
    if (!this.secrets.apiKey) throw new ProviderRequestError('Anthropic API key is required', { code: 'credential_required', provider: 'anthropic' });
    return { 'x-api-key': this.secrets.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
  }
  async listModels() {
    const { payload } = await this.request(`${this.baseUrl}/models?limit=100`, { headers: this.headers() });
    return normalizeModels(payload?.data, 'id');
  }
  async generate({ model, system, input, maxOutputTokens = 2048 }) {
    if (!model) throw new ProviderRequestError('Select a Claude model first', { code: 'model_required', provider: 'anthropic' });
    const { payload, latencyMs } = await this.request(`${this.baseUrl}/messages`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify({ model, max_tokens: maxOutputTokens, system, messages: [{ role: 'user', content: input }] })
    });
    const text = Array.isArray(payload?.content) ? payload.content.filter((item) => item?.type === 'text').map((item) => item.text).join('\n').trim() : '';
    if (!text) throw new ProviderRequestError('Claude returned no text output', { code: 'empty_provider_response', provider: 'anthropic' });
    return { text, latencyMs, usage: normalizeUsage(payload?.usage, 'anthropic') };
  }
}

class GeminiAdapter extends BaseAdapter {
  constructor(config) {
    super(config);
    this.origin = normalizeBase(this.connection.endpoint || this.definition.defaultEndpoint).replace(/\/v1(?:beta)?$/, '');
  }
  authHeaders() {
    const headers = { 'content-type': 'application/json' };
    if (this.connection.authMode === 'oauth') {
      if (!this.secrets.accessToken) throw new ProviderRequestError('Gemini OAuth access token is required', { code: 'credential_required', provider: 'gemini' });
      headers.authorization = `Bearer ${this.secrets.accessToken}`;
      if (this.connection.projectId) headers['x-goog-user-project'] = this.connection.projectId;
    } else {
      if (!this.secrets.apiKey) throw new ProviderRequestError('Gemini API key is required', { code: 'credential_required', provider: 'gemini' });
      headers['x-goog-api-key'] = this.secrets.apiKey;
    }
    return headers;
  }
  async listModels() {
    const { payload } = await this.request(`${this.origin}/v1/models`, { headers: this.authHeaders() });
    return normalizeModels(payload?.models, 'name').map((item) => ({ ...item, id: item.id.replace(/^models\//, '') }));
  }
  async generate({ model, system, input, maxOutputTokens = 2048 }) {
    if (!model) throw new ProviderRequestError('Select a Gemini model first', { code: 'model_required', provider: 'gemini' });
    const { payload, latencyMs } = await this.request(`${this.origin}/v1beta/interactions`, {
      method: 'POST', headers: this.authHeaders(), body: JSON.stringify({
        model, system_instruction: system, input, store: false, generation_config: { max_output_tokens: maxOutputTokens }
      })
    });
    const text = geminiInteractionText(payload);
    if (!text) throw new ProviderRequestError('Gemini returned no text output', { code: 'empty_provider_response', provider: 'gemini' });
    return { text, latencyMs, usage: normalizeUsage(payload?.usage, 'gemini') };
  }
}

class OllamaAdapter extends BaseAdapter {
  async listModels() {
    const { payload } = await this.request(`${this.baseUrl}/api/tags`);
    return normalizeModels(payload?.models, 'name');
  }
  async generate({ model, system, input, maxOutputTokens = 2048 }) {
    if (!model) throw new ProviderRequestError('Pull or select a local Ollama model first', { code: 'model_required', provider: 'ollama' });
    const { payload, latencyMs } = await this.request(`${this.baseUrl}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        model, stream: false, messages: [{ role: 'system', content: system }, { role: 'user', content: input }], options: { num_predict: maxOutputTokens }
      })
    });
    const text = String(payload?.message?.content || '').trim();
    if (!text) throw new ProviderRequestError('Ollama returned no text output', { code: 'empty_provider_response', provider: 'ollama' });
    return { text, latencyMs, usage: { inputTokens: Number(payload?.prompt_eval_count) || 0, outputTokens: Number(payload?.eval_count) || 0, totalTokens: (Number(payload?.prompt_eval_count) || 0) + (Number(payload?.eval_count) || 0) } };
  }
}

class OpenAiCompatibleAdapter extends BaseAdapter {
  headers() {
    return { 'content-type': 'application/json', ...(this.secrets.apiKey ? { authorization: `Bearer ${this.secrets.apiKey}` } : {}) };
  }
  async listModels() {
    if (!this.baseUrl) throw new ProviderRequestError('Endpoint is required', { code: 'endpoint_required', provider: 'openai-compatible' });
    const { payload } = await this.request(`${this.baseUrl}/models`, { headers: this.headers() });
    return normalizeModels(payload?.data || payload?.models, 'id');
  }
  async generate({ model, system, input, maxOutputTokens = 2048 }) {
    if (!this.baseUrl) throw new ProviderRequestError('Endpoint is required', { code: 'endpoint_required', provider: 'openai-compatible' });
    if (!model) throw new ProviderRequestError('Select a model first', { code: 'model_required', provider: 'openai-compatible' });
    const { payload, latencyMs } = await this.request(`${this.baseUrl}/chat/completions`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify({ model, max_tokens: maxOutputTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: input }] })
    });
    const text = String(payload?.choices?.[0]?.message?.content || '').trim();
    if (!text) throw new ProviderRequestError('Provider returned no text output', { code: 'empty_provider_response', provider: 'openai-compatible' });
    return { text, latencyMs, usage: normalizeUsage(payload?.usage, 'openai') };
  }
}

function normalizeBase(value = '') { return String(value || '').trim().replace(/\/$/, ''); }
function normalizeModels(items, key) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    const id = String(item?.[key] || item?.id || item?.name || '').trim();
    return id ? { id, name: String(item?.display_name || item?.displayName || item?.name || id).replace(/^models\//, ''), createdAt: item?.created_at || item?.createdAt || null } : null;
  }).filter(Boolean).slice(0, 250);
}
function providerMessage(payload) { return String(payload?.error?.message || payload?.message || payload?.error?.status || '').slice(0, 500); }
function statusCode(status) {
  if (status === 401) return 'credential_revoked';
  if (status === 402) return 'payment_required';
  if (status === 403) return 'permission_denied';
  if (status === 404) return 'model_unavailable';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'provider_offline';
  return 'provider_request_failed';
}
function openAiResponseText(payload) {
  if (typeof payload?.output_text === 'string') return payload.output_text.trim();
  const chunks = [];
  for (const output of payload?.output || []) for (const content of output?.content || []) if (content?.type === 'output_text' || content?.type === 'text') chunks.push(content.text || content.value || '');
  return chunks.join('\n').trim();
}
function geminiInteractionText(payload) {
  const chunks = [];
  for (const step of payload?.steps || []) for (const content of step?.content || []) if (content?.type === 'text' && content?.text) chunks.push(content.text);
  return chunks.join('\n').trim();
}
function normalizeUsage(usage = {}, provider = '') {
  if (provider === 'anthropic') {
    const inputTokens = Number(usage?.input_tokens) || 0;
    const outputTokens = Number(usage?.output_tokens) || 0;
    return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
  }
  if (provider === 'gemini') return { inputTokens: Number(usage?.total_input_tokens) || 0, outputTokens: Number(usage?.total_output_tokens) || 0, totalTokens: Number(usage?.total_tokens) || 0 };
  const inputTokens = Number(usage?.input_tokens ?? usage?.prompt_tokens) || 0;
  const outputTokens = Number(usage?.output_tokens ?? usage?.completion_tokens) || 0;
  return { inputTokens, outputTokens, totalTokens: Number(usage?.total_tokens) || inputTokens + outputTokens };
}
