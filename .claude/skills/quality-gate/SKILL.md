---
name: quality-gate
description: Use after code changes and before opening, approving, or merging a pull request.
---
# Quality Gate

Run:

```bash
npm run check
npm test
```

For connector changes, confirm tests cover authenticity and normalization. For Docker changes, build the image in CI. Review the diff for credentials, copied third-party prompts/code and unsupported production claims.

Do not merge `main` with failing CI or an untested security-sensitive connector change.
