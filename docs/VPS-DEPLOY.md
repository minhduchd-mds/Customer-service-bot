# VPS / Docker deployment

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

## First deployment

1. Install Docker Engine + Compose plugin on a Linux VPS.
2. Point two DNS records to the VPS: one for the bot, one for n8n.
3. Copy `.env.example` to `.env`.
4. Set `BOT_DOMAIN`, `N8N_DOMAIN`, `POSTGRES_PASSWORD`, `N8N_ENCRYPTION_KEY` and channel credentials.
5. Keep ports `8787`, `5432`, `6379`, `5678` private; only Caddy publishes 80/443.
6. Run `docker compose up -d --build`.
7. Verify `https://<BOT_DOMAIN>/api/health`.
8. Register each provider webhook only after its connector reports inbound configured.

## Operations

```bash
docker compose ps
docker compose logs -f bot
docker compose logs -f n8n
docker compose pull
docker compose up -d --build
```

Back up `postgres_data`, `n8n_data` and any application persistence added later. `data/repos` is source knowledge and can be re-imported from its upstream repositories, but private repositories should be backed up according to your data policy.

## Reverse proxy / webhook rules

- HTTPS is mandatory for public TikTok webhook callbacks and strongly recommended/expected for the other platforms.
- Do not expose n8n editor without authentication/network policy.
- Consider IP/firewall restrictions where providers publish stable ranges, but keep signature verification as the primary trust mechanism.
