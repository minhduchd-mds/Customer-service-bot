#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <git-url> [name]" >&2
  exit 2
fi

URL="$1"
NAME="${2:-$(basename "${URL%.git}")}"
if [[ ! "$NAME" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "Invalid repository name: $NAME" >&2
  exit 2
fi

ROOT="${KNOWLEDGE_ROOT:-./data/repos}"
TARGET="$ROOT/$NAME"
mkdir -p "$ROOT"
if [[ -e "$TARGET" ]]; then
  echo "Target already exists: $TARGET" >&2
  exit 1
fi

echo "Importing $URL -> $TARGET"
git clone --depth 1 --filter=blob:limit=2m "$URL" "$TARGET"
rm -rf "$TARGET/.git"
find "$TARGET" -type d \( -name node_modules -o -name dist -o -name build -o -name .next -o -name vendor \) -prune -exec rm -rf {} + 2>/dev/null || true
find "$TARGET" -type f \( -name '*.pem' -o -name '*.key' -o -name '.env' -o -name '*.p12' -o -name '*.pfx' \) -delete

echo "Imported. Restart the app or rebuild the knowledge index before querying new files."
