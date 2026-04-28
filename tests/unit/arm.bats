#!/usr/bin/env bats

load '../helpers/setup'

@test "arm.sh creates a flag file with the right shape" {
  export CLAUDE_SESSION_ID="sess-abc"
  run "${REPO_ROOT}/scripts/arm.sh" notify-me "+15555550100"
  [ "$status" -eq 0 ]
  flag="${CLAUDE_CALL_STATE_DIR}/notify-me.sess-abc.json"
  [ -f "$flag" ]
  jq -e '.number == "+15555550100" and .session_id == "sess-abc" and .flag == "notify-me" and .armed_at' "$flag"
}

@test "arm.sh fails with usage when flag arg is missing" {
  run "${REPO_ROOT}/scripts/arm.sh"
  [ "$status" -ne 0 ]
  [[ "$output" == *"Usage"* ]]
}

@test "arm.sh fails with usage when number arg is missing" {
  run "${REPO_ROOT}/scripts/arm.sh" notify-me
  [ "$status" -ne 0 ]
}

@test "arm.sh rejects non-E.164 numbers" {
  export CLAUDE_SESSION_ID="sess-abc"
  run "${REPO_ROOT}/scripts/arm.sh" notify-me "555-1234"
  [ "$status" -ne 0 ]
  [[ "$output" == *"E.164"* ]]
}

@test "arm.sh requires CLAUDE_SESSION_ID" {
  unset CLAUDE_SESSION_ID
  run "${REPO_ROOT}/scripts/arm.sh" notify-me "+15555550100"
  [ "$status" -ne 0 ]
  [[ "$output" == *"CLAUDE_SESSION_ID"* ]]
}

@test "arm.sh re-arming overwrites the previous flag (idempotent)" {
  export CLAUDE_SESSION_ID="sess-abc"
  "${REPO_ROOT}/scripts/arm.sh" notify-me "+15555550100"
  "${REPO_ROOT}/scripts/arm.sh" notify-me "+393339999999"
  flag="${CLAUDE_CALL_STATE_DIR}/notify-me.sess-abc.json"
  jq -e '.number == "+393339999999"' "$flag"
}
