# Security

## Implemented

- Raw-body HMAC verification for Meta and TikTok.
- Telegram secret-token verification.
- Constant-time comparison for cryptographic signatures and Bot Hub admin credentials.
- TikTok timestamp tolerance to reduce replay risk.
- Body-size cap before JSON parsing.
- Idempotency guard before business processing.
- Secret redaction in structured logs.
- Raw channel payload removed from workflow/public output.
- Runtime custom-skill safety scanner plus built-in slug protection and per-bot grants.
- Tool capability policy with explicit deny precedence.
- Privacy-minimized in-memory operational traces.
- Public server management gate: HTTP Basic auth when configured, loopback-only fallback when not configured.
- Public provider surfaces are narrowly exempted: `/api/health`, `/webhooks/*`, `/connect/*`.
- Container runs as a non-root user.
- HTTPS termination and basic security headers in Caddy.

## Public admin boundary

For Docker/VPS, configure:

```text
BOT_HUB_ADMIN_USER=admin
BOT_HUB_ADMIN_TOKEN=<long random secret>
```

`vps-bootstrap.sh` generates the token directly into `.env` and does not print it. The browser receives a standard Basic-auth challenge before the dashboard/static assets are served. Management APIs use the same same-origin browser credential context.

If the token is missing, remote/non-loopback management requests fail closed. This prevents an accidental `HOST=0.0.0.0` deployment from exposing the operator UI and mutation APIs without credentials. Local loopback diagnostics remain available. The embedded Windows desktop app keeps its separate loopback-only management listener.

This is a **single-operator authentication gate**, not full multi-user RBAC. Fine-grained roles, tenant isolation, session revocation and audit-backed identity remain future work.

## Important limitations before production scale

1. In-memory idempotency is single-process only. Move to Redis before multiple bot replicas.
2. Add durable conversation/ticket audit storage before regulated or high-value support workflows.
3. Zalo connector uses a deployment-level shared secret until the exact official OA product/version signature contract is implemented and tested.
4. TikTok outbound is intentionally disabled unless an approved messaging endpoint is configured.
5. Add rate limiting at Caddy/WAF or application edge for repeated admin-auth attempts and public callbacks.
6. Current admin protection is single-operator Basic auth; add real users/RBAC before shared enterprise administration.
7. Treat imported repositories as sensitive source data. Private code should remain on trusted storage; do not forward entire files to external AI providers.
8. For order/account workflows, perform identity checks in the business system; a social-channel user ID alone may be insufficient proof.
9. In-memory conversation memory and traces are not durable and are reset on process restart.
10. Custom skills are instructions-only. Do not enable imported script execution until sandbox, approval, dependency and audit controls are implemented.

## Secret handling

Use VPS secret management, environment files with restrictive permissions, or a secrets manager. Never put credentials in GitHub commits, n8n exported workflow JSON, screenshots or issue bodies.

Do not pass the admin token in a URL. Treat HTTP Basic credentials as sensitive even though HTTPS encrypts them in transit. Rotate `BOT_HUB_ADMIN_TOKEN` if it is exposed and restart the bot service so the new value becomes active.
