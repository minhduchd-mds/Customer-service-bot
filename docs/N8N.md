# n8n integration

Router9 emits a compact event to `N8N_WEBHOOK_URL` after processing. Configure `N8N_SHARED_SECRET` so the n8n webhook can reject arbitrary callers.

Recommended first workflows:

1. **Human handoff** — when `intent=handoff`, create/update a support ticket and notify an operator.
2. **Lead capture** — when `intent=sales|pricing`, persist contact/channel/conversation and create a CRM lead.
3. **Order lookup** — accept an order reference, call the internal order service, and send the verified result through a dedicated outbound action.
4. **SLA escalation** — timer workflow for unresolved tickets; avoid putting SLA timers inside channel adapters.
5. **Daily operations report** — aggregate processed, duplicate, failed and handoff events.

The bot should never send raw platform webhook bodies or access tokens to n8n. Only normalized/safe fields are emitted.
