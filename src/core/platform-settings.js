import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MODES = new Set(['desktop-lan', 'vps-docker']);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function cleanHost(value, max = 253) {
  return String(value || '').trim().replace(/^https?:\/\//i, '').replace(/\/$/, '').slice(0, max);
}

function cleanPublicUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const url = new URL(text);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid_public_url');
  if (url.username || url.password) throw new Error('invalid_public_url');
  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/$/, '');
}

export class PlatformSettingsStore {
  constructor({ file = './data/state/platform-settings.json', logger } = {}) {
    this.file = path.resolve(file);
    this.logger = logger;
    this.loaded = false;
    this.value = defaults();
  }

  async get() {
    await this.load();
    return clone(this.value);
  }

  async update(patch = {}) {
    await this.load();
    if (MODES.has(patch.mode)) this.value.mode = patch.mode;
    if (patch.publicBaseUrl != null) this.value.publicBaseUrl = cleanPublicUrl(patch.publicBaseUrl);
    if (patch.botDomain != null) this.value.botDomain = cleanHost(patch.botDomain);
    if (patch.n8nDomain != null) this.value.n8nDomain = cleanHost(patch.n8nDomain);
    if (patch.vpsHost != null) this.value.vpsHost = String(patch.vpsHost || '').trim().slice(0, 255);
    if (patch.sshUser != null) this.value.sshUser = String(patch.sshUser || '').trim().slice(0, 64) || 'root';
    if (patch.sshPort != null) {
      const port = Number(patch.sshPort);
      if (Number.isInteger(port) && port >= 1 && port <= 65535) this.value.sshPort = port;
    }
    this.value.updatedAt = new Date().toISOString();
    await this.persist();
    return clone(this.value);
  }

  async load() {
    if (this.loaded) return;
    try {
      const raw = await readFile(this.file, 'utf8');
      const payload = JSON.parse(raw);
      this.value = { ...defaults(), ...(payload?.deployment || {}) };
    } catch (error) {
      if (error?.code !== 'ENOENT') this.logger?.warn({ event: 'platform_settings_load_failed', reason: error?.message || 'unknown' });
      this.value = defaults();
    }
    this.loaded = true;
  }

  async persist() {
    await mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, JSON.stringify({ version: 1, deployment: this.value }, null, 2), { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, this.file);
  }
}

export function deploymentSummary(profile, runtimePublicBaseUrl = '') {
  const configuredRuntime = String(runtimePublicBaseUrl || '').trim().replace(/\/$/, '');
  const draftUrl = String(profile?.publicBaseUrl || '').trim().replace(/\/$/, '');
  const publicUrl = configuredRuntime || draftUrl || (profile?.botDomain ? `https://${profile.botDomain}` : '');
  const isHttps = publicUrl.startsWith('https://');
  return {
    ...profile,
    activePublicBaseUrl: configuredRuntime,
    effectivePublicBaseUrl: publicUrl,
    publicReady: Boolean(configuredRuntime && isHttps),
    draftReady: Boolean(publicUrl && isHttps),
    requiresRestartOrDeploy: Boolean(draftUrl && draftUrl !== configuredRuntime),
    webhookBaseUrl: configuredRuntime || '',
    qrMode: configuredRuntime ? 'public-https' : 'desktop-lan'
  };
}

export function deploymentEnv(profile) {
  const botDomain = cleanHost(profile?.botDomain);
  const n8nDomain = cleanHost(profile?.n8nDomain);
  const publicBaseUrl = profile?.publicBaseUrl || (botDomain ? `https://${botDomain}` : 'https://bot.example.com');
  return [
    `PUBLIC_BASE_URL=${publicBaseUrl}`,
    `BOT_DOMAIN=${botDomain || 'bot.example.com'}`,
    `N8N_DOMAIN=${n8nDomain || 'n8n.example.com'}`,
    'POSTGRES_PASSWORD=<generate-a-long-random-secret>',
    'N8N_ENCRYPTION_KEY=<generate-a-long-random-secret>',
    '',
    '# Provider credentials belong in the VPS .env only; never paste them into chat or commit them.',
    'TELEGRAM_BOT_TOKEN=',
    'TELEGRAM_WEBHOOK_SECRET=',
    'FACEBOOK_VERIFY_TOKEN=',
    'FACEBOOK_APP_SECRET=',
    'FACEBOOK_PAGE_ACCESS_TOKEN=',
    'ZALO_OA_ACCESS_TOKEN=',
    'ZALO_SEND_URL=',
    'ZALO_WEBHOOK_SECRET=',
    'TIKTOK_CLIENT_SECRET=',
    'TIKTOK_SEND_URL=',
    'TIKTOK_ACCESS_TOKEN='
  ].join('\n');
}

function defaults() {
  return {
    mode: 'desktop-lan',
    publicBaseUrl: '',
    botDomain: '',
    n8nDomain: '',
    vpsHost: '',
    sshUser: 'root',
    sshPort: 22,
    updatedAt: null
  };
}
