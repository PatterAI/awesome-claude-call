#!/usr/bin/env bash
# on-notification.sh — Notification hook. If dial-me-on-blocked is armed,
# enqueue a make_call request for the bundled MCP server. Does NOT auto-disarm
# — the user explicitly chose "ring me whenever you stall". Always exits 0.

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

context="${message:0:400}"
system_prompt="You are an AI assistant calling on behalf of Francesco. Identify yourself as such on the first turn. Claude Code stalled with a ${matcher}. Tell Francesco the question/blocker and gather his answer:

${context}"

first_message="Hi Francesco, your AI assistant. Claude needs your input on something — got a sec?"

queue_dir="${CLAUDE_CALL_FIRE_QUEUE:-$HOME/.claude-call/fire-queue}"
mkdir -m 0700 -p "$queue_dir"
queue_file="${queue_dir}/blocked-${sid}-$(date +%s).json"

jq -nc \
  --arg to "$number" \
  --arg sp "$system_prompt" \
  --arg fm "$first_message" \
  --arg sid "$sid" \
  --arg matcher "$matcher" \
  '{tool:"make_call",source:("on-notification:"+$matcher),args:{to:$to,system_prompt:$sp,first_message:$fm}}' \
  > "$queue_file"
chmod 0600 "$queue_file" 2>/dev/null || true

cc_log "$(jq -nc \
  --arg sid "$sid" \
  --arg matcher "$matcher" \
  --arg redacted "$(cc_redact_phone "$number")" \
  '{event:"on_notification_enqueued", session_id:$sid, matcher:$matcher, redacted_number:$redacted}')"
exit 0
