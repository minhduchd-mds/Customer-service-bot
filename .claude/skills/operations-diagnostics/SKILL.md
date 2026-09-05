---
name: operations-diagnostics
description: Use when debugging a broken bot, channel, provider, VPS, Docker service, QR connection, workflow or Windows package.
---

# Operations Diagnostics

Investigate read-only evidence before changing production configuration.

## Triage order

1. Identify runtime: Windows desktop/LAN or Docker/VPS/public HTTPS.
2. Check `/api/health` and the exact bot/channel status.
3. Inspect the most recent privacy-minimized trace for the failing bot/event.
4. Determine failure layer: authenticity, normalization, skill/intent, knowledge, AI provider, workflow, outbound connector, or public callback.
5. Check only the configuration relevant to that layer; never dump `.env` or secrets.
6. Apply the smallest reversible fix.
7. Re-run simulation or a provider-safe smoke test before live traffic.

## Common diagnostics

- QR opens `127.0.0.1`: desktop connection URL generation is wrong for phone access.
- LAN QR opens but OAuth fails: public HTTPS callback/provider app configuration is still required.
- AI fallback used: inspect provider name/model/status in logs without exposing keys.
- Skill not selected: inspect `/api/skills/search`, bot grants and skill enabled state.
- No outbound reply: inspect tool policy, connector readiness and provider restrictions.

Never change credentials, delete state, or broaden access merely to make a diagnostic check pass.
