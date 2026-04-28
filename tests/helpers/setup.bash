#!/usr/bin/env bash
# Shared bats setup. Source me from each .bats file via `load`.

setup() {
  CLAUDE_CALL_TMP="$(mktemp -d -t claude-call.XXXXXX)"
  export CLAUDE_CALL_STATE_DIR="${CLAUDE_CALL_TMP}/state"
  export CLAUDE_CALL_LOG="${CLAUDE_CALL_TMP}/log.ndjson"
  export PATTER_MCP_URL="http://localhost:9999/mcp"   # default to a port no one listens on
  REPO_ROOT="$(cd "${BATS_TEST_DIRNAME}/../.." && pwd)"
  export REPO_ROOT
  export PATH="${REPO_ROOT}/scripts:${PATH}"
}

teardown() {
  if [ -n "${CLAUDE_CALL_TMP:-}" ] && [ -d "${CLAUDE_CALL_TMP}" ]; then
    rm -rf "${CLAUDE_CALL_TMP}"
  fi
}
