# Customer Service Bot — Bot Hub

A self-hosted **multi-bot omnichannel customer-service platform** for Windows desktop, Docker/VPS, Telegram, Facebook Messenger, Zalo Official Account, TikTok webhooks, Web Chat and n8n.

The operator flow is intentionally simple:

> **Create → Connect → Teach → Go Live**

Behind that flow, each bot keeps its own identity, intelligence mode, channels, Product/Business Knowledge and scenarios while `Router9` runs inbound events through authenticity, normalization, idempotency, policy, intent/skill, knowledge, response and workflow/dispatch stages.

## Current product surface

- Create many bots in one workspace.
- Bot modes: **AI Autopilot**, **Scenario**, and **Hybrid**.
- Product setup directly in the onboarding wizard.
- Reusable scenarios: Sales Assistant, **Product Introduction**, **Product Advisor**, Customer Support and Order Tracking.
- Product intents: introduction, recommendation, comparison, pricing and promotion.
- AI-assisted product scenarios grounded in bot-specific Product Knowledge.
- Grounded product fallback when no AI provider is configured.
- QR connection handoff for Zalo/Facebook/TikTok/Telegram setup.
- Self-hosted QR generation; no third-party QR image service.
- Windows desktop QR uses a reachable LAN address rather than `127.0.0.1` when possible.
- Desktop management UI/API remain loopback-only; the LAN listener exposes only `/connect/*`.
- **Settings → Deployment** for Desktop/LAN vs Docker/VPS setup draft.
- VPS bootstrap helper that generates deployment secrets without printing them.
- Docker Compose automatically sets `PUBLIC_BASE_URL=https://${BOT_DOMAIN}`.
- Web Chat can be attached instantly in the MVP.
- Bot-aware webhook routes: `/webhooks/:botId/:channel`.
- Bot-aware Router9 simulator.
- Apple-inspired web UI with product-oriented navigation rather than technical configuration menus.
- Telegram webhook receive + send.
- Facebook Messenger verification, HMAC receive + send.
- Zalo OA inbound normalization + configurable outbound adapter.
- TikTok public webhook signature verification and event normalization.
- Local repository knowledge import/search.
- OpenAI-compatible AI router with deterministic fallback.
- n8n workflow bridge.
- Docker Compose: app + PostgreSQL + Redis + n8n + Caddy.
- Claude Code project skills under `.claude/skills/`.

> Production capability still depends on provider approval and credentials. The QR flow is an authorization **handoff**, not a personal-account session scraper. Zalo/TikTok/Facebook are not marked fully connected until their official provider-specific authorization/token-exchange adapter succeeds.

## Windows desktop

The Electron desktop build embeds the Bot Hub backend. It does not require the operator to start Node manually.

Runtime behavior:

```text
Windows app
  ├─ Management UI/API -> 127.0.0.1 only
  ├─ Bot state -> Windows AppData
  ├─ Platform deployment draft -> Windows AppData
  └─ QR handoff -> physical Wi-Fi/Ethernet LAN IP, /connect/* only
```

For real public provider webhooks/OAuth callbacks, use the VPS deployment below.

## Quick start

```bash
cp .env.example .env
npm run check
npm test
npm start
```

Open `http://localhost:8787`.

## Docker / VPS

Fast bootstrap:

```bash
sh scripts/vps-bootstrap.sh bot.example.com n8n.example.com
# Fill approved provider credentials / OAuth templates in .env.
docker compose up -d --build
```

Then verify:

```bash
docker compose ps
curl -fsS https://bot.example.com/api/health
```

The Compose stack sets the active public Bot Hub origin from `BOT_DOMAIN`, so production QR/OAuth callbacks do not fall back to localhost.

See [`docs/VPS-DEPLOY.md`](docs/VPS-DEPLOY.md).

## Product setup

Create a Sales/Product bot and choose **Product Introduction** or **Product Advisor**.

The Teach step can capture:

- product name;
- current verified price;
- short introduction;
- highlights / practical benefits;
- CTA;
- additional policy, warranty, delivery or FAQ data.

Product scenario flow:

```text
Customer request
  ↓
Product intent
  ↓
Scenario boundary
  ↓
Bot-specific Product Knowledge
  ↓
AI-assisted grounded answer
  or safe local fallback
  ↓
CTA / lead / human handoff
```

The system must not invent product specifications, price, promotion, stock, warranty or delivery promises.

See [`docs/PRODUCT-SCENARIOS.md`](docs/PRODUCT-SCENARIOS.md).

## Bot Hub API

| Method | Path | Purpose |
| --- | --- | --- |
| GET/POST | `/api/bots` | List/create bots |
| GET/PATCH | `/api/bots/:botId` | Read/update one bot |
| POST | `/api/bots/:botId/knowledge` | Add bot teaching source |
| PUT | `/api/bots/:botId/scenario` | Apply template or custom scenario |
| POST | `/api/bots/:botId/go-live` | Enable bot after minimum setup |
| POST | `/api/bots/:botId/simulate` | Run Router9 for one bot without outbound send |
| GET | `/api/scenario-templates` | Reusable scenario gallery |
| GET/PATCH | `/api/deployment` | Read/save non-secret deployment draft and generate VPS env/commands |
| POST | `/api/connect/sessions` | Create QR/instant channel setup session |
| GET | `/api/connect/sessions/:token` | Read temporary connection state |
| GET | `/connect/:token` | Mobile QR handoff page |
| POST | `/webhooks/:botId/:channel` | Bot-aware provider webhook |

Legacy `/webhooks/:channel` and `/api/simulate` remain available for the foundation flow.

## Repository knowledge

```bash
bash scripts/import-repo.sh https://github.com/owner/repository.git
```

The importer shallow-clones into `data/repos/<name>`, removes `.git`, common build directories and key/certificate files, then the local index can search supported source/document files.

## Security posture

- Verify webhook authenticity against raw bytes where required.
- Constant-time signature/secret comparison.
- TikTok timestamp tolerance and idempotency protection.
- Body-size cap and explicit JSON parsing.
- Raw provider payload excluded from workflow/public output.
- QR connection sessions expire automatically.
- QR payload contains only a temporary Bot Hub URL, not access tokens.
- No personal social-account QR-login cookie/session capture.
- Desktop LAN listener exposes only the connection handoff surface.
- VPS Caddy terminates HTTPS; database and Redis stay on the internal network.
- Deployment settings intentionally omit SSH passwords/private keys/provider secrets.
- Product answers must be grounded in current business knowledge.

Before multi-replica production, move bot state/idempotency to PostgreSQL/Redis, add admin authentication/RBAC, and implement an encrypted provider credential vault.

## Claude Code workflow

Start with [`CLAUDE.md`](CLAUDE.md). Relevant project skills include:

- Bot Hub Product;
- Product Scenario;
- Deployment / VPS;
- channel connectors;
- webhook security;
- n8n workflows;
- repository knowledge;
- quality gates.

No third-party prompt/template is copied verbatim. External references and license notes live in [`docs/SOURCES-LICENSES.md`](docs/SOURCES-LICENSES.md).

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/CHANNELS.md`](docs/CHANNELS.md)
- [`docs/PRODUCT-SCENARIOS.md`](docs/PRODUCT-SCENARIOS.md)
- [`docs/N8N.md`](docs/N8N.md)
- [`docs/VPS-DEPLOY.md`](docs/VPS-DEPLOY.md)
- [`docs/SECURITY.md`](docs/SECURITY.md)
- [`docs/ROADMAP.md`](docs/ROADMAP.md)
- [`docs/SOURCES-LICENSES.md`](docs/SOURCES-LICENSES.md)

## License

MIT.
