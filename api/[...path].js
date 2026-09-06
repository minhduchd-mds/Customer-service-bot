const ALLOWED_PREFIXES = [
  'health', 'bots', 'channels', 'metrics', 'scenario-templates', 'deployment',
  'skills', 'tool-policy', 'traces', 'connect', 'knowledge', 'simulate',
  'conversations', 'tickets', 'maintenance'
];

export default async function handler(request, response) {
  const runtimeBase = normalizeRuntimeBase(process.env.BOT_RUNTIME_URL || '');
  if (!runtimeBase) {
    return response.status(503).json({
      error: 'runtime_not_configured',
      message: 'Set BOT_RUNTIME_URL in Vercel to the public HTTPS URL of the Docker/VPS Bot Hub runtime.'
    });
  }

  const segments = Array.isArray(request.query?.path)
    ? request.query.path
    : String(request.query?.path || '').split('/').filter(Boolean);
  const relative = segments.map((segment) => encodeURIComponent(decodeURIComponent(segment))).join('/');
  const first = segments[0] || '';
  if (!ALLOWED_PREFIXES.includes(first)) {
    return response.status(404).json({ error: 'not_found' });
  }

  const target = new URL(`/api/${relative}`, runtimeBase);
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

  const user = process.env.BOT_RUNTIME_ADMIN_USER || 'admin';
  const token = process.env.BOT_RUNTIME_ADMIN_TOKEN || '';
  if (token) headers.authorization = `Basic ${Buffer.from(`${user}:${token}`).toString('base64')}`;

  const method = request.method || 'GET';
  const init = { method, headers, redirect: 'manual', signal: AbortSignal.timeout(25_000) };
  if (!['GET', 'HEAD'].includes(method)) init.body = serializeBody(request.body, headers['content-type']);

  try {
    const upstream = await fetch(target, init);
    const body = Buffer.from(await upstream.arrayBuffer());
    response.status(upstream.status);
    const contentType = upstream.headers.get('content-type');
    if (contentType) response.setHeader('content-type', contentType);
    response.setHeader('cache-control', 'no-store');
    return response.send(body);
  } catch (error) {
    return response.status(502).json({
      error: 'runtime_unreachable',
      message: 'The hosted console could not reach the configured Bot Hub runtime.'
    });
  }
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
