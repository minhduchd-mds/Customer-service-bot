#!/usr/bin/env bash
set -euo pipefail
BASE_URL="${BASE_URL:-http://127.0.0.1:8787}"
curl -fsS "$BASE_URL/api/health" | grep -q '"ok":true'
curl -fsS -X POST "$BASE_URL/api/simulate" -H 'content-type: application/json' -d '{"channel":"telegram","text":"Tôi cần hỗ trợ"}' | grep -q '"accepted":true'
echo "Smoke test passed: $BASE_URL"
