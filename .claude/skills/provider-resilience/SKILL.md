---
name: provider-resilience
description: Use when adding AI providers, model routing, fallback, retry or health behavior.
---

# Provider Resilience

Provider routing must fail safely without changing business truth.

## Rules

- Keep one normalized AI request/response contract; provider wire quirks stay behind the router.
- Try the configured primary route first, then explicit ordered fallbacks.
- Do not silently substitute a model when the operator explicitly requested an exact provider/model for a test.
- Fallback may handle transport errors, timeout, rate limit, overload, auth/billing failure or missing model; context overflow needs compaction, not provider roulette.
- Never expose provider API keys in logs, traces, UI payloads or skill content.
- A provider failure must fall back to deterministic grounded behavior when possible.
- Product/order/policy truth requirements remain identical across all providers.
- Add cooldown/health state only with observable status and bounded recovery logic.

Test at least primary success, primary failure + fallback success, and all-provider failure to deterministic fallback.
