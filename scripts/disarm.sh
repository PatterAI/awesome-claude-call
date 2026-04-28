#!/usr/bin/env bash
# disarm.sh — clear notify-me / dial-me-on-blocked flags.
#
# Two modes:
#   1. SessionEnd hook (no args, reads JSON from stdin) — clears flags for
#      that session_id, plus any flag older than 24h on any session.
#   2. Slash command (one arg: flag name) — clears that flag for the current
#      $CLAUDE_SESSION_ID.

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${DIR}/lib.sh"

state_dir="$(cc_state_dir)"

if [ $# -ge 1 ]; then
  flag="$1"
  case "$flag" in
    notify-me|dial-me-on-blocked) ;;
    *) echo "Unknown flag: $flag" >&2; exit 64 ;;
  esac
  if [ -z "${CLAUDE_SESSION_ID:-}" ]; then
    echo "CLAUDE_SESSION_ID env var required" >&2
    exit 66
  fi
  target="${state_dir}/${flag}.${CLAUDE_SESSION_ID}.json"
  rm -f "$target"
  cc_log "$(jq -nc --arg flag "$flag" '{event:"disarmed_by_arg", flag: $flag}')"
  echo "Disarmed: ${flag}"
  exit 0
fi

# Stdin mode (SessionEnd hook).
payload="$(cat)"
sid="$(printf '%s' "$payload" | jq -r '.session_id // empty')"

if [ -n "$sid" ]; then
  for f in "${state_dir}"/*."${sid}".json; do
    [ -f "$f" ] && rm -f "$f"
  done
fi

# TTL sweep: remove any flag older than 24h.
now_epoch=$(date -u +%s)
for f in "${state_dir}"/*.json; do
  [ -f "$f" ] || continue
  armed_at="$(jq -r '.armed_at // empty' "$f" 2>/dev/null || true)"
  [ -z "$armed_at" ] && continue
  if armed_epoch=$(date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$armed_at" +%s 2>/dev/null) \
     || armed_epoch=$(date -u -d "$armed_at" +%s 2>/dev/null); then
    age=$(( now_epoch - armed_epoch ))
    if [ "$age" -gt 86400 ]; then
      rm -f "$f"
    fi
  fi
done

cc_log "$(jq -nc --arg sid "$sid" '{event:"disarmed_by_session", session_id: $sid}')"
exit 0
