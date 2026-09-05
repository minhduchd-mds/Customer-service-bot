import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadConfig } from './config.js';
import { createLogger } from './lib/logger.js';
import { HttpError, json, parseJson, readRawBody, text } from './lib/http.js';
import { qrSvg } from './lib/qr.js';
import { IdempotencyStore } from './core/idempotency.js';
import { KnowledgeIndex } from './core/knowledge.js';
import { AiRouter } from './core/ai-router.js';
import { WorkflowBridge } from './core/workflow.js';
import { Router9 } from './core/router9.js';
import { BotStore } from './core/bot-store.js';
import { ConnectSessionStore } from './core/connect-session.js';
import { listScenarioTemplates, scenarioFromTemplate } from './core/scenario.js';
import { TelegramConnector } from './connectors/telegram.js';
import { FacebookConnector } from './connectors/facebook.js';
import { ZaloConnector } from './connectors/zalo.js';
import { TikTokConnector } from './connectors/tiktok.js';
import { listSkills } from './skills/catalog.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(dirname, '../public');
const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.css', ['app.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']]
]);

export function createApp({ config = loadConfig(), logger = createLogger(config.logLevel) } = {}) {
  const connectors = {
    telegram: new TelegramConnector(config.telegram),
    facebook: new FacebookConnector(config.facebook),
    zalo: new ZaloConnector(config.zalo),
    tiktok: new TikTokConnector(config.tiktok)
  };
  const router = new Router9({
    idempotency: new IdempotencyStore({ ttlSeconds: config.idempotencyTtlSeconds }),
    knowledge: new KnowledgeIndex({ ...config.knowledge, logger }),
    ai: new AiRouter(config.ai, logger),
    workflow: new WorkflowBridge(config.n8n, logger),
    logger
  });
  const bots = new BotStore({ file: config.botStoreFile, logger });
  const connectSessions = new ConnectSessionStore({ ttlSeconds: config.connect.ttlSeconds, publicBaseUrl: config.publicBaseUrl });
  const startedAt = Date.now();

  const handler = async (request, response) => {
    const url = new URL(request.url, config.publicBaseUrl || `http://${request.headers.host || 'localhost'}`);
    try {
      if (request.method === 'GET' && staticFiles.has(url.pathname)) {
        const [file, contentType] = staticFiles.get(url.pathname);
        const body = await readFile(path.join(publicDir, file), 'utf8');
        return text(response, 200, body, contentType);
      }

      if (request.method === 'GET' && url.pathname === '/api/health') {
        return json(response, 200, {
          ok: true,
          service: 'customer-service-bot',
          product: 'Bot Hub',
          uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
          now: new Date().toISOString()
        });
      }

      if (request.method === 'GET' && url.pathname === '/api/channels') {
        return json(response, 200, {
          channels: Object.values(connectors).map((connector) => connector.status()),
          connectMethods: {
            zalo: 'qr-oauth',
            facebook: 'qr-oauth',
            telegram: 'qr-handoff',
            tiktok: 'qr-oauth',
            web: 'instant'
          }
        });
      }

      if (request.method === 'GET' && url.pathname === '/api/metrics') return json(response, 200, router.snapshotMetrics());
      if (request.method === 'GET' && url.pathname === '/api/skills') return json(response, 200, { skills: listSkills() });
      if (request.method === 'GET' && url.pathname === '/api/scenario-templates') return json(response, 200, { templates: listScenarioTemplates() });

      if (request.method === 'GET' && url.pathname === '/api/bots') {
        return json(response, 200, { bots: await bots.list() });
      }

      if (request.method === 'POST' && url.pathname === '/api/bots') {
        const payload = await requestJson(request, config.maxBodyBytes);
        let bot;
        try {
          bot = await bots.create(payload);
        } catch (error) {
          if (error?.message === 'bot_name_required') throw new HttpError(400, 'Bot name is required', 'bot_name_required');
          throw error;
        }
        if (payload.scenarioTemplate) {
          const scenario = scenarioFromTemplate(payload.scenarioTemplate);
          if (scenario) bot = await bots.setScenario(bot.id, scenario);
        }
        return json(response, 201, { bot });
      }

      const botMatch = url.pathname.match(/^\/api\/bots\/([^/]+)$/);
      if (botMatch && request.method === 'GET') {
        const bot = await requireBot(bots, botMatch[1]);
        return json(response, 200, { bot });
      }
      if (botMatch && request.method === 'PATCH') {
        await requireBot(bots, botMatch[1]);
        const payload = await requestJson(request, config.maxBodyBytes);
        const bot = await bots.update(botMatch[1], payload);
        return json(response, 200, { bot });
      }

      const knowledgeMatch = url.pathname.match(/^\/api\/bots\/([^/]+)\/knowledge$/);
      if (knowledgeMatch && request.method === 'POST') {
        await requireBot(bots, knowledgeMatch[1]);
        const payload = await requestJson(request, config.maxBodyBytes);
        let bot;
        try {
          bot = await bots.addKnowledgeSource(knowledgeMatch[1], payload);
        } catch (error) {
          if (error?.message === 'knowledge_value_required') throw new HttpError(400, 'Knowledge content is required', 'knowledge_value_required');
          throw error;
        }
        return json(response, 201, { bot });
      }

      const scenarioMatch = url.pathname.match(/^\/api\/bots\/([^/]+)\/scenario$/);
      if (scenarioMatch && request.method === 'PUT') {
        await requireBot(bots, scenarioMatch[1]);
        const payload = await requestJson(request, config.maxBodyBytes);
        const template = payload.template ? scenarioFromTemplate(payload.template) : null;
        const bot = await bots.setScenario(scenarioMatch[1], template || payload);
        return json(response, 200, { bot });
      }

      const liveMatch = url.pathname.match(/^\/api\/bots\/([^/]+)\/go-live$/);
      if (liveMatch && request.method === 'POST') {
        const current = await requireBot(bots, liveMatch[1]);
        if (!current.channels.length) throw new HttpError(409, 'Connect at least one channel before going live', 'channel_required');
        const bot = await bots.update(liveMatch[1], { status: 'running' });
        return json(response, 200, { bot });
      }

      const botSimulateMatch = url.pathname.match(/^\/api\/bots\/([^/]+)\/simulate$/);
      if (botSimulateMatch && request.method === 'POST') {
        const bot = await requireBot(bots, botSimulateMatch[1]);
        const payload = await requestJson(request, config.maxBodyBytes);
        const channel = payload.channel || bot.channels[0]?.channel || 'telegram';
        const connector = connectors[channel] || connectors.telegram;
        const syntheticPayload = toSyntheticPayload(channel, payload);
        const syntheticRaw = Buffer.from(JSON.stringify(syntheticPayload));
        const result = await router.handle({ connector, rawBody: syntheticRaw, payload: syntheticPayload, headers: {}, url, dispatch: false, skipVerification: true, bot });
        return json(response, 200, result);
      }

      if (request.method === 'POST' && url.pathname === '/api/connect/sessions') {
        const payload = await requestJson(request, config.maxBodyBytes);
        const bot = await requireBot(bots, payload.botId);
        const channel = String(payload.channel || '');
        if (!['zalo', 'facebook', 'telegram', 'tiktok', 'web'].includes(channel)) throw new HttpError(400, 'Unsupported channel', 'unsupported_channel');
        if (channel === 'web') {
          const updated = await bots.upsertChannel(bot.id, 'web', { status: 'connected', connectionId: 'web-widget', connectedAt: new Date().toISOString() });
          return json(response, 201, { instant: true, bot: updated });
        }
        const session = connectSessions.create({ botId: bot.id, channel });
        await bots.upsertChannel(bot.id, channel, { status: 'pending', connectionId: session.token });
        let svg = null;
        try { svg = qrSvg(session.connectionUrl); } catch (error) { logger.warn({ event: 'qr_generation_failed', reason: error?.message || 'unknown' }); }
        return json(response, 201, { session, qrSvg: svg });
      }

      const connectApiMatch = url.pathname.match(/^\/api\/connect\/sessions\/([^/]+)$/);
      if (connectApiMatch && request.method === 'GET') {
        const session = connectSessions.get(connectApiMatch[1]);
        if (!session) throw new HttpError(404, 'Connection session not found or expired', 'connect_session_not_found');
        return json(response, 200, { session });
      }

      const connectPageMatch = url.pathname.match(/^\/connect\/([^/]+)$/);
      if (connectPageMatch && request.method === 'GET') {
        const session = connectSessions.get(connectPageMatch[1]);
        if (!session) return text(response, 404, connectionExpiredPage(), 'text/html; charset=utf-8');
        const bot = await bots.get(session.botId);
        connectSessions.update(session.token, { status: 'authorizing' });
        return text(response, 200, connectionPage({ session, bot, providerUrl: providerAuthorizeUrl(config, session) }), 'text/html; charset=utf-8');
      }

      const callbackMatch = url.pathname.match(/^\/connect\/callback\/(zalo|facebook|tiktok)$/);
      if (callbackMatch && request.method === 'GET') {
        const token = url.searchParams.get('state') || '';
        const session = connectSessions.get(token);
        if (!session || session.channel !== callbackMatch[1]) return text(response, 400, connectionExpiredPage(), 'text/html; charset=utf-8');
        connectSessions.update(token, { status: 'authorizing', providerState: 'callback_received' });
        await bots.upsertChannel(session.botId, session.channel, { status: 'authorization_received', connectionId: session.token });
        return text(response, 200, authorizationReceivedPage(session.channel), 'text/html; charset=utf-8');
      }

      if (request.method === 'GET' && url.pathname === '/webhooks/facebook') {
        const result = connectors.facebook.verifyChallenge(url);
        return result.ok ? text(response, 200, result.challenge) : text(response, 403, 'Forbidden');
      }

      if (request.method === 'POST' && url.pathname === '/api/knowledge/search') {
        const payload = await requestJson(request, config.maxBodyBytes);
        const results = await router.knowledge.search(payload.query || '', { limit: Math.min(Number(payload.limit) || 5, 20) });
        return json(response, 200, { query: payload.query || '', results });
      }

      if (request.method === 'POST' && url.pathname === '/api/simulate') {
        const payload = await requestJson(request, config.maxBodyBytes);
        const channel = payload.channel || 'telegram';
        const connector = connectors[channel];
        if (!connector) throw new HttpError(400, 'Unknown channel', 'unknown_channel');
        const syntheticPayload = toSyntheticPayload(channel, payload);
        const syntheticRaw = Buffer.from(JSON.stringify(syntheticPayload));
        const result = await router.handle({ connector, rawBody: syntheticRaw, payload: syntheticPayload, headers: {}, url, dispatch: false, skipVerification: true });
        return json(response, 200, result);
      }

      const botWebhookMatch = url.pathname.match(/^\/webhooks\/([^/]+)\/(telegram|facebook|zalo|tiktok)$/);
      if (request.method === 'POST' && botWebhookMatch) {
        const bot = await requireBot(bots, botWebhookMatch[1]);
        return handleWebhook({ request, response, url, connector: connectors[botWebhookMatch[2]], channel: botWebhookMatch[2], router, config, bot });
      }

      const legacyWebhookMatch = url.pathname.match(/^\/webhooks\/(telegram|facebook|zalo|tiktok)$/);
      if (request.method === 'POST' && legacyWebhookMatch) {
        return handleWebhook({ request, response, url, connector: connectors[legacyWebhookMatch[1]], channel: legacyWebhookMatch[1], router, config, bot: null });
      }

      return json(response, 404, { error: 'not_found' });
    } catch (error) {
      const statusCode = error instanceof HttpError ? error.statusCode : 500;
      logger.error({ event: 'request_failed', method: request.method, path: url.pathname, statusCode, reason: error?.message || 'unknown' });
      return json(response, statusCode, { error: error instanceof HttpError ? error.code : 'internal_error', message: statusCode >= 500 ? 'Internal server error' : error.message });
    }
  };

  return { handler, config, connectors, router, bots, connectSessions };
}

async function requestJson(request, maxBodyBytes) {
  return parseJson(await readRawBody(request, maxBodyBytes));
}

async function requireBot(store, id) {
  if (!id) throw new HttpError(400, 'Bot ID is required', 'bot_id_required');
  const bot = await store.get(id);
  if (!bot) throw new HttpError(404, 'Bot not found', 'bot_not_found');
  return bot;
}

async function handleWebhook({ request, response, url, connector, channel, router, config, bot }) {
  const rawBody = await readRawBody(request, config.maxBodyBytes);
  const payload = parseJson(rawBody);
  const result = await router.handle({ connector, rawBody, payload, headers: request.headers, url, dispatch: true, bot });
  const statusCode = result.statusCode || 200;
  return json(response, statusCode, channel === 'tiktok' && statusCode === 200 ? { ok: true } : result);
}

function providerAuthorizeUrl(config, session) {
  if (session.channel === 'telegram') return config.connect.telegramHelpUrl || null;
  const templates = {
    zalo: config.connect.zaloAuthUrlTemplate,
    facebook: config.connect.facebookAuthUrlTemplate,
    tiktok: config.connect.tiktokAuthUrlTemplate
  };
  const template = templates[session.channel];
  if (!template) return null;
  const callback = `${config.publicBaseUrl.replace(/\/$/, '')}/connect/callback/${session.channel}`;
  return template
    .replaceAll('{state}', encodeURIComponent(session.token))
    .replaceAll('{redirectUri}', encodeURIComponent(callback));
}

function connectionPage({ session, bot, providerUrl }) {
  const channel = escapeHtml(session.channel[0].toUpperCase() + session.channel.slice(1));
  const botName = escapeHtml(bot?.name || 'Bot');
  const action = providerUrl
    ? `<a class="primary" href="${escapeHtml(providerUrl)}" rel="noreferrer">Continue with ${channel}</a>`
    : `<div class="notice">The official authorization URL for ${channel} is not configured yet. Add the provider's approved OAuth URL template on the server, then scan again.</div>`;
  return mobileShell(`
    <div class="mark">⌁</div>
    <p class="eyebrow">Bot Hub connection</p>
    <h1>Connect ${channel}</h1>
    <p class="muted">You are connecting <strong>${botName}</strong>. This QR contains a temporary one-time handoff URL and expires automatically.</p>
    ${action}
    <p class="foot">Use official provider authorization only. Bot Hub does not capture personal web sessions or QR-login cookies.</p>
  `);
}

function authorizationReceivedPage(channel) {
  return mobileShell(`
    <div class="mark">✓</div>
    <p class="eyebrow">Authorization returned</p>
    <h1>Finish ${escapeHtml(channel)} setup</h1>
    <p class="muted">The provider redirected back to Bot Hub. The channel is marked <strong>authorization received</strong>. A provider-specific server token exchange must complete before production messages are enabled.</p>
    <div class="notice">You can close this page and return to the Bot Hub dashboard.</div>
  `);
}

function connectionExpiredPage() {
  return mobileShell(`<div class="mark">!</div><p class="eyebrow">Bot Hub</p><h1>QR expired</h1><p class="muted">Create a new connection QR from the bot's Channels step.</p>`);
}

function mobileShell(content) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bot Hub Connect</title><style>body{margin:0;background:#f5f5f7;color:#1d1d1f;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.wrap{max-width:520px;margin:auto;padding:64px 24px}.card{background:rgba(255,255,255,.86);border:1px solid rgba(0,0,0,.08);border-radius:28px;padding:32px;box-shadow:0 24px 80px rgba(0,0,0,.08);backdrop-filter:blur(28px)}.mark{width:52px;height:52px;border-radius:16px;display:grid;place-items:center;background:#111;color:#fff;font-size:24px}.eyebrow{margin:28px 0 8px;text-transform:uppercase;letter-spacing:.12em;font-size:12px;font-weight:700;color:#6e6e73}h1{font-size:38px;line-height:1.05;letter-spacing:-.04em;margin:0 0 16px}.muted{color:#6e6e73;line-height:1.6}.primary{display:block;text-align:center;text-decoration:none;background:#0071e3;color:#fff;padding:15px 18px;border-radius:14px;font-weight:650;margin:28px 0}.notice{background:#f5f5f7;padding:16px;border-radius:16px;color:#515154;line-height:1.5;margin-top:24px}.foot{font-size:12px;color:#86868b;line-height:1.5;margin-top:24px}</style></head><body><div class="wrap"><main class="card">${content}</main></div></body></html>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function toSyntheticPayload(channel, input) {
  const value = String(input.text || '');
  const id = String(input.eventId || `sim-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const sender = String(input.senderId || 'sim-user');
  if (channel === 'telegram') return { update_id: id, message: { message_id: id, date: Math.floor(Date.now() / 1000), chat: { id: sender }, from: { id: sender }, text: value } };
  if (channel === 'facebook') return { object: 'page', entry: [{ messaging: [{ sender: { id: sender }, recipient: { id: 'page' }, timestamp: Date.now(), message: { mid: id, text: value } }] }] };
  if (channel === 'zalo') return { event_name: 'user_send_text', timestamp: Date.now(), sender: { id: sender }, recipient: { id: 'oa' }, message: { msg_id: id, text: value } };
  return { client_key: 'sim', event: 'message.received', create_time: Math.floor(Date.now() / 1000), user_openid: sender, content: JSON.stringify({ event_id: id, text: value }) };
}
