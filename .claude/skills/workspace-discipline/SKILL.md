---
name: workspace-discipline
description: Use when adding generated files, bot data, imports, repositories, temp artifacts or shared runtime directories.
---

# Workspace Discipline

Choose the data owner and lifecycle before writing a file.

## Rules

- Bot-specific knowledge belongs under a bot-scoped record/path, not a global loose directory.
- Runtime state belongs in `data/state` on server or AppData on Windows, never inside installed application files.
- Imported repositories are source knowledge; strip `.git`, build outputs and obvious secret/key files before indexing.
- Temporary extraction/output belongs in a temporary workspace and must not become durable knowledge implicitly.
- Do not overwrite another bot's or workspace's files because names collide.
- Prefer archive/disable over destructive deletion for operator-managed business content unless deletion is explicit.
- Never use a user-controlled relative path without containment validation.

End file-producing changes with a short manifest: what was created, where it lives, whether it is durable, and how it is cleaned up.
