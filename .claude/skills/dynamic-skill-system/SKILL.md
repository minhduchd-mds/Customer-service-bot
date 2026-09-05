---
name: dynamic-skill-system
description: Use when adding, publishing, selecting, granting, disabling or searching runtime skills for Bot Hub bots.
---

# Dynamic Skill System

Runtime skills are business instructions, not arbitrary code packages.

## Invariants

- Built-in skill slugs are reserved and cannot be overwritten by custom skills.
- Custom skill content is safety-scanned before persistence.
- Persist a stable content hash; identical publish requests must be idempotent.
- Changed custom content increments the stored version.
- Metadata can be listed/search-ranked without loading full instructions into every AI request.
- A bot in `allowlist` mode can use only granted skill slugs; do not bypass grants through a fallback path.
- Disabled skills cannot be selected.
- Skill instructions cannot override webhook verification, tool policy, product grounding, credential policy or provider approval rules.
- Do not add custom script execution until a real sandbox + approval + audit boundary exists.

## Tests required

Cover publish, unchanged publish, version bump, unsafe rejection, enable/disable, search relevance, allowlist behavior and at least one end-to-end Router9 selection.
