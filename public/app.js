const state = {
  view: 'home',
  bots: [],
  templates: [],
  deploymentData: null,
  selectedBotId: null,
  botTab: 'overview',
  wizard: null,
  simulation: null
};

const view = document.querySelector('#view');
const modalRoot = document.querySelector('#modal-root');
const pageTitle = document.querySelector('#page-title');
const pageEyebrow = document.querySelector('#page-eyebrow');
const health = document.querySelector('#health');

const channelMeta = {
  zalo: { label: 'Zalo', mark: 'Z' },
  facebook: { label: 'Facebook', mark: 'f' },
  telegram: { label: 'Telegram', mark: '↗' },
  tiktok: { label: 'TikTok', mark: '♪' },
  web: { label: 'Web Chat', mark: '⌘' }
};

const purposeMeta = {
  sales: ['Sales / Product', 'Giới thiệu, tư vấn sản phẩm, báo giá và tạo lead.'],
  'customer-care': ['Customer Care', 'FAQ, chăm sóc và chuyển nhân viên khi cần.'],
  support: ['Support', 'Tiếp nhận lỗi, hướng dẫn và escalation.'],
  custom: ['Custom', 'Tự mô tả mục tiêu và hành vi của bot.']
};

const modeMeta = {
  ai: ['✨', 'AI Autopilot', 'AI tự hiểu ngữ cảnh và trả lời từ knowledge.'],
  scenario: ['◇', 'Scenario', 'Chỉ chạy theo các rule/kịch bản đã xuất bản.'],
  hybrid: ['◐', 'Hybrid', 'Ưu tiên kịch bản, AI xử lý phần ngoài luồng.']
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || payload.error || `Request failed: ${response.status}`);
  return payload;
}

async function boot() {
  bindGlobalEvents();
  await Promise.all([refreshHealth(), loadBots(), loadTemplates(), loadDeployment()]);
  render();
}

async function refreshHealth() {
  try {
    const data = await api('/api/health');
    health.classList.toggle('ok', Boolean(data.ok));
    health.innerHTML = `<i></i>${data.ok ? 'Healthy' : 'Unavailable'}`;
  } catch {
    health.classList.remove('ok');
    health.innerHTML = '<i></i>Offline';
  }
}

async function loadBots() {
  const data = await api('/api/bots');
  state.bots = data.bots || [];
}

async function loadTemplates() {
  try {
    const data = await api('/api/scenario-templates');
    state.templates = data.templates || [];
  } catch {
    state.templates = [];
  }
}

async function loadDeployment() {
  try {
    state.deploymentData = await api('/api/deployment');
  } catch {
    state.deploymentData = null;
  }
}

function bindGlobalEvents() {
  document.querySelector('#new-bot').addEventListener('click', openWizard);

  document.body.addEventListener('click', async (event) => {
    const nav = event.target.closest('[data-nav]');
    if (nav) {
      state.view = nav.dataset.nav;
      state.selectedBotId = null;
      document.querySelectorAll('[data-nav]').forEach((item) => item.classList.toggle('active', item.dataset.nav === state.view));
      render();
      return;
    }

    const action = event.target.closest('[data-action]');
    if (!action) return;
    try {
      await handleAction(action.dataset.action, action);
    } catch (error) {
      toast(error.message || 'Có lỗi xảy ra', true);
    }
  });

  document.body.addEventListener('input', (event) => {
    if (!state.wizard) return;
    const field = event.target.dataset.wizardField;
    if (field) state.wizard[field] = event.target.value;
  });
}

async function handleAction(action, element) {
  if (action === 'new-bot') return openWizard();
  if (action === 'close-modal') return closeModal();
  if (action === 'wizard-purpose') {
    state.wizard.purpose = element.dataset.value;
    if (state.wizard.purpose === 'sales') state.wizard.scenarioTemplate = 'product-introduction';
    else if (state.wizard.purpose === 'support' || state.wizard.purpose === 'customer-care') state.wizard.scenarioTemplate = 'support';
    return renderWizard();
  }
  if (action === 'wizard-mode') {
    state.wizard.intelligenceMode = element.dataset.value;
    return renderWizard();
  }
  if (action === 'wizard-template') {
    state.wizard.scenarioTemplate = element.dataset.value;
    return renderWizard();
  }
  if (action === 'wizard-back') {
    state.wizard.step = Math.max(1, state.wizard.step - 1);
    state.wizard.qr = null;
    return renderWizard();
  }
  if (action === 'wizard-next') return wizardNext();
  if (action === 'wizard-connect') return connectChannel(element.dataset.channel);
  if (action === 'wizard-close-qr') {
    state.wizard.qr = null;
    return renderWizard();
  }
  if (action === 'wizard-go-live') return goLive();
  if (action === 'open-bot') {
    state.selectedBotId = element.dataset.botId;
    state.view = 'bot-detail';
    state.botTab = 'overview';
    state.simulation = null;
    return render();
  }
  if (action === 'bot-tab') {
    state.botTab = element.dataset.tab;
    return render();
  }
  if (action === 'back-bots') {
    state.view = 'bots';
    state.selectedBotId = null;
    return render();
  }
  if (action === 'simulate') return runSimulation();
  if (action === 'quick-connect') {
    openWizard();
    state.wizard.step = 2;
    state.wizard.bot = getSelectedBot();
    return renderWizard();
  }
  if (action === 'save-deployment') return saveDeployment();
  if (action === 'copy-deployment-env') return copyDeploymentEnv();
}

function render() {
  if (state.view === 'bot-detail') return renderBotDetail();
  if (state.view === 'home' || state.view === 'bots') return renderHome();
  if (state.view === 'settings') return renderSettings();

  const titles = {
    conversations: ['Inbox', 'Conversations'],
    customers: ['CRM', 'Customers'],
    automations: ['Workflow', 'Automations'],
    analytics: ['Insights', 'Analytics']
  };
  const [eyebrow, title] = titles[state.view] || ['Workspace', 'Bot Hub'];
  pageEyebrow.textContent = eyebrow;
  pageTitle.textContent = title;
  view.innerHTML = `<section class="placeholder"><h2>${escapeHtml(title)}</h2><p>Module đã có vị trí trong information architecture. Bot Hub core hiện ưu tiên Create → Connect → Teach → Go Live.</p></section>`;
}

function renderHome() {
  const running = state.bots.filter((bot) => bot.status === 'running').length;
  const channels = new Set(state.bots.flatMap((bot) => bot.channels.map((item) => item.channel))).size;
  const sources = state.bots.reduce((sum, bot) => sum + (bot.knowledgeSources?.length || 0), 0);
  pageEyebrow.textContent = state.view === 'bots' ? 'Workspace / Bots' : 'Workspace';
  pageTitle.textContent = state.view === 'bots' ? 'Bots' : greeting();

  view.innerHTML = `
    <section class="hero-grid">
      <article class="glass-card hero-copy">
        <p class="eyebrow">Bot Hub</p>
        <h2>Create. Connect. Teach. Go live.</h2>
        <p>Tạo nhiều bot độc lập cho bán hàng và chăm sóc khách hàng. Router9, webhook, AI routing, Product Scenario và n8n chạy phía sau.</p>
        <div class="hero-actions">
          <button class="primary-button" data-action="new-bot">＋ Create Bot</button>
          <button class="secondary-button" data-nav="settings">Deployment setup</button>
        </div>
      </article>
      <article class="glass-card metric-stack">
        <div class="metric"><strong>${state.bots.length}</strong><span>Total bots</span></div>
        <div class="metric"><strong>${running}</strong><span>Running</span></div>
        <div class="metric"><strong>${channels}</strong><span>Channels used</span></div>
        <div class="metric"><strong>${sources}</strong><span>Knowledge sources</span></div>
      </article>
    </section>

    <div class="section-head">
      <div><h2>${state.view === 'bots' ? 'All bots' : 'Your bots'}</h2><p>Mỗi bot có channels, intelligence, product knowledge và scenario riêng.</p></div>
      ${state.bots.length ? '<button class="secondary-button" data-action="new-bot">＋ New Bot</button>' : ''}
    </div>
    ${state.bots.length ? `<section class="bots-grid">${state.bots.map(botCard).join('')}</section>` : emptyBots()}
  `;
}

function renderSettings() {
  pageEyebrow.textContent = 'Workspace / Infrastructure';
  pageTitle.textContent = 'Deployment';
  const data = state.deploymentData;
  if (!data) {
    view.innerHTML = '<section class="placeholder"><h2>Deployment settings unavailable</h2><p>Không đọc được cấu hình deployment từ backend.</p></section>';
    return;
  }

  const d = data.deployment || {};
  const readiness = d.publicReady ? ['green', 'Public HTTPS active'] : d.draftReady ? ['orange', 'VPS draft ready'] : ['orange', 'Desktop / LAN'];
  view.innerHTML = `
    <div class="split">
      <section class="panel">
        <p class="eyebrow">Connection mode</p>
        <h2>${escapeHtml(readiness[1])}</h2>
        <p class="subtle">Desktop dùng LAN cho QR test. Zalo/Meta/TikTok production nên chạy Bot Hub trên VPS với domain HTTPS công khai.</p>
        <div class="list">
          <div class="list-row"><div><strong>Runtime Public URL</strong><small>Giá trị PUBLIC_BASE_URL đang active</small></div><span class="tag ${d.publicReady ? 'green' : 'orange'}">${escapeHtml(d.activePublicBaseUrl || 'Not active')}</span></div>
          <div class="list-row"><div><strong>QR mode</strong><small>Địa chỉ QR hiện tại sẽ dùng</small></div><span class="tag blue">${escapeHtml(d.qrMode || 'desktop-lan')}</span></div>
          <div class="list-row"><div><strong>Restart / deploy required</strong><small>Draft chỉ có hiệu lực sau khi đưa vào VPS .env</small></div><span class="tag ${d.requiresRestartOrDeploy ? 'orange' : 'green'}">${d.requiresRestartOrDeploy ? 'Yes' : 'No'}</span></div>
        </div>
      </section>

      <section class="panel">
        <p class="eyebrow">VPS target</p>
        <h2>Docker + Caddy</h2>
        <div class="field"><label>Mode</label><select class="select" id="deploy-mode"><option value="desktop-lan" ${d.mode === 'desktop-lan' ? 'selected' : ''}>Desktop / LAN</option><option value="vps-docker" ${d.mode === 'vps-docker' ? 'selected' : ''}>Docker VPS / HTTPS</option></select></div>
        <div class="field"><label>VPS host / IP</label><input class="input" id="deploy-vps-host" value="${escapeAttr(d.vpsHost || '')}" placeholder="203.0.113.10"></div>
        <div class="choice-grid">
          <div class="field"><label>SSH user</label><input class="input" id="deploy-ssh-user" value="${escapeAttr(d.sshUser || 'root')}"></div>
          <div class="field"><label>SSH port</label><input class="input" id="deploy-ssh-port" type="number" min="1" max="65535" value="${Number(d.sshPort || 22)}"></div>
        </div>
      </section>
    </div>

    <section class="panel" style="margin-top:18px">
      <p class="eyebrow">Public endpoints</p>
      <h2>Domains & callback</h2>
      <div class="choice-grid">
        <div class="field"><label>Bot domain</label><input class="input" id="deploy-bot-domain" value="${escapeAttr(d.botDomain || '')}" placeholder="bot.example.com"></div>
        <div class="field"><label>n8n domain</label><input class="input" id="deploy-n8n-domain" value="${escapeAttr(d.n8nDomain || '')}" placeholder="n8n.example.com"></div>
      </div>
      <div class="field"><label>Public Base URL</label><input class="input" id="deploy-public-url" value="${escapeAttr(d.publicBaseUrl || '')}" placeholder="https://bot.example.com"><small>Đây là draft trong app. VPS runtime chỉ được coi là active khi PUBLIC_BASE_URL được áp dụng vào .env và server khởi động lại.</small></div>
      <div class="hero-actions"><button class="primary-button" data-action="save-deployment">Save deployment draft</button><button class="secondary-button" data-action="copy-deployment-env">Copy .env template</button></div>
    </section>

    <section class="panel" style="margin-top:18px">
      <p class="eyebrow">One-time VPS bootstrap</p>
      <h2>Deploy commands</h2>
      <div class="code-box">${escapeHtml(Object.values(data.commands || {}).join('\n'))}</div>
      <p class="connect-note">${escapeHtml(data.note || '')}</p>
      <p class="connect-note">Không lưu SSH password/API secrets ở màn này. Provider token chỉ đặt trong file <strong>.env</strong> trên VPS hoặc secret manager.</p>
    </section>`;
}

async function saveDeployment() {
  const payload = {
    mode: document.querySelector('#deploy-mode')?.value,
    vpsHost: document.querySelector('#deploy-vps-host')?.value,
    sshUser: document.querySelector('#deploy-ssh-user')?.value,
    sshPort: Number(document.querySelector('#deploy-ssh-port')?.value || 22),
    botDomain: document.querySelector('#deploy-bot-domain')?.value,
    n8nDomain: document.querySelector('#deploy-n8n-domain')?.value,
    publicBaseUrl: document.querySelector('#deploy-public-url')?.value
  };
  state.deploymentData = await api('/api/deployment', { method: 'PATCH', body: JSON.stringify(payload) });
  renderSettings();
  toast('Deployment draft saved');
}

async function copyDeploymentEnv() {
  const value = state.deploymentData?.dockerEnv || '';
  if (!value) throw new Error('No deployment template available');
  if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
  else fallbackCopy(value);
  toast('.env template copied');
}

function fallbackCopy(value) {
  const area = document.createElement('textarea');
  area.value = value;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  document.execCommand('copy');
  area.remove();
}

function botCard(bot) {
  const channelHtml = bot.channels.length
    ? bot.channels.slice(0, 4).map((item) => `<span class="channel-chip ${item.status === 'connected' ? 'connected' : ''}">${escapeHtml(channelMeta[item.channel]?.label || item.channel)}</span>`).join('')
    : '<span class="channel-chip">No channel yet</span>';
  return `
    <article class="bot-card" data-action="open-bot" data-bot-id="${escapeHtml(bot.id)}" tabindex="0">
      <div class="bot-top"><div class="bot-icon">⌁</div><span class="status-dot ${escapeHtml(bot.status)}"><i></i>${escapeHtml(capitalize(bot.status))}</span></div>
      <h3>${escapeHtml(bot.name)}</h3>
      <p class="purpose">${escapeHtml(purposeMeta[bot.purpose]?.[0] || bot.purpose)} · ${escapeHtml(modeMeta[bot.intelligenceMode]?.[1] || bot.intelligenceMode)}</p>
      <div class="channel-row">${channelHtml}</div>
      <div class="bot-stats"><div><strong>${bot.knowledgeSources?.length || 0}</strong><span>Knowledge</span></div><div><strong>${bot.scenario?.rules?.length || 0}</strong><span>Scenario rules</span></div></div>
    </article>`;
}

function emptyBots() {
  return `<section class="empty-state"><div class="empty-icon">⌁</div><h3>Create your first bot</h3><p>Đặt tên → kết nối kênh → nạp Product/Knowledge → chọn Scenario/AI → bật chạy.</p><button class="primary-button" data-action="new-bot">＋ Create Bot</button></section>`;
}

function openWizard() {
  state.wizard = {
    step: 1,
    name: '',
    description: '',
    purpose: 'customer-care',
    intelligenceMode: 'hybrid',
    scenarioTemplate: 'support',
    knowledge: '',
    productName: '',
    productSummary: '',
    productBenefits: '',
    productPrice: '',
    productCta: '',
    bot: null,
    qr: null
  };
  renderWizard();
}

function closeModal() {
  state.wizard = null;
  modalRoot.innerHTML = '';
}

function renderWizard() {
  if (!state.wizard) return closeModal();
  const w = state.wizard;
  modalRoot.innerHTML = `
    <div class="modal-backdrop">
      <section class="modal" role="dialog" aria-modal="true" aria-label="Create bot">
        <header class="modal-head"><div><p class="eyebrow">New Bot</p><h2>${wizardTitle(w.step)}</h2><p>${wizardSubtitle(w.step)}</p></div><button class="icon-button" data-action="close-modal" aria-label="Close">×</button></header>
        <div class="steps">${[1,2,3,4].map((step) => `<i class="step ${step < w.step ? 'done' : step === w.step ? 'active' : ''}"></i>`).join('')}</div>
        <div class="wizard-body">${wizardBody(w)}</div>
        <footer class="wizard-footer"><button class="ghost-button" data-action="wizard-back" ${w.step === 1 ? 'disabled' : ''}>Back</button>${w.step < 4 ? `<button class="primary-button" data-action="wizard-next">${w.step === 1 ? 'Create & continue' : 'Continue'}</button>` : `<button class="primary-button" data-action="wizard-go-live">Go Live</button>`}</footer>
      </section>
    </div>`;
}

function wizardTitle(step) {
  return ['', 'Create your bot', 'Connect customers', 'Teach your bot', 'Ready to go live'][step];
}

function wizardSubtitle(step) {
  return ['', 'Đặt mục tiêu trước, phần kỹ thuật để hệ thống xử lý.', 'Chọn channel. Desktop test bằng LAN; production OAuth/webhook dùng VPS HTTPS.', 'Nạp Product Knowledge và chọn AI / Scenario / Hybrid.', 'Kiểm tra nhanh trước khi bật bot.'][step];
}

function wizardBody(w) {
  if (w.step === 1) return `
    <div class="field"><label>Bot name</label><input class="input" data-wizard-field="name" value="${escapeAttr(w.name)}" placeholder="Kingmart Product Bot" maxlength="80"></div>
    <div class="field"><label>What should this bot do?</label><div class="choice-grid">${Object.entries(purposeMeta).map(([id,[name,desc]]) => `<button class="choice-card ${w.purpose === id ? 'selected' : ''}" data-action="wizard-purpose" data-value="${id}"><strong>${escapeHtml(name)}</strong><span>${escapeHtml(desc)}</span></button>`).join('')}</div></div>
    <div class="field"><label>Description <span class="subtle">optional</span></label><textarea class="textarea" data-wizard-field="description" placeholder="Mục tiêu và phạm vi của bot...">${escapeHtml(w.description)}</textarea></div>`;

  if (w.step === 2) {
    const bot = w.bot;
    return `
      <div class="choice-grid">${Object.entries(channelMeta).map(([id,meta]) => {
        const connection = bot?.channels?.find((item) => item.channel === id);
        return `<button class="channel-choice ${connection ? 'selected' : ''} ${connection?.status === 'connected' ? 'connected' : ''}" data-action="wizard-connect" data-channel="${id}"><span class="connect-state">${escapeHtml(connection?.status?.replaceAll('_',' ') || 'Connect')}</span><span class="channel-logo">${escapeHtml(meta.mark)}</span><strong>${escapeHtml(meta.label)}</strong><span>${id === 'web' ? 'Tạo Web Chat ngay.' : 'QR handoff → authorization.'}</span></button>`;
      }).join('')}</div>
      ${w.qr ? qrPanel(w.qr) : `<p class="connect-note" style="margin-top:18px">Desktop QR dùng IP LAN để điện thoại cùng Wi‑Fi truy cập. Zalo/Facebook/TikTok production cần Bot Hub trên VPS HTTPS + OAuth/token exchange chính thức.</p>`}`;
  }

  if (w.step === 3) {
    const showProduct = w.purpose === 'sales' || String(w.scenarioTemplate).startsWith('product');
    return `
      <div class="field"><label>How should your bot work?</label><div class="mode-grid">${Object.entries(modeMeta).map(([id,[icon,name,desc]]) => `<button class="mode-card ${w.intelligenceMode === id ? 'selected' : ''}" data-action="wizard-mode" data-value="${id}"><div class="mode-icon">${icon}</div><strong>${name}</strong><span>${desc}</span>${id === 'hybrid' ? '<em class="recommended">RECOMMENDED</em>' : ''}</button>`).join('')}</div></div>
      <div class="field"><label>Scenario template</label><div class="choice-grid">${state.templates.map(templateCard).join('') || '<span class="subtle">No templates loaded</span>'}</div></div>
      ${showProduct ? productSetup(w) : ''}
      <div class="field"><label>Additional Knowledge / FAQ / Policy</label><textarea class="textarea" data-wizard-field="knowledge" placeholder="Ví dụ: Chính sách bảo hành, giao hàng, điều kiện đổi trả...">${escapeHtml(w.knowledge)}</textarea><small>Nội dung được lưu riêng theo bot. AI không được tự bịa giá, khuyến mại hoặc chính sách thiếu nguồn.</small></div>`;
  }

  const bot = w.bot || {};
  return `<div class="summary-card">
    <div class="summary-row"><span>Bot</span><strong>${escapeHtml(bot.name || w.name)}</strong></div>
    <div class="summary-row"><span>Purpose</span><strong>${escapeHtml(purposeMeta[bot.purpose || w.purpose]?.[0] || '')}</strong></div>
    <div class="summary-row"><span>Channels</span><strong>${bot.channels?.length || 0}</strong></div>
    <div class="summary-row"><span>Intelligence</span><strong>${escapeHtml(modeMeta[bot.intelligenceMode || w.intelligenceMode]?.[1] || '')}</strong></div>
    <div class="summary-row"><span>Knowledge</span><strong>${bot.knowledgeSources?.length || 0} sources</strong></div>
    <div class="summary-row"><span>Scenario</span><strong>${escapeHtml(bot.scenario?.template || w.scenarioTemplate || 'none')} · ${bot.scenario?.rules?.length || 0} rules</strong></div>
  </div><p class="connect-note" style="margin-top:18px">Go Live bật bot. Channel OAuth pending vẫn phải hoàn tất token exchange trước khi outbound production được phép.</p>`;
}

function templateCard(template) {
  return `<button class="template-card ${state.wizard?.scenarioTemplate === template.id ? 'selected' : ''}" data-action="wizard-template" data-value="${escapeAttr(template.id)}"><span class="tag blue">${escapeHtml(template.category || 'General')}</span><strong style="margin-top:10px">${escapeHtml(template.name)}</strong><span>${escapeHtml(template.description || '')}</span><small style="display:block;margin-top:8px;color:#86868b">${template.rules.length} ready rules</small></button>`;
}

function productSetup(w) {
  return `<section class="panel" style="margin:18px 0;background:rgba(248,248,250,.72)">
    <p class="eyebrow">Product quick setup</p><h3>Giới thiệu sản phẩm</h3><p class="subtle">Nhập dữ liệu thật của sản phẩm. Bot sẽ dùng nó làm Product Knowledge cho kịch bản giới thiệu/tư vấn.</p>
    <div class="choice-grid"><div class="field"><label>Product name</label><input class="input" data-wizard-field="productName" value="${escapeAttr(w.productName)}" placeholder="Kingmart A1"></div><div class="field"><label>Current price</label><input class="input" data-wizard-field="productPrice" value="${escapeAttr(w.productPrice)}" placeholder="8.990.000đ"></div></div>
    <div class="field"><label>Short introduction</label><textarea class="textarea" data-wizard-field="productSummary" placeholder="Sản phẩm là gì, giải quyết nhu cầu nào...">${escapeHtml(w.productSummary)}</textarea></div>
    <div class="field"><label>Highlights / benefits</label><textarea class="textarea" data-wizard-field="productBenefits" placeholder="Điểm nổi bật, lợi ích, đối tượng phù hợp...">${escapeHtml(w.productBenefits)}</textarea></div>
    <div class="field"><label>CTA</label><input class="input" data-wizard-field="productCta" value="${escapeAttr(w.productCta)}" placeholder="Để lại SĐT để tư vấn viên liên hệ"></div>
  </section>`;
}

function qrPanel(qr) {
  const publicHttps = String(qr.url || '').startsWith('https://');
  return `<div class="qr-layout"><div class="qr-box">${qr.svg || '<span>QR unavailable</span>'}</div><div><p class="eyebrow">Scan on phone</p><h3>Connect ${escapeHtml(channelMeta[qr.channel]?.label || qr.channel)}</h3><p class="subtle">${publicHttps ? 'Public HTTPS handoff.' : 'LAN handoff: điện thoại và máy Windows cần cùng mạng Wi‑Fi/LAN.'} QR không chứa access token.</p><div class="connection-url">${escapeHtml(qr.url)}</div><div style="display:flex;gap:8px;margin-top:14px"><a class="primary-button" href="${escapeAttr(qr.url)}" target="_blank" rel="noreferrer" style="text-decoration:none">Open link</a><button class="secondary-button" data-action="wizard-close-qr">Done</button></div></div></div>`;
}

async function wizardNext() {
  const w = state.wizard;
  if (w.step === 1) {
    if (!w.name.trim()) return toast('Nhập tên bot trước khi tiếp tục', true);
    const data = await api('/api/bots', { method: 'POST', body: JSON.stringify({ name: w.name, description: w.description, purpose: w.purpose, intelligenceMode: w.intelligenceMode }) });
    w.bot = data.bot;
    await loadBots();
    w.step = 2;
    return renderWizard();
  }
  if (w.step === 2) {
    w.step = 3;
    w.qr = null;
    return renderWizard();
  }
  if (w.step === 3) {
    let updated = (await api(`/api/bots/${encodeURIComponent(w.bot.id)}`, { method: 'PATCH', body: JSON.stringify({ intelligenceMode: w.intelligenceMode }) })).bot;
    if (w.scenarioTemplate) updated = (await api(`/api/bots/${encodeURIComponent(w.bot.id)}/scenario`, { method: 'PUT', body: JSON.stringify({ template: w.scenarioTemplate }) })).bot;

    const productKnowledge = buildProductKnowledge(w);
    if (productKnowledge) {
      updated = (await api(`/api/bots/${encodeURIComponent(w.bot.id)}/knowledge`, { method: 'POST', body: JSON.stringify({ type: 'text', name: `Product · ${w.productName || 'Catalog'}`, value: productKnowledge }) })).bot;
    }
    if (w.knowledge.trim()) {
      updated = (await api(`/api/bots/${encodeURIComponent(w.bot.id)}/knowledge`, { method: 'POST', body: JSON.stringify({ type: 'text', name: 'Business knowledge', value: w.knowledge }) })).bot;
    }

    w.bot = updated;
    await loadBots();
    w.step = 4;
    return renderWizard();
  }
}

function buildProductKnowledge(w) {
  if (![w.productName, w.productSummary, w.productBenefits, w.productPrice, w.productCta].some((value) => String(value || '').trim())) return '';
  return [
    `PRODUCT: ${w.productName || 'Unnamed product'}`,
    `INTRODUCTION: ${w.productSummary || 'Not provided'}`,
    `HIGHLIGHTS_AND_BENEFITS: ${w.productBenefits || 'Not provided'}`,
    `CURRENT_PRICE: ${w.productPrice || 'Not provided'}`,
    `CTA: ${w.productCta || 'Offer human sales assistance when the customer is interested.'}`,
    '',
    'RULES:',
    '- Never invent price, promotion, stock, warranty or product specifications.',
    '- If a requested fact is missing, say the business data does not contain it yet.',
    '- Explain benefits in relation to the customer need instead of only listing specifications.'
  ].join('\n');
}

async function connectChannel(channel) {
  const w = state.wizard;
  if (!w.bot) throw new Error('Create the bot first');
  const data = await api('/api/connect/sessions', { method: 'POST', body: JSON.stringify({ botId: w.bot.id, channel }) });
  if (data.instant) {
    w.bot = data.bot;
    await loadBots();
    toast('Web Chat connected');
    return renderWizard();
  }
  w.qr = { channel, svg: data.qrSvg, url: data.session.connectionUrl, token: data.session.token };
  w.bot = await fetchBot(w.bot.id);
  await loadBots();
  renderWizard();
}

async function goLive() {
  const w = state.wizard;
  const data = await api(`/api/bots/${encodeURIComponent(w.bot.id)}/go-live`, { method: 'POST', body: '{}' });
  w.bot = data.bot;
  await loadBots();
  closeModal();
  state.view = 'bots';
  render();
  toast(`${data.bot.name} is live`);
}

async function fetchBot(id) {
  return (await api(`/api/bots/${encodeURIComponent(id)}`)).bot;
}

function getSelectedBot() {
  return state.bots.find((bot) => bot.id === state.selectedBotId) || null;
}

function renderBotDetail() {
  const bot = getSelectedBot();
  if (!bot) {
    state.view = 'bots';
    return renderHome();
  }
  pageEyebrow.textContent = 'Bots / Detail';
  pageTitle.textContent = bot.name;
  const tabs = ['overview','conversations','knowledge','automation','settings'];
  view.innerHTML = `<div class="bot-detail-head"><div class="bot-detail-title"><button class="icon-button" data-action="back-bots">‹</button><div><h2>${escapeHtml(bot.name)}</h2><p class="subtle">${escapeHtml(purposeMeta[bot.purpose]?.[0] || bot.purpose)} · ${escapeHtml(modeMeta[bot.intelligenceMode]?.[1] || bot.intelligenceMode)}</p></div></div><button class="primary-button" data-action="quick-connect">＋ Connect</button></div><div class="tabs">${tabs.map((tab) => `<button class="tab ${state.botTab === tab ? 'active' : ''}" data-action="bot-tab" data-tab="${tab}">${capitalize(tab)}</button>`).join('')}</div>${botTabContent(bot)}`;
}

function botTabContent(bot) {
  if (state.botTab === 'overview') return `
    <div class="split"><section class="panel"><p class="eyebrow">Status</p><h2>${capitalize(bot.status)}</h2><p class="subtle">${escapeHtml(bot.description || 'No description yet.')}</p><div class="list"><div class="list-row"><div><strong>Intelligence</strong><small>AI / scenario routing strategy</small></div><span class="tag blue">${escapeHtml(modeMeta[bot.intelligenceMode]?.[1] || bot.intelligenceMode)}</span></div><div class="list-row"><div><strong>Knowledge</strong><small>Bot-specific product/business sources</small></div><span class="tag">${bot.knowledgeSources?.length || 0} sources</span></div><div class="list-row"><div><strong>Scenario</strong><small>${escapeHtml(bot.scenario?.template || 'Custom')}</small></div><span class="tag">${bot.scenario?.rules?.length || 0} rules</span></div></div></section><section class="panel"><p class="eyebrow">Channels</p><h2>${bot.channels.length || 0} connected/setup</h2><div class="list">${bot.channels.length ? bot.channels.map(channelListRow).join('') : '<p class="subtle">No channels yet.</p>'}</div></section></div>
    <section class="panel" style="margin-top:18px"><p class="eyebrow">Test before production</p><h2>Router9 Simulator</h2><div class="simulator"><div class="sim-row"><select class="select" id="sim-channel">${Object.keys(channelMeta).filter((x)=>x!=='web').map((id)=>`<option value="${id}">${channelMeta[id].label}</option>`).join('')}</select><input class="input" id="sim-message" value="Giới thiệu sản phẩm này cho tôi"><button class="primary-button" data-action="simulate">Run</button></div>${simulationHtml()}</div></section>`;
  if (state.botTab === 'knowledge') return `<section class="panel"><p class="eyebrow">Knowledge</p><h2>${bot.knowledgeSources?.length || 0} sources</h2><div class="list">${bot.knowledgeSources?.length ? bot.knowledgeSources.map((source) => `<div class="list-row"><div><strong>${escapeHtml(source.name)}</strong><small>${escapeHtml(source.type)} · ${escapeHtml(String(source.value).slice(0,130))}</small></div><span class="tag green">${escapeHtml(source.status)}</span></div>`).join('') : '<p class="subtle">No product/business knowledge yet.</p>'}</div></section>`;
  if (state.botTab === 'settings') return `<section class="panel"><p class="eyebrow">Settings</p><h2>Bot profile</h2><div class="list"><div class="list-row"><div><strong>Purpose</strong><small>Primary business goal</small></div><span class="tag">${escapeHtml(bot.purpose)}</span></div><div class="list-row"><div><strong>Scenario</strong><small>Published deterministic template</small></div><span class="tag blue">${escapeHtml(bot.scenario?.template || 'custom')}</span></div><div class="list-row"><div><strong>Human handoff threshold</strong><small>Confidence lower than this should leave autopilot</small></div><span class="tag">${Math.round((bot.ai?.handoffConfidenceBelow || .7)*100)}%</span></div></div></section>`;
  return `<section class="placeholder"><h2>${capitalize(state.botTab)}</h2><p>Module này sẽ dùng chung botId/workspaceId.</p></section>`;
}

function channelListRow(item) {
  const statusClass = item.status === 'connected' ? 'green' : item.status.includes('authorization') ? 'blue' : 'orange';
  return `<div class="list-row"><div><strong>${escapeHtml(channelMeta[item.channel]?.label || item.channel)}</strong><small>${item.connectionId ? `Connection ${escapeHtml(String(item.connectionId).slice(0,12))}…` : 'Not connected'}</small></div><span class="tag ${statusClass}">${escapeHtml(item.status.replaceAll('_',' '))}</span></div>`;
}

async function runSimulation() {
  const bot = getSelectedBot();
  const channel = document.querySelector('#sim-channel').value;
  const textValue = document.querySelector('#sim-message').value;
  state.simulation = await api(`/api/bots/${encodeURIComponent(bot.id)}/simulate`, { method: 'POST', body: JSON.stringify({ channel, text: textValue }) });
  renderBotDetail();
}

function simulationHtml() {
  if (!state.simulation) return '<p class="subtle">Run a message to inspect all nine stages without sending outbound.</p>';
  const result = state.simulation;
  return `<div class="trace">${(result.trace || []).map((item) => `<div class="trace-row"><span class="trace-num">${item.stage}</span><div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(traceDetail(item))}</small></div><span class="tag ${item.ok ? 'green' : 'orange'}">${item.ok ? 'OK' : 'STOP'}</span></div>`).join('')}</div><div class="code-box">${escapeHtml(result.reply || 'No reply generated')}</div>`;
}

function traceDetail(item) {
  if (item.intent) return `${item.intent} · ${item.skill || ''}`;
  if (item.provider) return `${item.provider}${item.handoff ? ' · handoff' : ''}`;
  if (item.matches != null) return `${item.matches} repository matches · ${item.botSources || 0} bot sources`;
  if (item.duplicate != null) return item.duplicate ? 'Duplicate' : 'New event';
  if (item.action) return item.action;
  if (item.reason) return item.reason;
  return item.botId ? `bot ${item.botId.slice(0,12)}…` : 'passed';
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning.';
  if (hour < 18) return 'Good afternoon.';
  return 'Good evening.';
}

function toast(message, error = false) {
  const root = document.querySelector('#toast-root');
  const item = document.createElement('div');
  item.className = `toast ${error ? 'error' : ''}`;
  item.textContent = message;
  root.append(item);
  setTimeout(() => item.remove(), 3200);
}

function capitalize(value = '') {
  return value ? value[0].toUpperCase() + value.slice(1).replaceAll('-', ' ') : '';
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[char]));
}

function escapeAttr(value = '') {
  return escapeHtml(value);
}

boot().catch((error) => {
  view.innerHTML = `<section class="placeholder"><h2>Bot Hub could not start</h2><p>${escapeHtml(error.message || 'Unknown error')}</p></section>`;
});
