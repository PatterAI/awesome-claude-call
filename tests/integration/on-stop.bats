#!/usr/bin/env bats

load '../helpers/setup'

PORT=19300
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

@test "on-stop fires make_call when notify-me flag is armed" {
  export CLAUDE_SESSION_ID="sess-X"
  "${REPO_ROOT}/scripts/arm.sh" notify-me "+15555550100"

  payload='{"session_id":"sess-X","hook_event_name":"Stop","last_assistant_message":"All tests passing. Refactor complete.","stop_hook_active":true}'
  run bash -c "echo '${payload}' | ${REPO_ROOT}/scripts/on-stop.sh"
  [ "$status" -eq 0 ]

  sleep 0.2
  [ -s "${FAKE_LOG}" ]
  body="$(cat "${FAKE_LOG}")"
  echo "$body" | jq -e '.method == "tools/call"'
  echo "$body" | jq -e '.params.name == "make_call"'
  echo "$body" | jq -e '.params.arguments.to == "+15555550100"'
  echo "$body" | jq -e '.params.arguments.systemPrompt | test("AI assistant")'
  echo "$body" | jq -e '.params.arguments.systemPrompt | test("Refactor complete")'
}

@test "on-stop is a no-op when no flag is armed" {
  payload='{"session_id":"sess-Y","hook_event_name":"Stop","last_assistant_message":"hi","stop_hook_active":true}'
  run bash -c "echo '${payload}' | ${REPO_ROOT}/scripts/on-stop.sh"
  [ "$status" -eq 0 ]
  [ ! -s "${FAKE_LOG}" ]
}

@test "on-stop disarms the flag after firing (idempotent within session)" {
  export CLAUDE_SESSION_ID="sess-Z"
  "${REPO_ROOT}/scripts/arm.sh" notify-me "+15555550100"

  payload='{"session_id":"sess-Z","hook_event_name":"Stop","last_assistant_message":"done","stop_hook_active":true}'
  echo "${payload}" | "${REPO_ROOT}/scripts/on-stop.sh"
  [ ! -f "${CLAUDE_CALL_STATE_DIR}/notify-me.sess-Z.json" ]
}

@test "on-stop logs preflight failure and exits 0 when patter-mcp is down" {
  export CLAUDE_SESSION_ID="sess-W"
  "${REPO_ROOT}/scripts/arm.sh" notify-me "+15555550100"
  if [ -f "${CLAUDE_CALL_TMP}/server.pid" ]; then
    kill "$(cat "${CLAUDE_CALL_TMP}/server.pid")" 2>/dev/null || true
    rm -f "${CLAUDE_CALL_TMP}/server.pid"
  fi
  sleep 0.2

  payload='{"session_id":"sess-W","hook_event_name":"Stop","last_assistant_message":"done","stop_hook_active":true}'
  run bash -c "echo '${payload}' | ${REPO_ROOT}/scripts/on-stop.sh"
  [ "$status" -eq 0 ]

  grep -q 'preflight_failed' "${CLAUDE_CALL_LOG}"
}
