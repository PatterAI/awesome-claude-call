#!/usr/bin/env bash
# on-notification.sh — Notification hook. If dial-me-on-blocked is armed,
# POST make_call so the user is reached on their phone.
# Does NOT auto-disarm — the user explicitly chose "ring me whenever you stall".
# Always exits 0.

set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${DIR}/lib.sh"

matcher="${1:-unknown}"
payload="$(cat)"
sid="$(printf '%s' "$payload" | jq -r '.session_id // empty')"
message="$(printf '%s' "$payload" | jq -r '.message // ""')"

if [ -z "$sid" ]; then
  cc_log '{"event":"on_notification_no_sid"}'
  exit 0
fi

state_dir="$(cc_state_dir)"
flag_file="${state_dir}/dial-me-on-blocked.${sid}.json"
[ -f "$flag_file" ] || exit 0

number="$(jq -r '.number' "$flag_file")"

if ! "${DIR}/preflight.sh" >/dev/null 2>&1; then
  cc_log "$(jq -nc --arg sid "$sid" '{event:"on_notification_skipped_preflight_failed", session_id:$sid}')"
  exit 0
fi

context="${message:0:400}"
system_prompt="You are an AI assistant calling on behalf of the user. Identify yourself as such on the first turn. Claude Code stalled with a ${matcher}. Tell Francesco the question/blocker and gather his answer:

${context}"

first_message="Hi Francesco, your AI assistant. Claude needs your input on something — got a sec?"

req=$(jq -nc \
  --arg to "$number" \
  --arg sp "$system_prompt" \
  --arg fm "$first_message" \
  '{jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"make_call",arguments:{to:$to,systemPrompt:$sp,firstMessage:$fm}}}')

http_code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 \
  -H 'Content-Type: application/json' \
  -X POST "${PATTER_MCP_URL:-http://localhost:3000/mcp}" \
  -d "$req" 2>/dev/null || echo "000")

cc_log "$(jq -nc \
  --arg sid "$sid" \
  --arg matcher "$matcher" \
  --arg redacted "$(cc_redact_phone "$number")" \
  --arg code "$http_code" \
  '{event:"on_notification_fired", session_id:$sid, matcher:$matcher, redacted_number:$redacted, http_code:$code}')"
exit 0
