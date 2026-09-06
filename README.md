# Customer Service Bot — Bot Hub

Self-hosted omnichannel customer-service platform for Windows, Docker/VPS and a Vercel-hosted management console.

> Create → Connect → Teach → Go Live → Operate from Inbox

## v0.7.0

Bot Hub currently includes:

- Router9 inbound pipeline with verification, normalization, idempotency, policy, skill selection, knowledge, response and dispatch.
- Telegram, Facebook Messenger, Zalo OA, TikTok webhook and Web Chat integration surfaces.
- AI / Scenario / Hybrid bot modes with product introduction and product advisor scenarios.
- Safe dynamic instruction skills and per-bot Tool Policy.
- Durable SQLite Inbox with redacted messages and human-handoff tickets.
- Encrypted Credential Vault using AES-256-GCM.
- Embeddable Web Widget with explicit website-origin allowlist, CSP `frame-ancestors` and short-lived signed grants.
- Windows Electron app with AppData state and packaged executable smoke tests.
- Docker Desktop named-volume state for SQLite reliability.
- Docker/VPS stack with Caddy, Redis, PostgreSQL and n8n.
- Operations Center, backup/repair flows and deployment setup.
- Vercel hosted console with explicit API routing and truthful preview fallback.

## Vercel console vs runtime

Vercel is the hosted management console. The real Bot Hub runtime should run on Windows/Docker/VPS.

```text
Browser → Vercel console → BOT_RUNTIME_URL → Bot Hub runtime
```

Provider webhooks must point directly to the public runtime, for example:

```text
https://bot.example.com/webhooks/<botId>/<channel>
```

Bot Hub intentionally does not proxy signed provider webhook bodies through Vercel. The Vercel `/webhooks/*` surface returns `503 direct_runtime_webhook_required` so raw signed bytes are verified at the real runtime.

Recommended Vercel variables:

```text
BOT_RUNTIME_URL=https://bot.example.com
BOT_RUNTIME_ADMIN_USER=admin
BOT_RUNTIME_ADMIN_TOKEN=<same admin token as VPS>
BOT_RUNTIME_STRICT=true
```

Without `BOT_RUNTIME_URL`, the console runs a clearly labelled preview. Preview QR setup does not claim that provider OAuth or webhook delivery has completed.

## QR connection

Windows QR handoff uses a reachable LAN address when possible; it never generates a phone QR pointing to `127.0.0.1`. For public provider OAuth/webhooks, deploy a public HTTPS runtime.

Zalo production integration uses official Zalo OA/Bot developer capabilities. Bot Hub does not capture personal-account cookies or browser sessions.

## Credential Vault

Production VPS should configure:

```text
CREDENTIAL_VAULT_MASTER_KEY=<long random secret>
CREDENTIAL_VAULT_FILE=/app/data/state/credentials.json
```

Windows desktop generates and reuses a local credential key under AppData. List/status APIs expose only public metadata, never plaintext provider secrets.

## Web Widget

Cross-origin embedding is deny-by-default. Add each approved website origin:

```text
WEB_WIDGET_ENABLED=true
WEB_WIDGET_ALLOWED_ORIGINS=https://shop.example.com
WEB_WIDGET_SIGNING_KEY=<long random secret>
WEB_WIDGET_TOKEN_TTL_SECONDS=900
```

Embed the widget from the real runtime:

```html
<script src="https://bot.example.com/widget.js" data-bot-id="bot_..." data-title="Chat with us"></script>
```

The widget validates the parent website origin, returns a matching frame CSP and uses a signed grant bound to bot, parent origin and expiration.

## Windows desktop

Requires Node.js 22 for development/build tooling.

```bash
npm install --no-audit --no-fund
npm run desktop
npm run desktop:build
```

The Windows CI job runs syntax checks, all tests, builds the NSIS x64 installer, then starts the packaged executable with `--desktop-smoke-test` before uploading the artifact.

## Local development

```bash
cp .env.example .env
npm run check
npm test
npm start
```

Open `http://127.0.0.1:8787`.

## Docker / VPS

```bash
sh scripts/vps-bootstrap.sh bot.example.com n8n.example.com
docker compose up -d --build
docker compose ps
```

The bootstrap script generates admin, database, n8n, credential-vault and widget-signing secrets directly into the local mode-600 `.env` without printing them.

## Security boundaries

- Management APIs are protected on public VPS.
- Web Widget public routes are separated from management-console CORS/auth rules.
- Provider webhook verification uses the original runtime request body where required.
- Credential Vault uses authenticated encryption.
- QR sessions expire and do not contain provider access tokens.
- Product, price, promotion, order and policy responses must be grounded in verified business data.
- SQLite remains a single-node persistence backend; migrate to PostgreSQL/Redis before multi-replica scale.

## Documentation

- `docs/ARCHITECTURE.md`
- `docs/CHANNELS.md`
- `docs/CONVERSATION-PERSISTENCE.md`
- `docs/PRODUCT-SCENARIOS.md`
- `docs/VPS-DEPLOY.md`
- `docs/SECURITY.md`
- `docs/ROADMAP.md`
- `docs/GOCLAW-ADAPTATION.md`
- `docs/SOURCES-LICENSES.md`

## License

MIT for this repository's original code. Third-party services and dependencies retain their upstream licenses and terms.
