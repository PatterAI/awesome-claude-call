#!/usr/bin/env bats

load '../helpers/setup'

setup() {
  CLAUDE_CALL_TMP="$(mktemp -d -t claude-call.XXXXXX)"
  export CLAUDE_CALL_STATE_DIR="${CLAUDE_CALL_TMP}/state"
  export CLAUDE_CALL_LOG="${CLAUDE_CALL_TMP}/log.ndjson"
  export CLAUDE_CALL_FIRE_QUEUE="${CLAUDE_CALL_TMP}/fire-queue"
  REPO_ROOT="$(cd "${BATS_TEST_DIRNAME}/../.." && pwd)"
  export REPO_ROOT
}

teardown() {
  rm -rf "${CLAUDE_CALL_TMP}"
}

@test "on-stop enqueues make_call when notify-me flag is armed" {
  export CLAUDE_SESSION_ID="sess-X"
  "${REPO_ROOT}/scripts/arm.sh" notify-me "+15555550100"

  payload='{"session_id":"sess-X","hook_event_name":"Stop","last_assistant_message":"All tests passing. Refactor complete.","stop_hook_active":true}'
  run bash -c "echo '${payload}' | ${REPO_ROOT}/scripts/on-stop.sh"
  [ "$status" -eq 0 ]

  files=$(find "${CLAUDE_CALL_FIRE_QUEUE}" -name '*.json' 2>/dev/null | wc -l | tr -d ' ')
  [ "$files" -eq 1 ]
  body=$(cat "${CLAUDE_CALL_FIRE_QUEUE}"/*.json)
  echo "$body" | jq -e '.tool == "make_call"'
  echo "$body" | jq -e '.args.to == "+15555550100"'
  echo "$body" | jq -e '.args.system_prompt | test("AI assistant")'
  echo "$body" | jq -e '.args.system_prompt | test("Refactor complete")'
  echo "$body" | jq -e '.source == "on-stop"'
}

@test "on-stop is a no-op when no flag is armed" {
  payload='{"session_id":"sess-Y","hook_event_name":"Stop","last_assistant_message":"hi","stop_hook_active":true}'
  run bash -c "echo '${payload}' | ${REPO_ROOT}/scripts/on-stop.sh"
  [ "$status" -eq 0 ]
  [ ! -d "${CLAUDE_CALL_FIRE_QUEUE}" ] || [ -z "$(find "${CLAUDE_CALL_FIRE_QUEUE}" -name '*.json' 2>/dev/null)" ]
}

@test "on-stop disarms the flag after firing (idempotent within session)" {
  export CLAUDE_SESSION_ID="sess-Z"
  "${REPO_ROOT}/scripts/arm.sh" notify-me "+15555550100"

  payload='{"session_id":"sess-Z","hook_event_name":"Stop","last_assistant_message":"done","stop_hook_active":true}'
  echo "${payload}" | "${REPO_ROOT}/scripts/on-stop.sh"
  [ ! -f "${CLAUDE_CALL_STATE_DIR}/notify-me.sess-Z.json" ]
}
