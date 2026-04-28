#!/usr/bin/env bash
# preflight.sh — verify patter-mcp is reachable. Exit 0 if healthy, 1 otherwise.

set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${DIR}/lib.sh"

mcp_url="${PATTER_MCP_URL:-http://localhost:3000/mcp}"
health_url="${mcp_url%/mcp}/health"

http_code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 1.5 "$health_url" 2>/dev/null || echo "000")

if [ "$http_code" = "200" ]; then
  exit 0
fi

cat >&2 <<EOF
Patter MCP isn't reachable at ${mcp_url} (got HTTP ${http_code}).
Start it with: cd patter-mcp && npm run dev   (Node 22+ required)
EOF

cc_log "$(jq -nc --arg url "$mcp_url" --arg code "$http_code" \
  '{event:"preflight_failed", url:$url, http_code:$code}')"
exit 1
