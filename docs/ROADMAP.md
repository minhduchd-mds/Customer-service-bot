# Roadmap

## Phase 0 — current foundation

- Router9 orchestration.
- Telegram + Meta verification/normalization.
- TikTok public webhook verification/idempotency.
- Zalo adapter boundary.
- Local repository knowledge import/search.
- AI provider adapter + safe fallback.
- n8n bridge.
- Docker/VPS stack.
- Claude Code skills + CI.

## Phase 1 — production persistence

- PostgreSQL schema: tenants, contacts, conversations, messages, tickets, channel accounts, consent, audit log.
- Redis idempotency and outbound queue.
- Admin authentication + RBAC.
- Per-tenant encryption/configuration.
- Web dashboard for conversations, handoff, connector health and SLA.

## Phase 2 — sales/customer-care product

- Product/catalog and FAQ ingestion.
- CRM/order connectors through n8n or dedicated adapters.
- Agent inbox with claim/assign/close.
- Conversation summary + suggested reply.
- Quality review, CSAT and analytics.
- Language/persona policies per brand.

## Phase 3 — channel hardening

- Verify the exact current Zalo OA webhook signature/DPoP requirements for the granted app and replace shared-secret edge verification.
- Add approved TikTok Business Messaging support only when the business account/API product provides it.
- Rich message templates, attachments and rate-limit handling per channel.
- Contract tests from sanitized provider fixtures.

## Phase 4 — scale

- Multi-replica workers and durable queue.
- Observability (OpenTelemetry metrics/traces).
- Horizontal tenant sharding where needed.
- Hybrid lexical + vector search with source-level permission filters.
- Disaster-recovery runbook and load tests.
