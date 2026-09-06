import { CredentialVault } from './credential-vault.js';
import { HttpError, json, parseJson, readRawBody } from '../lib/http.js';

export async function attachCredentialVault(runtime) {
  if (!runtime?.config || typeof runtime.handler !== 'function') throw new Error('invalid_runtime');
  if (runtime.credentialVault) return runtime;

  const vault = new CredentialVault(runtime.config.credentials || {});
  await vault.load();
  const nextHandler = runtime.handler;
  runtime.handler = credentialVaultHandler({ nextHandler, vault, config: runtime.config, logger: runtime.router?.logger });
  runtime.credentialVault = vault;
  return runtime;
}

export function credentialVaultHandler({ nextHandler, vault, config, logger }) {
  return async (request, response) => {
    const url = new URL(request.url || '/', config.publicBaseUrl || `http://${request.headers.host || 'localhost'}`);
    try {
      if (request.method === 'GET' && url.pathname === '/api/credentials/status') {
        return json(response, 200, { vault: vault.status() });
      }
      if (request.method === 'GET' && url.pathname === '/api/credentials') {
        return json(response, 200, { credentials: vault.list({ botId: url.searchParams.get('botId'), type: url.searchParams.get('type') }) });
      }
      if (request.method === 'POST' && url.pathname === '/api/credentials') {
        const payload = await requestJson(request, config.maxBodyBytes);
        return json(response, 201, { credential: await vault.save(payload) });
      }
      const match = url.pathname.match(/^\/api\/credentials\/(cred_[a-f0-9]+)$/);
      if (match && request.method === 'DELETE') {
        const deleted = await vault.delete(match[1]);
        if (!deleted) throw new HttpError(404, 'Credential not found', 'credential_not_found');
        return json(response, 200, { deleted: true, id: match[1] });
      }
    } catch (error) {
      const messages = {
        credential_vault_disabled: 'Credential vault is disabled. Set CREDENTIAL_VAULT_MASTER_KEY or enable a local desktop key before saving provider secrets.',
        credential_secret_required: 'At least one supported secret value is required.',
        invalid_ciphertext: 'Stored credential ciphertext is invalid.'
      };
      const statusCode = error instanceof HttpError ? error.statusCode : (messages[error?.code] ? 400 : 500);
      logger?.error?.({ event: 'credential_vault_api_failed', method: request.method, path: url.pathname, statusCode, reason: error?.message || 'unknown' });
      return json(response, statusCode, {
        error: error?.code || (statusCode >= 500 ? 'internal_error' : 'credential_error'),
        message: messages[error?.code] || (statusCode >= 500 ? 'Credential operation failed' : error.message)
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
