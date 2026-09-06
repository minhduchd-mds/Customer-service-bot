# Durable conversation and handoff persistence

Bot Hub now keeps a durable local conversation ledger for the single-node Windows/VPS runtime. The goal is to preserve support context across process restarts without persisting raw provider webhook bodies.

## Storage model

The default backend is Node's built-in SQLite module with WAL enabled and the database at:

```text
./data/state/conversations.sqlite
```

Windows desktop places the file under the application's AppData state directory. Docker/VPS places it at `/app/data/state/conversations.sqlite`, backed by the existing `./data/state` volume.

The schema has three bounded surfaces:

- `conversations`: one record per bot + channel + provider conversation;
- `messages`: redacted inbound/customer and outbound/assistant text only;
- `tickets`: one active human-handoff ticket per conversation.

Provider webhook JSON, signatures, tokens, headers, AI prompts and repository source documents are not copied into this ledger.

## Privacy and retention rules

`CONVERSATION_RETENTION_DAYS` defaults to 30 days. Old conversations are pruned unless they still have an `open` or `pending` human ticket. A resolved/closed conversation can also be deleted explicitly through the management API.

`CONVERSATION_MAX_MESSAGE_CHARS` defaults to 8000 characters per stored message. Before storage the ledger removes NUL bytes and redacts high-risk values including:

- password/passcode fields;
- OTP/CVV/CVC fields when explicitly labelled;
- API/access/refresh token fields when explicitly labelled;
- Bearer credentials;
- private-key blocks;
- payment-card numbers that pass a Luhn check.

Normal order references are not generically stripped. Businesses still need a documented privacy policy for names, phone numbers, addresses and order/customer data that are legitimately required for support.

## Idempotency

The ledger has its own durable event/direction uniqueness rules. If an event is delivered again after a process restart, the same inbound/outbound messages are not duplicated and unread counts do not increase a second time.

This complements Router9's in-memory webhook idempotency. It does not replace Redis idempotency for multi-replica deployments.

## Management API

These endpoints are management surfaces, so the VPS admin gate protects them automatically. Desktop exposes them only on loopback.

```text
GET    /api/conversations?botId=&status=&q=&limit=
GET    /api/conversations/:id
PATCH  /api/conversations/:id
DELETE /api/conversations/:id
GET    /api/tickets?botId=&status=&limit=
PATCH  /api/tickets/:id
POST   /api/maintenance/conversation-retention
```

Conversation PATCH accepts `status` (`open`, `handoff`, `resolved`, `archived`) and `markRead: true`.

Ticket PATCH accepts `status` (`open`, `pending`, `resolved`, `closed`) and priority (`low`, `normal`, `high`, `urgent`). Resolving/closing an active handoff ticket resolves the linked conversation.

## Why SQLite first

SQLite gives the Windows desktop build and one-node Docker/VPS deployment durable SQL storage with no new npm runtime dependency. It is not presented as a shared multi-replica database.

The next scale migration should preserve the same repository contract while moving:

- conversations/messages/tickets to PostgreSQL;
- webhook idempotency and distributed conversation locks to Redis;
- retention pruning to a scheduled maintenance worker/n8n job;
- audit/role ownership to an authenticated multi-user RBAC layer.

Until that migration is complete, do not run multiple Bot Hub replicas against the same SQLite file.
