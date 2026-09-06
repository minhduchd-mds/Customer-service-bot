const channelState = { active: false, accounts: [], bots: [], selectedBot: '', busy: false };
const ch$ = (selector) => document.querySelector(selector);

window.addEventListener('DOMContentLoaded', installChannelsNav);
document.body.addEventListener('click', (event) => {
  const nav = event.target.closest('[data-nav]');
  if (nav) {
    channelState.active = nav.dataset.nav === 'channel-accounts';
    if (channelState.active) setTimeout(() => void openChannelAccounts(), 0);
  }
  const action = event.target.closest('[data-channel-action]');
  if (!action || !channelState.active) return;
  event.preventDefault();
  void handleChannelAction(action.dataset.channelAction, action).catch((error) => channelToast(error.message || 'Channel action failed', true));
});

document.body.addEventListener('change', (event) => {
  if (event.target.id !== 'channel-bot-select') return;
  channelState.selectedBot = event.target.value;
});

function installChannelsNav() {
  const primary = document.querySelector('nav[aria-label="Primary"]');
  if (!primary || primary.querySelector('[data-nav="channel-accounts"]')) return;
  const button = document.createElement('button');
  button.className = 'nav-item';
  button.dataset.nav = 'channel-accounts';
  button.innerHTML = '<span>◎</span><span>Channel Accounts</span>';
  primary.append(button);
}

async function openChannelAccounts() {
  if (!channelState.active) return;
  ch$('#page-eyebrow').textContent = 'Workspace / Omnichannel';
  ch$('#page-title').textContent = 'Channel Accounts';
  await refreshChannelAccounts();
}

async function refreshChannelAccounts() {
  if (!channelState.active || channelState.busy) return;
  channelState.busy = true;
  const view = ch$('#view');
  if (view) view.innerHTML = '<section class="channel-loading"><div></div><p>Checking messaging capabilities…</p></section>';
  try {
    const [catalog, bots] = await Promise.all([channelApi('/api/channel-accounts/catalog'), channelApi('/api/bots')]);
    channelState.accounts = catalog.accounts || [];
    channelState.bots = bots.bots || [];
    if (!channelState.selectedBot || !channelState.bots.some((item) => item.id === channelState.selectedBot)) channelState.selectedBot = channelState.bots[0]?.id || '';
    renderChannelAccounts();
  } finally { channelState.busy = false; }
}

function renderChannelAccounts() {
  const view = ch$('#view');
  if (!view) return;
  const messaging = channelState.accounts.filter((item) => item.capabilities?.autoReply && item.production).length;
  const identityOnly = channelState.accounts.filter((item) => item.capabilities?.identityLogin && !item.capabilities?.autoReply).length;
  view.innerHTML = `
    <section class="channel-hero">
      <div><p class="eyebrow">Permission first</p><h2>Connect the account type that can actually reply.</h2><p>Bot Hub separates identity login from messaging authorization. A personal social account is never shown as an automated inbox unless the provider officially grants that capability.</p></div>
      <div class="channel-metrics"><div><strong>${messaging}</strong><span>Messaging-ready types</span></div><div><strong>${identityOnly}</strong><span>Identity-only types</span></div></div>
    </section>
    <section class="channel-rule"><strong>Auto Reply gate</strong><span>Bot Hub requires receive + send + webhook/provider authorization before a channel can be treated as automated messaging.</span></section>
    <div class="section-head"><div><h2>Account types</h2><p>Zalo personal, Facebook profile and consumer Instagram/TikTok login are intentionally not presented as bot inboxes.</p></div><div class="field channel-bot-field"><label>Connect to bot</label><select class="select" id="channel-bot-select">${channelState.bots.map((bot) => `<option value="${escapeChannelAttr(bot.id)}" ${bot.id === channelState.selectedBot ? 'selected' : ''}>${escapeChannel(bot.name)}</option>`).join('') || '<option value="">Create a bot first</option>'}</select></div></div>
    <section class="channel-grid">${channelState.accounts.map(channelAccountCard).join('')}</section>
  `;
}

function channelAccountCard(account) {
  const caps = account.capabilities || {};
  const allowed = account.connectable && account.runtimeReady && caps.autoReply;
  const className = allowed ? 'ready' : caps.identityLogin && !caps.autoReply ? 'identity' : 'planned';
  return `<article class="channel-card ${className}">
    <div class="channel-card-head"><div class="channel-mark">${channelMark(account.channel)}</div><div><h3>${escapeChannel(account.label)}</h3><p>${escapeChannel(account.accountClass || '')}</p></div><span>${allowed ? 'Messaging' : caps.identityLogin && !caps.autoReply ? 'Identity only' : 'Not enabled'}</span></div>
    <p class="channel-note">${escapeChannel(account.note || '')}</p>
    <div class="channel-caps">
      ${capChip('Login', caps.identityLogin)}${capChip('Receive', caps.receiveMessages)}${capChip('Send', caps.sendMessages)}${capChip('Webhook', caps.webhook)}${capChip('Auto reply', caps.autoReply)}
    </div>
    <div class="channel-status-row"><span>Runtime adapter</span><strong>${account.adapterAvailable ? 'Available' : 'Not installed'}</strong></div>
    <div class="channel-status-row"><span>Current config</span><strong>${account.configured ? 'Configured' : 'Not configured'}</strong></div>
    <button class="${allowed ? 'primary-button' : 'secondary-button'}" data-channel-action="${allowed ? 'connect' : 'explain'}" data-account="${escapeChannelAttr(account.id)}" ${!channelState.selectedBot ? 'disabled' : ''}>${allowed ? 'Connect account' : caps.identityLogin && !caps.autoReply ? 'Why login is not a bot' : 'View requirement'}</button>
  </article>`;
}

async function handleChannelAction(action, element) {
  const account = channelState.accounts.find((item) => item.id === element.dataset.account);
  if (!account) return;
  if (action === 'explain') return showChannelExplanation(account);
  if (action === 'close') return closeChannelModal();
  if (action === 'connect') {
    if (!channelState.selectedBot) throw new Error('Create or select a bot first');
    const result = await channelApi('/api/channel-accounts/connect', { method: 'POST', body: JSON.stringify({ botId: channelState.selectedBot, accountTypeId: account.id }) });
    if (result.instant) {
      channelToast(`${account.label} connected`);
      return refreshChannelAccounts();
    }
    return showConnectionQr(result, account);
  }
}

function showChannelExplanation(account) {
  const caps = account.capabilities || {};
  const root = ch$('#modal-root');
  root.innerHTML = `<div class="modal-backdrop"><section class="modal channel-modal"><div class="modal-head"><div><p class="eyebrow">Channel capability</p><h2>${escapeChannel(account.label)}</h2><p>${escapeChannel(account.note || '')}</p></div><button class="icon-button" data-channel-action="close">×</button></div>
    <div class="channel-permission-matrix"><div><span>Identity login</span><strong>${yesNo(caps.identityLogin)}</strong></div><div><span>Receive messages</span><strong>${yesNo(caps.receiveMessages)}</strong></div><div><span>Send messages</span><strong>${yesNo(caps.sendMessages)}</strong></div><div><span>Webhook</span><strong>${yesNo(caps.webhook)}</strong></div><div><span>Auto reply</span><strong>${yesNo(caps.autoReply)}</strong></div></div>
    <div class="channel-explain-box"><strong>${caps.identityLogin && !caps.autoReply ? 'Sign-in is not messaging authorization' : 'Adapter/capability not enabled'}</strong><span>Bot Hub will not capture browser cookies, personal QR sessions or undocumented user tokens to bypass provider restrictions.</span></div>
  </section></div>`;
}

function showConnectionQr(result, account) {
  const session = result.session || {};
  const root = ch$('#modal-root');
  root.innerHTML = `<div class="modal-backdrop"><section class="modal channel-modal"><div class="modal-head"><div><p class="eyebrow">Official connection handoff</p><h2>${escapeChannel(account.label)}</h2><p>Scan this temporary QR with a phone or open the handoff URL. The channel is not marked Connected until provider authorization/configuration is verified.</p></div><button class="icon-button" data-channel-action="close">×</button></div>
    <div class="channel-qr">${result.qrSvg || '<div class="channel-qr-missing">QR could not be rendered.</div>'}</div>
    <div class="channel-url">${escapeChannel(session.connectionUrl || '')}</div>
    <div class="channel-explain-box"><strong>Temporary authorization session</strong><span>No personal browser session or cookie is captured by Bot Hub.</span></div>
  </section></div>`;
}

function closeChannelModal() { const root = ch$('#modal-root'); if (root) root.innerHTML = ''; }
function capChip(label, value) { return `<span class="${value ? 'on' : 'off'}">${value ? '✓' : '—'} ${escapeChannel(label)}</span>`; }
function yesNo(value) { return value ? 'Allowed' : 'Not granted'; }
function channelMark(id) { return ({ zalo: 'Z', facebook: 'f', instagram: '◎', telegram: '↗', tiktok: '♪', web: '⌘' })[id] || '•'; }
async function channelApi(url, options = {}) { const response = await fetch(url, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.message || payload.error || `Request failed: ${response.status}`); return payload; }
function channelToast(message, error = false) { const root = ch$('#toast-root'); if (!root) return; const item = document.createElement('div'); item.className = `toast ${error ? 'error' : ''}`; item.textContent = message; root.append(item); setTimeout(() => item.remove(), 3600); }
function escapeChannel(value = '') { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
function escapeChannelAttr(value = '') { return escapeChannel(value); }
