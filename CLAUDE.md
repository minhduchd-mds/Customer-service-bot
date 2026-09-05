# CLAUDE.md — Customer Service Bot / Bot Hub

## Mission

Build a secure, self-hosted **multi-bot omnichannel customer-service platform**. The operator experience is intentionally simple: **Create → Connect → Teach → Go Live**. Channel security, Router9, AI routing, workflows and credentials remain behind that product flow.

## Non-negotiable rules

1. Read the relevant project skill under `.claude/skills/` before changing its area.
2. Never weaken webhook verification to make a test pass.
3. Never hard-code tokens, secrets, page IDs, OA IDs or customer data.
4. Keep channel payload quirks inside `src/connectors/`; business logic belongs in `src/core/`.
5. Keep TikTok messaging and Zalo outbound/OAuth details configuration-driven unless the current official API and granted account capability are verified.
6. Every inbound event must remain idempotent and scoped by bot when a bot context exists.
7. Never treat QR login/session cookies from personal social accounts as a supported integration strategy. QR is a temporary handoff into approved authorization flows.
8. Do not claim a channel is production-ready when only its skeleton/permission-dependent adapter is configured.
9. After code changes run `npm run check` and `npm test`.
10. Do not merge to `main` unless CI is green and security-sensitive connector changes have verification + normalization tests.
11. Prefer small, reversible commits and self-written implementation. If third-party code is incorporated, record source + license in `docs/SOURCES-LICENSES.md` first.

## Product / UX rules

- Keep first-level navigation product-oriented: Home, Bots, Conversations, Customers, Automations, Analytics, Settings.
- Do not expose Router9, model providers, webhook secrets, guardrails or raw n8n details as first-level navigation for normal operators.
- Use an Apple-inspired web language: restrained surfaces, strong typography, generous spacing, subtle blur, minimal color and clear hierarchy. Do not copy Apple assets or reproduce macOS chrome.
- Prefer progressive disclosure: simple defaults first, advanced configuration only when requested.
- Every bot owns its identity, intelligence mode, channels, knowledge and scenario configuration.

## Architecture boundaries

- `src/connectors/`: webhook verification, normalization, outbound channel calls.
- `src/core/router9.js`: orchestration only.
- `src/core/bot-store.js`: multi-bot product state for the MVP; replace with PostgreSQL behind the same concepts before large-scale production.
- `src/core/connect-session.js`: short-lived QR authorization handoff state.
- `src/core/scenario.js`: deterministic scenario templates/rules.
- `src/core/`: idempotency, policy, intent, knowledge, AI routing and workflow bridge.
- `src/skills/`: runtime business/customer-service skills, not Claude Code instructions.
- `.claude/skills/`: development workflow instructions for Claude Code.
- `public/`: operator-facing web application. Keep dependencies minimal and UI accessible.
- `data/repos/`: imported local knowledge repositories; never commit their contents.
- `data/state/`: local MVP state; never store plaintext provider access tokens here.

## Definition of done

A change is complete only when:

- error paths are explicit;
- no secret leaks into logs or persisted Bot Hub state;
- tests cover expected and adversarial behavior;
- frontend JavaScript passes the syntax gate;
- `npm run check` passes;
- `npm test` passes;
- docs/env examples are updated when configuration changes;
- production capability statements remain accurate;
- the operator flow remains simpler than the underlying technical architecture.
