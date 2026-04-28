#!/usr/bin/env bats

load '../helpers/setup'

PORT=19400
FAKE_LOG=""

setup() {
  CLAUDE_CALL_TMP="$(mktemp -d -t claude-call.XXXXXX)"
  export CLAUDE_CALL_STATE_DIR="${CLAUDE_CALL_TMP}/state"
  export CLAUDE_CALL_LOG="${CLAUDE_CALL_TMP}/log.ndjson"
  export PATTER_MCP_URL="http://127.0.0.1:${PORT}/mcp"
  REPO_ROOT="$(cd "${BATS_TEST_DIRNAME}/../.." && pwd)"
  export REPO_ROOT
  FAKE_LOG="${CLAUDE_CALL_TMP}/fake-mcp-requests.log"

  python3 "${REPO_ROOT}/tests/integration/fake_patter_mcp.py" "${PORT}" "${FAKE_LOG}" &
  echo $! > "${CLAUDE_CALL_TMP}/server.pid"
  for _ in $(seq 1 60); do
    if curl -sS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
      break
    fi
    sleep 0.05
  done
}

teardown() {
  if [ -f "${CLAUDE_CALL_TMP}/server.pid" ]; then
    kill "$(cat "${CLAUDE_CALL_TMP}/server.pid")" 2>/dev/null || true
  fi
  rm -rf "${CLAUDE_CALL_TMP}"
}

@test "on-notification permission_prompt fires make_call when armed" {
  export CLAUDE_SESSION_ID="sess-N1"
  "${REPO_ROOT}/scripts/arm.sh" dial-me-on-blocked "+393331234567"

  payload='{"session_id":"sess-N1","hook_event_name":"Notification","matcher":"permission_prompt","message":"Claude wants to run rm -rf node_modules"}'
  run bash -c "echo '${payload}' | ${REPO_ROOT}/scripts/on-notification.sh permission_prompt"
  [ "$status" -eq 0 ]

  sleep 0.2
  body="$(cat "${FAKE_LOG}")"
  echo "$body" | jq -e '.params.name == "make_call"'
  echo "$body" | jq -e '.params.arguments.to == "+393331234567"'
  echo "$body" | jq -e '.params.arguments.systemPrompt | test("permission")'
  echo "$body" | jq -e '.params.arguments.systemPrompt | test("rm -rf node_modules")'
}

@test "on-notification idle_prompt fires when armed" {
  export CLAUDE_SESSION_ID="sess-N2"
  "${REPO_ROOT}/scripts/arm.sh" dial-me-on-blocked "+393331234567"

  payload='{"session_id":"sess-N2","hook_event_name":"Notification","matcher":"idle_prompt","message":"Claude is waiting for input"}'
  run bash -c "echo '${payload}' | ${REPO_ROOT}/scripts/on-notification.sh idle_prompt"
  [ "$status" -eq 0 ]
  sleep 0.2
  [ -s "${FAKE_LOG}" ]
}

@test "on-notification is a no-op when not armed" {
  payload='{"session_id":"sess-N3","hook_event_name":"Notification","matcher":"permission_prompt","message":"x"}'
  run bash -c "echo '${payload}' | ${REPO_ROOT}/scripts/on-notification.sh permission_prompt"
  [ "$status" -eq 0 ]
  [ ! -s "${FAKE_LOG}" ]
}

@test "on-notification does NOT auto-disarm (multiple prompts can fire repeatedly until SessionEnd)" {
  export CLAUDE_SESSION_ID="sess-N4"
  "${REPO_ROOT}/scripts/arm.sh" dial-me-on-blocked "+393331234567"

  payload='{"session_id":"sess-N4","hook_event_name":"Notification","matcher":"permission_prompt","message":"first"}'
  echo "${payload}" | "${REPO_ROOT}/scripts/on-notification.sh" permission_prompt
  [ -f "${CLAUDE_CALL_STATE_DIR}/dial-me-on-blocked.sess-N4.json" ]
}
