# Architecture

## Goal

One customer-service core, many channels. Every channel translates its platform payload into the same normalized event and keeps platform-specific auth/outbound details out of business logic.

```text
Telegram ─┐
Facebook ─┼─> Channel Adapter ─> Router9 ─> Runtime Skill ─> Knowledge ─> AI/Fallback ─> Channel
Zalo ─────┤                         │                           │
TikTok ───┘                         └─────────────> n8n ───────┘

Local repository imports ───────────────> KnowledgeIndex
```

## Router9

1. **Ingress** — raw request enters the platform.
2. **Authenticity** — verify channel secret/signature against raw bytes before parsing-dependent work.
3. **Normalize** — channel payload becomes one event model.
4. **Idempotency** — reject repeat deliveries by `channel:eventId`.
5. **Policy** — decide respond, ignore or workflow-only.
6. **Intent + skill** — classify intent and pick a runtime customer-service capability.
7. **Knowledge** — local source/doc search; no source means the model must not invent business facts.
8. **Response** — AI router when configured; deterministic safe fallback otherwise.
9. **Workflow + dispatch + observe** — emit to n8n, send only if the event is replyable, update metrics/logs.

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

`./scripts/import-repo.sh` performs a shallow local clone into `data/repos/<name>` and strips `.git`, common build directories and key/certificate files. `KnowledgeIndex` scans supported text/code files with size/count limits. The first implementation is lexical so it works offline and is auditable; a future vector adapter can be added behind the same `search(query)` contract.

This is deliberately different from copying an upstream bot project into the product. We reuse **ideas and public API contracts**, while keeping the product implementation self-written and license-clean.

## Scaling path

The in-memory idempotency store is adequate for a single-process MVP. Before multi-replica production rollout:

- move idempotency to Redis with TTL + SET NX;
- persist normalized conversations, contacts, tickets and audit events in PostgreSQL;
- put outbound work on a durable queue;
- retain the same connector and Router9 interfaces;
- add tenant isolation before serving multiple businesses.
