import handler from './[...path].js';
import { providerCatalog } from '../src/core/ai-provider-registry.js';

export default async function router(request, response) {
  const path = pathValue(request);
  if (!path.startsWith('ai/') && path !== 'ai') return handler(request, response);

  const runtimeBase = normalizeRuntimeBase(process.env.BOT_RUNTIME_URL || '');
  if (!runtimeBase) {
    if ((request.method || 'GET') === 'GET' && path === 'ai/providers') {
      return sendJson(response, 200, {
        providers: providerCatalog().map((item) => ({ ...item, oauthReady: false })),
        preview: true
      });
    }
    if ((request.method || 'GET') === 'GET' && path === 'ai/connections') {
      return sendJson(response, 200, { connections: [], preview: true });
    }
    return sendJson(response, 503, {
      error: 'live_runtime_required',
      message: 'AI credentials, model verification and OAuth are available only through a connected Bot Hub runtime. Configure BOT_RUNTIME_URL or use the Windows app.'
    });
  }

  try {
    return await proxyAiToRuntime({ request, response, runtimeBase, path });
  } catch (error) {
    return sendJson(response, 502, {
      error: 'runtime_unreachable',
      message: 'The hosted console could not reach the Bot Hub runtime for this AI account operation.',
      reason: String(error?.message || 'runtime_unreachable').slice(0, 240)
    });
  }
}

async function proxyAiToRuntime({ request, response, runtimeBase, path }) {
  const target = new URL(`/api/${path}`, runtimeBase);
  for (const [key, value] of Object.entries(request.query || {})) {
    if (key === 'path') continue;
    if (Array.isArray(value)) value.forEach((item) => target.searchParams.append(key, item));
    else if (value != null) target.searchParams.set(key, String(value));
  }
  const headers = {
    accept: request.headers.accept || 'application/json',
    'content-type': request.headers['content-type'] || 'application/json',
    'x-forwarded-host': request.headers.host || '',
    'x-forwarded-proto': request.headers['x-forwarded-proto'] || 'https',
    'x-bot-hub-console': 'vercel'
  };
  const token = process.env.BOT_RUNTIME_ADMIN_TOKEN || '';
  const user = process.env.BOT_RUNTIME_ADMIN_USER || 'admin';
  if (token) headers.authorization = `Basic ${Buffer.from(`${user}:${token}`).toString('base64')}`;

  const method = request.method || 'GET';
  const init = { method, headers, redirect: 'manual', signal: AbortSignal.timeout(25_000) };
  if (!['GET', 'HEAD'].includes(method)) init.body = serializeBody(request.body, headers['content-type']);
  const upstream = await fetch(target, init);
  const body = Buffer.from(await upstream.arrayBuffer());
  response.status(upstream.status);
  for (const name of ['content-type', 'location', 'cache-control']) {
    const value = upstream.headers.get(name);
    if (value) response.setHeader(name, value);
  }
  response.setHeader('cache-control', 'no-store');
  return response.send(body);
}

function pathValue(request) {
  const value = request.query?.path;
  if (Array.isArray(value)) return value.map((item) => String(item)).join('/').replace(/^\/+/, '');
  if (value) return String(value).replace(/^\/+/, '');
  try {
    return new URL(request.url || '/', 'https://bot-hub.invalid').pathname.replace(/^\/api\//, '').replace(/^\/+/, '');
  } catch {
    return '';
  }
}

function normalizeRuntimeBase(value) {
  try {
    if (!value) return '';
    const url = new URL(value);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) return '';
    if (url.username || url.password) return '';
    return url.toString().replace(/\/$/, '');
  } catch { return ''; }
}
function serializeBody(body, contentType) {
  if (body == null) return undefined;
  if (typeof body === 'string' || Buffer.isBuffer(body)) return body;
  if (String(contentType || '').includes('application/json')) return JSON.stringify(body);
  return String(body);
}
function sendJson(response, status, payload) {
  response.status(status);
  response.setHeader('cache-control', 'no-store');
  response.setHeader('content-type', 'application/json; charset=utf-8');
  return response.send(JSON.stringify(payload));
}
