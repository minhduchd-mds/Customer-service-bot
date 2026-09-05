---
name: omnichannel-architecture
description: Use when adding a channel, changing Router9 stages, or moving logic between connectors and the core.
---
# Omnichannel Architecture

Keep channel contracts at the edge and one normalized conversation model in the core.

## Workflow

1. Identify whether the requested behavior is channel-specific or business-wide.
2. Put signature/challenge/payload/outbound details in `src/connectors/<channel>.js`.
3. Do not branch on channel inside business modules unless a platform capability truly requires it.
4. Preserve Router9 stage order; security verification must remain before normalization-dependent business work.
5. Add connector fixture tests and Router9 regression tests.
6. Update `docs/CHANNELS.md` if readiness or required configuration changes.

## Guardrail

Never mark permission-dependent behavior as supported just because an endpoint shape is known. Provider approval and account scopes are part of production readiness.
