#!/usr/bin/env bash
# arm.sh — write a flag file so a hook will trigger an outbound call later.
# Usage: arm.sh <flag-name> <e164-number>

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${DIR}/lib.sh"

usage() {
  echo "Usage: arm.sh <flag-name> <e164-number>" >&2
  echo "  flag-name: notify-me | dial-me-on-blocked" >&2
  exit 64
}

[ $# -eq 2 ] || usage
flag="$1"
number="$2"

case "$flag" in
  notify-me|dial-me-on-blocked) ;;
  *) echo "Unknown flag: $flag" >&2; usage ;;
esac

if [[ ! "$number" =~ ^\+[1-9][0-9]{6,14}$ ]]; then
  echo "Number must be E.164 (e.g. +15555550100)" >&2
  exit 65
fi

if [ -z "${CLAUDE_SESSION_ID:-}" ]; then
  echo "CLAUDE_SESSION_ID env var required" >&2
  exit 66
fi

state_dir="$(cc_state_dir)"
out="${state_dir}/${flag}.${CLAUDE_SESSION_ID}.json"
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

jq -nc \
  --arg flag "$flag" \
  --arg number "$number" \
  --arg sid "$CLAUDE_SESSION_ID" \
  --arg ts "$ts" \
  '{flag: $flag, number: $number, session_id: $sid, armed_at: $ts}' \
  > "$out"

cc_log "$(jq -nc --arg flag "$flag" --arg redacted "$(cc_redact_phone "$number")" \
  '{event: "armed", flag: $flag, redacted_number: $redacted}')"

echo "Armed: ${flag} → ${number}"
