import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MODES = new Set(['desktop-lan', 'free-local', 'free-cloud', 'free-vps', 'vps-docker']);
const CLOUD_PROVIDERS = new Set(['render', 'koyeb']);
const DATABASE_PROVIDERS = new Set(['neon']);
const FREE_VPS_PROVIDERS = new Set(['oracle']);
const TUNNEL_PROVIDERS = new Set(['cloudflare', 'none']);

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function cleanHost(value, max = 253) { return String(value || '').trim().replace(/^https?:\/\//i, '').replace(/\/$/, '').slice(0, max); }
function cleanPublicUrl(value) {
  const valueText = String(value || '').trim();
  if (!valueText) return '';
  const url = new URL(valueText);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('invalid_public_url');
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
  async get() { await this.load(); return clone(this.value); }
  async update(patch = {}) {
    await this.load();
    if (MODES.has(patch.mode)) this.value.mode = patch.mode === 'desktop-lan' ? 'free-local' : patch.mode;
    if (patch.publicBaseUrl != null) this.value.publicBaseUrl = cleanPublicUrl(patch.publicBaseUrl);
    if (patch.botDomain != null) this.value.botDomain = cleanHost(patch.botDomain);
    if (patch.n8nDomain != null) this.value.n8nDomain = cleanHost(patch.n8nDomain);
    if (patch.vpsHost != null) this.value.vpsHost = String(patch.vpsHost || '').trim().slice(0, 255);
    if (patch.sshUser != null) this.value.sshUser = String(patch.sshUser || '').trim().slice(0, 64) || 'root';
    if (patch.sshPort != null) {
      const port = Number(patch.sshPort);
      if (Number.isInteger(port) && port >= 1 && port <= 65535) this.value.sshPort = port;
    }
    if (CLOUD_PROVIDERS.has(patch.cloudProvider)) this.value.cloudProvider = patch.cloudProvider;
    if (DATABASE_PROVIDERS.has(patch.databaseProvider)) this.value.databaseProvider = patch.databaseProvider;
    if (FREE_VPS_PROVIDERS.has(patch.freeVpsProvider)) this.value.freeVpsProvider = patch.freeVpsProvider;
    if (TUNNEL_PROVIDERS.has(patch.tunnelProvider)) this.value.tunnelProvider = patch.tunnelProvider;
    this.value.updatedAt = new Date().toISOString();
    await this.persist();
    return clone(this.value);
  }
  async load() {
    if (this.loaded) return;
    try {
      const payload = JSON.parse(await readFile(this.file, 'utf8'));
      this.value = { ...defaults(), ...(payload?.deployment || {}) };
      if (this.value.mode === 'desktop-lan') this.value.mode = 'free-local';
    } catch (error) {
      if (error?.code !== 'ENOENT') this.logger?.warn?.({ event: 'platform_settings_load_failed', reason: error?.message || 'unknown' });
      this.value = defaults();
    }
    this.loaded = true;
  }
  async persist() {
    await mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, JSON.stringify({ version: 2, deployment: this.value }, null, 2), { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, this.file);
  }
}

export function deploymentPlans() {
  return [
    {
      id: 'free-local', label: 'Free Local', price: '$0', recommended: true, alwaysOn: false, ready: true,
      summary: 'Run Bot Hub on this Windows PC with local SQLite and encrypted credentials.',
      persistence: 'Local SQLite + local encrypted vault',
      internet: 'Optional Cloudflare Tunnel for public HTTPS callbacks while this computer is online.',
      caveat: 'When the computer sleeps or shuts down, automated replies stop.'
    },
    {
      id: 'free-cloud', label: 'Free Cloud', price: '$0 tier', recommended: false, alwaysOn: false, ready: false,
      summary: 'Target a free web service plus external free-tier database.',
      persistence: 'Requires PostgreSQL-backed Bot Hub state before stateless hosting is production-safe.',
      internet: 'Public HTTPS from the cloud provider.',
      caveat: 'Free services can sleep, change quotas, or remove free tiers. Bot Hub does not claim always-on service on this plan.',
      blockedReason: 'Current durable conversation store is SQLite. Keep this plan in preview until PostgreSQL state migration is enabled.'
    },
    {
      id: 'free-vps', label: 'Free VPS', price: '$0 quota', recommended: false, alwaysOn: true, ready: true,
      summary: 'Run the normal Docker Compose stack on a user-provisioned always-free/credit VPS when available.',
      persistence: 'Native Docker volumes / host storage',
      internet: 'Public HTTPS through Caddy.',
      caveat: 'Availability and free quotas are controlled by the VPS provider and must be confirmed by the user.'
    },
    {
      id: 'vps-docker', label: 'Production VPS', price: 'Provider pricing', recommended: false, alwaysOn: true, ready: true,
      summary: 'Dedicated Linux VPS with Docker, Caddy and production domain.',
      persistence: 'Persistent host storage; PostgreSQL/Redis scale layer recommended for multi-replica.',
      internet: 'Public HTTPS through Caddy.',
      caveat: 'Recommended for customer-facing production workloads and predictable uptime.'
    }
  ];
}

export function deploymentSummary(profile, runtimePublicBaseUrl = '') {
  const configuredRuntime = String(runtimePublicBaseUrl || '').trim().replace(/\/$/, '');
  const draftUrl = String(profile?.publicBaseUrl || '').trim().replace(/\/$/, '');
  const publicUrl = configuredRuntime || draftUrl || (profile?.botDomain ? `https://${profile.botDomain}` : '');
  const isHttps = publicUrl.startsWith('https://');
  const mode = profile?.mode === 'desktop-lan' ? 'free-local' : (profile?.mode || 'free-local');
  const plan = deploymentPlans().find((item) => item.id === mode) || deploymentPlans()[0];
  return {
    ...profile,
    mode,
    plan,
    activePublicBaseUrl: configuredRuntime,
    effectivePublicBaseUrl: publicUrl,
    publicReady: Boolean(configuredRuntime && isHttps),
    draftReady: Boolean(publicUrl && isHttps),
    requiresRestartOrDeploy: Boolean(draftUrl && draftUrl !== configuredRuntime),
    webhookBaseUrl: configuredRuntime || '',
    qrMode: configuredRuntime ? 'public-https' : mode === 'free-local' ? 'desktop-lan' : 'deployment-required',
    freeFirst: mode.startsWith('free-')
  };
}

export function deploymentEnv(profile) {
  const mode = profile?.mode === 'desktop-lan' ? 'free-local' : (profile?.mode || 'free-local');
  const botDomain = cleanHost(profile?.botDomain);
  const n8nDomain = cleanHost(profile?.n8nDomain);
  const publicBaseUrl = profile?.publicBaseUrl || (botDomain ? `https://${botDomain}` : mode === 'free-local' ? '' : 'https://bot.example.com');
  return [
    `DEPLOYMENT_MODE=${mode}`,
    `PUBLIC_BASE_URL=${publicBaseUrl}`,
    `BOT_DOMAIN=${botDomain || ''}`,
    `N8N_DOMAIN=${n8nDomain || ''}`,
    'CONVERSATION_DB_FILE=/app/data/state/conversations.sqlite',
    'AI_CONNECTION_STORE_FILE=/app/data/state/ai-connections.json',
    'CREDENTIAL_VAULT_FILE=/app/data/state/credentials.json',
    'CREDENTIAL_VAULT_MASTER_KEY=<generate-a-long-random-secret>',
    'WEB_WIDGET_SIGNING_KEY=<generate-a-long-random-secret>',
    '',
    '# Legacy environment AI fallback is optional. Prefer AI Connections in the Bot Hub UI.',
    'AI_PROVIDER_NAME=',
    'AI_BASE_URL=',
    'AI_API_KEY=',
    'AI_MODEL=',
    '',
    '# Gemini OAuth is optional. Configure an approved Google OAuth client before enabling the OAuth button.',
    'GEMINI_OAUTH_CLIENT_ID=',
    'GEMINI_OAUTH_CLIENT_SECRET=',
    'GEMINI_OAUTH_REDIRECT_URI=',
    '',
    '# Provider/channel credentials belong in the encrypted vault or VPS secrets; never commit them.',
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
    mode: 'free-local',
    publicBaseUrl: '',
    botDomain: '',
    n8nDomain: '',
    vpsHost: '',
    sshUser: 'root',
    sshPort: 22,
    cloudProvider: 'render',
    databaseProvider: 'neon',
    freeVpsProvider: 'oracle',
    tunnelProvider: 'cloudflare',
    updatedAt: null
  };
}
