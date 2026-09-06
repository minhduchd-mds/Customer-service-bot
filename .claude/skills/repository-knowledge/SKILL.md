---
name: repository-knowledge
description: Use when importing repositories, changing knowledge indexing/search, adding embeddings, or sending source context to an AI provider.
---
# Repository Knowledge

The knowledge source is local-first. Imported repositories may contain proprietary code.

## Rules

- Exclude `.git`, build outputs, dependencies, binaries and key/certificate files.
- Apply file count/size limits before reading content.
- Keep search behind the `KnowledgeIndex.search()` contract so lexical search can later be replaced or augmented.
- Do not upload full repositories to external AI providers by default.
- Return source paths with snippets so answers remain auditable.
- Record any third-party code incorporated into the product in `docs/SOURCES-LICENSES.md` before committing it.
