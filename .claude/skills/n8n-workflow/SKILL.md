---
name: n8n-workflow
description: Use when routing leads, tickets, order lookups, human handoff, notifications, CRM actions, or other automation through n8n.
---
# n8n Workflow Boundary

Use n8n for business orchestration, not webhook authenticity or channel payload parsing.

Only emit normalized, minimum-necessary fields. Never send provider credentials or raw webhook payloads. Sign bot-to-n8n calls with the configured shared secret.

Prefer idempotent workflow operations keyed by channel + eventId or a stable business object ID. For order/payment actions, confirm state in the system of record before sending a customer-facing result.
