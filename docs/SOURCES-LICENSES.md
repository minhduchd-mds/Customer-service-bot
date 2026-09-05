# Sources and license notes

This repository is self-written. No third-party chatbot repository, prompt template or source file is copied into the implementation.

## Design/API references

| Reference | Use | License / note |
| --- | --- | --- |
| Telegram Bot API documentation (`core.telegram.org/bots/api`) | Webhook secret-token behavior and Bot API concepts | Documentation reference only; no source copied. |
| Zalo for Developers (`developers.zalo.me/docs`) | Confirms OA messaging/webhook product surface | Documentation reference only; permission/version-specific details are intentionally configuration-driven. |
| TikTok for Developers webhook overview + verification | HTTPS callback, at-least-once behavior, `TikTok-Signature`, HMAC-SHA256 timestamp/raw-body verification | Documentation reference only; no source copied. |
| `davila7/claude-code-templates` | General inspiration for discoverable project skills, progressive disclosure and validation-oriented workflows | Repository states MIT for the project while also aggregating components with their own licenses. No prompt/template copied; project skills here are original. |

## Dependency posture

Runtime application code has no npm dependencies in v0.1. Docker Compose uses official/community container images (`node`, `postgres`, `redis`, `n8n`, `caddy`) under their respective upstream licenses. Review those licenses and image tags as part of enterprise deployment governance.
