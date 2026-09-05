export class HttpError extends Error {
  constructor(statusCode, message, code = 'request_error') {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export async function readRawBody(request, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new HttpError(413, 'Request body is too large', 'body_too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function parseJson(rawBody) {
  if (!rawBody.length) return {};
  try {
    return JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new HttpError(400, 'Invalid JSON payload', 'invalid_json');
  }
}

export function json(response, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...extraHeaders
  });
  response.end(body);
}

export function text(response, statusCode, body, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(statusCode, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  response.end(body);
}
