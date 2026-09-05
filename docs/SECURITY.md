# Security

## Implemented

- Raw-body HMAC verification for Meta and TikTok.
- Telegram secret-token verification.
- Constant-time comparison for cryptographic signatures.
- TikTok timestamp tolerance to reduce replay risk.
- Body-size cap before JSON parsing.
- Idempotency guard before business processing.
- Secret redaction in structured logs.
- Raw channel payload removed from workflow/public output.
- Container runs as a non-root user.
- HTTPS termination and basic security headers in Caddy.

## Important limitations before production scale

1. In-memory idempotency is single-process only. Move to Redis before multiple bot replicas.
2. Add durable conversation/ticket audit storage before regulated or high-value support workflows.
3. Zalo connector uses a deployment-level shared secret until the exact official OA product/version signature contract is implemented and tested.
4. TikTok outbound is intentionally disabled unless an approved messaging endpoint is configured.
5. Add rate limiting at Caddy/WAF or application edge for public admin endpoints.
6. Protect `/api/knowledge/search`, `/api/metrics` and `/api/simulate` behind admin authentication before internet exposure.
7. Treat imported repositories as sensitive source data. Private code should remain on trusted storage; do not forward entire files to external AI providers.
8. For order/account workflows, perform identity checks in the business system; a social-channel user ID alone may be insufficient proof.

## Secret handling

Use VPS secret management, environment files with restrictive permissions, or a secrets manager. Never put credentials in GitHub commits, n8n exported workflow JSON, screenshots or issue bodies.
