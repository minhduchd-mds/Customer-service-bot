import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadConfig } from './config.js';
import { createLogger } from './lib/logger.js';
import { HttpError, json, parseJson, readRawBody, text } from './lib/http.js';
import { IdempotencyStore } from './core/idempotency.js';
import { KnowledgeIndex } from './core/knowledge.js';
import { AiRouter } from './core/ai-router.js';
import { WorkflowBridge } from './core/workflow.js';
import { Router9 } from './core/router9.js';
import { TelegramConnector } from './connectors/telegram.js';
import { FacebookConnector } from './connectors/facebook.js';
import { ZaloConnector } from './connectors/zalo.js';
import { TikTokConnector } from './connectors/tiktok.js';
import { listSkills } from './skills/catalog.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const dashboardPath = path.resolve(dirname, '../public/index.html');

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
  const startedAt = Date.now();

  const handler = async (request, response) => {
    const url = new URL(request.url, config.publicBaseUrl || `http://${request.headers.host || 'localhost'}`);
    try {
      if (request.method === 'GET' && url.pathname === '/') {
        const body = await readFile(dashboardPath, 'utf8');
        return text(response, 200, body, 'text/html; charset=utf-8');
      }
      if (request.method === 'GET' && url.pathname === '/api/health') {
        return json(response, 200, { ok: true, service: 'customer-service-bot', uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000), now: new Date().toISOString() });
      }
      if (request.method === 'GET' && url.pathname === '/api/channels') {
        return json(response, 200, { channels: Object.values(connectors).map((connector) => connector.status()) });
      }
      if (request.method === 'GET' && url.pathname === '/api/metrics') {
        return json(response, 200, router.snapshotMetrics());
      }
      if (request.method === 'GET' && url.pathname === '/api/skills') {
        return json(response, 200, { skills: listSkills() });
      }
      if (request.method === 'GET' && url.pathname === '/webhooks/facebook') {
        const result = connectors.facebook.verifyChallenge(url);
        return result.ok ? text(response, 200, result.challenge) : text(response, 403, 'Forbidden');
      }
      if (request.method === 'POST' && url.pathname === '/api/knowledge/search') {
        const rawBody = await readRawBody(request, config.maxBodyBytes);
        const payload = parseJson(rawBody);
        const results = await router.knowledge.search(payload.query || '', { limit: Math.min(Number(payload.limit) || 5, 20) });
        return json(response, 200, { query: payload.query || '', results });
      }
      if (request.method === 'POST' && url.pathname === '/api/simulate') {
        const rawBody = await readRawBody(request, config.maxBodyBytes);
        const payload = parseJson(rawBody);
        const channel = payload.channel || 'telegram';
        const connector = connectors[channel];
        if (!connector) throw new HttpError(400, 'Unknown channel', 'unknown_channel');
        const syntheticPayload = toSyntheticPayload(channel, payload);
        const syntheticRaw = Buffer.from(JSON.stringify(syntheticPayload));
        const result = await router.handle({ connector, rawBody: syntheticRaw, payload: syntheticPayload, headers: {}, url, dispatch: false, skipVerification: true });
        return json(response, 200, result);
      }
      const match = url.pathname.match(/^\/webhooks\/(telegram|facebook|zalo|tiktok)$/);
      if (request.method === 'POST' && match) {
        const channel = match[1];
        const connector = connectors[channel];
        const rawBody = await readRawBody(request, config.maxBodyBytes);
        const payload = parseJson(rawBody);
        const result = await router.handle({ connector, rawBody, payload, headers: request.headers, url, dispatch: true });
        const statusCode = result.statusCode || 200;
        return json(response, statusCode, channel === 'tiktok' && statusCode === 200 ? { ok: true } : result);
      }
      return json(response, 404, { error: 'not_found' });
    } catch (error) {
      const statusCode = error instanceof HttpError ? error.statusCode : 500;
      logger.error({ event: 'request_failed', method: request.method, path: url.pathname, statusCode, reason: error?.message || 'unknown' });
      return json(response, statusCode, { error: error instanceof HttpError ? error.code : 'internal_error', message: statusCode >= 500 ? 'Internal server error' : error.message });
    }
  };

  return { handler, config, connectors, router };
}

function toSyntheticPayload(channel, input) {
  const text = String(input.text || '');
  const id = String(input.eventId || `sim-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const sender = String(input.senderId || 'sim-user');
  if (channel === 'telegram') return { update_id: id, message: { message_id: id, date: Math.floor(Date.now() / 1000), chat: { id: sender }, from: { id: sender }, text } };
  if (channel === 'facebook') return { object: 'page', entry: [{ messaging: [{ sender: { id: sender }, recipient: { id: 'page' }, timestamp: Date.now(), message: { mid: id, text } }] }] };
  if (channel === 'zalo') return { event_name: 'user_send_text', timestamp: Date.now(), sender: { id: sender }, recipient: { id: 'oa' }, message: { msg_id: id, text } };
  return { client_key: 'sim', event: 'message.received', create_time: Math.floor(Date.now() / 1000), user_openid: sender, content: JSON.stringify({ event_id: id, text }) };
}
