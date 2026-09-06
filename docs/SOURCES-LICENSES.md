# Sources and license notes

This repository is self-written. No third-party chatbot repository, prompt template, `SKILL.md`, source file, or executable implementation is copied into the implementation unless a future change explicitly records that material and its compatible license here.

## Design/API references

| Reference | Use | License / note |
| --- | --- | --- |
| Telegram Bot API documentation (`core.telegram.org/bots/api`) | Webhook secret-token behavior and Bot API concepts | Documentation reference only; no source copied. |
| Zalo for Developers (`developers.zalo.me/docs`) | Confirms OA messaging/webhook product surface | Documentation reference only; permission/version-specific details are intentionally configuration-driven. |
| TikTok for Developers webhook overview + verification | HTTPS callback, at-least-once behavior, `TikTok-Signature`, HMAC-SHA256 timestamp/raw-body verification | Documentation reference only; no source copied. |
| `davila7/claude-code-templates` | General inspiration for discoverable project skills, progressive disclosure and validation-oriented workflows | Repository states MIT for the project while also aggregating components with their own licenses. No prompt/template copied; project skills here are original. |
| `nextlevelbuilder/goclaw`, `dev` commit `169e0bafafda983b53ebdb9f884d7bf5e0204249` | Architectural study of skill lifecycle/search/grants, tool policy, memory/session patterns, tracing, provider fallback, channel normalization, store abstraction, scheduling and sandbox boundaries | Repository license reviewed as **CC BY-NC 4.0**. Because of the NonCommercial restriction, Customer Service Bot uses GoClaw only as a conceptual reference. No GoClaw source, prompt, regex set, bundled skill prose, UI code, or executable asset is copied. See `docs/GOCLAW-ADAPTATION.md`. |

## Dependency posture

The runtime service remains zero-runtime-npm-dependency in v0.4. Electron and electron-builder are development/build dependencies for the Windows package. Docker Compose uses third-party container images (`node`, `postgres`, `redis`, `n8n`, `caddy`) under their respective upstream licenses. Review those licenses and image tags as part of enterprise deployment governance.

Custom runtime skills in v0.4 are instruction/metadata packages only. They cannot execute uploaded scripts or install dependencies. This is deliberate until Bot Hub has a production-grade sandbox, authentication/RBAC, approval boundary, audit log and dependency security model.
