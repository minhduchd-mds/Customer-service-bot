const inbox = {
  active: false,
  conversations: [],
  tickets: [],
  selectedId: null,
  detail: null,
  status: '',
  query: '',
  loading: false,
  searchTimer: null
};

const $ = (selector) => document.querySelector(selector);
const apiJson = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || payload.error || `Request failed: ${response.status}`);
  return payload;
};

document.body.addEventListener('click', (event) => {
  const nav = event.target.closest('[data-nav]');
  if (nav) {
    if (nav.dataset.nav === 'conversations') {
      inbox.active = true;
      setTimeout(() => void openInbox(), 0);
    } else {
      inbox.active = false;
    }
  }

  const action = event.target.closest('[data-inbox-action]');
  if (!action || !inbox.active) return;
  event.preventDefault();
  void handleInboxAction(action.dataset.inboxAction, action).catch((error) => notify(error.message || 'Inbox action failed', true));
});

document.body.addEventListener('input', (event) => {
  if (!inbox.active || event.target.id !== 'inbox-search') return;
  inbox.query = event.target.value;
  clearTimeout(inbox.searchTimer);
  inbox.searchTimer = setTimeout(() => void loadInbox({ keepSelection: true }), 250);
});

async function openInbox() {
  if (!inbox.active) return;
  $('#page-eyebrow').textContent = 'Workspace / Support';
  $('#page-title').textContent = 'Conversations';
  await loadInbox({ keepSelection: true });
}

async function loadInbox({ keepSelection = false } = {}) {
  if (!inbox.active || inbox.loading) return;
  inbox.loading = true;
  renderLoading();
  try {
    const params = new URLSearchParams();
    if (inbox.status) params.set('status', inbox.status);
    if (inbox.query.trim()) params.set('q', inbox.query.trim());
    params.set('limit', '100');
    const [conversationData, ticketData] = await Promise.all([
      apiJson(`/api/conversations?${params}`),
      apiJson('/api/tickets?limit=100')
    ]);
    inbox.conversations = conversationData.conversations || [];
    inbox.tickets = ticketData.tickets || [];
    if (!keepSelection || !inbox.conversations.some((item) => item.id === inbox.selectedId)) {
      inbox.selectedId = inbox.conversations[0]?.id || null;
      inbox.detail = null;
    }
    if (inbox.selectedId) await loadDetail(inbox.selectedId, false);
    else renderInbox();
  } finally {
    inbox.loading = false;
  }
}

async function loadDetail(id, markRead = true) {
  inbox.selectedId = id;
  const data = await apiJson(`/api/conversations/${encodeURIComponent(id)}?messageLimit=200`);
  inbox.detail = data.conversation;
  if (markRead && inbox.detail.unreadCount > 0) {
    const updated = await apiJson(`/api/conversations/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ markRead: true })
    });
    inbox.detail.unreadCount = updated.conversation.unreadCount;
    const listItem = inbox.conversations.find((item) => item.id === id);
    if (listItem) listItem.unreadCount = 0;
  }
  renderInbox();
}

async function handleInboxAction(action, element) {
  if (action === 'select') return loadDetail(element.dataset.id);
  if (action === 'filter') {
    inbox.status = element.dataset.status || '';
    inbox.selectedId = null;
    return loadInbox();
  }
  if (action === 'refresh') return loadInbox({ keepSelection: true });
  if (action === 'resolve-ticket') {
    const ticketId = element.dataset.ticketId;
    await apiJson(`/api/tickets/${encodeURIComponent(ticketId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'resolved' })
    });
    notify('Handoff ticket resolved');
    return loadInbox({ keepSelection: true });
  }
  if (action === 'pending-ticket') {
    const ticketId = element.dataset.ticketId;
    await apiJson(`/api/tickets/${encodeURIComponent(ticketId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'pending' })
    });
    notify('Ticket moved to pending');
    return loadInbox({ keepSelection: true });
  }
  if (action === 'archive') {
    await apiJson(`/api/conversations/${encodeURIComponent(inbox.selectedId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'archived', markRead: true })
    });
    notify('Conversation archived');
    return loadInbox();
  }
  if (action === 'delete') {
    if (!confirm('Delete this stored conversation and its handoff tickets?')) return;
    await apiJson(`/api/conversations/${encodeURIComponent(inbox.selectedId)}`, { method: 'DELETE' });
    inbox.selectedId = null;
    inbox.detail = null;
    notify('Conversation deleted');
    return loadInbox();
  }
}

function renderLoading() {
  const root = $('#view');
  if (!root || !inbox.active) return;
  root.innerHTML = '<section class="inbox-loading"><span></span><p>Loading durable conversations…</p></section>';
}

function renderInbox() {
  const root = $('#view');
  if (!root || !inbox.active) return;
  const activeTickets = inbox.tickets.filter((ticket) => ticket.status === 'open' || ticket.status === 'pending');
  const handoffs = inbox.conversations.filter((item) => item.status === 'handoff').length;
  const unread = inbox.conversations.reduce((sum, item) => sum + Number(item.unreadCount || 0), 0);

  root.innerHTML = `
    <section class="inbox-summary">
      <div><strong>${inbox.conversations.length}</strong><span>Conversations</span></div>
      <div><strong>${unread}</strong><span>Unread turns</span></div>
      <div><strong>${handoffs}</strong><span>Need human</span></div>
      <div><strong>${activeTickets.length}</strong><span>Open tickets</span></div>
    </section>
    <section class="inbox-toolbar">
      <div class="inbox-search-wrap"><span>⌕</span><input id="inbox-search" value="${escapeAttr(inbox.query)}" placeholder="Search excerpt, channel or customer ref" aria-label="Search conversations"></div>
      <div class="inbox-filters">${filterButton('', 'All')}${filterButton('open', 'Open')}${filterButton('handoff', 'Handoff')}${filterButton('resolved', 'Resolved')}${filterButton('archived', 'Archived')}</div>
      <button class="secondary-button" data-inbox-action="refresh">Refresh</button>
    </section>
    <section class="inbox-shell">
      <aside class="inbox-list" aria-label="Conversation list">${conversationList()}</aside>
      <main class="inbox-detail">${conversationDetail()}</main>
    </section>`;
}

function filterButton(status, label) {
  return `<button class="inbox-filter ${inbox.status === status ? 'active' : ''}" data-inbox-action="filter" data-status="${status}">${label}</button>`;
}

function conversationList() {
  if (!inbox.conversations.length) return '<div class="inbox-empty"><strong>No conversations</strong><span>Live channel messages will appear here after Router9 processes them.</span></div>';
  return inbox.conversations.map((item) => {
    const selected = item.id === inbox.selectedId ? 'selected' : '';
    const unread = Number(item.unreadCount || 0);
    return `<button class="conversation-item ${selected}" data-inbox-action="select" data-id="${escapeAttr(item.id)}">
      <span class="conversation-avatar">${escapeHtml(channelMark(item.channel))}</span>
      <span class="conversation-copy">
        <span class="conversation-head"><strong>${escapeHtml(item.senderRef)}</strong><time>${escapeHtml(relativeTime(item.updatedAt))}</time></span>
        <span class="conversation-meta"><em class="inbox-status ${escapeAttr(item.status)}">${escapeHtml(item.status)}</em><small>${escapeHtml(item.channel)}${item.lastIntent ? ` · ${escapeHtml(item.lastIntent)}` : ''}</small></span>
        <span class="conversation-excerpt">${escapeHtml(item.lastExcerpt || 'No customer text stored')}</span>
      </span>
      ${unread ? `<b class="unread-badge">${Math.min(unread, 99)}</b>` : ''}
    </button>`;
  }).join('');
}

function conversationDetail() {
  const detail = inbox.detail;
  if (!detail) return '<div class="inbox-detail-empty"><span>▣</span><h2>Select a conversation</h2><p>Open a durable conversation to review its redacted message history and handoff state.</p></div>';
  const activeTicket = (detail.tickets || []).find((ticket) => ticket.status === 'open' || ticket.status === 'pending');
  return `
    <header class="conversation-detail-head">
      <div><p class="eyebrow">${escapeHtml(detail.channel)} · ${escapeHtml(detail.senderRef)}</p><h2>${escapeHtml(detail.lastIntent || 'Customer conversation')}</h2><p class="subtle">${escapeHtml(detail.lastSkill || 'No skill')} · ${escapeHtml(detail.responseSource || 'unknown response source')}</p></div>
      <div class="conversation-actions"><button class="secondary-button" data-inbox-action="archive">Archive</button><button class="danger-button" data-inbox-action="delete">Delete</button></div>
    </header>
    ${activeTicket ? ticketBanner(activeTicket) : ''}
    <div class="message-stream">${(detail.messages || []).map(messageBubble).join('') || '<p class="subtle">No stored message text.</p>'}</div>
    <footer class="conversation-foot"><span>Stored with retention policy · ${escapeHtml(detail.messages?.length || 0)} redacted messages</span><span>Updated ${escapeHtml(relativeTime(detail.updatedAt))}</span></footer>`;
}

function ticketBanner(ticket) {
  return `<section class="handoff-banner">
    <div><span class="handoff-icon">↗</span><div><strong>Human handoff · ${escapeHtml(ticket.priority)} priority</strong><p>${escapeHtml(ticket.summary || 'Customer requested human support.')}</p></div></div>
    <div class="handoff-actions">${ticket.status === 'open' ? `<button class="secondary-button" data-inbox-action="pending-ticket" data-ticket-id="${escapeAttr(ticket.id)}">Take / Pending</button>` : ''}<button class="primary-button" data-inbox-action="resolve-ticket" data-ticket-id="${escapeAttr(ticket.id)}">Resolve</button></div>
  </section>`;
}

function messageBubble(message) {
  const role = message.direction === 'outbound' ? 'assistant' : 'customer';
  return `<article class="message-row ${role}"><div class="message-bubble"><p>${escapeHtml(message.content || '')}</p><time>${escapeHtml(formatTime(message.createdAt))}</time></div></article>`;
}

function channelMark(channel) {
  return ({ telegram: '↗', facebook: 'f', zalo: 'Z', tiktok: '♪', web: '⌘' })[channel] || '•';
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function relativeTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function notify(message, error = false) {
  const root = $('#toast-root');
  if (!root) return;
  const item = document.createElement('div');
  item.className = `toast ${error ? 'error' : ''}`;
  item.textContent = message;
  root.append(item);
  setTimeout(() => item.remove(), 3200);
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function escapeAttr(value = '') {
  return escapeHtml(value);
}
