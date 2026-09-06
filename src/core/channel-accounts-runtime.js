import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { qrSvg } from '../lib/qr.js';
import { HttpError, json, parseJson, readRawBody, text } from '../lib/http.js';
import { channelAccountCatalog, channelAccountType, canAutoReplyAccount } from './channel-account-registry.js';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');
const assets = new Map([
  ['/channel-accounts.js', ['channel-accounts.js', 'text/javascript; charset=utf-8']],
  ['/channel-accounts.css', ['channel-accounts.css', 'text/css; charset=utf-8']]
]);

export function attachChannelAccounts(runtime) {
  if (!runtime?.bots || !runtime?.connectSessions || !runtime?.connectors || typeof runtime.handler !== 'function') throw new Error('channel_accounts_require_base_runtime');
  if (runtime.channelAccounts) return runtime;
  const service = new ChannelAccountService(runtime);
  const nextHandler = runtime.handler;
  runtime.handler = channelAccountsHandler({ nextHandler, service, config: runtime.config, logger: runtime.router?.logger });
  runtime.channelAccounts = service;
  return runtime;
}

export class ChannelAccountService {
  constructor(runtime) { this.runtime = runtime; }

  catalog() {
    const connectorStatus = {};
    for (const connector of Object.values(this.runtime.connectors || {})) connectorStatus[connector.id] = connector.status();
    return channelAccountCatalog({ connectorStatus });
  }

  async connect({ botId, accountTypeId }) {
    const bot = await this.runtime.bots.get(botId);
    if (!bot) throw new HttpError(404, 'Bot not found', 'bot_not_found');
    const account = channelAccountType(accountTypeId);
    if (!account) throw new HttpError(400, 'Unknown channel account type', 'channel_account_type_unknown');
    if (!account.connectable) {
      throw new HttpError(409, account.note || 'This account type cannot be used for automated replies', account.capabilities?.identityLogin ? 'identity_only_account' : 'channel_adapter_not_ready');
    }
    if (!canAutoReplyAccount(account.id)) throw new HttpError(409, 'This account type does not grant automated messaging rights', 'auto_reply_not_allowed');

    if (account.channel === 'web') {
      const updated = await this.runtime.bots.upsertChannel(bot.id, 'web', {
        status: 'connected', connectionId: 'web-widget', accountType: account.id, autoReplyAllowed: true, connectedAt: new Date().toISOString()
      });
      return { instant: true, bot: updated, account };
    }

    if (!this.runtime.connectors[account.channel]) throw new HttpError(409, 'The channel adapter is not enabled in this Bot Hub runtime', 'channel_adapter_not_ready');
    const session = this.runtime.connectSessions.create({ botId: bot.id, channel: account.channel });
    await this.runtime.bots.upsertChannel(bot.id, account.channel, {
      status: 'pending', connectionId: session.token, accountType: account.id, autoReplyAllowed: false
    });
    let svg = null;
    try { svg = qrSvg(session.connectionUrl); } catch {}
    return { session: { ...session, accountType: account.id }, qrSvg: svg, account };
  }
}

export function channelAccountsHandler({ nextHandler, service, config, logger }) {
  return async (request, response) => {
    const url = new URL(request.url || '/', config.publicBaseUrl || `http://${request.headers.host || 'localhost'}`);
    try {
      if (request.method === 'GET' && assets.has(url.pathname)) {
        const [file, contentType] = assets.get(url.pathname);
        const body = await readFile(path.join(publicDir, file), 'utf8');
        return text(response, 200, body, contentType);
      }
      if (request.method === 'GET' && url.pathname === '/api/channel-accounts/catalog') {
        return json(response, 200, { accounts: service.catalog() });
      }
      if (request.method === 'POST' && url.pathname === '/api/channel-accounts/connect') {
        return json(response, 201, await service.connect(await requestJson(request, config.maxBodyBytes)));
      }
    } catch (error) {
      const statusCode = error instanceof HttpError ? error.statusCode : 500;
      logger?.error?.({ event: 'channel_account_api_failed', method: request.method, path: url.pathname, statusCode, reason: error?.message || 'unknown' });
      return json(response, statusCode, {
        error: error instanceof HttpError ? error.code : 'channel_account_failed',
        message: statusCode >= 500 ? 'Channel account operation failed' : error.message
      });
    }
    return nextHandler(request, response);
  };
}

async function requestJson(request, maxBodyBytes) {
  const raw = await readRawBody(request, maxBodyBytes);
  return raw.length ? parseJson(raw) : {};
}
