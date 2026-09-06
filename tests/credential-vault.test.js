import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CredentialVault } from '../src/core/credential-vault.js';

async function withDir(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'credential-vault-'));
  try { await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('credential vault encrypts supported secrets and survives restart without exposing plaintext', async () => {
  await withDir(async (dir) => {
    const file = path.join(dir, 'credentials.json');
    const vault = new CredentialVault({ file, masterKey: 'this-is-a-long-test-master-key' });
    await vault.load();
    const saved = await vault.save({
      botId: 'bot-a',
      type: 'zalo',
      name: 'Zalo OA',
      secrets: { oaAccessToken: 'zalo-secret-token', webhookSecret: 'webhook-secret', unsupported: 'drop-me' },
      metadata: { oaId: 'oa-123', accessToken: 'must-not-leak' }
    });
    assert.deepEqual(saved.secretKeys, ['oaAccessToken', 'webhookSecret']);
    assert.equal('ciphertext' in saved, false);

    const raw = await readFile(file, 'utf8');
    assert.equal(raw.includes('zalo-secret-token'), false);
    assert.equal(raw.includes('webhook-secret'), false);
    assert.equal(raw.includes('must-not-leak'), false);

    const restarted = new CredentialVault({ file, masterKey: 'this-is-a-long-test-master-key' });
    await restarted.load();
    assert.equal(restarted.list({ botId: 'bot-a' }).length, 1);
    assert.deepEqual(await restarted.reveal(saved.id), { oaAccessToken: 'zalo-secret-token', webhookSecret: 'webhook-secret' });
  });
});

test('credential vault fails closed with the wrong key or disabled key', async () => {
  await withDir(async (dir) => {
    const file = path.join(dir, 'credentials.json');
    const first = new CredentialVault({ file, masterKey: 'correct-master-key' });
    await first.load();
    const saved = await first.save({ type: 'telegram', name: 'BotFather', secrets: { botToken: '123:secret' } });

    const wrong = new CredentialVault({ file, masterKey: 'wrong-master-key' });
    await wrong.load();
    await assert.rejects(() => wrong.reveal(saved.id));

    const disabled = new CredentialVault({ file });
    await disabled.load();
    await assert.rejects(() => disabled.save({ secrets: { apiKey: 'x' } }), (error) => error.code === 'credential_vault_disabled');
  });
});

test('desktop-style local key is generated once and reopens the same encrypted store', async () => {
  await withDir(async (dir) => {
    const file = path.join(dir, 'credentials.json');
    const localKeyFile = path.join(dir, 'credentials.key');
    const first = new CredentialVault({ file, localKeyFile, allowLocalKey: true });
    await first.load();
    const saved = await first.save({ type: 'ai-provider', name: 'Provider', secrets: { apiKey: 'provider-secret' } });
    assert.equal(first.status().mode, 'local-key');

    const second = new CredentialVault({ file, localKeyFile, allowLocalKey: true });
    await second.load();
    assert.equal(second.status().keyId, first.status().keyId);
    assert.deepEqual(await second.reveal(saved.id), { apiKey: 'provider-secret' });
  });
});
