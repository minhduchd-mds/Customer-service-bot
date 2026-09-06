import { randomBytes } from 'node:crypto';
import { access, copyFile, mkdir, readdir, readFile, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';

const STATE_FILES = [
  ['bots', 'botStoreFile'],
  ['platform-settings', 'platformSettingsFile'],
  ['skills', 'skillStoreFile']
];

export class OperationsCenter {
  constructor(runtime, { backupRoot = '' } = {}) {
    if (!runtime?.config || !runtime?.conversations) throw new Error('operations_runtime_requires_persistence');
    this.runtime = runtime;
    this.config = runtime.config;
    this.ledger = runtime.conversations;
    this.stateDir = path.dirname(path.resolve(this.config.conversations.file));
    this.backupRoot = path.resolve(backupRoot || path.join(this.stateDir, 'backups'));
  }

  async doctor() {
    await mkdir(this.stateDir, { recursive: true });
    await mkdir(this.backupRoot, { recursive: true });
    const checks = [];

    checks.push(await this.checkWritable());
    checks.push(this.checkSqlite());
    checks.push(await this.checkDisk());
    checks.push(this.checkPublicUrl());

    const channels = Object.values(this.runtime.connectors || {}).map((connector) => sanitizeChannelStatus(connector.status?.() || { id: connector.id || 'unknown' }));
    const providers = providerStatus(this.runtime.router?.ai?.config || {});
    const blocking = checks.filter((item) => item.level === 'error');

    return {
      ok: blocking.length === 0,
      runtime: {
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        pid: process.pid,
        uptimeSeconds: Math.floor(process.uptime()),
        container: await fileExists('/.dockerenv')
      },
      state: {
        backend: this.ledger.snapshot?.().backend || 'unknown',
        conversationStore: this.ledger.snapshot?.() || null,
        backupRoot: this.backupRoot
      },
      checks,
      channels,
      providers,
      generatedAt: new Date().toISOString()
    };
  }

  async createBackup({ label = 'manual' } = {}) {
    await mkdir(this.backupRoot, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeLabel = String(label || 'manual').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'manual';
    const id = `${stamp}_${safeLabel}_${randomBytes(3).toString('hex')}`;
    const directory = path.join(this.backupRoot, id);
    await mkdir(directory, { recursive: false });

    try {
      const files = [];
      for (const [name, configKey] of STATE_FILES) {
        const source = path.resolve(this.config[configKey] || '');
        if (!source || !(await fileExists(source))) continue;
        const destination = path.join(directory, path.basename(source));
        await copyFile(source, destination);
        const info = await stat(destination);
        files.push({ name, file: path.basename(destination), bytes: info.size });
      }

      const sqliteName = 'conversations.sqlite';
      const sqliteDestination = path.join(directory, sqliteName);
      await sqliteBackup(this.ledger, sqliteDestination);
      const sqliteInfo = await stat(sqliteDestination);
      files.push({ name: 'conversations', file: sqliteName, bytes: sqliteInfo.size });

      const manifest = {
        id,
        createdAt: new Date().toISOString(),
        label: safeLabel,
        files,
        conversationSnapshot: this.ledger.snapshot?.() || null,
        format: 1
      };
      await writeFile(path.join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      await this.pruneBackups(20);
      return manifest;
    } catch (error) {
      await rm(directory, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  async listBackups({ limit = 20 } = {}) {
    await mkdir(this.backupRoot, { recursive: true });
    const entries = await readdir(this.backupRoot, { withFileTypes: true });
    const results = [];
    for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => b.name.localeCompare(a.name)).slice(0, Math.max(1, Math.min(Number(limit) || 20, 100)))) {
      try {
        const manifest = JSON.parse(await readFile(path.join(this.backupRoot, entry.name, 'manifest.json'), 'utf8'));
        results.push({
          id: String(manifest.id || entry.name),
          createdAt: manifest.createdAt || null,
          label: manifest.label || 'backup',
          files: Array.isArray(manifest.files) ? manifest.files.map(({ name, file, bytes }) => ({ name, file, bytes })) : [],
          conversationSnapshot: manifest.conversationSnapshot || null
        });
      } catch {
        // Ignore incomplete backup directories; Repair removes them after they age out.
      }
    }
    return results;
  }

  async repair() {
    await mkdir(this.stateDir, { recursive: true });
    await mkdir(this.backupRoot, { recursive: true });
    const retention = this.ledger.prune?.() || null;
    const staleRemoved = await this.removeStaleBackupFragments();
    const doctor = await this.doctor();
    return { ok: doctor.ok, retention, staleRemoved, doctor };
  }

  async pruneBackups(keep = 20) {
    const entries = (await readdir(this.backupRoot, { withFileTypes: true }))
      .filter((item) => item.isDirectory())
      .sort((a, b) => b.name.localeCompare(a.name));
    for (const entry of entries.slice(Math.max(1, Number(keep) || 20))) {
      await rm(path.join(this.backupRoot, entry.name), { recursive: true, force: true });
    }
  }

  async removeStaleBackupFragments() {
    const entries = await readdir(this.backupRoot, { withFileTypes: true });
    let removed = 0;
    const cutoff = Date.now() - 24 * 3600_000;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(this.backupRoot, entry.name);
      const manifest = path.join(directory, 'manifest.json');
      if (await fileExists(manifest)) continue;
      const info = await stat(directory).catch(() => null);
      if (info && info.mtimeMs < cutoff) {
        await rm(directory, { recursive: true, force: true });
        removed += 1;
      }
    }
    return removed;
  }

  async checkWritable() {
    const probe = path.join(this.stateDir, `.write-probe-${process.pid}-${randomBytes(3).toString('hex')}`);
    try {
      await writeFile(probe, 'ok', { encoding: 'utf8', mode: 0o600 });
      await access(probe, fsConstants.R_OK | fsConstants.W_OK);
      return { id: 'state-writable', level: 'ok', message: 'Persistent state directory is writable.' };
    } catch (error) {
      return { id: 'state-writable', level: 'error', message: `Persistent state is not writable: ${safeMessage(error)}` };
    } finally {
      await rm(probe, { force: true }).catch(() => {});
    }
  }

  checkSqlite() {
    try {
      const rows = this.ledger.db?.prepare?.('PRAGMA quick_check').all?.() || [];
      const values = rows.flatMap((row) => Object.values(row || {})).map(String);
      const ok = values.length === 0 || values.every((value) => value.toLowerCase() === 'ok');
      return ok
        ? { id: 'sqlite-integrity', level: 'ok', message: 'SQLite quick_check passed.' }
        : { id: 'sqlite-integrity', level: 'error', message: 'SQLite quick_check reported an integrity problem.' };
    } catch (error) {
      return { id: 'sqlite-integrity', level: 'error', message: `SQLite health check failed: ${safeMessage(error)}` };
    }
  }

  async checkDisk() {
    try {
      const info = await statfs(this.stateDir);
      const availableBytes = Number(info.bavail) * Number(info.bsize);
      const level = availableBytes < 512 * 1024 * 1024 ? 'warning' : 'ok';
      return { id: 'disk-space', level, message: `${formatBytes(availableBytes)} available for state/backups.`, availableBytes };
    } catch (error) {
      return { id: 'disk-space', level: 'warning', message: `Disk-space check unavailable: ${safeMessage(error)}` };
    }
  }

  checkPublicUrl() {
    const value = String(this.config.publicBaseUrl || '').trim();
    if (!value) return { id: 'public-url', level: 'warning', message: 'No PUBLIC_BASE_URL is active; provider callbacks/phone QR may require LAN or VPS setup.' };
    try {
      const url = new URL(value);
      const secure = url.protocol === 'https:';
      return { id: 'public-url', level: secure ? 'ok' : 'warning', message: secure ? `Public HTTPS runtime: ${url.origin}` : `Public runtime is not HTTPS: ${url.origin}` };
    } catch {
      return { id: 'public-url', level: 'warning', message: 'PUBLIC_BASE_URL is invalid.' };
    }
  }
}

async function sqliteBackup(ledger, destination) {
  if (!ledger?.db?.exec) throw new Error('SQLite backup is unavailable');
  await rm(destination, { force: true });
  const escaped = path.resolve(destination).replaceAll("'", "''");
  ledger.db.exec('PRAGMA wal_checkpoint(PASSIVE);');
  ledger.db.exec(`VACUUM INTO '${escaped}'`);
}

function providerStatus(config = {}) {
  const candidates = [];
  if (config.baseUrl && config.model) candidates.push({ name: config.name || 'primary', baseUrl: config.baseUrl, model: config.model, configured: Boolean(config.apiKey) });
  for (const [index, item] of (Array.isArray(config.fallbacks) ? config.fallbacks : []).entries()) {
    if (!item?.baseUrl || !item?.model) continue;
    candidates.push({ name: item.name || `fallback-${index + 1}`, baseUrl: item.baseUrl, model: item.model, configured: Boolean(item.apiKey) });
  }
  return candidates.slice(0, 5).map((item) => ({
    name: String(item.name).slice(0, 80),
    model: String(item.model).slice(0, 160),
    endpoint: safeOrigin(item.baseUrl),
    configured: item.configured
  }));
}

function sanitizeChannelStatus(status = {}) {
  return {
    id: String(status.id || 'unknown').slice(0, 60),
    label: status.label ? String(status.label).slice(0, 100) : undefined,
    inboundConfigured: Boolean(status.inboundConfigured),
    outboundConfigured: Boolean(status.outboundConfigured),
    connectMethod: status.connectMethod ? String(status.connectMethod).slice(0, 80) : undefined,
    note: status.note ? String(status.note).slice(0, 300) : undefined
  };
}

function safeOrigin(value) {
  try { return new URL(String(value || '')).origin; } catch { return ''; }
}

async function fileExists(file) {
  try { await access(file, fsConstants.F_OK); return true; } catch { return false; }
}

function safeMessage(error) {
  return String(error?.message || 'unknown').replace(/[A-Za-z]:\\[^\s]+/g, '[path]').slice(0, 240);
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let current = bytes;
  let index = 0;
  while (current >= 1024 && index < units.length - 1) { current /= 1024; index += 1; }
  return `${current.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}
