import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('release metadata and deployment surfaces stay aligned for v0.7', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const vercel = JSON.parse(await readFile('vercel.json', 'utf8'));
  const env = await readFile('.env.example', 'utf8');
  const checkScript = await readFile('scripts/check.mjs', 'utf8');
  const desktopCompose = await readFile('docker-compose.desktop.yml', 'utf8');

  assert.equal(pkg.version, '0.7.0');
  assert.equal(pkg.engines.node, '22.x');
  assert.ok(vercel.rewrites.some((item) => item.source === '/api/:path*' && item.destination.includes('/api/router')));
  assert.match(env, /CREDENTIAL_VAULT_MASTER_KEY=/);
  assert.match(env, /WEB_WIDGET_SIGNING_KEY=/);
  assert.match(env, /BOT_RUNTIME_URL=/);
  assert.match(checkScript, /'api'/);
  assert.match(checkScript, /'desktop'/);
  assert.match(desktopCompose, /bot_state:\/app\/data\/state/);
});
