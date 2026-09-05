# VPS / Docker deployment

## Why VPS mode exists

The Windows desktop app can generate a LAN QR so a phone on the same Wi-Fi can open the temporary handoff page. That is useful for local testing, but production Zalo/Meta/TikTok OAuth and provider webhooks need a stable public HTTPS endpoint.

For production, deploy the same Bot Hub server on a Linux VPS behind Caddy.

## Recommended topology

```text
Internet
  │ 80/443
Caddy (TLS)
  ├── bot.example.com -> bot:8787
  └── n8n.example.com -> n8n:5678
                         │
                 PostgreSQL + Redis
```

`docker-compose.yml` sets:

```text
PUBLIC_BASE_URL=https://${BOT_DOMAIN}
```

inside the bot container. This prevents production QR/OAuth callbacks from falling back to `127.0.0.1`.

## Admin authentication

The public VPS management surface is protected separately from provider callbacks.

- `/api/health`, `/webhooks/*` and `/connect/*` remain public because providers/phones must reach them.
- The dashboard, static UI and all other management/API routes require HTTP Basic authentication when `BOT_HUB_ADMIN_TOKEN` is configured.
- The default username is `admin` (`BOT_HUB_ADMIN_USER`).
- The bootstrap script generates a long random admin token directly into `.env` and never prints it.
- If no admin token is configured, non-loopback management requests fail closed. Host-local loopback access remains available for diagnostics.
- The embedded Windows desktop runtime is not routed through this public-server auth gate; its management listener remains loopback-only.

When opening `https://bot.example.com`, the browser displays its native authentication prompt. Use the configured admin username and the `BOT_HUB_ADMIN_TOKEN` value from the private VPS `.env` file. Do not put this token in bookmarks, URLs, screenshots, issue bodies or shell history.

For command-line administration, avoid placing credentials directly in reusable command history. Use a protected environment variable or interactive credential input according to your operations policy.

## Fast bootstrap

Prerequisites:

- Linux VPS;
- Docker Engine;
- Docker Compose plugin;
- two DNS records pointing to the VPS;
- ports 80 and 443 open.

Run:

```bash
sh scripts/vps-bootstrap.sh bot.example.com n8n.example.com
```

The script:

- refuses to overwrite an existing `.env`;
- generates PostgreSQL, n8n encryption and Bot Hub admin secrets locally;
- writes `.env` with mode `600`;
- does **not** print generated secrets;
- configures v0.4 state paths for bots, deployment settings and skills;
- prepares `data/state` and `data/repos`;
- leaves provider credentials empty for the operator to fill explicitly.

Then edit `.env` and add only the provider credentials/capabilities actually approved for the business account.

Start the platform:

```bash
docker compose up -d --build
```

Check:

```bash
docker compose ps
docker compose logs -f bot
curl -fsS https://bot.example.com/api/health
```

Caddy obtains and renews TLS certificates automatically when DNS resolves correctly and ports 80/443 are reachable.

## Desktop → VPS configuration

The Windows app exposes **Settings → Deployment**. It stores only a non-secret deployment draft:

- deployment mode;
- VPS host/IP;
- SSH username/port;
- bot domain;
- n8n domain;
- intended public base URL.

It can generate a safe `.env` template and deployment commands. It deliberately does **not** store SSH passwords, private keys, admin tokens or provider access tokens.

A value saved in the desktop Deployment screen is only a **draft**. It becomes active after the corresponding values are applied to the VPS `.env` and the bot service is restarted. The backend distinguishes `draftReady` from `publicReady` to avoid reporting a fake production connection.

## QR / OAuth behavior

### Desktop LAN

```text
Windows Bot Hub
  ├─ UI/API -> 127.0.0.1 only
  └─ QR handoff -> LAN IP, /connect/* only
```

The desktop app chooses a physical Wi-Fi/Ethernet IPv4 address and avoids WSL/Docker/virtual adapters when possible. Only `/connect/*` is exposed on the LAN handoff listener; Bot Hub management APIs remain on localhost.

### VPS production

```text
Phone / Provider
  ↓ HTTPS
https://bot.example.com/connect/...
  ↓
Official provider authorization
  ↓
https://bot.example.com/connect/callback/<provider>
```

Configure `PUBLIC_BASE_URL` plus the approved provider OAuth URL template before treating OAuth as production-ready.

## First manual deployment

If not using the bootstrap script:

1. Install Docker Engine + Compose plugin on a Linux VPS.
2. Point two DNS records to the VPS: one for the bot, one for n8n.
3. Copy `.env.example` to `.env`.
4. Set `BOT_DOMAIN`, `N8N_DOMAIN`, `POSTGRES_PASSWORD`, `N8N_ENCRYPTION_KEY` and a long random `BOT_HUB_ADMIN_TOKEN`.
5. Add only approved channel/provider credentials.
6. Keep ports `8787`, `5432`, `6379`, `5678` private; only Caddy publishes 80/443.
7. Run `docker compose up -d --build`.
8. Verify `https://<BOT_DOMAIN>/api/health` without credentials.
9. Open `https://<BOT_DOMAIN>` and confirm the admin authentication challenge appears.
10. Register each provider webhook only after its connector reports inbound configured.

## Operations

```bash
docker compose ps
docker compose logs -f bot
docker compose logs -f n8n
docker compose pull
docker compose up -d --build
```

Back up `postgres_data`, `n8n_data`, `data/state` and any private knowledge sources according to your data policy.

## Reverse proxy / webhook rules

- HTTPS is mandatory for public TikTok webhook callbacks and strongly recommended/expected for the other platforms.
- Keep the Bot Hub admin token private and rotate it if exposed.
- Do not expose n8n editor without its own authentication/network policy.
- Keep provider signature verification as the primary trust mechanism for webhooks; admin Basic auth is not a substitute for webhook authenticity checks.
- Do not replace official provider authorization with personal-account cookie/session capture.
