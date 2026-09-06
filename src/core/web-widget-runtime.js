import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { HttpError, json, parseJson, readRawBody, text } from '../lib/http.js';

const PROCESS_WIDGET_KEY = randomBytes(32);

const widgetConnector = {
  status() { return { channel: 'web', configured: true, outbound: true, notes: ['Embedded web widget runtime'] }; },
  verify() { return { ok: true, reason: 'widget-public-endpoint' }; },
  normalize(payload = {}) {
    const now = Date.now();
    const sessionId = clean(payload.sessionId || payload.visitorId || `visitor-${randomUUID()}`, 160);
    return {
      channel: 'web',
      eventId: clean(payload.eventId || `web-${now}-${randomUUID()}`, 220),
      eventType: 'message',
      senderId: sessionId,
      conversationId: sessionId,
      recipientId: clean(payload.botId || 'bot', 128),
      text: clean(payload.text || '', 4000),
      timestamp: now,
      replyAllowed: true
    };
  },
  async send() { return { delivered: true, mode: 'widget-response' }; }
};

export function attachWebWidget(runtime) {
  if (!runtime?.router || !runtime?.bots || !runtime?.config || typeof runtime.handler !== 'function') throw new Error('web_widget_requires_bot_runtime');
  if (runtime.webWidget) return runtime;
  const nextHandler = runtime.handler;
  const signingKey = resolveSigningKey(runtime);
  runtime.webWidget = {
    enabled: Boolean(runtime.config.webWidget?.enabled),
    signingKey,
    signingMode: runtime.config.webWidget?.signingKey ? 'env-key' : (runtime.credentialVault?.key ? 'vault-key' : 'ephemeral-key')
  };
  runtime.handler = webWidgetHandler({ nextHandler, runtime });
  return runtime;
}

export function webWidgetHandler({ nextHandler, runtime }) {
  return async (request, response) => {
    const url = new URL(request.url || '/', runtime.config.publicBaseUrl || `http://${request.headers.host || 'localhost'}`);
    try {
      if (!runtime.config.webWidget?.enabled) return nextHandler(request, response);

      if (request.method === 'GET' && url.pathname === '/widget.js') {
        return text(response, 200, widgetScript(url), 'text/javascript; charset=utf-8');
      }

      if (request.method === 'GET' && url.pathname === '/widget.html') {
        const botId = clean(url.searchParams.get('botId'), 128);
        if (!botId) throw new HttpError(400, 'botId is required', 'bot_id_required');
        const bot = await runtime.bots.get(botId);
        if (!bot) throw new HttpError(404, 'Bot not found', 'bot_not_found');
        const runtimeOrigin = requestRuntimeOrigin(request, runtime);
        const requestedParent = normalizeOrigin(url.searchParams.get('parentOrigin')) || runtimeOrigin;
        assertParentOriginAllowed(runtime, requestedParent, runtimeOrigin);
        const expiresAt = Date.now() + (runtime.config.webWidget.tokenTtlSeconds || 900) * 1000;
        const token = signWidgetGrant({ botId, parentOrigin: requestedParent, expiresAt }, runtime.webWidget.signingKey);
        return widgetHtml(response, widgetFrame({ botId, title: url.searchParams.get('title') || bot.name || 'Chat with us', parentOrigin: requestedParent, token }), requestedParent, runtimeOrigin);
      }

      const messageMatch = url.pathname.match(/^\/api\/widget\/([^/]+)\/message$/);
      if (messageMatch && request.method === 'OPTIONS') {
        const origin = normalizeOrigin(request.headers.origin);
        const runtimeOrigin = requestRuntimeOrigin(request, runtime);
        if (!origin || !isParentOriginAllowed(runtime, origin, runtimeOrigin)) throw new HttpError(403, 'Widget origin is not allowed', 'widget_origin_denied');
        return widgetApi(response, 204, null, origin);
      }

      if (messageMatch && request.method === 'POST') {
        const botId = decodeURIComponent(messageMatch[1]);
        const grant = verifyWidgetGrant(String(request.headers['x-bot-hub-widget-token'] || ''), runtime.webWidget.signingKey);
        if (!grant || grant.botId !== botId) throw new HttpError(403, 'Widget token is invalid or expired', 'widget_token_invalid');
        const runtimeOrigin = requestRuntimeOrigin(request, runtime);
        if (!isParentOriginAllowed(runtime, grant.parentOrigin, runtimeOrigin)) throw new HttpError(403, 'Widget origin is not allowed', 'widget_origin_denied');
        const requestOrigin = normalizeOrigin(request.headers.origin);
        if (requestOrigin && requestOrigin !== runtimeOrigin && requestOrigin !== grant.parentOrigin) throw new HttpError(403, 'Widget request origin is not allowed', 'widget_origin_denied');

        const bot = await runtime.bots.get(botId);
        if (!bot) throw new HttpError(404, 'Bot not found', 'bot_not_found');
        const payload = await requestJson(request, runtime.config.maxBodyBytes);
        const value = clean(payload.text, runtime.config.webWidget.maxMessageChars || 2000);
        if (!value) throw new HttpError(400, 'Message text is required', 'message_required');
        const requestPayload = {
          botId,
          text: value,
          sessionId: clean(payload.sessionId || `visitor-${randomUUID()}`, 160),
          eventId: clean(payload.eventId || `web-${Date.now()}-${randomUUID()}`, 220)
        };
        const result = await runtime.router.handle({
          connector: widgetConnector,
          rawBody: Buffer.from(JSON.stringify(requestPayload)),
          payload: requestPayload,
          headers: request.headers,
          url,
          dispatch: true,
          skipVerification: true,
          bot
        });
        return widgetApi(response, 200, {
          ok: result.accepted === true,
          botId,
          sessionId: requestPayload.sessionId,
          reply: result.reply || 'Mình đã nhận được tin nhắn. Nhân viên sẽ hỗ trợ tiếp.',
          intent: result.intent || null,
          handoff: Boolean(result.handoff),
          responseSource: result.responseSource || null,
          traceId: result.traceId || null
        }, requestOrigin === grant.parentOrigin ? grant.parentOrigin : '');
      }
    } catch (error) {
      const statusCode = error instanceof HttpError ? error.statusCode : 500;
      const body = {
        error: error instanceof HttpError ? error.code : 'widget_failed',
        message: statusCode >= 500 ? 'Widget request failed' : error.message
      };
      if (url.pathname.startsWith('/api/widget/')) return widgetApi(response, statusCode, body, '');
      return json(response, statusCode, body);
    }
    return nextHandler(request, response);
  };
}

function widgetScript(url) {
  const defaultBotId = clean(url.searchParams.get('botId'), 128);
  return `(() => {
  const current = document.currentScript;
  const botId = current?.dataset?.botId || '${escapeJs(defaultBotId)}';
  const title = current?.dataset?.title || 'Chat with us';
  const apiBase = new URL(current?.src || location.href).origin;
  const parentOrigin = location.origin;
  if (!botId || document.querySelector('[data-bot-hub-widget-root]')) return;
  const root = document.createElement('div');
  root.dataset.botHubWidgetRoot = 'true';
  root.innerHTML = '<button aria-label="Open chat" style="position:fixed;right:22px;bottom:22px;z-index:2147483646;border:0;border-radius:999px;background:#111;color:#fff;padding:15px 18px;font:600 14px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;box-shadow:0 18px 55px rgba(0,0,0,.22);cursor:pointer">Chat</button><iframe title="Bot Hub Chat" referrerpolicy="strict-origin" style="position:fixed;right:22px;bottom:82px;width:min(380px,calc(100vw - 32px));height:min(560px,calc(100vh - 110px));border:0;border-radius:24px;box-shadow:0 22px 75px rgba(0,0,0,.25);z-index:2147483646;display:none;background:#fff"></iframe>';
  const button = root.querySelector('button');
  const frame = root.querySelector('iframe');
  frame.src = apiBase + '/widget.html?botId=' + encodeURIComponent(botId) + '&title=' + encodeURIComponent(title) + '&parentOrigin=' + encodeURIComponent(parentOrigin);
  button.addEventListener('click', () => { frame.style.display = frame.style.display === 'none' ? 'block' : 'none'; });
  document.body.append(root);
})();`;
}

function widgetFrame({ botId, title, parentOrigin, token }) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f5f5f7;color:#1d1d1f}.wrap{height:100vh;display:grid;grid-template-rows:auto 1fr auto}.head{padding:18px 18px 14px;background:rgba(255,255,255,.88);border-bottom:1px solid rgba(0,0,0,.08);backdrop-filter:blur(18px)}.head strong{display:block;font-size:16px}.head span{display:block;color:#6e6e73;font-size:12px;margin-top:3px}.log{padding:16px;overflow:auto;display:flex;flex-direction:column;gap:10px}.msg{max-width:82%;padding:10px 12px;border-radius:16px;background:#fff;box-shadow:0 3px 12px rgba(0,0,0,.045);font-size:13px;line-height:1.45}.me{align-self:flex-end;background:#0071e3;color:#fff}.bot{align-self:flex-start}.form{display:flex;gap:8px;padding:12px;background:#fff;border-top:1px solid rgba(0,0,0,.08)}input{flex:1;border:1px solid rgba(0,0,0,.12);border-radius:14px;padding:12px;font:inherit}button{border:0;border-radius:14px;background:#111;color:#fff;padding:0 14px;font-weight:700;cursor:pointer}.hint{font-size:11px;color:#86868b;padding:0 16px 12px;background:#fff}</style></head><body><main class="wrap"><header class="head"><strong>${escapeHtml(title)}</strong><span>Bot Hub Web Chat · ${escapeHtml(parentOrigin)}</span></header><section class="log" id="log"><div class="msg bot">Chào anh/chị, em có thể hỗ trợ gì?</div></section><form class="form" id="form"><input id="input" maxlength="2000" autocomplete="off" placeholder="Nhập tin nhắn..."><button>Gửi</button></form><div class="hint">Không nhập mật khẩu, OTP hoặc thông tin thẻ thanh toán.</div></main><script>const botId=${JSON.stringify(botId)};const token=${JSON.stringify(token)};const originKey=${JSON.stringify(parentOrigin)};const storageKey='botHubWidgetSession:'+botId+':'+originKey;const sid=sessionStorage.getItem(storageKey)||('web_'+crypto.randomUUID());sessionStorage.setItem(storageKey,sid);const log=document.getElementById('log');const input=document.getElementById('input');document.getElementById('form').addEventListener('submit',async(e)=>{e.preventDefault();const value=input.value.trim();if(!value)return;input.value='';add(value,'me');try{const r=await fetch('/api/widget/'+encodeURIComponent(botId)+'/message',{method:'POST',headers:{'content-type':'application/json','x-bot-hub-widget-token':token},body:JSON.stringify({text:value,sessionId:sid})});const data=await r.json();if(!r.ok)throw new Error(data.message||'request failed');add(data.reply||'Em đã nhận được tin nhắn.','bot')}catch{add('Kết nối đang lỗi, anh/chị thử lại sau giúp em.','bot')}});function add(value,kind){const div=document.createElement('div');div.className='msg '+kind;div.textContent=value;log.append(div);log.scrollTop=log.scrollHeight}</script></body></html>`;
}

export function signWidgetGrant({ botId, parentOrigin, expiresAt }, signingKey) {
  const body = Buffer.from(JSON.stringify({ b: clean(botId, 128), o: normalizeOrigin(parentOrigin), e: Number(expiresAt) || 0 })).toString('base64url');
  const signature = createHmac('sha256', signingKey).update(body).digest('base64url');
  return `v1.${body}.${signature}`;
}

export function verifyWidgetGrant(token, signingKey, now = Date.now()) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  const expected = createHmac('sha256', signingKey).update(parts[1]).digest();
  let actual;
  try { actual = Buffer.from(parts[2], 'base64url'); } catch { return null; }
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!payload?.b || !payload?.o || !Number.isFinite(payload?.e) || payload.e < now) return null;
    return { botId: clean(payload.b, 128), parentOrigin: normalizeOrigin(payload.o), expiresAt: payload.e };
  } catch {
    return null;
  }
}

function resolveSigningKey(runtime) {
  const configured = String(runtime.config.webWidget?.signingKey || '').trim();
  if (configured) return createHash('sha256').update(configured).digest();
  if (Buffer.isBuffer(runtime.credentialVault?.key) && runtime.credentialVault.key.length >= 32) return runtime.credentialVault.key.subarray(0, 32);
  return PROCESS_WIDGET_KEY;
}

function requestRuntimeOrigin(request, runtime) {
  const configured = normalizeOrigin(runtime.config.publicBaseUrl);
  if (configured) return configured;
  const host = String(request.headers.host || 'localhost');
  const proto = String(request.headers['x-forwarded-proto'] || (/^(localhost|127\.|\[::1\])/.test(host) ? 'http' : 'https')).split(',')[0].trim();
  return normalizeOrigin(`${proto}://${host}`) || 'http://localhost';
}

function assertParentOriginAllowed(runtime, parentOrigin, runtimeOrigin) {
  if (!isParentOriginAllowed(runtime, parentOrigin, runtimeOrigin)) throw new HttpError(403, 'Widget origin is not allowed', 'widget_origin_denied');
}

function isParentOriginAllowed(runtime, parentOrigin, runtimeOrigin) {
  const candidate = normalizeOrigin(parentOrigin);
  if (!candidate) return false;
  if (candidate === normalizeOrigin(runtimeOrigin)) return true;
  return (runtime.config.webWidget?.allowedOrigins || []).some((item) => normalizeOrigin(item) === candidate);
}

function widgetHtml(response, body, parentOrigin, runtimeOrigin) {
  const ancestor = parentOrigin === runtimeOrigin ? "'self'" : parentOrigin;
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'content-security-policy': `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors ${ancestor}; base-uri 'none'; form-action 'self'`,
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff'
  });
  response.end(body);
}

function widgetApi(response, statusCode, payload = null, allowOrigin = '') {
  const body = payload == null ? '' : JSON.stringify(payload);
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...(allowOrigin ? {
      'access-control-allow-origin': allowOrigin,
      'vary': 'Origin',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type,x-bot-hub-widget-token'
    } : {})
  });
  response.end(body);
}

async function requestJson(request, maxBodyBytes) {
  const raw = await readRawBody(request, maxBodyBytes);
  if (!raw.length) return {};
  return parseJson(raw);
}

function normalizeOrigin(value = '') {
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    return url.origin;
  } catch {
    return '';
  }
}

function clean(value, max = 500) { return String(value || '').replace(/\u0000/g, '').trim().slice(0, Math.max(1, Number(max) || 500)); }
function escapeHtml(value = '') { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
function escapeJs(value = '') { return String(value).replace(/[\\'\n\r]/g, (char) => ({ '\\': '\\\\', "'": "\\'", '\n': '\\n', '\r': '\\r' }[char])); }
