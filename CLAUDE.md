# CLAUDE.md — Customer Service Bot

## Mission

Build a secure, self-hosted omnichannel customer-service platform. Preserve channel-specific security while exposing one normalized conversation model to the rest of the system.

## Non-negotiable rules

1. Read the relevant project skill under `.claude/skills/` before changing its area.
2. Never weaken webhook verification to make a test pass.
3. Never hard-code tokens, secrets, page IDs, OA IDs or customer data.
4. Keep channel payload quirks inside `src/connectors/`; business logic belongs in `src/core/`.
5. Keep TikTok messaging and Zalo outbound endpoints configuration-driven unless the current official API and granted account capability are verified.
6. Every inbound event must remain idempotent.
7. Do not claim a channel is production-ready when only its skeleton/permission-dependent adapter is configured.
8. After code changes run `npm run check` and `npm test`.
9. Do not merge to `main` unless CI is green and the changed connector has tests for verification + normalization.
10. Prefer small, reversible commits and self-written implementation. If a third-party implementation is incorporated, record source + license in `docs/SOURCES-LICENSES.md` first.

## Architecture boundaries

- `src/connectors/`: webhook verification, normalization, outbound channel calls.
- `src/core/router9.js`: orchestration only.
- `src/core/`: idempotency, policy, intent, knowledge, AI routing and workflow bridge.
- `src/skills/`: runtime business/customer-service skills, not Claude Code instructions.
- `.claude/skills/`: development workflow instructions for Claude Code.
- `data/repos/`: imported local knowledge repositories; never commit their contents.

## Definition of done

A change is complete only when:

- error paths are explicit;
- no secret leaks into logs;
- tests cover expected and adversarial behavior;
- `npm run check` passes;
- `npm test` passes;
- docs/env examples are updated when configuration changes;
- production capability statements remain accurate.
