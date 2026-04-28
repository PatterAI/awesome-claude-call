#!/usr/bin/env bash
# on-stop.sh — Stop hook. If notify-me is armed, POST make_call to patter-mcp.
# Always exits 0 (never blocks Claude). Reads hook event JSON from stdin.

set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${DIR}/lib.sh"

payload="$(cat)"
sid="$(printf '%s' "$payload" | jq -r '.session_id // empty')"
last_msg="$(printf '%s' "$payload" | jq -r '.last_assistant_message // ""')"

if [ -z "$sid" ]; then
  cc_log '{"event":"on_stop_no_sid"}'
  exit 0
fi

state_dir="$(cc_state_dir)"
flag_file="${state_dir}/notify-me.${sid}.json"
[ -f "$flag_file" ] || exit 0

number="$(jq -r '.number' "$flag_file")"

if ! "${DIR}/preflight.sh" >/dev/null 2>&1; then
  cc_log "$(jq -nc --arg sid "$sid" '{event:"on_stop_skipped_preflight_failed", session_id:$sid}')"
  exit 0
fi

# Truncate summary to 500 chars to keep the system prompt tight.
summary="${last_msg:0:500}"

system_prompt="You are an AI assistant calling on behalf of the user. Identify yourself as such on the first turn. Francesco asked to be notified when the current task finished. Read this summary, then offer to take follow-up questions:

${summary}"

first_message="Hi Francesco, this is your AI assistant. Your task just finished — got a moment for the summary?"

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
  --arg redacted "$(cc_redact_phone "$number")" \
  --arg code "$http_code" \
  '{event:"on_stop_fired", session_id:$sid, redacted_number:$redacted, http_code:$code}')"

rm -f "$flag_file"
exit 0
