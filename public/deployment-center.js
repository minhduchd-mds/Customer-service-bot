const deployState = { active: false, data: null, busy: false };
const dep$ = (selector) => document.querySelector(selector);

const DEPLOYMENT_PLANS = [
  {
    id: 'free-local', label: 'Free Local', price: '$0', badge: 'Recommended', ready: true,
    summary: 'Run Bot Hub on this Windows PC. Your bots, conversations and encrypted credentials stay on this machine.',
    bullets: ['No VPS required', 'Local SQLite + encrypted vault', 'Optional Cloudflare Tunnel for public callbacks', 'PC must stay online for auto-reply']
  },
  {
    id: 'free-cloud', label: 'Free Cloud', price: '$0 tier', badge: 'Preview', ready: false,
    summary: 'Stateless free hosting target for evaluation. Durable production use is blocked until Bot Hub state is migrated from SQLite to PostgreSQL.',
    bullets: ['Render/Koyeb target', 'Neon PostgreSQL migration required', 'Free services may sleep', 'Provider quotas can change']
  },
  {
    id: 'free-vps', label: 'Free VPS', price: '$0 quota', badge: 'Advanced', ready: true,
    summary: 'Run the normal Docker stack on a user-provisioned free-quota VPS such as an eligible Oracle Always Free instance.',
    bullets: ['Docker + Caddy', 'Public HTTPS callbacks', 'Persistent host storage', 'Free capacity is provider-dependent']
  },
  {
    id: 'vps-docker', label: 'Production VPS', price: 'Paid VPS', badge: 'Production', ready: true,
    summary: 'Dedicated Linux VPS for predictable uptime, public webhooks and customer-facing workloads.',
    bullets: ['24/7 target', 'Docker + Caddy', 'Custom domain', 'PostgreSQL/Redis recommended for scale']
  }
];

window.addEventListener('DOMContentLoaded', installDeploymentNav);
document.body.addEventListener('click', (event) => {
  const nav = event.target.closest('[data-nav]');
  if (nav) {
    deployState.active = nav.dataset.nav === 'deployment-center';
    if (deployState.active) setTimeout(() => void openDeploymentCenter(), 0);
  }
  const action = event.target.closest('[data-deploy-action]');
  if (!action || !deployState.active) return;
  event.preventDefault();
  void handleDeployAction(action.dataset.deployAction, action).catch((error) => deployToast(error.message || 'Deployment action failed', true));
});

function installDeploymentNav() {
  const operations = document.querySelector('nav[aria-label="Operations"]');
  if (!operations || operations.querySelector('[data-nav="deployment-center"]')) return;
  const button = document.createElement('button');
  button.className = 'nav-item';
  button.dataset.nav = 'deployment-center';
  button.innerHTML = '<span>⬡</span><span>Deployment</span>';
  operations.append(button);
}

async function openDeploymentCenter() {
  if (!deployState.active) return;
  dep$('#page-eyebrow').textContent = 'Workspace / Infrastructure';
  dep$('#page-title').textContent = 'Deployment Center';
  await refreshDeploymentCenter();
}

async function refreshDeploymentCenter() {
  if (!deployState.active || deployState.busy) return;
  deployState.busy = true;
  const view = dep$('#view');
  if (view) view.innerHTML = '<section class="deploy-loading"><div></div><p>Checking runtime plan…</p></section>';
  try {
    deployState.data = await depApi('/api/deployment');
    renderDeploymentCenter();
  } finally { deployState.busy = false; }
}

function renderDeploymentCenter() {
  const view = dep$('#view');
  if (!view) return;
  const d = deployState.data?.deployment || {};
  const selected = d.mode === 'desktop-lan' ? 'free-local' : (d.mode || 'free-local');
  const current = DEPLOYMENT_PLANS.find((item) => item.id === selected) || DEPLOYMENT_PLANS[0];
  view.innerHTML = `
    <section class="deploy-hero">
      <div><p class="eyebrow">Free-first</p><h2>Start at $0. Upgrade only when the bot needs to stay online.</h2><p>Bot Hub does not require a VPS to evaluate the product. Start locally, add public HTTPS only when a channel needs it, then move to a cloud or VPS runtime when uptime matters.</p></div>
      <div class="deploy-current"><span>Current plan</span><strong>${escapeDep(current.label)}</strong><small>${escapeDep(current.price)}</small><i class="${current.ready ? 'ok' : 'warn'}">${current.ready ? 'Ready' : 'Preview only'}</i></div>
    </section>

    <section class="deploy-path"><span>1</span><b>Free Local</b><i>→</i><span>2</span><b>Public HTTPS</b><i>→</i><span>3</span><b>Free Cloud/VPS</b><i>→</i><span>4</span><b>Production VPS</b></section>

    <div class="section-head"><div><h2>Choose how Bot Hub runs</h2><p>Changing this saves a deployment profile; it never silently provisions third-party infrastructure.</p></div></div>
    <section class="deploy-grid">${DEPLOYMENT_PLANS.map((plan) => deploymentPlanCard(plan, selected)).join('')}</section>

    ${selected === 'free-local' ? freeLocalDetails(d) : selected === 'free-cloud' ? freeCloudDetails(d) : vpsDetails(d, selected)}

    <section class="deploy-safety">
      <strong>Infrastructure truthfulness</strong>
      <p>Free tiers, quotas and sleep policies are controlled by external providers and can change. Bot Hub checks its own runtime health but does not promise permanent free hosting. Provider webhooks must reach the live runtime directly so signed request bytes are verified correctly.</p>
    </section>`;
}

function deploymentPlanCard(plan, selected) {
  const active = plan.id === selected;
  return `<article class="deploy-plan ${active ? 'active' : ''} ${plan.ready ? '' : 'preview'}">
    <div class="deploy-plan-head"><span>${escapeDep(plan.badge)}</span><strong>${escapeDep(plan.price)}</strong></div>
    <h3>${escapeDep(plan.label)}</h3><p>${escapeDep(plan.summary)}</p>
    <ul>${plan.bullets.map((item) => `<li>${escapeDep(item)}</li>`).join('')}</ul>
    <button class="${active ? 'secondary-button' : 'primary-button'}" data-deploy-action="select" data-mode="${escapeDepAttr(plan.id)}" ${!plan.ready && active ? 'disabled' : ''}>${active ? 'Selected' : plan.ready ? 'Choose plan' : 'Preview plan'}</button>
  </article>`;
}

function freeLocalDetails(d) {
  return `<section class="deploy-panel">
    <div><p class="eyebrow">$0 local runtime</p><h2>This computer is the server.</h2><p>Windows Desktop uses local SQLite, the local encrypted Credential Vault and the AI accounts you connect. No cloud database is required.</p></div>
    <div class="deploy-checks">
      <div><i>✓</i><span><strong>Local persistence</strong><small>Conversation and bot state remain on this machine.</small></span></div>
      <div><i>✓</i><span><strong>BYOA AI</strong><small>OpenAI, Claude, Gemini or local Ollama credentials remain encrypted in Bot Hub.</small></span></div>
      <div><i>⌁</i><span><strong>Public callback option</strong><small>Use a trusted HTTPS tunnel when a provider needs an Internet-reachable webhook. Bot Hub does not collect tunnel credentials.</small></span></div>
      <div><i>!</i><span><strong>Availability</strong><small>Sleep, shutdown or Internet loss stops automated replies.</small></span></div>
    </div>
    <div class="field"><label>Public Base URL <span>optional</span></label><input class="input" id="deploy-public-url" value="${escapeDepAttr(d.publicBaseUrl || '')}" placeholder="https://bot.example.com"><small>Only set this when the URL actually reaches this Bot Hub runtime.</small></div>
    <div class="deploy-actions"><button class="primary-button" data-deploy-action="save-local">Save Free Local</button><button class="secondary-button" data-deploy-action="copy-env">Copy runtime .env</button></div>
  </section>`;
}

function freeCloudDetails(d) {
  return `<section class="deploy-panel blocked">
    <div><p class="eyebrow">Free Cloud preview</p><h2>PostgreSQL migration required before production.</h2><p>Current Bot Hub conversation persistence is SQLite single-node. A sleeping/stateless free web service cannot safely be advertised as durable until shared PostgreSQL state is enabled.</p></div>
    <div class="deploy-block"><strong>Deployment blocked for live customer traffic</strong><span>Use Free Local or Free VPS today. Free Cloud remains a preview target while the PostgreSQL/Redis scale layer is implemented.</span></div>
    <div class="choice-grid"><div class="field"><label>Web service target</label><select class="select" id="deploy-cloud-provider"><option value="render" ${d.cloudProvider === 'render' ? 'selected' : ''}>Render free tier</option><option value="koyeb" ${d.cloudProvider === 'koyeb' ? 'selected' : ''}>Koyeb free tier</option></select></div><div class="field"><label>Database target</label><select class="select" id="deploy-database-provider"><option value="neon">Neon PostgreSQL</option></select></div></div>
    <button class="secondary-button" data-deploy-action="save-cloud-preview">Save preview target</button>
  </section>`;
}

function vpsDetails(d, mode) {
  const free = mode === 'free-vps';
  return `<section class="deploy-panel">
    <div><p class="eyebrow">${free ? 'Free quota VPS' : 'Production Docker VPS'}</p><h2>${free ? 'Use your own eligible free VPS.' : 'Run Bot Hub continuously on Linux.'}</h2><p>${free ? 'Bot Hub prepares the same Docker architecture, but the cloud provider controls free capacity and account eligibility.' : 'Recommended when public channels and customer support need predictable uptime.'}</p></div>
    ${free ? '<div class="deploy-block info"><strong>Suggested target: Oracle free quota when available</strong><span>Bot Hub does not create accounts or promise provider capacity. Confirm current free-tier eligibility before provisioning.</span></div>' : ''}
    <div class="choice-grid"><div class="field"><label>VPS host / IP</label><input class="input" id="deploy-vps-host" value="${escapeDepAttr(d.vpsHost || '')}" placeholder="203.0.113.10"></div><div class="field"><label>SSH user</label><input class="input" id="deploy-ssh-user" value="${escapeDepAttr(d.sshUser || 'root')}"></div></div>
    <div class="choice-grid"><div class="field"><label>Bot domain</label><input class="input" id="deploy-bot-domain" value="${escapeDepAttr(d.botDomain || '')}" placeholder="bot.example.com"></div><div class="field"><label>n8n domain</label><input class="input" id="deploy-n8n-domain" value="${escapeDepAttr(d.n8nDomain || '')}" placeholder="n8n.example.com"></div></div>
    <div class="field"><label>Public Base URL</label><input class="input" id="deploy-public-url" value="${escapeDepAttr(d.publicBaseUrl || '')}" placeholder="https://bot.example.com"></div>
    <div class="deploy-actions"><button class="primary-button" data-deploy-action="save-vps">Save ${free ? 'Free VPS' : 'VPS'} target</button><button class="secondary-button" data-deploy-action="copy-env">Copy Docker .env</button></div>
    <div class="deploy-code"><strong>Bootstrap</strong><pre>${escapeDep(Object.values(deployState.data?.commands || {}).join('\n'))}</pre></div>
  </section>`;
}

async function handleDeployAction(action, element) {
  if (action === 'select') {
    const mode = element.dataset.mode;
    deployState.data = await depApi('/api/deployment', { method: 'PATCH', body: JSON.stringify({ mode }) });
    deployToast(`${DEPLOYMENT_PLANS.find((item) => item.id === mode)?.label || 'Plan'} selected`);
    return renderDeploymentCenter();
  }
  if (action === 'save-local') return saveDeploymentPayload({ mode: 'free-local', publicBaseUrl: dep$('#deploy-public-url')?.value || '', tunnelProvider: 'cloudflare' }, 'Free Local saved');
  if (action === 'save-cloud-preview') return saveDeploymentPayload({ mode: 'free-cloud', cloudProvider: dep$('#deploy-cloud-provider')?.value || 'render', databaseProvider: dep$('#deploy-database-provider')?.value || 'neon' }, 'Free Cloud preview target saved');
  if (action === 'save-vps') {
    const mode = deployState.data?.deployment?.mode === 'free-vps' ? 'free-vps' : 'vps-docker';
    return saveDeploymentPayload({ mode, vpsHost: dep$('#deploy-vps-host')?.value || '', sshUser: dep$('#deploy-ssh-user')?.value || 'root', botDomain: dep$('#deploy-bot-domain')?.value || '', n8nDomain: dep$('#deploy-n8n-domain')?.value || '', publicBaseUrl: dep$('#deploy-public-url')?.value || '', ...(mode === 'free-vps' ? { freeVpsProvider: 'oracle' } : {}) }, 'VPS target saved');
  }
  if (action === 'copy-env') {
    const value = deployState.data?.dockerEnv || '';
    if (!value) throw new Error('No runtime environment template is available');
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value); else fallbackDepCopy(value);
    return deployToast('.env template copied');
  }
}

async function saveDeploymentPayload(payload, message) {
  deployState.data = await depApi('/api/deployment', { method: 'PATCH', body: JSON.stringify(payload) });
  renderDeploymentCenter();
  deployToast(message);
}
async function depApi(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || payload.error || `Request failed: ${response.status}`);
  return payload;
}
function fallbackDepCopy(value) { const area = document.createElement('textarea'); area.value = value; area.style.position = 'fixed'; area.style.opacity = '0'; document.body.append(area); area.select(); document.execCommand('copy'); area.remove(); }
function deployToast(message, error = false) { const root = dep$('#toast-root'); if (!root) return; const item = document.createElement('div'); item.className = `toast ${error ? 'error' : ''}`; item.textContent = message; root.append(item); setTimeout(() => item.remove(), 3600); }
function escapeDep(value = '') { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
function escapeDepAttr(value = '') { return escapeDep(value); }
