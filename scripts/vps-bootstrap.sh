#!/usr/bin/env sh
set -eu

BOT_DOMAIN="${1:-}"
N8N_DOMAIN="${2:-}"

if [ -z "$BOT_DOMAIN" ] || [ -z "$N8N_DOMAIN" ]; then
  echo "Usage: sh scripts/vps-bootstrap.sh bot.example.com n8n.example.com" >&2
  exit 2
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed. Install Docker Engine + Compose plugin first." >&2
  exit 3
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose plugin is not available." >&2
  exit 4
fi

random_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c 'import secrets; print(secrets.token_hex(32))'
  else
    echo "Need openssl or python3 to generate deployment secrets." >&2
    exit 5
  fi
}

if [ -f .env ]; then
  echo ".env already exists. Refusing to overwrite it." >&2
  echo "Move or back up the current .env, then run this command again." >&2
  exit 6
fi

POSTGRES_PASSWORD="$(random_secret)"
N8N_ENCRYPTION_KEY="$(random_secret)"
BOT_HUB_ADMIN_TOKEN="$(random_secret)"
CREDENTIAL_VAULT_MASTER_KEY="$(random_secret)"
WEB_WIDGET_SIGNING_KEY="$(random_secret)"

cat > .env <<EOF_ENV
HOST=0.0.0.0
PORT=8787
PUBLIC_BASE_URL=https://${BOT_DOMAIN}
LOG_LEVEL=info
MAX_BODY_BYTES=1048576
IDEMPOTENCY_TTL_SECONDS=86400
BOT_STORE_FILE=/app/data/state/bots.json
PLATFORM_SETTINGS_FILE=/app/data/state/platform-settings.json
SKILL_STORE_FILE=/app/data/state/skills.json
TRACE_LIMIT=250
CONVERSATION_MEMORY_TURNS=12
CONVERSATION_DB_FILE=/app/data/state/conversations.sqlite
CONVERSATION_RETENTION_DAYS=30
CONVERSATION_MAX_MESSAGE_CHARS=8000

BOT_HUB_ADMIN_USER=admin
BOT_HUB_ADMIN_TOKEN=${BOT_HUB_ADMIN_TOKEN}
WEB_CONSOLE_ORIGINS=

CREDENTIAL_VAULT_FILE=/app/data/state/credentials.json
CREDENTIAL_VAULT_MASTER_KEY=${CREDENTIAL_VAULT_MASTER_KEY}
CREDENTIAL_VAULT_LOCAL_KEY_FILE=/app/data/state/credentials.key
CREDENTIAL_VAULT_ALLOW_LOCAL_KEY=false

WEB_WIDGET_ENABLED=true
WEB_WIDGET_ALLOWED_ORIGINS=
WEB_WIDGET_MAX_MESSAGE_CHARS=2000
WEB_WIDGET_TOKEN_TTL_SECONDS=900
WEB_WIDGET_SIGNING_KEY=${WEB_WIDGET_SIGNING_KEY}

KNOWLEDGE_ROOT=/app/data/repos
KNOWLEDGE_MAX_FILES=2500
KNOWLEDGE_MAX_FILE_BYTES=262144

BOT_DOMAIN=${BOT_DOMAIN}
N8N_DOMAIN=${N8N_DOMAIN}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
N8N_ENCRYPTION_KEY=${N8N_ENCRYPTION_KEY}

AI_PROVIDER_NAME=primary
AI_BASE_URL=
AI_API_KEY=
AI_MODEL=
AI_TIMEOUT_MS=20000
AI_SYSTEM_PROMPT=You are a concise, helpful customer-service assistant. Never invent order status, price, promotion or policy facts.
AI_FALLBACKS_JSON=[]

N8N_WEBHOOK_URL=
N8N_SHARED_SECRET=

TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=

FACEBOOK_VERIFY_TOKEN=
FACEBOOK_APP_SECRET=
FACEBOOK_PAGE_ACCESS_TOKEN=
FACEBOOK_GRAPH_VERSION=v24.0

ZALO_OA_ACCESS_TOKEN=
ZALO_SEND_URL=
ZALO_WEBHOOK_SECRET=

TIKTOK_CLIENT_SECRET=
TIKTOK_SEND_URL=
TIKTOK_ACCESS_TOKEN=
TIKTOK_SIGNATURE_TOLERANCE_SECONDS=300

CONNECT_SESSION_TTL_SECONDS=600
CONNECT_ZALO_AUTH_URL_TEMPLATE=
CONNECT_FACEBOOK_AUTH_URL_TEMPLATE=
CONNECT_TIKTOK_AUTH_URL_TEMPLATE=
CONNECT_TELEGRAM_HELP_URL=https://t.me/BotFather
EOF_ENV

chmod 600 .env
mkdir -p data/state data/repos

cat <<EOF_MESSAGE
VPS configuration created.

Bot URL:  https://${BOT_DOMAIN}
n8n URL: https://${N8N_DOMAIN}

Next steps:
1. Point both DNS A/AAAA records to this VPS.
2. Fill approved provider credentials/OAuth URL templates in .env.
3. If using the hosted Vercel console, add its origin to WEB_CONSOLE_ORIGINS.
4. If embedding Web Widget, add each customer website origin to WEB_WIDGET_ALLOWED_ORIGINS.
5. Run: docker compose up -d --build
6. Check: docker compose ps
7. Verify: https://${BOT_DOMAIN}/api/health
8. Point provider webhooks directly to https://${BOT_DOMAIN}/webhooks/...; do not route signed provider webhooks through Vercel.
9. Open https://${BOT_DOMAIN}; the browser will request Basic authentication. User: admin. Password: BOT_HUB_ADMIN_TOKEN from the local .env file.
10. Back up data/state, including conversations.sqlite and encrypted credentials.json.

Deployment secrets were generated directly into .env and were not printed to stdout.
EOF_MESSAGE
