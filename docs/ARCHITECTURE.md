# Architecture

## Product goal

Bot Hub is one self-hosted customer-service platform that can operate many bots. Operators see the simple flow **Create → Connect → Teach → Go Live** while channel security, Router9, AI, workflows and observability remain behind the product surface.

```text
Workspace
   │
   ├── Bot A ── Channels[] ─┐
   ├── Bot B ── Channels[] ─┼─> Channel Adapter ─> Router9 ─> Scenario / AI ─> Channel
   └── Bot N ── Channels[] ─┘                         │            │
                                                    Knowledge     n8n
```

Every bot owns its identity, intelligence mode, channels, teaching sources and scenario configuration. `botId` is included in bot-aware webhook routing, idempotency keys, workflow events and logs.

## Bot model

The MVP persists product state to `data/state/bots.json` through `BotStore` so the product works without another runtime dependency. The model contains:

```text
workspaceId
botId
name / purpose / status
intelligenceMode: ai | scenario | hybrid
channels[]
knowledgeSources[]
scenario { template, rules, notes }
ai profile
```

Provider access tokens must **not** be persisted in this file. Production channel credentials belong in an encrypted credential vault.

## Connect / QR architecture

QR is a temporary authorization handoff, not a provider session-login mechanism.

```text
Desktop Bot Hub
    │
    ├─ POST /api/connect/sessions
    │
    ├─ random short-lived token
    │
    └─ self-hosted QR containing only:
          https://bot.example.com/connect/<token>
                         │
                    phone scans
                         │
                Bot Hub handoff page
                         │
              approved provider OAuth
                         │
               server token exchange
                         │
                   channel connected
```

`ConnectSessionStore` is in-memory and expires tokens automatically. The QR encoder is implemented locally (`src/lib/qr.js`) and does not call an external QR rendering service.

If an official provider authorization URL is not configured, the handoff page stops and explains that setup is incomplete. It never pretends a channel is connected.

## Router9

1. **Ingress** — raw request enters the platform with optional bot context.
2. **Authenticity** — verify channel secret/signature before business processing.
3. **Normalize** — channel payload becomes one normalized event.
4. **Idempotency** — reject repeat deliveries by `botId:channel:eventId` when a bot exists.
5. **Policy** — decide respond, ignore or workflow-only.
6. **Intent + skill** — classify intent and choose a runtime service skill.
7. **Knowledge** — repository search plus bot-specific teaching sources.
8. **Response** — Scenario / AI / Hybrid selection.
9. **Workflow + dispatch + observe** — emit bot-aware workflow data, send reply when allowed, update metrics/logs.

### Intelligence modes

- **AI** — use the AI router (or deterministic fallback if no provider is configured).
- **Scenario** — only deterministic scenario rules; unmatched intents hand off safely.
- **Hybrid** — use a scenario rule first; otherwise fall through to AI/fallback.

## Normalized event

```js
{
  channel,
  eventId,
  eventType,
  senderId,
  conversationId,
  recipientId,
  text,
  timestamp,
  replyAllowed,
  raw
}
```

`raw` remains internal and is removed before workflow/public responses.

## Repository-as-knowledge design

`bash scripts/import-repo.sh <url>` performs a shallow local clone into `data/repos/<name>` and strips `.git`, common build directories and key/certificate files. `KnowledgeIndex` scans supported text/code files with size/count limits. The first implementation is lexical, offline-capable and auditable; a future vector adapter can sit behind the same `search(query)` contract.

Bot-specific text/URL/document/repository metadata is kept separately from the global repository index and is supplied to the selected bot's response context.

## Frontend information architecture

Normal operators see:

```text
Home
Bots
Conversations
Customers
Automations
Analytics
Settings
```

Router9, provider model routing, raw webhook secrets and n8n internals are not first-level navigation. Advanced technical controls should use progressive disclosure inside bot/settings surfaces.

## Scaling path

Current MVP state is appropriate for a single Bot Hub process. Before multi-replica or multi-business production rollout:

- move `BotStore` from JSON to PostgreSQL;
- move idempotency and connect sessions to Redis with TTL / SET NX semantics;
- add encrypted per-bot provider credential storage;
- persist conversations, messages, contacts, tickets and audit logs in PostgreSQL;
- put outbound work on a durable queue;
- enforce workspace/tenant authorization on every bot-aware route;
- add provider-specific OAuth token-exchange adapters and refresh-token rotation;
- add OpenTelemetry metrics/traces and load tests.
