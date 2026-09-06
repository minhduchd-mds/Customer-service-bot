import { createHash, timingSafeEqual } from 'node:crypto';

const PUBLIC_PREFIXES = ['/webhooks/', '/connect/', '/api/widget/'];
const PUBLIC_EXACT = new Set(['/api/health', '/widget.js', '/widget.html']);

function digest(value) {
  return createHash('sha256').update(String(value || '')).digest();
}

function safeEqualText(left, right) {
  return timingSafeEqual(digest(left), digest(right));
}

export function isLoopbackAddress(address = '') {
  const value = String(address || '').toLowerCase();
  if (value === '::1' || value === '127.0.0.1') return true;
  if (value.startsWith('::ffff:127.')) return true;
  return /^127(?:\.\d{1,3}){3}$/.test(value);
}

export function isPublicRuntimePath(pathname = '/') {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function basicCredentials(header = '') {
  const match = String(header || '').match(/^Basic\s+(.+)$/i);
  if (!match) return null;
  try {
    const decoded = Buffer.from(match[1], 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator < 0) return null;
    return { user: decoded.slice(0, separator), token: decoded.slice(separator + 1) };
  } catch {
    return null;
  }
}

export class AdminAuth {
  constructor({ user = 'admin', token = '' } = {}) {
    this.user = String(user || 'admin').slice(0, 80);
    this.token = String(token || '');
  }

  get configured() {
    return Boolean(this.token);
  }

  mode() {
    return this.configured ? 'basic-auth' : 'loopback-only';
  }

  authorize(request) {
    if (!this.configured) return isLoopbackAddress(request?.socket?.remoteAddress || '');
    const credentials = basicCredentials(request?.headers?.authorization || '');
    if (!credentials) return false;
    return safeEqualText(credentials.user, this.user) && safeEqualText(credentials.token, this.token);
  }

  reject(request, response) {
    const isApi = String(request?.url || '').startsWith('/api/');
    const statusCode = this.configured ? 401 : 503;
    const payload = this.configured
      ? { error: 'admin_auth_required', message: 'Administrator authentication is required.' }
      : { error: 'admin_auth_not_configured', message: 'Remote management is disabled until BOT_HUB_ADMIN_TOKEN is configured.' };
    const body = isApi ? JSON.stringify(payload) : `${payload.message}\n`;
    response.writeHead(statusCode, {
      'content-type': isApi ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
      'content-length': Buffer.byteLength(body),
      'cache-control': 'no-store',
      ...(this.configured ? { 'www-authenticate': 'Basic realm="Bot Hub Admin", charset="UTF-8"' } : {})
    });
    response.end(body);
  }
}

export function protectAdminSurface(handler, auth) {
  return (request, response) => {
    let pathname = '/';
    try {
      pathname = new URL(request.url || '/', 'http://bot-hub.local').pathname;
    } catch {
      response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      response.end('Bad request');
      return;
    }

    if (isPublicRuntimePath(pathname) || auth.authorize(request)) return handler(request, response);
    return auth.reject(request, response);
  };
}
