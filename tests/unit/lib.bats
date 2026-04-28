#!/usr/bin/env bats

load '../helpers/setup'

@test "cc_state_dir creates the directory if missing and returns it" {
  source "${REPO_ROOT}/scripts/lib.sh"
  result="$(cc_state_dir)"
  [ "$result" = "${CLAUDE_CALL_STATE_DIR}" ]
  [ -d "${CLAUDE_CALL_STATE_DIR}" ]
  if perms="$(stat -c '%a' "${CLAUDE_CALL_STATE_DIR}" 2>/dev/null)"; then
    :
  else
    perms="$(stat -f '%Lp' "${CLAUDE_CALL_STATE_DIR}")"
  fi
  [ "$perms" = "700" ]
}

@test "cc_log appends a JSON line to CLAUDE_CALL_LOG" {
  source "${REPO_ROOT}/scripts/lib.sh"
  cc_log '{"event":"test","ok":true}'
  [ -f "${CLAUDE_CALL_LOG}" ]
  line="$(tail -n 1 "${CLAUDE_CALL_LOG}")"
  echo "$line" | jq -e '.event == "test" and .ok == true and .ts'
}

@test "cc_redact_phone keeps first 3 + last 4 digits, masks the middle" {
  source "${REPO_ROOT}/scripts/lib.sh"
  # +15555550100 → 13 chars: keep first 3 (+39) + last 4 (4567), mask 6 in the middle
  [ "$(cc_redact_phone '+15555550100')" = '+39******4567' ]
  # +15551234567 → 12 chars: keep first 3 (+15) + last 4 (4567), mask 5 in the middle
  [ "$(cc_redact_phone '+15551234567')" = '+15*****4567' ]
}

@test "cc_redact_phone returns empty when input is empty" {
  source "${REPO_ROOT}/scripts/lib.sh"
  [ "$(cc_redact_phone '')" = '' ]
}
