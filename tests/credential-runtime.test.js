import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { attachCredentialVault } from '../src/core/credential-runtime.js';

async function withRuntime(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'credential-runtime-'));
  const runtime = {
    config: {
      publicBaseUrl: 'http://127.0.0.1',
      maxBodyBytes: 1024 * 1024,
      credentials: { file: path.join(dir, 'credentials.json'), masterKey: 'runtime-test-key' }
    },
    router: { logger: { error() {} } },
    handler(_request, response) { response.writeHead(404, { 'content-type': 'application/json' }); response.end('{"error":"not_found"}'); }
  };
  await attachCredentialVault(runtime);
  const server = http.createServer(runtime.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try { await run({ runtime, origin }); } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
}

async function api(origin, pathname, options = {}) {
  const response = await fetch(`${origin}${pathname}`, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  return { response, payload: await response.json() };
}

test('credential runtime saves and lists only public credential metadata', async () => {
  await withRuntime(async ({ origin }) => {
    const status = await api(origin, '/api/credentials/status');
    assert.equal(status.response.status, 200);
    assert.equal(status.payload.vault.enabled, true);

    const created = await api(origin, '/api/credentials', {
      method: 'POST',
      body: JSON.stringify({ botId: 'bot-a', type: 'facebook', name: 'Page', secrets: { pageAccessToken: 'page-secret' }, metadata: { pageId: '123' } })
    });
    assert.equal(created.response.status, 201);
    assert.equal(JSON.stringify(created.payload).includes('page-secret'), false);
    assert.deepEqual(created.payload.credential.secretKeys, ['pageAccessToken']);

    const listed = await api(origin, '/api/credentials?botId=bot-a');
    assert.equal(listed.payload.credentials.length, 1);
    assert.equal(JSON.stringify(listed.payload).includes('page-secret'), false);

    const deleted = await api(origin, `/api/credentials/${created.payload.credential.id}`, { method: 'DELETE' });
    assert.equal(deleted.payload.deleted, true);
  });
});
