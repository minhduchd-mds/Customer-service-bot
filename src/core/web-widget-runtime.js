import { randomUUID } from 'node:crypto';
import { HttpError, json, parseJson, readRawBody, text } from '../lib/http.js';

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
  runtime.handler = webWidgetHandler({ nextHandler, runtime });
  runtime.webWidget = { enabled: Boolean(runtime.config.webWidget?.enabled) };
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
        await runtime.bots.get(botId);
        return text(response, 200, widgetFrame({ botId, title: url.searchParams.get('title') || 'Chat with us' }), 'text/html; charset=utf-8');
      }

      const messageMatch = url.pathname.match(/^\/api\/widget\/([^/]+)\/message$/);
      if (messageMatch && request.method === 'OPTIONS') return cors(response, runtime, request, 204);
      if (messageMatch && request.method === 'POST') {
        assertWidgetOrigin(runtime, request);
        const botId = decodeURIComponent(messageMatch[1]);
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
        return cors(response, runtime, request, 200, {
          ok: result.accepted === true,
          botId,
          sessionId: requestPayload.sessionId,
          reply: result.reply || 'Mình đã nhận được tin nhắn. Nhân viên sẽ hỗ trợ tiếp.',
          intent: result.intent || null,
          handoff: Boolean(result.handoff),
          responseSource: result.responseSource || null,
          traceId: result.traceId || null
        });
      }
    } catch (error) {
      const statusCode = error instanceof HttpError ? error.statusCode : 500;
      const body = {
        error: error instanceof HttpError ? error.code : 'widget_failed',
        message: statusCode >= 500 ? 'Widget request failed' : error.message
      };
      if (url.pathname.startsWith('/api/widget/')) return cors(response, runtime, request, statusCode, body);
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
  if (!botId || document.querySelector('[data-bot-hub-widget-root]')) return;
  const root = document.createElement('div');
  root.dataset.botHubWidgetRoot = 'true';
  root.innerHTML = '<button aria-label="Open chat" style="position:fixed;right:22px;bottom:22px;z-index:2147483646;border:0;border-radius:999px;background:#111;color:#fff;padding:15px 18px;font:600 14px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;box-shadow:0 18px 55px rgba(0,0,0,.22);cursor:pointer">Chat</button><iframe title="Bot Hub Chat" style="position:fixed;right:22px;bottom:82px;width:min(380px,calc(100vw - 32px));height:min(560px,calc(100vh - 110px));border:0;border-radius:24px;box-shadow:0 22px 75px rgba(0,0,0,.25);z-index:2147483646;display:none;background:#fff"></iframe>';
  const button = root.querySelector('button');
  const frame = root.querySelector('iframe');
  frame.src = apiBase + '/widget.html?botId=' + encodeURIComponent(botId) + '&title=' + encodeURIComponent(title);
  button.addEventListener('click', () => { frame.style.display = frame.style.display === 'none' ? 'block' : 'none'; });
  document.body.append(root);
})();`;
}

function widgetFrame({ botId, title }) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f5f5f7;color:#1d1d1f}.wrap{height:100vh;display:grid;grid-template-rows:auto 1fr auto}.head{padding:18px 18px 14px;background:rgba(255,255,255,.88);border-bottom:1px solid rgba(0,0,0,.08);backdrop-filter:blur(18px)}.head strong{display:block;font-size:16px}.head span{display:block;color:#6e6e73;font-size:12px;margin-top:3px}.log{padding:16px;overflow:auto;display:flex;flex-direction:column;gap:10px}.msg{max-width:82%;padding:10px 12px;border-radius:16px;background:#fff;box-shadow:0 3px 12px rgba(0,0,0,.045);font-size:13px;line-height:1.45}.me{align-self:flex-end;background:#0071e3;color:#fff}.bot{align-self:flex-start}.form{display:flex;gap:8px;padding:12px;background:#fff;border-top:1px solid rgba(0,0,0,.08)}input{flex:1;border:1px solid rgba(0,0,0,.12);border-radius:14px;padding:12px;font:inherit}button{border:0;border-radius:14px;background:#111;color:#fff;padding:0 14px;font-weight:700;cursor:pointer}.hint{font-size:11px;color:#86868b;padding:0 16px 12px;background:#fff}</style></head><body><main class="wrap"><header class="head"><strong>${escapeHtml(title)}</strong><span>Bot Hub Web Chat · secure public widget</span></header><section class="log" id="log"><div class="msg bot">Chào anh/chị, em có thể hỗ trợ gì?</div></section><form class="form" id="form"><input id="input" maxlength="2000" autocomplete="off" placeholder="Nhập tin nhắn..."><button>Gửi</button></form><div class="hint">Không nhập mật khẩu, OTP hoặc thông tin thẻ thanh toán.</div></main><script>const botId=${JSON.stringify(botId)};const sid=localStorage.getItem('botHubWidgetSession')||('web_'+crypto.randomUUID());localStorage.setItem('botHubWidgetSession',sid);const log=document.getElementById('log');const input=document.getElementById('input');document.getElementById('form').addEventListener('submit',async(e)=>{e.preventDefault();const text=input.value.trim();if(!text)return;input.value='';add(text,'me');try{const r=await fetch('/api/widget/'+encodeURIComponent(botId)+'/message',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text,sessionId:sid})});const data=await r.json();add(data.reply||'Em đã nhận được tin nhắn.','bot')}catch{add('Kết nối đang lỗi, anh/chị thử lại sau giúp em.','bot')}});function add(text,kind){const div=document.createElement('div');div.className='msg '+kind;div.textContent=text;log.append(div);log.scrollTop=log.scrollHeight}</script></body></html>`;
}

function assertWidgetOrigin(runtime, request) {
  const allowed = runtime.config.webWidget?.allowedOrigins || [];
  const origin = String(request.headers.origin || '').replace(/\/$/, '');
  if (!origin || !allowed.length) return true;
  if (allowed.map((item) => String(item).replace(/\/$/, '')).includes(origin)) return true;
  throw new HttpError(403, 'Widget origin is not allowed', 'widget_origin_denied');
}

function cors(response, runtime, request, statusCode, payload = null) {
  const origin = String(request.headers.origin || '').replace(/\/$/, '');
  const allowed = runtime.config.webWidget?.allowedOrigins || [];
  const allowOrigin = origin && (!allowed.length || allowed.map((item) => String(item).replace(/\/$/, '')).includes(origin)) ? origin : '';
  const body = payload == null ? '' : JSON.stringify(payload);
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...(allowOrigin ? { 'access-control-allow-origin': allowOrigin, 'vary': 'Origin', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type' } : {})
  });
  response.end(body);
}

async function requestJson(request, maxBodyBytes) {
  const raw = await readRawBody(request, maxBodyBytes);
  if (!raw.length) return {};
  return parseJson(raw);
}

function clean(value, max = 500) { return String(value || '').replace(/\u0000/g, '').trim().slice(0, Math.max(1, Number(max) || 500)); }
function escapeHtml(value = '') { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
function escapeJs(value = '') { return String(value).replace(/[\\'\n\r]/g, (char) => ({ '\\': '\\\\', "'": "\\'", '\n': '\\n', '\r': '\\r' }[char])); }
