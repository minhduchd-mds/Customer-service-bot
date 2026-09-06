# Customer Service Bot — Bot Hub

A self-hosted **multi-bot omnichannel customer-service platform** for Windows desktop, Docker/VPS, Telegram, Facebook Messenger, Zalo Official Account, TikTok webhooks, Web Chat and n8n.

The operator flow is intentionally simple:

> **Create → Connect → Teach → Go Live → Operate from Inbox**

Behind that flow, each bot keeps its own identity, intelligence mode, channels, Product/Business Knowledge, runtime skills, tool policy and scenarios while `Router9` runs inbound events through authenticity, normalization, idempotency, policy, intent/skill, knowledge, response and workflow/dispatch stages.

## Current product surface — v0.5

- Create many bots in one workspace.
- Bot modes: **AI Autopilot**, **Scenario**, and **Hybrid**.
- Product setup directly in the onboarding wizard.
- Reusable scenarios: Sales Assistant, Product Introduction, Product Advisor, Customer Support and Order Tracking.
- Safe dynamic runtime skills: built-ins + custom instruction skills with version/hash, enable/disable, search and per-bot allowlists.
- BM25-style zero-dependency skill metadata search and skill-routing eval endpoint.
- Independent skill-content safety scanner. Custom skills cannot execute scripts or install dependencies.
- Per-bot Tool Policy profiles controlling retrieval, memory, AI, workflow and channel side effects.
- Bounded conversation memory scoped by bot/channel/conversation/sender.
- Bounded in-process ConversationScheduler: one active turn per conversation while unrelated customers remain concurrent.
- Privacy-minimized Router9 trace records.
- Ordered OpenAI-compatible AI fallback candidates through `AI_FALLBACKS_JSON` with truthful provider/fallback reporting.
- **Durable Inbox** backed by Node 22 built-in SQLite for Windows and one-node VPS deployments.
- Durable redacted message history, unread state and human-handoff tickets.
- Inbox search/filter, message detail, pending/resolve handoff, archive and explicit delete.
- Configurable conversation retention, defaulting to 30 days; active handoff tickets are retained.
- Windows desktop app with embedded Bot Hub runtime and AppData state.
- Windows QR handoff uses a reachable LAN address rather than `127.0.0.1` when possible.
- Desktop management UI/API remain loopback-only; the LAN listener exposes only `/connect/*`.
- Public VPS management is protected by a single-operator admin gate; provider webhook/OAuth handoff routes stay public.
- Settings → Deployment for Desktop/LAN vs Docker/VPS setup draft.
- VPS bootstrap helper generates deployment secrets without printing them.
- Docker Compose automatically sets `PUBLIC_BASE_URL=https://${BOT_DOMAIN}`.
- Telegram webhook receive + send.
- Facebook Messenger verification, raw-body HMAC receive + send.
- Zalo OA inbound normalization + configurable approved outbound adapter.
- TikTok official public webhook signature/timestamp verification and event normalization.
- Web Chat instant setup.
- Bot-aware webhook routes: `/webhooks/:botId/:channel`.
- Local repository knowledge import/search.
- n8n workflow bridge.
- Docker Compose: app + PostgreSQL + Redis + n8n + Caddy.
- Original Claude Code project skills under `.claude/skills/`.

> Provider capability still depends on the real approved account/app credentials and product permissions. QR connection is an authorization handoff, not personal-account cookie/session automation. TikTok generic customer DM outbound is not assumed.

## Durable Inbox and human handoff

The v0.5 single-node runtime stores accepted live channel turns in:

```text
./data/state/conversations.sqlite
```

Windows desktop places the same ledger under the app's AppData `state` directory. Docker maps it through the existing persistent `data/state` volume.

The ledger stores only bounded operational content:

- conversation metadata;
- redacted customer/assistant message text;
- human-handoff tickets.

It does **not** persist raw provider webhook bodies, signatures, headers, AI system prompts or repository source documents. Simulator calls are not added to the inbox.

Before storage the runtime redacts high-risk secret fields, Bearer credentials, private-key blocks and Luhn-valid payment card numbers while preserving ordinary business references such as order IDs. Default retention is 30 days; unresolved human handoffs are preserved until their tickets are resolved/closed.

Management API:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/conversations` | Search/filter durable conversations |
| GET/PATCH/DELETE | `/api/conversations/:id` | Read, mark read/update status, or explicitly delete |
| GET | `/api/tickets` | List human-handoff tickets |
| PATCH | `/api/tickets/:id` | Set pending/resolved/closed and priority |
| POST | `/api/maintenance/conversation-retention` | Run retention pruning |

See [`docs/CONVERSATION-PERSISTENCE.md`](docs/CONVERSATION-PERSISTENCE.md).

## Dynamic runtime skills

Built-in skills cover sales, product introduction, product advising/comparison, support triage, order care, human handoff and knowledge retrieval.

Custom skill lifecycle:

```text
Publish instruction skill
  ↓
validate + safety scan
  ↓
SHA-256 hash / version
  ↓
enable or disable
  ↓
optional per-bot allowlist
  ↓
intent match / metadata search
  ↓
load selected instructions
  ↓
ConversationScheduler
  ↓
Router9 + Tool Policy
  ↓
AI / scenario / workflow / channel
  ↓
durable Inbox / handoff ticket
```

Custom runtime skills are instructions-only. They cannot run shell commands, install dependencies or receive generic OS execution access.

## Windows desktop

```bash
npm install --no-audit --no-fund
npm run desktop
```

Build the NSIS x64 installer:

```bash
npm run desktop:build
```

The Electron package embeds the Node Bot Hub runtime. CI executes the packaged Windows executable with `--desktop-smoke-test` before publishing its installer artifact.

## Quick start

Requires Node.js 22+.

```bash
cp .env.example .env
npm run check
npm test
npm start
```

Open `http://localhost:8787`.

## Docker / VPS

```bash
sh scripts/vps-bootstrap.sh bot.example.com n8n.example.com
# Fill only approved provider credentials/OAuth templates in .env.
docker compose up -d --build
```

Then verify:

```bash
docker compose ps
curl -fsS https://bot.example.com/api/health
```

The bootstrap script creates PostgreSQL, n8n and Bot Hub admin secrets directly in the local mode-600 `.env` and does not print them. Caddy is the public TLS edge; PostgreSQL and Redis remain on the internal network.

See [`docs/VPS-DEPLOY.md`](docs/VPS-DEPLOY.md).

## Provider behavior

- **Telegram:** secret-token verified inbound webhook and Bot API text outbound when configured.
- **Facebook Messenger:** verification challenge, raw-body HMAC receive and Messenger text outbound with the approved page token.
- **Zalo OA:** tolerant inbound normalization. Exact outbound endpoint/token behavior remains configuration-driven because current OA product/version approval determines the contract.
- **TikTok:** public developer webhook HMAC/timestamp verification and event normalization. Outbound messaging is enabled only if an approved messaging capability/endpoint is explicitly configured.
- **Web Chat:** instant local Bot Hub setup surface.

## Repository knowledge

```bash
bash scripts/import-repo.sh https://github.com/owner/repository.git
```

The importer shallow-clones into `data/repos/<name>`, removes `.git`, common build directories and key/certificate files, then the local index searches supported source/document files.

## Security posture

- Raw-byte webhook verification where required.
- Constant-time signature/secret comparison.
- TikTok timestamp tolerance and idempotency protection.
- Request body limits and explicit JSON parsing.
- Skill publishing bounds + high-risk instruction scanner.
- Built-in skill overwrite protection and per-bot grants.
- Tool-policy deny precedence.
- Bounded per-conversation queue with retryable overload response.
- Conversation persistence excludes raw webhook bodies.
- Stored customer text receives targeted secret/payment redaction.
- Configurable retention and explicit delete.
- QR sessions expire and contain only a temporary Bot Hub URL, never provider access tokens.
- Desktop management remains localhost-only; LAN handoff exposes only `/connect/*`.
- Public VPS management uses the Bot Hub admin gate.
- Product/order/policy answers must be grounded in business systems or verified knowledge.

## Scale boundary

v0.5 SQLite persistence is intentionally a **single-node** store. Do not run multiple Bot Hub replicas against the same SQLite file.

The next production-scale phase is:

1. PostgreSQL repository for conversations/messages/tickets and later bot/skill state.
2. Redis distributed idempotency, conversation locks and queue state.
3. Multi-user authentication/RBAC and audit ownership.
4. Provider health/cooldown/usage accounting.
5. Document ingestion workers for PDF/DOCX/XLSX/PPTX.

## GoClaw architecture study

The project studied `nextlevelbuilder/goclaw` as an architecture reference for skill lifecycle, tool policy, memory, tracing, provider fallback, store abstraction and runtime safety. The reviewed GoClaw repository license is CC BY-NC 4.0, so this project uses it as a conceptual reference only. No GoClaw source, prompts, regex sets, bundled skill prose, UI code or executable assets are copied.

See [`docs/GOCLAW-ADAPTATION.md`](docs/GOCLAW-ADAPTATION.md) and [`docs/SOURCES-LICENSES.md`](docs/SOURCES-LICENSES.md).

## Claude Code workflow

Start with [`CLAUDE.md`](CLAUDE.md). Project skills cover Bot Hub product, scenarios, deployment/VPS, connectors, webhook security, n8n, repository knowledge, quality gates, dynamic skills, skill evals, runtime security, tool policy, memory/session, provider resilience, document ingestion, workspace discipline, cross-surface parity, runtime pipeline and operations diagnostics.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/CHANNELS.md`](docs/CHANNELS.md)
- [`docs/CONVERSATION-PERSISTENCE.md`](docs/CONVERSATION-PERSISTENCE.md)
- [`docs/PRODUCT-SCENARIOS.md`](docs/PRODUCT-SCENARIOS.md)
- [`docs/GOCLAW-ADAPTATION.md`](docs/GOCLAW-ADAPTATION.md)
- [`docs/N8N.md`](docs/N8N.md)
- [`docs/VPS-DEPLOY.md`](docs/VPS-DEPLOY.md)
- [`docs/SECURITY.md`](docs/SECURITY.md)
- [`docs/ROADMAP.md`](docs/ROADMAP.md)
- [`docs/SOURCES-LICENSES.md`](docs/SOURCES-LICENSES.md)

## License

MIT for this repository's original code. Third-party services, images and dependencies retain their upstream licenses and terms.
