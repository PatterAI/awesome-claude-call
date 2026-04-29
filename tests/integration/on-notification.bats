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

@test "on-notification permission_prompt enqueues make_call when armed" {
  export CLAUDE_SESSION_ID="sess-N1"
  "${REPO_ROOT}/scripts/arm.sh" dial-me-on-blocked "+393331234567"

  payload='{"session_id":"sess-N1","hook_event_name":"Notification","matcher":"permission_prompt","message":"Claude wants to run rm -rf node_modules"}'
  run bash -c "echo '${payload}' | ${REPO_ROOT}/scripts/on-notification.sh permission_prompt"
  [ "$status" -eq 0 ]

  body=$(cat "${CLAUDE_CALL_FIRE_QUEUE}"/*.json)
  echo "$body" | jq -e '.tool == "make_call"'
  echo "$body" | jq -e '.args.to == "+393331234567"'
  echo "$body" | jq -e '.args.system_prompt | test("permission")'
  echo "$body" | jq -e '.args.system_prompt | test("rm -rf node_modules")'
  echo "$body" | jq -e '.source == "on-notification:permission_prompt"'
}

@test "on-notification idle_prompt enqueues when armed" {
  export CLAUDE_SESSION_ID="sess-N2"
  "${REPO_ROOT}/scripts/arm.sh" dial-me-on-blocked "+393331234567"

  payload='{"session_id":"sess-N2","hook_event_name":"Notification","matcher":"idle_prompt","message":"Claude is waiting for input"}'
  run bash -c "echo '${payload}' | ${REPO_ROOT}/scripts/on-notification.sh idle_prompt"
  [ "$status" -eq 0 ]
  files=$(find "${CLAUDE_CALL_FIRE_QUEUE}" -name '*.json' 2>/dev/null | wc -l | tr -d ' ')
  [ "$files" -eq 1 ]
}

@test "on-notification is a no-op when not armed" {
  payload='{"session_id":"sess-N3","hook_event_name":"Notification","matcher":"permission_prompt","message":"x"}'
  run bash -c "echo '${payload}' | ${REPO_ROOT}/scripts/on-notification.sh permission_prompt"
  [ "$status" -eq 0 ]
  [ ! -d "${CLAUDE_CALL_FIRE_QUEUE}" ] || [ -z "$(find "${CLAUDE_CALL_FIRE_QUEUE}" -name '*.json' 2>/dev/null)" ]
}

@test "on-notification does NOT auto-disarm (multiple prompts can fire repeatedly until SessionEnd)" {
  export CLAUDE_SESSION_ID="sess-N4"
  "${REPO_ROOT}/scripts/arm.sh" dial-me-on-blocked "+393331234567"

  payload='{"session_id":"sess-N4","hook_event_name":"Notification","matcher":"permission_prompt","message":"first"}'
  echo "${payload}" | "${REPO_ROOT}/scripts/on-notification.sh" permission_prompt
  [ -f "${CLAUDE_CALL_STATE_DIR}/dial-me-on-blocked.sess-N4.json" ]
}
