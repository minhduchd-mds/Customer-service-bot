import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ConversationLedger } from './conversation-ledger.js';
import { HttpError, json, parseJson, readRawBody } from '../lib/http.js';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');
const inboxAssets = new Map([
  ['/inbox.js', ['inbox.js', 'text/javascript; charset=utf-8']],
  ['/inbox.css', ['inbox.css', 'text/css; charset=utf-8']]
]);

export function attachConversationPersistence(runtime) {
  if (!runtime?.router || !runtime?.config || typeof runtime?.handler !== 'function') throw new Error('invalid_runtime');
  if (runtime.conversations) return runtime;

  const ledger = new ConversationLedger({ ...(runtime.config.conversations || {}), logger: runtime.router.logger });
  const originalHandle = runtime.router.handle.bind(runtime.router);
  runtime.router.handle = async (input = {}) => {
    const result = await originalHandle(input);
    const shouldStore = input.dispatch !== false && result?.accepted === true && !result.duplicate && !result.ignored && result.event;
    if (!shouldStore) return result;
    try {
      result.persistence = await ledger.recordTurn({
        botId: result.botId || input.bot?.id || null,
        event: result.event,
        intent: result.intent || null,
        skill: result.skill || null,
        reply: result.reply || '',
        handoff: Boolean(result.handoff),
        responseSource: result.responseSource || null
      });
    } catch (error) {
      runtime.router.logger?.warn?.({ event: 'conversation_persistence_failed', reason: error?.message || 'unknown' });
      result.persistence = { stored: false, reason: 'persistence_failed' };
    }
    return result;
  };

  const nextHandler = runtime.handler;
  runtime.handler = conversationManagementHandler({ nextHandler, ledger, config: runtime.config, logger: runtime.router.logger });
  runtime.conversations = ledger;
  return runtime;
}

export function conversationManagementHandler({ nextHandler, ledger, config, logger }) {
  return async (request, response) => {
    const url = new URL(request.url || '/', config.publicBaseUrl || `http://${request.headers.host || 'localhost'}`);
    try {
      if (request.method === 'GET' && inboxAssets.has(url.pathname)) {
        const [file, contentType] = inboxAssets.get(url.pathname);
        return sendAsset(response, await readFile(path.join(publicDir, file), 'utf8'), contentType);
      }

      if (request.method === 'GET' && url.pathname === '/api/conversations') {
        return json(response, 200, {
          conversations: ledger.listConversations({
            botId: url.searchParams.get('botId'),
            status: url.searchParams.get('status'),
            query: url.searchParams.get('q'),
            limit: url.searchParams.get('limit')
          })
        });
      }

      const conversationMatch = url.pathname.match(/^\/api\/conversations\/(conv_[a-f0-9]+)$/);
      if (conversationMatch && request.method === 'GET') {
        const conversation = ledger.getConversation(conversationMatch[1], { messageLimit: url.searchParams.get('messageLimit') });
        if (!conversation) throw new HttpError(404, 'Conversation not found', 'conversation_not_found');
        return json(response, 200, { conversation });
      }
      if (conversationMatch && request.method === 'PATCH') {
        const payload = await requestJson(request, config.maxBodyBytes);
        const conversation = ledger.updateConversation(conversationMatch[1], payload);
        if (!conversation) throw new HttpError(404, 'Conversation not found', 'conversation_not_found');
        return json(response, 200, { conversation });
      }
      if (conversationMatch && request.method === 'DELETE') {
        if (!ledger.deleteConversation(conversationMatch[1])) throw new HttpError(404, 'Conversation not found', 'conversation_not_found');
        return json(response, 200, { deleted: true, id: conversationMatch[1] });
      }

      if (request.method === 'GET' && url.pathname === '/api/tickets') {
        return json(response, 200, {
          tickets: ledger.listTickets({
            botId: url.searchParams.get('botId'),
            status: url.searchParams.get('status'),
            limit: url.searchParams.get('limit')
          })
        });
      }
      const ticketMatch = url.pathname.match(/^\/api\/tickets\/(ticket_[A-Za-z0-9-]+)$/);
      if (ticketMatch && request.method === 'PATCH') {
        const payload = await requestJson(request, config.maxBodyBytes);
        const ticket = ledger.updateTicket(ticketMatch[1], payload);
        if (!ticket) throw new HttpError(404, 'Ticket not found', 'ticket_not_found');
        return json(response, 200, { ticket });
      }

      if (request.method === 'POST' && url.pathname === '/api/maintenance/conversation-retention') {
        return json(response, 200, { retention: ledger.prune() });
      }
    } catch (error) {
      const validation = {
        invalid_conversation_status: 'Conversation status is invalid',
        invalid_ticket_status: 'Ticket status is invalid',
        invalid_ticket_priority: 'Ticket priority is invalid'
      };
      if (validation[error?.code]) return json(response, 400, { error: error.code, message: validation[error.code] });
      const statusCode = error instanceof HttpError ? error.statusCode : 500;
      logger?.error?.({ event: 'conversation_api_failed', method: request.method, path: url.pathname, statusCode, reason: error?.message || 'unknown' });
      return json(response, statusCode, {
        error: error instanceof HttpError ? error.code : 'internal_error',
        message: statusCode >= 500 ? 'Internal server error' : error.message
      });
    }
    return nextHandler(request, response);
  };
}

async function requestJson(request, maxBodyBytes) {
  return parseJson(await readRawBody(request, maxBodyBytes));
}

function sendAsset(response, body, contentType) {
  response.writeHead(200, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  response.end(body);
}
