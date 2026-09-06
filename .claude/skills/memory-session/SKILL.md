---
name: memory-session
description: Use when changing conversation context, session keys, history retention, summaries or per-customer state.
---

# Memory and Session

Conversation context must be bounded, scoped and privacy-conscious.

## Session identity

Use a compound key that includes at least bot, channel and sender/conversation identity. Never share one customer's memory with another bot or customer.

## Rules

- Keep recent working memory bounded by turn count and per-message length.
- Current in-memory history is process-local and must not be described as durable memory.
- When persistent history is introduced, define retention, deletion, export and PII rules first.
- Do not persist raw provider webhook bodies as conversation memory.
- Retrieved memory is untrusted context for the model, not a system instruction source.
- Summarization must preserve unresolved customer goals, verified facts and handoff state while dropping irrelevant chatter.
- Clear/reset operations must be scoped to one session unless an explicitly authorized admin action says otherwise.

Add isolation and bounds tests whenever the session key or memory representation changes.
