const WIDGET_PUBLIC_EXACT = new Set(['/widget.js', '/widget.html']);

export function isWidgetPublicPath(pathname = '/') {
  return WIDGET_PUBLIC_EXACT.has(pathname) || pathname.startsWith('/api/widget/');
}

export function applyWebConsoleCors(request, response, { origins = [] } = {}) {
  let pathname = '/';
  try { pathname = new URL(request.url || '/', 'http://bot-hub.local').pathname; } catch {}
  if (isWidgetPublicPath(pathname)) return { handled: false, allowed: true, skipped: 'widget' };

  const origin = String(request.headers?.origin || '').trim();
  if (!origin) return { handled: false, allowed: true };

  const requestOrigin = normalizeOrigin(origin);
  const host = String(request.headers?.host || '').trim();
  const sameOrigin = requestOrigin && host && new URL(requestOrigin).host === host;
  const allowed = sameOrigin || origins.some((item) => normalizeOrigin(item) === requestOrigin);

  if (!allowed) {
    response.writeHead(403, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    });
    response.end(JSON.stringify({ error: 'origin_not_allowed' }));
    return { handled: true, allowed: false };
  }

  response.setHeader('access-control-allow-origin', requestOrigin);
  response.setHeader('vary', 'Origin');
  response.setHeader('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  response.setHeader('access-control-allow-headers', 'content-type,authorization,x-bot-hub-console');
  response.setHeader('access-control-max-age', '600');
  if (String(request.headers['access-control-request-private-network'] || '').toLowerCase() === 'true') {
    response.setHeader('access-control-allow-private-network', 'true');
  }

  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return { handled: true, allowed: true };
  }
  return { handled: false, allowed: true };
}

function normalizeOrigin(value) {
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    return url.origin;
  } catch {
    return '';
  }
}
