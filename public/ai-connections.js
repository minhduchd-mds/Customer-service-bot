const aiState = { active: false, providers: [], connections: [], bots: [], busy: false };
const ai$ = (selector) => document.querySelector(selector);

window.addEventListener('DOMContentLoaded', () => installAiNav());
document.body.addEventListener('click', (event) => {
  const nav = event.target.closest('[data-nav]');
  if (nav) {
    aiState.active = nav.dataset.nav === 'ai-connections';
    if (aiState.active) setTimeout(() => void openAiConnections(), 0);
  }
  const action = event.target.closest('[data-ai-action]');
  if (!action) return;
  event.preventDefault();
  void handleAiAction(action.dataset.aiAction, action).catch((error) => aiToast(error.message || 'AI connection action failed', true));
});

document.body.addEventListener('change', (event) => {
  const select = event.target.closest('[data-ai-model]');
  if (!select) return;
  void aiApi(`/api/ai/connections/${encodeURIComponent(select.dataset.aiModel)}`, { method: 'PATCH', body: JSON.stringify({ selectedModel: select.value }) })
    .then(() => { aiToast('Model updated'); return refreshAiConnections(); })
    .catch((error) => aiToast(error.message, true));
});

function installAiNav() {
  const operations = document.querySelector('nav[aria-label="Operations"]');
  if (!operations || operations.querySelector('[data-nav="ai-connections"]')) return;
  const button = document.createElement('button');
  button.className = 'nav-item';
  button.dataset.nav = 'ai-connections';
  button.innerHTML = '<span>✦</span><span>AI Connections</span>';
  operations.prepend(button);
}

async function openAiConnections() {
  if (!aiState.active) return;
  ai$('#page-eyebrow').textContent = 'Workspace / Intelligence';
  ai$('#page-title').textContent = 'AI Connections';
  await refreshAiConnections();
}

async function refreshAiConnections() {
  if (!aiState.active || aiState.busy) return;
  aiState.busy = true;
  renderAiLoading();
  try {
    const [providers, connections, bots] = await Promise.all([
      aiApi('/api/ai/providers'), aiApi('/api/ai/connections'), aiApi('/api/bots').catch(() => ({ bots: [] }))
    ]);
    aiState.providers = providers.providers || [];
    aiState.connections = connections.connections || [];
    aiState.bots = bots.bots || [];
    renderAiConnections();
  } finally { aiState.busy = false; }
}

function renderAiLoading() {
  const view = ai$('#view');
  if (view) view.innerHTML = '<section class="ai-loading"><div></div><p>Checking AI accounts…</p></section>';
}

function renderAiConnections() {
  const view = ai$('#view');
  if (!view) return;
  const healthy = aiState.connections.filter((item) => item.health?.status === 'healthy' && item.enabled).length;
  const free = aiState.connections.filter((item) => ['gemini', 'ollama'].includes(item.provider) && item.health?.status === 'healthy').length;
  view.innerHTML = `
    <section class="ai-hero">
      <div><p class="eyebrow">Bring your own AI</p><h2>Use the AI account you already control.</h2><p>Connect provider credentials to Bot Hub without sharing consumer browser sessions. Secrets are encrypted in the Credential Vault and are never shown again after saving.</p></div>
      <div class="ai-hero-metrics"><div><strong>${healthy}</strong><span>Ready</span></div><div><strong>${aiState.connections.length}</strong><span>Connections</span></div><div><strong>${free}</strong><span>Free-first</span></div></div>
    </section>
    <section class="ai-warning"><strong>Subscription ≠ API permission.</strong><span>ChatGPT Plus/Pro and Claude consumer plans are not treated as API credentials. Gemini OAuth is enabled only when this runtime has an approved Google OAuth client and project permissions.</span></section>
    <div class="section-head"><div><h2>Providers</h2><p>Bot Hub verifies credentials and discovers available models before showing Connected.</p></div></div>
    <section class="ai-provider-grid">${aiState.providers.map(providerCard).join('')}</section>
    <div class="section-head"><div><h2>Connected accounts</h2><p>Routing priority, health, model and usage are managed per connection.</p></div><button class="secondary-button" data-ai-action="refresh">Refresh</button></div>
    ${aiState.connections.length ? `<section class="ai-connection-list">${aiState.connections.map(connectionCard).join('')}</section>` : '<section class="ai-empty"><strong>No AI account connected yet.</strong><span>Gemini API free tier or a local Ollama model are the easiest $0 starting paths.</span></section>'}
  `;
}

function providerCard(provider) {
  const existing = aiState.connections.filter((item) => item.provider === provider.id).length;
  const freeBadge = provider.freeFirst ? '<span class="ai-badge green">Free-first</span>' : '';
  const oauth = provider.id === 'gemini' && provider.oauthReady ? '<span class="ai-badge blue">OAuth ready</span>' : '';
  return `<article class="ai-provider-card">
    <div class="ai-provider-mark">${providerMark(provider.id)}</div>
    <div class="ai-provider-head"><div><h3>${escapeAi(provider.label)}</h3><p>${escapeAi(provider.family)}</p></div><div>${freeBadge}${oauth}</div></div>
    <p class="ai-provider-note">${escapeAi(provider.accountNote || '')}</p>
    <div class="ai-capabilities">${(provider.capabilities || []).slice(0, 5).map((item) => `<span>${escapeAi(item)}</span>`).join('')}</div>
    <div class="ai-card-actions"><button class="primary-button" data-ai-action="connect" data-provider="${escapeAiAttr(provider.id)}">Connect</button>${existing ? `<span>${existing} configured</span>` : ''}</div>
  </article>`;
}

function connectionCard(connection) {
  const provider = aiState.providers.find((item) => item.id === connection.provider) || { label: connection.provider };
  const health = connection.health || {};
  const models = Number(health.modelsCount || 0);
  const usage = connection.usage || {};
  const budget = connection.budget || {};
  return `<article class="ai-connection-card">
    <div class="ai-connection-main">
      <div class="ai-provider-mark small">${providerMark(connection.provider)}</div>
      <div class="ai-connection-copy"><div class="ai-title-line"><h3>${escapeAi(connection.name)}</h3><span class="ai-health ${escapeAiAttr(health.status || 'pending_verification')}">${healthLabel(health.status)}</span>${connection.enabled ? '' : '<span class="ai-badge">Paused</span>'}</div>
      <p>${escapeAi(provider.label)} · ${escapeAi(connection.authMode)} · ${escapeAi(connection.botId === 'global' ? 'Workspace' : botName(connection.botId))}</p>
      ${health.lastError ? `<small class="ai-error">${escapeAi(health.lastError)}</small>` : `<small>${models} models discovered · ${Number(health.latencyMs || 0)} ms last check</small>`}</div>
    </div>
    <div class="ai-model-row"><label>Model</label><select data-ai-model="${escapeAiAttr(connection.id)}" ${health.status !== 'healthy' ? 'disabled' : ''}><option value="${escapeAiAttr(connection.selectedModel || '')}">${escapeAi(connection.selectedModel || 'Verify connection first')}</option></select><button class="secondary-button compact" data-ai-action="models" data-id="${escapeAiAttr(connection.id)}">Choose</button></div>
    <div class="ai-usage"><span>Requests <strong>${Number(usage.monthlyRequests || 0)}</strong>${budget.monthlyRequestLimit ? ` / ${Number(budget.monthlyRequestLimit)}` : ''}</span><span>Tokens <strong>${formatAiNumber(usage.totalTokens || 0)}</strong></span><span>Priority <strong>${Number(connection.priority || 100)}</strong></span></div>
    <div class="ai-card-actions"><button class="secondary-button" data-ai-action="test" data-id="${escapeAiAttr(connection.id)}">Test</button><button class="secondary-button" data-ai-action="test-reply" data-id="${escapeAiAttr(connection.id)}">Test reply</button><button class="secondary-button" data-ai-action="toggle" data-id="${escapeAiAttr(connection.id)}" data-enabled="${connection.enabled}">${connection.enabled ? 'Pause' : 'Enable'}</button><button class="danger-button" data-ai-action="disconnect" data-id="${escapeAiAttr(connection.id)}">Disconnect</button></div>
  </article>`;
}

async function handleAiAction(action, element) {
  if (action === 'refresh') return refreshAiConnections();
  if (action === 'connect') return openConnectModal(element.dataset.provider);
  if (action === 'close') return closeAiModal();
  if (action === 'save') return saveAiConnection();
  if (action === 'gemini-oauth') return startGeminiOauth();
  if (action === 'test') {
    await aiApi(`/api/ai/connections/${element.dataset.id}/test`, { method: 'POST', body: '{}' });
    aiToast('Provider verified'); return refreshAiConnections();
  }
  if (action === 'test-reply') {
    const result = await aiApi(`/api/ai/connections/${element.dataset.id}/test-reply`, { method: 'POST', body: JSON.stringify({ text: 'Reply with exactly: Bot Hub connection OK' }) });
    return showTestReply(result.result?.text || 'No text returned');
  }
  if (action === 'toggle') {
    await aiApi(`/api/ai/connections/${element.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: element.dataset.enabled !== 'true' }) });
    return refreshAiConnections();
  }
  if (action === 'disconnect') {
    if (!confirm('Disconnect this AI account? The encrypted provider credential for this connection will also be removed.')) return;
    await aiApi(`/api/ai/connections/${element.dataset.id}`, { method: 'DELETE' });
    aiToast('AI account disconnected'); return refreshAiConnections();
  }
  if (action === 'models') return loadModelPicker(element.dataset.id);
  if (action === 'select-model') {
    await aiApi(`/api/ai/connections/${element.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ selectedModel: element.dataset.model }) });
    closeAiModal(); aiToast('Model selected'); return refreshAiConnections();
  }
}

function openConnectModal(providerId) {
  const provider = aiState.providers.find((item) => item.id === providerId);
  if (!provider) return;
  const defaultMode = provider.authModes?.[0] || 'api-key';
  const botOptions = ['<option value="global">Workspace default</option>', ...aiState.bots.map((bot) => `<option value="${escapeAiAttr(bot.id)}">${escapeAi(bot.name)}</option>`)].join('');
  const local = defaultMode === 'local';
  const advanced = providerId === 'openai-compatible' || providerId === 'ollama';
  const root = ai$('#modal-root');
  root.innerHTML = `<div class="modal-backdrop"><section class="modal ai-modal" role="dialog" aria-modal="true"><div class="modal-head"><div><p class="eyebrow">AI Connection</p><h2>Connect ${escapeAi(provider.label)}</h2><p>${escapeAi(provider.accountNote || '')}</p></div><button class="icon-button" data-ai-action="close">×</button></div>
    <div class="ai-form" data-provider="${escapeAiAttr(providerId)}" data-auth-mode="${escapeAiAttr(defaultMode)}">
      <div class="choice-grid"><div class="field"><label>Connection name</label><input class="input" id="ai-name" value="${escapeAiAttr(provider.label)}"></div><div class="field"><label>Use for</label><select class="select" id="ai-bot">${botOptions}</select></div></div>
      ${local ? '' : `<div class="field"><label>API credential</label><input class="input" id="ai-key" type="password" autocomplete="off" placeholder="Paste once — it will be encrypted"><small>Bot Hub stores this in Credential Vault and never returns the plaintext through the API.</small></div>`}
      ${providerId === 'gemini' ? '<div class="field"><label>Google Cloud project ID <span>optional for API key; required for OAuth user-project billing</span></label><input class="input" id="ai-project" placeholder="my-gcp-project"></div>' : ''}
      ${advanced ? `<div class="field"><label>Endpoint</label><input class="input" id="ai-endpoint" value="${escapeAiAttr(provider.defaultEndpoint || '')}" placeholder="${providerId === 'ollama' ? 'http://127.0.0.1:11434' : 'https://provider.example/v1'}"></div>` : ''}
      <div class="choice-grid"><div class="field"><label>Monthly request limit</label><input class="input" id="ai-monthly-limit" type="number" min="0" value="0"><small>0 = no Bot Hub request cap.</small></div><div class="field"><label>Max output tokens</label><input class="input" id="ai-max-output" type="number" min="128" max="32768" value="2048"></div></div>
      <div class="ai-permission-box"><strong>Bot Hub will use this connection only for AI inference.</strong><span>It does not request Gmail, Drive, consumer chat history, browser cookies or account passwords.</span></div>
      <div class="modal-actions">${providerId === 'gemini' && provider.oauthReady ? '<button class="secondary-button" data-ai-action="gemini-oauth">Continue with Google OAuth</button>' : ''}<button class="primary-button" data-ai-action="save">Verify & connect</button></div>
    </div></section></div>`;
}

async function saveAiConnection() {
  const form = document.querySelector('.ai-form');
  if (!form) return;
  const provider = form.dataset.provider;
  const definition = aiState.providers.find((item) => item.id === provider);
  const authMode = provider === 'ollama' ? 'local' : provider === 'openai-compatible' && !ai$('#ai-key')?.value ? 'none' : 'api-key';
  const payload = {
    provider, authMode, name: ai$('#ai-name')?.value, botId: ai$('#ai-bot')?.value || 'global', apiKey: ai$('#ai-key')?.value || undefined,
    projectId: ai$('#ai-project')?.value || '', endpoint: ai$('#ai-endpoint')?.value || definition?.defaultEndpoint || '',
    budget: { monthlyRequestLimit: Number(ai$('#ai-monthly-limit')?.value || 0), maxOutputTokens: Number(ai$('#ai-max-output')?.value || 2048), onExceeded: 'fallback' }
  };
  const result = await aiApi('/api/ai/connections', { method: 'POST', body: JSON.stringify(payload) });
  closeAiModal();
  aiToast(result.connected ? 'AI account verified and connected' : `Saved, but verification needs attention: ${result.error?.message || 'check provider access'}`, !result.connected);
  return refreshAiConnections();
}

async function startGeminiOauth() {
  const result = await aiApi('/api/ai/oauth/gemini/start', { method: 'POST', body: JSON.stringify({ botId: ai$('#ai-bot')?.value || 'global', projectId: ai$('#ai-project')?.value || '', name: ai$('#ai-name')?.value || 'Gemini OAuth' }) });
  window.open(result.authorizeUrl, '_blank', 'noopener,noreferrer');
  aiToast('Google authorization opened in your browser');
}

async function loadModelPicker(id) {
  const result = await aiApi(`/api/ai/connections/${encodeURIComponent(id)}/models`);
  const connection = aiState.connections.find((item) => item.id === id);
  const root = ai$('#modal-root');
  root.innerHTML = `<div class="modal-backdrop"><section class="modal ai-modal model-modal"><div class="modal-head"><div><p class="eyebrow">Available models</p><h2>${escapeAi(connection?.name || 'AI connection')}</h2><p>Loaded directly from the authenticated provider account.</p></div><button class="icon-button" data-ai-action="close">×</button></div><div class="ai-model-list">${(result.models || []).map((model) => `<button data-ai-action="select-model" data-id="${escapeAiAttr(id)}" data-model="${escapeAiAttr(model.id)}"><strong>${escapeAi(model.name || model.id)}</strong><span>${escapeAi(model.id)}</span></button>`).join('') || '<p>No models returned.</p>'}</div></section></div>`;
}

function showTestReply(value) {
  const root = ai$('#modal-root');
  root.innerHTML = `<div class="modal-backdrop"><section class="modal small"><div class="modal-head"><div><p class="eyebrow">Provider test</p><h2>Live reply</h2></div><button class="icon-button" data-ai-action="close">×</button></div><div class="ai-test-output">${escapeAi(value)}</div></section></div>`;
}
function closeAiModal() { const root = ai$('#modal-root'); if (root) root.innerHTML = ''; }
async function aiApi(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || payload.error || `Request failed: ${response.status}`);
  return payload;
}
function aiToast(message, error = false) {
  const root = ai$('#toast-root'); if (!root) return;
  const element = document.createElement('div'); element.className = `toast ${error ? 'error' : ''}`; element.textContent = message; root.append(element); setTimeout(() => element.remove(), 3600);
}
function botName(id) { return aiState.bots.find((item) => item.id === id)?.name || id; }
function providerMark(id) { return ({ openai: 'O', anthropic: 'C', gemini: 'G', ollama: 'L', 'openai-compatible': '↔' })[id] || 'AI'; }
function healthLabel(value) { return ({ healthy: 'Connected', pending_verification: 'Verifying', needs_attention: 'Needs attention', rate_limited: 'Rate limited', quota_exceeded: 'Quota', payment_required: 'Billing', credential_revoked: 'Re-auth', model_unavailable: 'Model unavailable', offline: 'Offline' })[value] || 'Unknown'; }
function formatAiNumber(value) { return new Intl.NumberFormat('en-US', { notation: Number(value) > 9999 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(Number(value) || 0); }
function escapeAi(value = '') { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
function escapeAiAttr(value = '') { return escapeAi(value); }
