# GoClaw architecture study and clean-room adaptation

This document records concepts studied from `nextlevelbuilder/goclaw` and how they are independently implemented or intentionally deferred in Customer Service Bot.

Reference reviewed: GoClaw `dev` at commit `169e0bafafda983b53ebdb9f884d7bf5e0204249`.

## License boundary

GoClaw's repository license is Creative Commons Attribution-NonCommercial 4.0. This project does **not** copy GoClaw source files, bundled `SKILL.md` prose, regex sets, prompts, UI code, or executable implementations. The items below are architectural concepts independently reimplemented for this repository's Node.js architecture.

## Mapping

| GoClaw concept studied | Customer Service Bot 0.4 adaptation | Status |
| --- | --- | --- |
| Versioned skill store | `SkillRegistry` with SHA-256 content hash and monotonically increasing custom-skill version | Implemented |
| Builtin + managed skill hierarchy | Built-in runtime skills plus custom persisted instruction skills; built-ins cannot be overwritten | Implemented, deliberately simpler |
| Skill metadata search | Zero-dependency BM25-style metadata/trigger search | Implemented |
| Per-agent skill grants | Per-bot `skills.mode=auto/allowlist` and slug grants | Implemented |
| Progressive skill disclosure | List/search returns metadata by default; full instructions returned only by skill detail/selection | Implemented |
| Skill publishing safety checks | Independent line-oriented high-risk instruction scanner | Implemented |
| Skill eval workflow | `/api/skills/evaluate` with trigger/expected-skill cases | Implemented |
| Tool registry/policy | Capability-oriented `ToolPolicy` profiles with per-bot allow/deny overlay | Implemented for Bot Hub runtime capabilities |
| Working session context | Bounded per-bot/channel/sender `ConversationMemory` | Implemented in memory only |
| Tracing spans | Privacy-minimized bounded `TraceStore` recording stage metadata, selected skill and delivery result | Implemented for single-process MVP |
| Provider fallback | Ordered OpenAI-compatible primary + fallback candidate routing | Implemented via env configuration |
| Multi-store PostgreSQL/SQLite architecture | Current JSON stores stay for desktop MVP; PostgreSQL/Redis migration remains planned | Deferred |
| Hybrid vector + FTS memory | Existing repository lexical search remains; vector/FTS backend planned with PostgreSQL | Deferred |
| Scheduler lanes / cron | n8n remains the primary workflow scheduler; per-session queue/debounce will be a separate runtime phase | Partially covered by n8n / deferred |
| MCP tool bridge | No direct port; evaluate only after Bot Hub tool policy and authentication are production hardened | Deferred |
| Agent teams/delegation | Human handoff + n8n orchestration today; multi-agent task board is future scope | Deferred |
| Sandbox skill scripts | Custom skills in 0.4 are **instructions-only**. No imported skill can execute scripts or install dependencies | Intentionally not implemented |
| Office bundled skills | PDF/DOCX/XLSX/PPTX patterns inform future document knowledge ingestion; original GoClaw skill text/scripts are not included | Roadmap |
| Workspace discipline | Bot-specific state/knowledge boundaries and original Claude Code workspace skill | Applied as development guidance |
| Cross-surface parity | Any backend capability must be considered for API, desktop, Docker/VPS and tests | Applied as development rule |

## Runtime skill lifecycle in Bot Hub

```text
Publish custom instructions
        ↓
Validate name / slug / size
        ↓
Safety scan
        ↓
SHA-256 content hash
        ↓
Create or version skill
        ↓
Enable / disable
        ↓
Optional per-bot allowlist
        ↓
Intent match or skill search
        ↓
Load full instructions only for selected skill
        ↓
Router9 + ToolPolicy
        ↓
AI / scenario / workflow / channel
        ↓
Privacy-minimized trace
```

## Deliberate differences

Customer Service Bot is a focused customer-service product, not a general-purpose coding/OS agent gateway. Therefore:

- Runtime skills do not receive shell access.
- Runtime skills cannot install pip/npm/system dependencies.
- There is no generic `exec` tool exposed to customer conversations.
- External provider credentials remain environment/config secrets, not skill content.
- Product, order, price, promotion, policy and stock facts require business knowledge grounding.
- Zalo/Meta/TikTok integration remains tied to approved provider APIs/capabilities rather than personal-session automation.

## Next architecture phases

1. Add authenticated admin/RBAC before exposing mutation APIs publicly.
2. Move bot, skill, trace, session and idempotency state to PostgreSQL/Redis for multi-replica VPS deployments.
3. Add persistent conversation/session history with retention controls and PII policy.
4. Add provider health/cooldown/usage accounting around the existing ordered fallback list.
5. Add document ingestion workers for PDF/DOCX/XLSX/PPTX with file-type-specific validation.
6. Add bounded inbound debounce and per-conversation serialization for bursty channel traffic.
7. Re-evaluate MCP and sandboxed script skills only after permission, audit and isolation layers exist.
