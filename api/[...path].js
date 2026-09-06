import { randomBytes } from 'node:crypto';
import { qrSvg } from '../src/lib/qr.js';
import { listScenarioTemplates, scenarioFromTemplate } from '../src/core/scenario.js';

const ALLOWED_PREFIXES = [
  'health', 'bots', 'channels', 'metrics', 'scenario-templates', 'deployment',
  'skills', 'tool-policy', 'traces', 'connect', 'knowledge', 'simulate',
  'conversations', 'tickets', 'maintenance', 'operations', 'webhooks'
];

export default async function handler(request, response) {
  const segments = pathSegments(request);
  const first = segments[0] || '';
  if (!ALLOWED_PREFIXES.includes(first)) return sendJson(response, 404, { error: 'not_found' });

  const runtimeBase = normalizeRuntimeBase(process.env.BOT_RUNTIME_URL || '');
  if (runtimeBase) {
    try {
      return await proxyToRuntime({ request, response, runtimeBase, segments });
    } catch {
      if (String(process.env.BOT_RUNTIME_STRICT || '').toLowerCase() === 'true') {
        return sendJson(response, 502, {
          error: 'runtime_unreachable',
          message: 'The hosted console could not reach BOT_RUNTIME_URL. Set BOT_RUNTIME_STRICT=false to use the Vercel preview fallback.'
        });
      }
      response.setHeader?.('x-bot-hub-runtime-fallback', 'vercel-preview');
    }
  }

  return previewHandler({ request, response, segments, reason: runtimeBase ? 'runtime_unreachable' : 'runtime_not_configured' });
}

async function proxyToRuntime({ request, response, runtimeBase, segments }) {
  const relative = segments.map((segment) => encodeURIComponent(decodeURIComponent(segment))).join('/');
  const targetPath = segments[0] === 'webhooks' || (segments[0] === 'connect' && segments[1] !== 'sessions')
    ? `/${relative}`
    : `/api/${relative}`;
  const target = new URL(targetPath, runtimeBase);
  for (const [key, value] of Object.entries(request.query || {})) {
    if (key === 'path') continue;
    if (Array.isArray(value)) value.forEach((item) => target.searchParams.append(key, item));
    else if (value != null) target.searchParams.set(key, String(value));
  }

  const headers = {
    accept: request.headers.accept || 'application/json',
    'content-type': request.headers['content-type'] || 'application/json',
    'x-forwarded-host': request.headers.host || '',
    'x-bot-hub-console': 'vercel'
  };
  const token = process.env.BOT_RUNTIME_ADMIN_TOKEN || '';
  const user = process.env.BOT_RUNTIME_ADMIN_USER || 'admin';
  if (token && segments[0] !== 'webhooks' && segments[0] !== 'connect') {
    headers.authorization = `Basic ${Buffer.from(`${user}:${token}`).toString('base64')}`;
  }

  const method = request.method || 'GET';
  const init = { method, headers, redirect: 'manual', signal: AbortSignal.timeout(25_000) };
  if (!['GET', 'HEAD'].includes(method)) init.body = serializeBody(request.body, headers['content-type']);

  const upstream = await fetch(target, init);
  const body = Buffer.from(await upstream.arrayBuffer());
  response.status(upstream.status);
  const contentType = upstream.headers.get('content-type');
  if (contentType) response.setHeader('content-type', contentType);
  response.setHeader('cache-control', 'no-store');
  return response.send(body);
}

async function previewHandler({ request, response, segments, reason }) {
  const store = previewStore();
  const method = request.method || 'GET';
  const first = segments[0] || '';

  if (method === 'GET' && first === 'health') {
    return sendJson(response, 200, {
      ok: true,
      service: 'customer-service-bot',
      product: 'Bot Hub',
      mode: 'vercel-preview',
      warning: reason,
      uptimeSeconds: Math.floor((Date.now() - store.startedAt) / 1000),
      now: new Date().toISOString()
    });
  }

  if (method === 'GET' && first === 'channels') {
    return sendJson(response, 200, {
      channels: ['telegram', 'facebook', 'zalo', 'tiktok'].map((channel) => ({ channel, configured: false, mode: 'preview' })),
      connectMethods: { zalo: 'qr-oauth', facebook: 'qr-oauth', telegram: 'qr-handoff', tiktok: 'qr-oauth', web: 'instant' }
    });
  }
  if (method === 'GET' && first === 'metrics') return sendJson(response, 200, { accepted: 0, duplicates: 0, rejected: 0, preview: true });
  if (method === 'GET' && first === 'scenario-templates') return sendJson(response, 200, { templates: listScenarioTemplates() });
  if (method === 'GET' && first === 'deployment') return sendJson(response, 200, previewDeploymentPayload(request, reason));
  if (method === 'GET' && first === 'skills') return sendJson(response, 200, { skills: [] });
  if (method === 'GET' && first === 'tool-policy') return sendJson(response, 200, { profiles: [] });
  if (method === 'GET' && first === 'traces') return sendJson(response, 200, { traces: [] });
  if (method === 'GET' && first === 'conversations') return sendJson(response, 200, { conversations: [] });
  if (method === 'GET' && first === 'tickets') return sendJson(response, 200, { tickets: [] });
  if (method === 'GET' && first === 'operations') return sendJson(response, 200, { doctor: { status: 'preview', checks: [] } });
  if (first === 'webhooks') return sendJson(response, 200, { ok: true, preview: true, message: 'Webhook proxy preview accepted the request. Configure BOT_RUNTIME_URL for live dispatch.' });

  if (first === 'bots') return botPreviewApi({ request, response, segments, store });
  if (first === 'connect') return connectPreviewApi({ request, response, segments, store });
  if (method === 'POST' && first === 'simulate') return sendJson(response, 200, previewSimulation(await requestBody(request)));
  if (method === 'POST' && first === 'knowledge') return sendJson(response, 200, { query: '', results: [], preview: true });

  return sendJson(response, 404, { error: 'not_found' });
}

async function botPreviewApi({ request, response, segments, store }) {
  const method = request.method || 'GET';
  if (segments.length === 1 && method === 'GET') return sendJson(response, 200, { bots: store.bots });
  if (segments.length === 1 && method === 'POST') {
    const payload = await requestBody(request);
    const now = new Date().toISOString();
    const id = `bot_preview_${randomBytes(6).toString('hex')}`;
    const bot = {
      id,
      workspaceId: 'workspace_vercel_preview',
      name: clean(payload.name || 'Preview Bot', 80),
      purpose: payload.purpose || 'customer-care',
      intelligenceMode: payload.intelligenceMode || 'hybrid',
      status: 'draft',
      description: clean(payload.description || '', 500),
      channels: [],
      knowledgeSources: [],
      scenario: scenarioFromTemplate(payload.scenarioTemplate || 'support') || { template: 'custom', rules: [], notes: '' },
      ai: { enabled: true, modelMode: 'preview', personality: '', handoffConfidenceBelow: 0.45 },
      metrics: { conversations: 0, handoffs: 0 },
      createdAt: now,
      updatedAt: now,
      preview: true
    };
    store.bots.push(bot);
    return sendJson(response, 201, { bot });
  }

  const botId = segments[1];
  const bot = store.bots.find((item) => item.id === botId);
  if (!bot) return sendJson(response, 404, { error: 'bot_not_found', message: 'Preview bot not found' });
  if (segments.length === 2 && method === 'GET') return sendJson(response, 200, { bot });
  if (segments.length === 2 && method === 'PATCH') {
    Object.assign(bot, await requestBody(request), { updatedAt: new Date().toISOString() });
    return sendJson(response, 200, { bot });
  }
  if (segments[2] === 'knowledge' && method === 'POST') {
    const payload = await requestBody(request);
    bot.knowledgeSources.push({ id: `ks_${randomBytes(4).toString('hex')}`, type: payload.type || 'text', title: payload.title || 'Preview knowledge', value: clean(payload.value || payload.content || '', 8000), createdAt: new Date().toISOString() });
    bot.updatedAt = new Date().toISOString();
    return sendJson(response, 201, { bot });
  }
  if (segments[2] === 'scenario' && method === 'PUT') {
    const payload = await requestBody(request);
    bot.scenario = scenarioFromTemplate(payload.template) || payload;
    bot.updatedAt = new Date().toISOString();
    return sendJson(response, 200, { bot });
  }
  if (segments[2] === 'go-live' && method === 'POST') {
    bot.status = 'running';
    bot.updatedAt = new Date().toISOString();
    return sendJson(response, 200, { bot });
  }
  if (segments[2] === 'simulate' && method === 'POST') return sendJson(response, 200, previewSimulation(await requestBody(request), bot));
  return sendJson(response, 404, { error: 'not_found' });
}

async function connectPreviewApi({ request, response, segments, store }) {
  const method = request.method || 'GET';
  if (segments[1] === 'sessions' && segments.length === 2 && method === 'POST') {
    const payload = await requestBody(request);
    const bot = store.bots.find((item) => item.id === payload.botId);
    if (!bot) return sendJson(response, 404, { error: 'bot_not_found' });
    const channel = clean(payload.channel || '', 32);
    if (!['zalo', 'facebook', 'telegram', 'tiktok', 'web'].includes(channel)) return sendJson(response, 400, { error: 'unsupported_channel' });
    if (channel === 'web') {
      upsertChannel(bot, channel, { status: 'connected', connectionId: 'web-preview', connectedAt: new Date().toISOString() });
      return sendJson(response, 201, { instant: true, bot });
    }
    const token = randomBytes(10).toString('base64url');
    const origin = publicOrigin(request);
    const session = { token, botId: bot.id, channel, status: 'pending', createdAt: Date.now(), expiresAt: Date.now() + 600_000, connectionUrl: `${origin}/connect/${token}`, preview: true };
    store.sessions[token] = session;
    upsertChannel(bot, channel, { status: 'pending', connectionId: token });
    let svg = null;
    try { svg = qrSvg(session.connectionUrl); } catch { svg = null; }
    return sendJson(response, 201, { session, qrSvg: svg });
  }

  if (segments[1] === 'sessions' && segments[2] && method === 'GET') {
    const session = store.sessions[segments[2]];
    if (!session) return sendJson(response, 404, { error: 'connect_session_not_found' });
    return sendJson(response, 200, { session });
  }

  const token = segments[1];
  const session = store.sessions[token];
  if (!session) return sendHtml(response, 404, connectShell('<div class="mark">!</div><p class="eyebrow">Bot Hub</p><h1>QR expired</h1><p class="muted">Create a new connection QR from the dashboard.</p>'));
  const bot = store.bots.find((item) => item.id === session.botId);
  if (segments[2] === 'confirm' && method === 'POST') {
    session.status = 'setup_reviewed';
    session.providerState = 'manual_confirmation';
    if (bot) upsertChannel(bot, session.channel, { status: 'setup_reviewed', connectionId: token, reviewedAt: new Date().toISOString() });
    return sendHtml(response, 200, connectShell(successContent(session.channel)));
  }
  if (method === 'GET' && segments.length === 2) {
    session.status = 'authorizing';
    return sendHtml(response, 200, connectShell(connectContent({ session, bot, origin: publicOrigin(request), preview: true })));
  }
  if (segments[1] === 'callback' && method === 'GET') return sendHtml(response, 200, connectShell(successContent(segments[2] || 'provider')));
  return sendJson(response, 404, { error: 'not_found' });
}

function previewDeploymentPayload(request, reason) {
  const origin = publicOrigin(request);
  return {
    deployment: { mode: 'vercel-preview', publicReady: false, draftReady: false, activePublicBaseUrl: '', publicBaseUrl: origin, qrMode: 'vercel-preview', requiresRestartOrDeploy: true },
    dockerEnv: `BOT_RUNTIME_URL=https://bot.example.com\nBOT_RUNTIME_ADMIN_USER=admin\nBOT_RUNTIME_ADMIN_TOKEN=<token-from-vps-env>\n`,
    commands: {
      connectRuntime: 'Vercel → Settings → Environment Variables → BOT_RUNTIME_URL=https://<bot-domain>',
      strictMode: 'Optional: BOT_RUNTIME_STRICT=true disables preview fallback',
      health: `${origin}/api/health`
    },
    note: `Hosted console is running in preview fallback (${reason}). Configure BOT_RUNTIME_URL to control the real Docker/VPS runtime.`
  };
}

function previewSimulation(input = {}, bot = null) {
  const value = clean(input.text || '', 500);
  const name = bot?.name || 'Preview Bot';
  return { accepted: true, preview: true, botId: bot?.id || null, intent: 'preview', responseSource: 'vercel-preview', reply: `${name} preview received: ${value || 'hello'}. Connect a Docker/VPS runtime for live channel dispatch.` };
}

function previewStore() {
  globalThis.__botHubVercelPreview ||= { startedAt: Date.now(), bots: [], sessions: {} };
  return globalThis.__botHubVercelPreview;
}

function pathSegments(request) {
  const raw = request.query?.path;
  return Array.isArray(raw) ? raw.filter(Boolean).map(String) : String(raw || '').split('/').filter(Boolean);
}

async function requestBody(request) {
  if (request.body == null) return {};
  if (typeof request.body === 'object' && !Buffer.isBuffer(request.body)) return request.body;
  try { return JSON.parse(Buffer.isBuffer(request.body) ? request.body.toString('utf8') : String(request.body)); } catch { return {}; }
}

function publicOrigin(request) {
  const host = request.headers['x-forwarded-host'] || request.headers.host || 'localhost';
  const proto = request.headers['x-forwarded-proto'] || (String(host).includes('localhost') ? 'http' : 'https');
  return `${proto}://${host}`.replace(/\/$/, '');
}

function upsertChannel(bot, channel, patch) {
  const current = bot.channels.find((item) => item.channel === channel);
  if (current) Object.assign(current, patch, { channel, updatedAt: new Date().toISOString() });
  else bot.channels.push({ channel, ...patch, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  bot.updatedAt = new Date().toISOString();
  return bot;
}

function connectContent({ session, bot, origin, preview }) {
  const title = channelTitle(session.channel);
  const webhook = `${origin}/webhooks/${encodeURIComponent(session.botId)}/${encodeURIComponent(session.channel)}`;
  return `
    <div class="mark">⌁</div><p class="eyebrow">Bot Hub connection</p><h1>Connect ${escapeHtml(title)}</h1>
    <p class="muted">You are connecting <strong>${escapeHtml(bot?.name || 'Preview Bot')}</strong>. This QR is a temporary handoff URL. ${preview ? 'This Vercel page is preview-only until BOT_RUNTIME_URL points to the VPS runtime.' : ''}</p>
    <div class="notice"><strong>Webhook / callback</strong><br><code>${escapeHtml(webhook)}</code></div>
    <ol>${channelSteps(session.channel).map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol>
    <form method="post" action="/connect/${escapeHtml(session.token)}/confirm"><button class="primary" type="submit">I have configured this channel</button></form>
    <p class="foot">Zalo/Facebook/TikTok production requires official provider approval and token exchange. Bot Hub does not capture personal QR-login cookies.</p>`;
}

function successContent(channel) {
  return `<div class="mark">✓</div><p class="eyebrow">Setup reviewed</p><h1>${escapeHtml(channelTitle(channel))} action saved</h1><p class="muted">Bot Hub marked this connection as <strong>setup reviewed</strong>. Return to the dashboard to continue. Production outbound still requires the provider token/capability to be configured on the runtime.</p>`;
}

function channelSteps(channel) {
  return ({
    zalo: ['Use Zalo OA/Bot official developer console.', 'Set the public HTTPS webhook/callback URL.', 'Add approved app token/secret on the VPS runtime.', 'Send a real test event after saving.'],
    facebook: ['Create/choose a Meta app and Page.', 'Set callback URL and verify token.', 'Configure app secret and page access token on the VPS runtime.', 'Send a test Messenger webhook.'],
    telegram: ['Open BotFather and create/copy bot token.', 'Paste the token in Bot Hub runtime .env or channel settings.', 'Set webhook to the Bot Hub public URL.', 'Send the bot a test message.'],
    tiktok: ['Use the approved TikTok developer product.', 'Configure the webhook URL and signing secret.', 'Enable outbound only if your app has an approved messaging capability.', 'Send a test event.']
  })[channel] || ['Configure the official provider credentials.', 'Send a test event.'];
}

function channelTitle(channel) {
  return ({ zalo: 'Zalo OA', facebook: 'Facebook Messenger', telegram: 'Telegram', tiktok: 'TikTok' })[channel] || channel;
}

function connectShell(content) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bot Hub Connect</title><style>body{margin:0;background:#f5f5f7;color:#1d1d1f;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.wrap{max-width:560px;margin:auto;padding:42px 20px}.card{background:rgba(255,255,255,.9);border:1px solid rgba(0,0,0,.08);border-radius:28px;padding:28px;box-shadow:0 24px 80px rgba(0,0,0,.08);backdrop-filter:blur(28px)}.mark{width:52px;height:52px;border-radius:16px;display:grid;place-items:center;background:#111;color:#fff;font-size:24px}.eyebrow{margin:24px 0 8px;text-transform:uppercase;letter-spacing:.12em;font-size:12px;font-weight:700;color:#6e6e73}h1{font-size:36px;line-height:1.05;letter-spacing:-.04em;margin:0 0 14px}.muted{color:#6e6e73;line-height:1.6}.primary{width:100%;border:0;text-align:center;text-decoration:none;background:#0071e3;color:#fff;padding:15px 18px;border-radius:14px;font-weight:650;margin:20px 0;cursor:pointer}ol{padding-left:22px;color:#424245;line-height:1.65}.notice{background:#f5f5f7;padding:16px;border-radius:16px;color:#515154;line-height:1.5;margin-top:18px;overflow:auto}.notice code{font-size:12px;word-break:break-all}.foot{font-size:12px;color:#86868b;line-height:1.5;margin-top:20px}</style></head><body><div class="wrap"><main class="card">${content}</main></div></body></html>`;
}

function sendJson(response, status, payload) {
  response.setHeader?.('cache-control', 'no-store');
  if (typeof response.status === 'function' && typeof response.json === 'function') return response.status(status).json(payload);
  response.statusCode = status;
  response.setHeader?.('content-type', 'application/json; charset=utf-8');
  return response.end(JSON.stringify(payload));
}

function sendHtml(response, status, html) {
  response.setHeader?.('cache-control', 'no-store');
  response.setHeader?.('content-type', 'text/html; charset=utf-8');
  if (typeof response.status === 'function' && typeof response.send === 'function') return response.status(status).send(html);
  response.statusCode = status;
  return response.end(html);
}

function normalizeRuntimeBase(value) {
  const text = String(value || '').trim().replace(/\/$/, '');
  if (!text) return '';
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:') return '';
    if (url.username || url.password) return '';
    return url.origin;
  } catch {
    return '';
  }
}

function serializeBody(body, contentType) {
  if (body == null) return undefined;
  if (Buffer.isBuffer(body) || typeof body === 'string') return body;
  if (String(contentType).includes('application/json')) return JSON.stringify(body);
  return String(body);
}

function clean(value, max = 500) {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, max);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}
