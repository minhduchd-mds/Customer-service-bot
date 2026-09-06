const int = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const bool = (value, fallback = false) => {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

const csv = (value) => String(value || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)
  .slice(0, 20);

const jsonArray = (value) => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.slice(0, 5).map((item) => ({
      name: String(item?.name || '').slice(0, 80),
      baseUrl: String(item?.baseUrl || item?.base_url || '').slice(0, 500),
      apiKey: String(item?.apiKey || item?.api_key || '').slice(0, 500),
      model: String(item?.model || '').slice(0, 200)
    })).filter((item) => item.baseUrl && item.apiKey && item.model) : [];
  } catch {
    return [];
  }
};

export function loadConfig(env = process.env) {
  return {
    host: env.HOST || '0.0.0.0',
    port: int(env.PORT, 8787),
    publicBaseUrl: env.PUBLIC_BASE_URL || '',
    logLevel: env.LOG_LEVEL || 'info',
    maxBodyBytes: int(env.MAX_BODY_BYTES, 1024 * 1024),
    idempotencyTtlSeconds: int(env.IDEMPOTENCY_TTL_SECONDS, 86400),
    botStoreFile: env.BOT_STORE_FILE || './data/state/bots.json',
    platformSettingsFile: env.PLATFORM_SETTINGS_FILE || './data/state/platform-settings.json',
    skillStoreFile: env.SKILL_STORE_FILE || './data/state/skills.json',
    traceLimit: int(env.TRACE_LIMIT, 250),
    conversationMemoryTurns: int(env.CONVERSATION_MEMORY_TURNS, 12),
    webConsole: {
      origins: csv(env.WEB_CONSOLE_ORIGINS)
    },
    webWidget: {
      enabled: bool(env.WEB_WIDGET_ENABLED, true),
      allowedOrigins: csv(env.WEB_WIDGET_ALLOWED_ORIGINS),
      maxMessageChars: int(env.WEB_WIDGET_MAX_MESSAGE_CHARS, 2000)
    },
    credentials: {
      file: env.CREDENTIAL_VAULT_FILE || './data/state/credentials.json',
      masterKey: env.CREDENTIAL_VAULT_MASTER_KEY || env.BOT_HUB_MASTER_KEY || '',
      localKeyFile: env.CREDENTIAL_VAULT_LOCAL_KEY_FILE || './data/state/credentials.key',
      allowLocalKey: bool(env.CREDENTIAL_VAULT_ALLOW_LOCAL_KEY, false)
    },
    conversations: {
      file: env.CONVERSATION_DB_FILE || './data/state/conversations.sqlite',
      retentionDays: int(env.CONVERSATION_RETENTION_DAYS, 30),
      maxMessageChars: int(env.CONVERSATION_MAX_MESSAGE_CHARS, 8000)
    },
    admin: {
      user: env.BOT_HUB_ADMIN_USER || 'admin',
      token: env.BOT_HUB_ADMIN_TOKEN || ''
    },
    connect: {
      ttlSeconds: int(env.CONNECT_SESSION_TTL_SECONDS, 600),
      zaloAuthUrlTemplate: env.CONNECT_ZALO_AUTH_URL_TEMPLATE || '',
      facebookAuthUrlTemplate: env.CONNECT_FACEBOOK_AUTH_URL_TEMPLATE || '',
      tiktokAuthUrlTemplate: env.CONNECT_TIKTOK_AUTH_URL_TEMPLATE || '',
      telegramHelpUrl: env.CONNECT_TELEGRAM_HELP_URL || 'https://t.me/BotFather'
    },
    ai: {
      name: env.AI_PROVIDER_NAME || 'primary',
      baseUrl: env.AI_BASE_URL || '',
      apiKey: env.AI_API_KEY || '',
      model: env.AI_MODEL || '',
      fallbacks: jsonArray(env.AI_FALLBACKS_JSON),
      timeoutMs: int(env.AI_TIMEOUT_MS, 20000),
      systemPrompt: env.AI_SYSTEM_PROMPT || 'You are a concise, helpful customer-service assistant. Never invent order status or policy facts.'
    },
    n8n: {
      webhookUrl: env.N8N_WEBHOOK_URL || '',
      sharedSecret: env.N8N_SHARED_SECRET || ''
    },
    telegram: {
      botToken: env.TELEGRAM_BOT_TOKEN || '',
      webhookSecret: env.TELEGRAM_WEBHOOK_SECRET || ''
    },
    facebook: {
      verifyToken: env.FACEBOOK_VERIFY_TOKEN || '',
      appSecret: env.FACEBOOK_APP_SECRET || '',
      pageAccessToken: env.FACEBOOK_PAGE_ACCESS_TOKEN || '',
      graphVersion: env.FACEBOOK_GRAPH_VERSION || 'v24.0'
    },
    zalo: {
      oaAccessToken: env.ZALO_OA_ACCESS_TOKEN || '',
      sendUrl: env.ZALO_SEND_URL || '',
      webhookSecret: env.ZALO_WEBHOOK_SECRET || ''
    },
    tiktok: {
      clientSecret: env.TIKTOK_CLIENT_SECRET || '',
      sendUrl: env.TIKTOK_SEND_URL || '',
      accessToken: env.TIKTOK_ACCESS_TOKEN || '',
      signatureToleranceSeconds: int(env.TIKTOK_SIGNATURE_TOLERANCE_SECONDS, 300)
    },
    knowledge: {
      root: env.KNOWLEDGE_ROOT || './data/repos',
      maxFiles: int(env.KNOWLEDGE_MAX_FILES, 2500),
      maxFileBytes: int(env.KNOWLEDGE_MAX_FILE_BYTES, 262144)
    }
  };
}
