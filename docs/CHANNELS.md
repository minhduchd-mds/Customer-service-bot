# Channel adapters

## Telegram

Inbound security uses the `X-Telegram-Bot-Api-Secret-Token` value configured when registering a webhook. Outbound uses Bot API `sendMessage`. Configure `TELEGRAM_WEBHOOK_SECRET` and `TELEGRAM_BOT_TOKEN`.

Production registration should use an HTTPS webhook and a secret token. Do not run both webhook and long-polling modes for the same bot.

## Facebook Messenger

The adapter supports the webhook verification challenge and verifies POST bodies with `X-Hub-Signature-256` using the application secret. Outbound uses the configured page access token.

Required variables: `FACEBOOK_VERIFY_TOKEN`, `FACEBOOK_APP_SECRET`, `FACEBOOK_PAGE_ACCESS_TOKEN`.

App review, Page permissions and messaging policies still apply; code cannot bypass them.

## Zalo Official Account

Zalo Developers exposes OA messaging, management and webhook products, but details can depend on the product/API version and authenticated app configuration. This repository therefore does **not** hard-code a guessed send endpoint or universal signature header.

- `ZALO_SEND_URL`: copy the current approved OA send endpoint from your Zalo Developers integration.
- `ZALO_OA_ACCESS_TOKEN`: OA access token.
- `ZALO_WEBHOOK_SECRET`: deployment-level shared secret enforced by the webhook route/edge.

When an official webhook signature mechanism is confirmed for the exact OA product/version in use, implement it in `ZaloConnector.verify` and add a fixture test before marking the connector production-ready.

## TikTok

The public TikTok developer webhook format is event-oriented. The adapter verifies `TikTok-Signature` using the timestamp + raw request body and HMAC-SHA256, then applies a replay-tolerance window. Public webhook delivery can be at-least-once, so Router9 deduplicates event IDs.

`TIKTOK_SEND_URL` and `TIKTOK_ACCESS_TOKEN` are blank by default. They should only be configured when the business account has an approved customer-messaging product/capability with a documented outbound endpoint. Public content/auth webhooks alone do not mean a generic DM bot can send replies.
