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

cat > .env <<EOF
HOST=0.0.0.0
PORT=8787
PUBLIC_BASE_URL=https://${BOT_DOMAIN}
LOG_LEVEL=info
MAX_BODY_BYTES=1048576
IDEMPOTENCY_TTL_SECONDS=86400
BOT_STORE_FILE=/app/data/state/bots.json
PLATFORM_SETTINGS_FILE=/app/data/state/platform-settings.json
KNOWLEDGE_ROOT=/app/data/repos
KNOWLEDGE_MAX_FILES=2500
KNOWLEDGE_MAX_FILE_BYTES=262144

BOT_DOMAIN=${BOT_DOMAIN}
N8N_DOMAIN=${N8N_DOMAIN}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
N8N_ENCRYPTION_KEY=${N8N_ENCRYPTION_KEY}

AI_BASE_URL=
AI_API_KEY=
AI_MODEL=
AI_TIMEOUT_MS=20000
AI_SYSTEM_PROMPT=You are a concise, helpful customer-service assistant. Never invent order status, price, promotion or policy facts.

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
EOF

chmod 600 .env
mkdir -p data/state data/repos

cat <<EOF
VPS configuration created.

Bot URL:  https://${BOT_DOMAIN}
n8n URL: https://${N8N_DOMAIN}

Next steps:
1. Point both DNS A/AAAA records to this VPS.
2. Fill provider credentials and approved OAuth URL templates in .env.
3. Run: docker compose up -d --build
4. Check: docker compose ps
5. Verify: https://${BOT_DOMAIN}/api/health

Secrets were generated directly into .env and were not printed to stdout.
EOF
