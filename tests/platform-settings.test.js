import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PlatformSettingsStore, deploymentEnv, deploymentSummary } from '../src/core/platform-settings.js';

test('deployment profile persists safe non-secret VPS settings', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'bot-hub-deploy-'));
  const file = path.join(dir, 'platform-settings.json');
  try {
    const store = new PlatformSettingsStore({ file });
    const saved = await store.update({
      mode: 'vps-docker',
      vpsHost: '203.0.113.10',
      sshUser: 'deploy',
      sshPort: 2222,
      botDomain: 'bot.example.com',
      n8nDomain: 'n8n.example.com',
      publicBaseUrl: 'https://bot.example.com/'
    });
    assert.equal(saved.publicBaseUrl, 'https://bot.example.com');
    assert.equal(saved.sshPort, 2222);

    const raw = await readFile(file, 'utf8');
    assert.doesNotMatch(raw, /password|privateKey|accessToken/i);

    const reloaded = new PlatformSettingsStore({ file });
    assert.equal((await reloaded.get()).vpsHost, '203.0.113.10');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('deployment summary distinguishes draft URL from active runtime URL', () => {
  const profile = { mode: 'vps-docker', publicBaseUrl: 'https://bot.example.com', botDomain: 'bot.example.com' };
  const draft = deploymentSummary(profile, '');
  assert.equal(draft.draftReady, true);
  assert.equal(draft.publicReady, false);
  assert.equal(draft.requiresRestartOrDeploy, true);

  const active = deploymentSummary(profile, 'https://bot.example.com');
  assert.equal(active.publicReady, true);
  assert.equal(active.requiresRestartOrDeploy, false);
  assert.equal(active.qrMode, 'public-https');
});

test('deployment env template never generates fake provider secrets', () => {
  const value = deploymentEnv({ botDomain: 'bot.example.com', n8nDomain: 'n8n.example.com', publicBaseUrl: 'https://bot.example.com' });
  assert.match(value, /PUBLIC_BASE_URL=https:\/\/bot\.example\.com/);
  assert.match(value, /TELEGRAM_BOT_TOKEN=\n/);
  assert.match(value, /POSTGRES_PASSWORD=<generate-a-long-random-secret>/);
});
