#!/usr/bin/env bash
# on-stop.sh — Stop hook. If notify-me is armed, enqueue a make_call request
# for the bundled MCP server to fire. Always exits 0 (never blocks Claude).
# Reads hook event JSON from stdin.

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

# Truncate summary to 500 chars to keep the system prompt tight.
summary="${last_msg:0:500}"

system_prompt="You are an AI assistant calling on behalf of Francesco. Identify yourself as such on the first turn. Francesco asked to be notified when the current task finished. Read this summary, then offer to take follow-up questions:

${summary}"

first_message="Hi Francesco, this is your AI assistant. Your task just finished — got a moment for the summary?"

queue_dir="${CLAUDE_CALL_FIRE_QUEUE:-$HOME/.claude-call/fire-queue}"
mkdir -m 0700 -p "$queue_dir"
queue_file="${queue_dir}/notify-${sid}-$(date +%s).json"

jq -nc \
  --arg to "$number" \
  --arg sp "$system_prompt" \
  --arg fm "$first_message" \
  --arg sid "$sid" \
  '{tool:"make_call",source:"on-stop",args:{to:$to,system_prompt:$sp,first_message:$fm}}' \
  > "$queue_file"
chmod 0600 "$queue_file" 2>/dev/null || true

cc_log "$(jq -nc \
  --arg sid "$sid" \
  --arg redacted "$(cc_redact_phone "$number")" \
  '{event:"on_stop_enqueued", session_id:$sid, redacted_number:$redacted}')"

rm -f "$flag_file"
exit 0
