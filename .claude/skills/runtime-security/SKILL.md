---
name: runtime-security
description: Use for security-sensitive runtime, webhook, skill publishing, public API, credential, file or deployment changes.
---

# Runtime Security

Use defense in depth; no single check is considered sufficient.

## Required boundaries

- Verify provider authenticity before normalization or business logic where the provider supports signatures/secrets.
- Enforce request/body size limits and bounded text lengths.
- Treat user messages, imported documents, URLs, repositories and skill text as untrusted input.
- Store no provider token, SSH secret, cookie, private key or password in bot/profile JSON.
- Redact credentials from logs and traces.
- Keep management APIs loopback/private unless authentication and authorization are explicitly implemented.
- Public OAuth/webhook callbacks require HTTPS and exact official provider configuration.
- File operations must remain inside an approved workspace; reject traversal and unsafe symlink behavior.
- Custom skills are instructions-only until sandboxing, approval, resource limits and auditing exist.

## Review gates

For a sensitive change add a negative test for the failure path, inspect logging for accidental secret exposure, and verify Docker/VPS exposure separately from desktop/LAN behavior.
