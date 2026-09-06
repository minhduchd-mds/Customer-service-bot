import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { HttpError, json, parseJson, readRawBody } from '../lib/http.js';
import { OperationsCenter } from './operations-center.js';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');
const assets = new Map([
  ['/operations.js', ['operations.js', 'text/javascript; charset=utf-8']],
  ['/operations.css', ['operations.css', 'text/css; charset=utf-8']]
]);

export function attachOperationsCenter(runtime) {
  if (!runtime?.conversations || !runtime?.config || typeof runtime.handler !== 'function') throw new Error('operations_requires_conversation_runtime');
  if (runtime.operations) return runtime;

  const center = new OperationsCenter(runtime);
  const nextHandler = runtime.handler;
  runtime.handler = operationsHandler({ nextHandler, center, config: runtime.config, logger: runtime.router?.logger });
  runtime.operations = center;
  return runtime;
}

export function operationsHandler({ nextHandler, center, config, logger }) {
  return async (request, response) => {
    const url = new URL(request.url || '/', config.publicBaseUrl || `http://${request.headers.host || 'localhost'}`);
    try {
      if (request.method === 'GET' && assets.has(url.pathname)) {
        const [file, contentType] = assets.get(url.pathname);
        const body = await readFile(path.join(publicDir, file), 'utf8');
        response.writeHead(200, { 'content-type': contentType, 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
        response.end(body);
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/operations/doctor') {
        return json(response, 200, { doctor: await center.doctor() });
      }
      if (request.method === 'GET' && url.pathname === '/api/operations/backups') {
        return json(response, 200, { backups: await center.listBackups({ limit: url.searchParams.get('limit') }) });
      }
      if (request.method === 'POST' && url.pathname === '/api/operations/backups') {
        const payload = await requestJson(request, config.maxBodyBytes);
        return json(response, 201, { backup: await center.createBackup({ label: payload.label || 'manual' }) });
      }
      if (request.method === 'POST' && url.pathname === '/api/operations/repair') {
        return json(response, 200, { repair: await center.repair() });
      }
    } catch (error) {
      const statusCode = error instanceof HttpError ? error.statusCode : 500;
      logger?.error?.({ event: 'operations_api_failed', method: request.method, path: url.pathname, statusCode, reason: error?.message || 'unknown' });
      return json(response, statusCode, {
        error: error instanceof HttpError ? error.code : 'operations_failed',
        message: statusCode >= 500 ? 'Operations task failed' : error.message
      });
    }
    return nextHandler(request, response);
  };
}

async function requestJson(request, maxBodyBytes) {
  const raw = await readRawBody(request, maxBodyBytes);
  if (!raw.length) return {};
  return parseJson(raw);
}
