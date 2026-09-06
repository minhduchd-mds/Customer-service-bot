---
name: cross-surface-parity
description: Use when a feature affects API, Windows desktop, Docker/VPS, UI, configuration or documentation. Prevents one surface from silently lagging behind.
---

# Cross-Surface Parity

A Bot Hub feature is incomplete when only one surface knows it exists.

## Surfaces to check

- Node runtime/API
- Apple-inspired web UI
- Electron Windows package
- Docker/VPS environment and volumes
- `.env.example` / deployment docs
- tests and smoke tests
- Claude Code skills / architecture docs when the rule changes

## Rules

For each change, state which surfaces are affected. Keep local desktop behavior distinct from public HTTPS production behavior. Do not make the UI display a capability as connected/active when only a configuration draft exists. When a new state file is added, ensure both desktop AppData and Docker persistent volumes can hold it. When a config key is added, update `.env.example` and deployment guidance.
