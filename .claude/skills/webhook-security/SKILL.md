---
name: webhook-security
description: Use when changing webhook routes, signature verification, raw-body handling, replay protection, idempotency, or provider secrets.
---
# Webhook Security

Webhook authenticity is a correctness requirement, not optional hardening.

## Checklist

- Verify against the exact raw request bytes when the provider signs the body.
- Use constant-time comparisons for MAC/signature text of equal length.
- Reject missing/invalid secrets explicitly.
- Enforce timestamp tolerance when the signed format provides one.
- Preserve idempotency after verification and before side effects.
- Never log signature secrets or access tokens.
- Add one positive and at least one negative test.

Do not replace cryptographic verification with an IP allowlist or user-agent check.
