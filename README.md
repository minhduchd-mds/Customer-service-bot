# Customer Service Bot — Bot Hub

A self-hosted **multi-bot omnichannel customer-service platform** for Telegram, Facebook Messenger, Zalo Official Account, TikTok webhooks, Web Chat, n8n, Docker and VPS deployments.

The operator flow is intentionally simple:

> **Create → Connect → Teach → Go Live**

Behind that flow, each bot keeps its own identity, intelligence mode, channels, knowledge and scenarios while `Router9` runs inbound events through authenticity, normalization, idempotency, policy, intent/skill, knowledge, response and workflow/dispatch stages.

## Current product surface

- Create many bots in one workspace.
- Bot modes: **AI Autopilot**, **Scenario**, and **Hybrid**.
- Per-bot teaching sources and reusable scenario templates.
- QR connection handoff for Zalo/Facebook/TikTok/Telegram setup.
- Self-hosted QR generation; no third-party QR image service.
- QR URLs are short-lived and contain no provider token.
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

## Quick start

```bash
cp .env.example .env
npm run check
npm test
npm start
```

Open `http://localhost:8787`.

## Docker / VPS

```bash
cp .env.example .env
# Replace BOT_DOMAIN, N8N_DOMAIN, POSTGRES_PASSWORD and N8N_ENCRYPTION_KEY.
docker compose up -d --build
```

Set `PUBLIC_BASE_URL` to the public HTTPS Bot Hub origin before using QR connection links.

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
- Caddy terminates HTTPS on VPS.
- `data/state/bots.json` contains product configuration only; do not persist provider secrets there.

Before multi-replica production, move bot state/idempotency to PostgreSQL/Redis and implement an encrypted provider credential vault.

## Claude Code workflow

Start with [`CLAUDE.md`](CLAUDE.md). Relevant skills include channel connectors, webhook security, n8n workflows, repository knowledge, quality gates and the new **Bot Hub Product Skill** for the multi-bot onboarding/UI contract.

No third-party prompt/template is copied verbatim. External references and license notes live in [`docs/SOURCES-LICENSES.md`](docs/SOURCES-LICENSES.md).

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/CHANNELS.md`](docs/CHANNELS.md)
- [`docs/N8N.md`](docs/N8N.md)
- [`docs/VPS-DEPLOY.md`](docs/VPS-DEPLOY.md)
- [`docs/SECURITY.md`](docs/SECURITY.md)
- [`docs/ROADMAP.md`](docs/ROADMAP.md)
- [`docs/SOURCES-LICENSES.md`](docs/SOURCES-LICENSES.md)

## License

MIT.
