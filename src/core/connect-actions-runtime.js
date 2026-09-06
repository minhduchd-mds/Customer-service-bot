import { HttpError, json, text } from '../lib/http.js';

const ACTIONABLE_CHANNELS = new Set(['zalo', 'facebook', 'telegram', 'tiktok']);

export function attachConnectionActions(runtime) {
  if (!runtime?.connectSessions || !runtime?.bots || !runtime?.config || typeof runtime.handler !== 'function') throw new Error('connection_actions_requires_bot_runtime');
  if (runtime.connectionActions) return runtime;
  const nextHandler = runtime.handler;
  runtime.handler = connectionActionsHandler({ nextHandler, runtime });
  runtime.connectionActions = { enabled: true };
  return runtime;
}

export function connectionActionsHandler({ nextHandler, runtime }) {
  return async (request, response) => {
    const url = new URL(request.url || '/', runtime.config.publicBaseUrl || `http://${request.headers.host || 'localhost'}`);
    try {
      const pageMatch = url.pathname.match(/^\/connect\/([A-Za-z0-9_-]+)$/);
      if (pageMatch && request.method === 'GET') {
        const session = runtime.connectSessions.get(pageMatch[1]);
        if (!session) return text(response, 404, expiredPage(), 'text/html; charset=utf-8');
        const bot = await runtime.bots.get(session.botId);
        runtime.connectSessions.update(session.token, { status: 'authorizing' });
        return text(response, 200, connectionPage({ session, bot, request, runtime }), 'text/html; charset=utf-8');
      }

      const confirmMatch = url.pathname.match(/^\/connect\/([A-Za-z0-9_-]+)\/confirm$/);
      if (confirmMatch && request.method === 'POST') {
        const session = runtime.connectSessions.get(confirmMatch[1]);
        if (!session) return text(response, 404, expiredPage(), 'text/html; charset=utf-8');
        if (!ACTIONABLE_CHANNELS.has(session.channel)) throw new HttpError(400, 'Unsupported connection action', 'unsupported_connection_action');
        const updatedSession = runtime.connectSessions.update(session.token, { status: 'setup_reviewed', providerState: 'manual_confirmation' });
        await runtime.bots.upsertChannel(session.botId, session.channel, {
          status: 'setup_reviewed',
          connectionId: session.token,
          reviewedAt: new Date().toISOString(),
          note: 'Operator confirmed provider-side setup from QR handoff page. Production send still depends on configured provider credentials.'
        });
        const wantsJson = String(request.headers.accept || '').includes('application/json');
        if (wantsJson) return json(response, 200, { session: updatedSession, status: 'setup_reviewed' });
        return text(response, 200, successPage(session.channel), 'text/html; charset=utf-8');
      }
    } catch (error) {
      const statusCode = error instanceof HttpError ? error.statusCode : 500;
      if (String(request.headers.accept || '').includes('application/json')) {
        return json(response, statusCode, { error: error instanceof HttpError ? error.code : 'connection_action_failed', message: statusCode >= 500 ? 'Connection action failed' : error.message });
      }
      return text(response, statusCode, errorPage(statusCode >= 500 ? 'Connection action failed' : error.message), 'text/html; charset=utf-8');
    }
    return nextHandler(request, response);
  };
}

function connectionPage({ session, bot, request, runtime }) {
  const origin = effectiveOrigin({ request, runtime });
  const providerUrl = providerAuthorizeUrl(runtime.config, session, origin);
  const title = channelTitle(session.channel);
  const webhook = `${origin}/webhooks/${encodeURIComponent(session.botId)}/${encodeURIComponent(session.channel)}`;
  const providerAction = providerUrl
    ? `<a class="secondary" href="${escapeHtml(providerUrl)}" rel="noreferrer">Open official ${escapeHtml(title)} authorization</a>`
    : `<div class="notice"><strong>Official OAuth URL is not configured yet.</strong><br>Add PUBLIC_BASE_URL and CONNECT_${escapeHtml(session.channel.toUpperCase())}_AUTH_URL_TEMPLATE on the VPS runtime for full OAuth.</div>`;
  return shell(`
    <div class="mark">⌁</div>
    <p class="eyebrow">Bot Hub connection</p>
    <h1>Connect ${escapeHtml(title)}</h1>
    <p class="muted">You are connecting <strong>${escapeHtml(bot?.name || 'Bot')}</strong>. This QR is a temporary handoff URL. It updates Bot Hub setup state but never captures personal login cookies.</p>
    <div class="notice"><strong>Webhook / callback URL</strong><br><code>${escapeHtml(webhook)}</code></div>
    <ol>${channelSteps(session.channel).map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol>
    ${providerAction}
    <form method="post" action="/connect/${escapeHtml(session.token)}/confirm"><button class="primary" type="submit">I have configured this channel</button></form>
    <p class="foot">For Zalo/Facebook/TikTok, this marks setup as reviewed, not fully connected. Production outbound is enabled only after official credentials and provider capability checks are configured.</p>`);
}

function successPage(channel) {
  return shell(`
    <div class="mark ok">✓</div>
    <p class="eyebrow">Setup reviewed</p>
    <h1>${escapeHtml(channelTitle(channel))} action saved</h1>
    <p class="muted">Bot Hub recorded your QR action and marked the channel as <strong>setup reviewed</strong>. Return to the desktop/web dashboard to continue testing.</p>
    <div class="notice">Next: configure provider token exchange/credentials on VPS, then send a real test message or webhook event.</div>`);
}

function expiredPage() {
  return shell(`<div class="mark warn">!</div><p class="eyebrow">Bot Hub</p><h1>QR expired</h1><p class="muted">Create a new connection QR from the Bot Hub channel setup step.</p>`);
}

function errorPage(message) {
  return shell(`<div class="mark warn">!</div><p class="eyebrow">Bot Hub</p><h1>Connection action failed</h1><p class="muted">${escapeHtml(message)}</p>`);
}

function providerAuthorizeUrl(config, session, origin) {
  if (session.channel === 'telegram') return config.connect.telegramHelpUrl || null;
  const templates = {
    zalo: config.connect.zaloAuthUrlTemplate,
    facebook: config.connect.facebookAuthUrlTemplate,
    tiktok: config.connect.tiktokAuthUrlTemplate
  };
  const template = templates[session.channel];
  if (!template) return null;
  const callback = `${origin}/connect/callback/${session.channel}`;
  return template.replaceAll('{state}', encodeURIComponent(session.token)).replaceAll('{redirectUri}', encodeURIComponent(callback));
}

function effectiveOrigin({ request, runtime }) {
  if (runtime.config.publicBaseUrl) return runtime.config.publicBaseUrl.replace(/\/$/, '');
  const host = request.headers.host || 'localhost';
  const proto = request.headers['x-forwarded-proto'] || (String(host).includes('localhost') || /^\d+\.\d+\.\d+\.\d+/.test(String(host)) ? 'http' : 'https');
  return `${proto}://${host}`.replace(/\/$/, '');
}

function channelSteps(channel) {
  return ({
    zalo: ['Use Zalo OA/Bot official developer console, not personal web-session automation.', 'Set the public HTTPS webhook/callback URL shown above.', 'Add approved Zalo token/secret on the Bot Hub VPS runtime.', 'Send a real Zalo OA test event after saving.'],
    facebook: ['Create or select the Meta app and Facebook Page.', 'Set callback URL and verify token in Meta developer settings.', 'Configure App Secret and Page Access Token on the Bot Hub runtime.', 'Send a Messenger test webhook.'],
    telegram: ['Open BotFather and create/copy the bot token.', 'Add TELEGRAM_BOT_TOKEN and webhook secret in Bot Hub runtime configuration.', 'Set Telegram webhook to the Bot Hub public URL.', 'Send the bot a test message.'],
    tiktok: ['Use only an approved TikTok developer product/capability.', 'Set webhook URL and signing secret.', 'Configure outbound only when TikTok has approved that capability for the app.', 'Send a test event.']
  })[channel] || ['Configure official provider credentials.', 'Send a test event.'];
}

function channelTitle(channel) {
  return ({ zalo: 'Zalo OA', facebook: 'Facebook Messenger', telegram: 'Telegram', tiktok: 'TikTok' })[channel] || channel;
}

function shell(content) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bot Hub Connect</title><style>body{margin:0;background:#f5f5f7;color:#1d1d1f;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.wrap{max-width:560px;margin:auto;padding:42px 20px}.card{background:rgba(255,255,255,.9);border:1px solid rgba(0,0,0,.08);border-radius:28px;padding:28px;box-shadow:0 24px 80px rgba(0,0,0,.08);backdrop-filter:blur(28px)}.mark{width:52px;height:52px;border-radius:16px;display:grid;place-items:center;background:#111;color:#fff;font-size:24px}.mark.ok{background:#167a3a}.mark.warn{background:#b45309}.eyebrow{margin:24px 0 8px;text-transform:uppercase;letter-spacing:.12em;font-size:12px;font-weight:700;color:#6e6e73}h1{font-size:36px;line-height:1.05;letter-spacing:-.04em;margin:0 0 14px}.muted{color:#6e6e73;line-height:1.6}.primary,.secondary{display:block;width:100%;box-sizing:border-box;border:0;text-align:center;text-decoration:none;padding:15px 18px;border-radius:14px;font-weight:650;margin:16px 0;cursor:pointer}.primary{background:#0071e3;color:#fff}.secondary{background:#eef5ff;color:#005fb8}ol{padding-left:22px;color:#424245;line-height:1.65}.notice{background:#f5f5f7;padding:16px;border-radius:16px;color:#515154;line-height:1.5;margin-top:18px;overflow:auto}.notice code{font-size:12px;word-break:break-all}.foot{font-size:12px;color:#86868b;line-height:1.5;margin-top:20px}</style></head><body><div class="wrap"><main class="card">${content}</main></div></body></html>`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}
