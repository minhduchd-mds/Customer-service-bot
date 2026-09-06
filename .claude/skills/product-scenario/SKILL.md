---
name: product-scenario
description: Use when adding product catalog, product introduction, recommendation, comparison, pricing, promotion or sales scenarios.
---

# Product scenario skill

## Goal

Product bots should explain and recommend naturally while remaining grounded in business-provided product data.

## Required structure

Prefer this flow for product introduction:

1. identify requested product or ask for it;
2. explain what it is / customer problem solved;
3. highlight verified differentiators;
4. translate features into practical benefits;
5. identify who it fits;
6. include current price only when present in knowledge;
7. offer a concise CTA or human handoff.

## Never invent

- product specifications;
- current price;
- discount or voucher;
- promotion expiry;
- stock availability;
- warranty;
- delivery promise.

If a fact is missing, state that current business data does not confirm it.

## Hybrid pattern

Use deterministic scenario rules for business boundaries, lead capture and handoff. A scenario rule may request AI generation only when the AI prompt is grounded in bot-specific Product Knowledge. The no-provider fallback must also remain safe and useful.

## Quality gate

Add or update tests for intent classification, scenario selection and grounded fallback whenever product behavior changes.
