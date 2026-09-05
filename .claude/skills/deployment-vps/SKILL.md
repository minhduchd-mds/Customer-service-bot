---
name: deployment-vps
description: Use when changing Docker, VPS, public callbacks, QR reachability, Caddy, domains or deployment settings.
---

# Deployment / VPS skill

## Product invariant

Keep two modes explicit:

- Desktop/LAN is for local operation and same-network QR handoff.
- VPS/Docker with public HTTPS is the production path for provider webhooks and OAuth callbacks.

Never present a saved desktop deployment draft as an active VPS connection.

## Required checks

1. `PUBLIC_BASE_URL` must be the real public HTTPS bot origin in VPS mode.
2. Production QR/callback URLs must never use `127.0.0.1` or `localhost`.
3. Caddy is the only public edge in the default Compose topology; database, Redis, n8n service port and bot service port stay private.
4. Do not store SSH passwords, private keys or provider tokens in platform settings JSON.
5. Bootstrap scripts must not print generated secrets and must refuse destructive overwrite by default.
6. Provider webhook signature verification remains mandatory behind the reverse proxy.
7. Run syntax/tests, Docker build and packaged Windows smoke test when desktop networking changes.

## Desktop LAN rule

The desktop UI/API remains loopback-only. If a phone-reachable listener is needed, expose only the minimum `/connect/*` handoff surface on LAN.

## Production truthfulness

OAuth capability, outbound messaging and callback support are only production-ready when the exact provider product/account permission and token exchange are implemented and tested.
