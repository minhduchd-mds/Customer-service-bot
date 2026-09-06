---
name: tool-policy
description: Use when adding a runtime capability, side effect, workflow, outbound action or per-bot permission profile.
---

# Tool Policy

Capabilities are the contract between reasoning and side effects.

## Rules

- Classify a capability before exposing it: retrieval/read, memory/state write, AI call, workflow emission, outbound delivery, or human handoff.
- Default customer-service behavior must preserve current product flow; more restrictive profiles can subtract permissions.
- Per-bot `deny` always wins over profile and explicit `allow`.
- Never use a fallback path to bypass a denied capability.
- `read-only` must not send customer messages, invoke AI, or emit mutating workflows.
- Scenario-only bots do not need AI permission.
- New capabilities need a stable name, profile placement, API visibility and tests.

When adding an external tool later, route it through the policy layer rather than calling it directly from Router9 or a skill.
