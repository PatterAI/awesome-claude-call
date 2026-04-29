#!/usr/bin/env bats

load '../helpers/setup'

@test "prints reminder when credentials file is missing" {
  export CLAUDE_CALL_CREDENTIALS="${CLAUDE_CALL_TMP}/no-credentials"
  run "${REPO_ROOT}/scripts/on-session-start.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"/claude-call:setup"* ]]
}

@test "is silent when credentials file exists and is non-empty" {
  export CLAUDE_CALL_CREDENTIALS="${CLAUDE_CALL_TMP}/credentials"
  echo "TWILIO_ACCOUNT_SID=AC1" > "${CLAUDE_CALL_CREDENTIALS}"
  chmod 0600 "${CLAUDE_CALL_CREDENTIALS}"
  run "${REPO_ROOT}/scripts/on-session-start.sh"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}
