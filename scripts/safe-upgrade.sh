#!/usr/bin/env sh
set -eu

BRANCH="${1:-feat/omnichannel-router9-claude-skills}"
ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [ ! -d .git ]; then
  echo "Run from a Git clone of Customer-service-bot." >&2
  exit 2
fi
if [ ! -f .env ]; then
  echo ".env is missing. Run scripts/vps-bootstrap.sh first." >&2
  exit 3
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree is not clean. Commit/stash local changes before safe upgrade." >&2
  exit 4
fi

BEFORE="$(git rev-parse HEAD)"
echo "Current revision: $BEFORE"

curl -fsS -X POST http://127.0.0.1:8787/api/operations/backups \
  -H 'content-type: application/json' \
  --data '{"label":"pre-upgrade"}' >/dev/null || {
    echo "Persistent backup failed. Upgrade aborted." >&2
    exit 5
  }
echo "Pre-upgrade backup created."

wait_healthy() {
  i=0
  while [ "$i" -lt 30 ]; do
    if curl -fsS http://127.0.0.1:8787/api/health >/dev/null 2>&1; then
      return 0
    fi
    i=$((i + 1))
    sleep 2
  done
  return 1
}

upgrade() {
  git fetch origin "$BRANCH"
  git checkout "$BRANCH"
  git pull --ff-only origin "$BRANCH"
  docker compose up -d --build
  wait_healthy
  curl -fsS http://127.0.0.1:8787/api/operations/doctor | grep -q '"ok":true'
}

if upgrade; then
  AFTER="$(git rev-parse HEAD)"
  echo "Upgrade complete: $BEFORE -> $AFTER"
  exit 0
fi

echo "Upgrade failed. Rolling code back to $BEFORE ..." >&2
git reset --hard "$BEFORE"
docker compose up -d --build || true
if wait_healthy; then
  echo "Rollback runtime is healthy. The pre-upgrade persistent backup was preserved." >&2
else
  echo "Rollback did not become healthy. Inspect docker compose logs and data/state/backups." >&2
fi
exit 6
