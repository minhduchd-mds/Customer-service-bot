const opsState = {
  doctor: null,
  backups: [],
  loading: false
};

const qs = (selector) => document.querySelector(selector);

window.addEventListener('DOMContentLoaded', () => {
  installRuntimeButton();
  void refreshRuntimeBadge();
  setInterval(() => void refreshRuntimeBadge(), 30_000);
});

document.body.addEventListener('click', (event) => {
  const action = event.target.closest('[data-ops-action]')?.dataset.opsAction;
  if (!action) return;
  event.preventDefault();
  void handleAction(action).catch((error) => toast(error.message || 'Operations action failed', true));
});

function installRuntimeButton() {
  const actions = qs('.top-actions');
  if (!actions || qs('#runtime-center')) return;
  const button = document.createElement('button');
  button.id = 'runtime-center';
  button.className = 'runtime-button';
  button.dataset.opsAction = 'open';
  button.innerHTML = '<i></i><span>Runtime</span><b id="runtime-mode">Checking</b>';
  actions.insertBefore(button, actions.firstChild);
}

async function refreshRuntimeBadge() {
  const button = qs('#runtime-center');
  const label = qs('#runtime-mode');
  if (!button || !label) return;
  try {
    const payload = await api('/api/operations/doctor');
    opsState.doctor = payload.doctor;
    button.classList.remove('ok', 'warning', 'error');
    const hasWarning = payload.doctor.checks?.some((item) => item.level === 'warning');
    button.classList.add(payload.doctor.ok ? (hasWarning ? 'warning' : 'ok') : 'error');
    label.textContent = runtimeLabel(payload.doctor);
  } catch {
    button.classList.remove('ok', 'warning');
    button.classList.add('error');
    label.textContent = window.botHubRuntime?.mode === 'local-docker' ? 'Docker offline' : 'Disconnected';
  }
}

async function handleAction(action) {
  if (action === 'open') return openOperations();
  if (action === 'close') return closeModal();
  if (action === 'refresh') return openOperations(true);
  if (action === 'backup') {
    setBusy(true);
    try {
      await api('/api/operations/backups', { method: 'POST', body: JSON.stringify({ label: 'manual-ui' }) });
      toast('Backup created');
      return openOperations(true);
    } finally { setBusy(false); }
  }
  if (action === 'repair') {
    if (!confirm('Run safe repair? This applies retention cleanup and health checks; it does not delete active handoff tickets.')) return;
    setBusy(true);
    try {
      await api('/api/operations/repair', { method: 'POST', body: '{}' });
      toast('Repair completed');
      return openOperations(true);
    } finally { setBusy(false); }
  }
  if (action === 'runtime-local') {
    window.botHubRuntime?.set('local');
    return;
  }
  if (action === 'runtime-same') {
    window.botHubRuntime?.clear();
    return;
  }
  if (action === 'runtime-remote') {
    const value = prompt('Public HTTPS Bot Hub runtime URL', 'https://bot.example.com');
    if (value) window.botHubRuntime?.set(value);
  }
}

async function openOperations(force = false) {
  if (opsState.loading) return;
  opsState.loading = true;
  try {
    if (force || !opsState.doctor) {
      const [doctorData, backupData] = await Promise.all([
        api('/api/operations/doctor'),
        api('/api/operations/backups?limit=8')
      ]);
      opsState.doctor = doctorData.doctor;
      opsState.backups = backupData.backups || [];
    }
    renderOperations();
  } catch (error) {
    renderDisconnected(error);
  } finally {
    opsState.loading = false;
    void refreshRuntimeBadge();
  }
}

function renderOperations() {
  const doctor = opsState.doctor || {};
  const modalRoot = qs('#modal-root');
  if (!modalRoot) return;
  modalRoot.innerHTML = `<div class="modal-backdrop">
    <section class="modal ops-modal" role="dialog" aria-modal="true" aria-label="Runtime Operations">
      <div class="modal-head"><div><p class="eyebrow">Bot Hub Operations</p><h2>Runtime & Maintenance</h2><p>Doctor, persistent backup, repair and runtime switching.</p></div><button class="icon-button" data-ops-action="close">×</button></div>
      <div class="ops-grid">
        <article class="ops-card">
          <h3>Runtime</h3><p class="subtle">${escapeHtml(runtimeDescription(doctor))}</p>
          ${runtimeRows(doctor)}
          <div class="ops-actions"><button class="secondary-button" data-ops-action="refresh">Refresh</button><button class="primary-button" data-ops-action="backup">Create backup</button><button class="secondary-button" data-ops-action="repair">Safe repair</button></div>
          <div class="ops-checks">${(doctor.checks || []).map(checkRow).join('')}</div>
        </article>
        <article class="ops-card">
          <h3>Web ↔ Runtime</h3><p class="subtle">Choose where this web console sends management API calls.</p>
          <div class="ops-runtime-picker">
            <button class="ops-runtime-choice" data-ops-action="runtime-local"><span>▣</span><div><b>Local Docker</b><span>Use http://127.0.0.1:8787 on this computer. Recommended when Docker Desktop is running.</span></div></button>
            <button class="ops-runtime-choice" data-ops-action="runtime-same"><span>⌘</span><div><b>Same origin / Vercel proxy</b><span>Use the current website API. Requires BOT_RUNTIME_URL when the console is hosted on Vercel.</span></div></button>
            <button class="ops-runtime-choice" data-ops-action="runtime-remote"><span>↗</span><div><b>Public HTTPS runtime</b><span>Point this browser directly to a trusted Bot Hub VPS/runtime.</span></div></button>
          </div>
          <div class="ops-banner">Current browser mode: <strong>${escapeHtml(window.botHubRuntime?.mode || 'same-origin')}</strong>${window.botHubRuntime?.base ? `<br><span class="ops-code">${escapeHtml(window.botHubRuntime.base)}</span>` : ''}</div>
        </article>
        <article class="ops-card">
          <h3>Channels</h3><p class="subtle">Configuration status only; secrets are never shown here.</p>
          ${(doctor.channels || []).length ? doctor.channels.map(channelRow).join('') : '<div class="ops-empty">No channel adapters found.</div>'}
        </article>
        <article class="ops-card">
          <h3>AI providers</h3><p class="subtle">Provider registry summary without API keys.</p>
          ${(doctor.providers || []).length ? doctor.providers.map(providerRow).join('') : '<div class="ops-empty">No AI provider configured. Grounded deterministic fallback remains available.</div>'}
        </article>
        <article class="ops-card" style="grid-column:1/-1">
          <h3>Backups</h3><p class="subtle">Consistent SQLite snapshot plus Bot Hub JSON state. The newest 20 backups are retained.</p>
          <div class="ops-backup-list">${opsState.backups.length ? opsState.backups.map(backupRow).join('') : '<div class="ops-empty">No backup has been created yet.</div>'}</div>
        </article>
      </div>
    </section>
  </div>`;
}

function renderDisconnected(error) {
  const modalRoot = qs('#modal-root');
  if (!modalRoot) return;
  modalRoot.innerHTML = `<div class="modal-backdrop"><section class="modal small" role="dialog" aria-modal="true"><div class="modal-head"><div><p class="eyebrow">Runtime unavailable</p><h2>Connect Bot Hub runtime</h2><p>${escapeHtml(error?.message || 'The console cannot reach Bot Hub.')}</p></div><button class="icon-button" data-ops-action="close">×</button></div><div class="ops-runtime-picker"><button class="ops-runtime-choice" data-ops-action="runtime-local"><span>▣</span><div><b>Connect Local Docker</b><span>Use Bot Hub running on this PC at 127.0.0.1:8787.</span></div></button><button class="ops-runtime-choice" data-ops-action="runtime-remote"><span>↗</span><div><b>Connect public runtime</b><span>Enter a public HTTPS VPS/runtime URL.</span></div></button></div></section></div>`;
}

function runtimeRows(doctor) {
  const runtime = doctor.runtime || {};
  const state = doctor.state || {};
  return [
    ['Status', doctor.ok ? 'Healthy' : 'Needs attention'],
    ['Environment', `${runtime.container ? 'Docker · ' : ''}${runtime.platform || 'unknown'} ${runtime.arch || ''}`],
    ['Node', runtime.node || 'unknown'],
    ['Conversation store', `${state.backend || 'unknown'} · ${state.conversationStore?.conversations || 0} conversations`],
    ['Open handoffs', String(state.conversationStore?.openTickets || 0)]
  ].map(([label, value]) => `<div class="ops-runtime-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
}

function runtimeDescription(doctor) {
  if (!doctor) return 'Runtime information unavailable.';
  return doctor.ok ? 'Core persistence and runtime checks are healthy.' : 'One or more blocking runtime checks failed.';
}

function runtimeLabel(doctor) {
  if (window.botHubRuntime?.mode === 'local-docker') return doctor?.runtime?.container ? 'Local Docker' : 'Local runtime';
  if (window.botHubRuntime?.mode === 'remote-runtime') return 'Remote';
  return doctor?.runtime?.container ? 'Docker' : 'Runtime';
}

function checkRow(item) {
  return `<div class="ops-check ${escapeAttr(item.level || 'warning')}"><i></i><div><strong>${escapeHtml(item.id || 'check')}</strong><span>${escapeHtml(item.message || '')}</span></div></div>`;
}
function channelRow(item) {
  const active = item.inboundConfigured || item.outboundConfigured;
  return `<div class="ops-channel"><div><strong>${escapeHtml(item.label || item.id)}</strong><small>${escapeHtml(item.note || item.connectMethod || '')}</small></div><span class="ops-state ${active ? 'on' : ''}">${active ? 'Configured' : 'Not configured'}</span></div>`;
}
function providerRow(item) {
  return `<div class="ops-provider"><div><strong>${escapeHtml(item.name)} · ${escapeHtml(item.model)}</strong><small>${escapeHtml(item.endpoint || '')}</small></div><span class="ops-state ${item.configured ? 'on' : ''}">${item.configured ? 'Ready' : 'Missing key'}</span></div>`;
}
function backupRow(item) {
  const bytes = (item.files || []).reduce((sum, file) => sum + Number(file.bytes || 0), 0);
  return `<div class="ops-backup"><strong>${escapeHtml(item.label || 'backup')} · ${escapeHtml(formatDate(item.createdAt))}</strong><span>${escapeHtml(item.id)} · ${formatBytes(bytes)} · ${(item.files || []).length} files</span></div>`;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || payload.error || `Request failed: ${response.status}`);
  return payload;
}

function closeModal() { const root = qs('#modal-root'); if (root) root.innerHTML = ''; }
function setBusy(value) { opsState.loading = value; }
function toast(message, error = false) {
  const root = qs('#toast-root');
  if (!root) return;
  const element = document.createElement('div');
  element.className = `toast ${error ? 'error' : ''}`;
  element.textContent = message;
  root.append(element);
  setTimeout(() => element.remove(), 3200);
}
function formatDate(value) { try { return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)); } catch { return String(value || ''); } }
function formatBytes(value) { const units = ['B','KB','MB','GB']; let n = Number(value)||0; let i=0; while(n>=1024&&i<units.length-1){n/=1024;i++;} return `${n.toFixed(i?1:0)} ${units[i]}`; }
function escapeHtml(value = '') { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
function escapeAttr(value = '') { return escapeHtml(value); }
