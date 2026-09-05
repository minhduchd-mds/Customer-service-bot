const int = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
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
    connect: {
      ttlSeconds: int(env.CONNECT_SESSION_TTL_SECONDS, 600),
      zaloAuthUrlTemplate: env.CONNECT_ZALO_AUTH_URL_TEMPLATE || '',
      facebookAuthUrlTemplate: env.CONNECT_FACEBOOK_AUTH_URL_TEMPLATE || '',
      tiktokAuthUrlTemplate: env.CONNECT_TIKTOK_AUTH_URL_TEMPLATE || '',
      telegramHelpUrl: env.CONNECT_TELEGRAM_HELP_URL || 'https://t.me/BotFather'
    },
    ai: {
      baseUrl: env.AI_BASE_URL || '',
      apiKey: env.AI_API_KEY || '',
      model: env.AI_MODEL || '',
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
