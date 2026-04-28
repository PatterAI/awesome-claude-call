#!/usr/bin/env bash
# claude-call shared bash helpers. Source me — do not execute.

set -o pipefail

cc_state_dir() {
  local dir="${CLAUDE_CALL_STATE_DIR:-$HOME/.claude-call/state}"
  if [ ! -d "$dir" ]; then
    mkdir -m 0700 -p "$dir"
  fi
  printf '%s' "$dir"
}

cc_log() {
  local payload="$1"
  local log="${CLAUDE_CALL_LOG:-$HOME/.claude-call/log.ndjson}"
  mkdir -p "$(dirname "$log")"
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '%s\n' "$(printf '%s' "$payload" | jq -c --arg ts "$ts" '. + {ts: $ts}')" >> "$log"
}

cc_redact_phone() {
  local n="$1"
  if [ -z "$n" ]; then
    printf ''
    return
  fi
  local len=${#n}
  if [ "$len" -le 4 ]; then
    printf '%s' "$n"
    return
  fi
  local last4="${n: -4}"
  local prefix="${n:0:$((len - 4))}"
  local mask=""
  local i=0
  while [ $i -lt ${#prefix} ]; do
    local ch="${prefix:$i:1}"
    if [ "$ch" = "+" ] || [[ "$ch" =~ [0-9] ]]; then
      if [ "$i" -le 2 ]; then
        mask+="$ch"
      else
        mask+="*"
      fi
    else
      mask+="$ch"
    fi
    i=$((i + 1))
  done
  printf '%s%s' "$mask" "$last4"
}
