---
name: channel-connector
description: Use when implementing or modifying Telegram, Facebook Messenger, Zalo OA, TikTok, or a new customer messaging connector.
---
# Channel Connector

Each connector must expose `status()`, `verify()`, `normalize()` and `send()` (plus challenge handling where the provider requires it).

## Normalization contract

Always produce channel, eventId, eventType, senderId, conversationId, recipientId, text, timestamp, replyAllowed and raw.

## Capability honesty

If outbound messaging requires product approval or documentation unavailable for the exact account, return `outboundConfigured=false` and keep the endpoint configurable. Never guess a live production URL.

## Done

Add tests for verification and normalization, update `.env.example`, `docs/CHANNELS.md`, and run `npm run check && npm test`.
