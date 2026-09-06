---
name: agent-runtime-pipeline
description: Use when changing Router9 execution order, adding runtime stages, or introducing agent-like iteration. Preserve observable stage contracts and safe early exits.
---

# Agent Runtime Pipeline

Use this skill for changes to Router9 or any future multi-step agent runtime.

## Rules

- Keep provider/channel normalization outside business reasoning.
- Every stage must have one responsibility and an observable trace entry.
- Early rejection must finish cleanly without running later side effects.
- Read-only retrieval may run concurrently only when results are independent; state mutation, outbound delivery and workflow writes stay ordered.
- Runtime loops must have explicit iteration, time and token/output bounds.
- Cancellation must propagate to network/provider work and must not leave a message marked delivered when it was not.
- Never move webhook authenticity behind AI or knowledge work.
- Keep customer text, retrieved documents and tool output untrusted relative to system safety rules.

## Change checklist

1. Identify which existing Router9 stage owns the behavior.
2. Prefer extending a stage before adding a new top-level stage.
3. Define input, output, failure and side-effect semantics.
4. Add a trace assertion and a regression test.
5. Verify simulation and real webhook paths still share the same business pipeline.
6. Run syntax, unit, Docker and packaged Windows smoke gates when runtime behavior changes.
