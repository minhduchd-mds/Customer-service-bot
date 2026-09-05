# Customer Service Bot

A self-hosted omnichannel customer-service foundation for **Telegram, Facebook Messenger, Zalo Official Account, TikTok webhooks, n8n, Docker and VPS deployments**.

The codebase is intentionally provider-neutral and zero-dependency at runtime: Node.js 22 provides HTTP, crypto, tests and `fetch`. Channel integrations are isolated behind adapters, while `Router9` runs every event through a nine-stage pipeline.

> Status: foundation/MVP. Telegram and Meta webhook verification are implemented; TikTok webhook signature verification follows TikTok's public webhook specification. Zalo outbound and TikTok messaging outbound are configuration-driven because those capabilities/endpoints depend on the product/app permissions granted to your business account.

## What is included

- Telegram webhook receive + send.
- Facebook Messenger webhook challenge, HMAC verification, receive + send.
- Zalo OA tolerant inbound normalizer + configurable outbound adapter.
- TikTok public webhook signature verification + event normalization; messaging outbound is disabled unless an approved endpoint is configured.
- `Router9`: ingress → authenticity → normalize → idempotency → policy → intent/skill → knowledge → response → workflow/dispatch.
- Local repository knowledge base: clone/import a repository and search its source/docs without uploading the repository to a third-party vector store.
- OpenAI-compatible AI router via environment variables, with deterministic fallback when AI is disabled.
- n8n bridge for CRM, ticketing, lead capture, notifications and human handoff.
- Docker Compose stack with app, PostgreSQL, Redis, n8n and Caddy.
- Claude Code project guidance and original `.claude/skills/*/SKILL.md` files.
- Node built-in tests and CI.

## Quick start

```bash
cp .env.example .env
npm test
npm start
```

Then open `http://localhost:8787`.

### Docker / VPS

```bash
cp .env.example .env
# Replace BOT_DOMAIN, N8N_DOMAIN, POSTGRES_PASSWORD and N8N_ENCRYPTION_KEY before exposing publicly.
docker compose up -d --build
```

See [`docs/VPS-DEPLOY.md`](docs/VPS-DEPLOY.md).

## Import a repository into the local knowledge base

```bash
bash scripts/import-repo.sh https://github.com/owner/repository.git
```

The importer performs a shallow clone into `data/repos/<name>` and removes `.git`. On the next request (or restart), the knowledge index can search supported text/code files and add relevant snippets to the response context. Secrets, binaries and common build directories are excluded.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Health and uptime |
| GET | `/api/channels` | Connector readiness without exposing secrets |
| GET | `/api/metrics` | Router counters |
| GET | `/api/skills` | Runtime customer-service skill catalog |
| POST | `/api/simulate` | Run a normalized message through Router9 without outbound send |
| POST | `/api/knowledge/search` | Search the local repository knowledge index |
| POST | `/webhooks/telegram` | Telegram webhook |
| GET/POST | `/webhooks/facebook` | Meta verification + Messenger webhook |
| POST | `/webhooks/zalo` | Zalo OA webhook |
| POST | `/webhooks/tiktok` | TikTok webhook |

## Security posture

- Verify webhook authenticity before normalization/processing.
- Keep raw bytes for HMAC verification; do not stringify parsed JSON before verifying.
- Idempotency guard for at-least-once webhook delivery.
- Constant-time signature comparison.
- Body-size cap and explicit JSON parsing.
- No credentials in logs or repository files.
- Caddy terminates HTTPS on VPS.
- Human handoff for high-risk or account-sensitive requests.

Read [`docs/SECURITY.md`](docs/SECURITY.md) before production use.

## Claude Code workflow

Start with [`CLAUDE.md`](CLAUDE.md). The project-specific skills under `.claude/skills/` are original instructions tailored to this repository. They borrow only general organizational ideas—small discoverable skills, progressive disclosure, validation after changes—from public Claude Code ecosystem patterns. No third-party prompt/template is copied verbatim.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/CHANNELS.md`](docs/CHANNELS.md)
- [`docs/N8N.md`](docs/N8N.md)
- [`docs/VPS-DEPLOY.md`](docs/VPS-DEPLOY.md)
- [`docs/SECURITY.md`](docs/SECURITY.md)
- [`docs/ROADMAP.md`](docs/ROADMAP.md)
- [`docs/SOURCES-LICENSES.md`](docs/SOURCES-LICENSES.md)

## License

MIT. External references and licenses are documented in `docs/SOURCES-LICENSES.md`.
