#!/usr/bin/env bats

load '../helpers/setup'

setup_armed() {
  export CLAUDE_SESSION_ID="$1"
  "${REPO_ROOT}/scripts/arm.sh" "$2" "+15555550100"
}

@test "disarm.sh from-stdin removes flags for given session_id" {
  setup_armed "sess-A" notify-me
  setup_armed "sess-A" dial-me-on-blocked
  setup_armed "sess-B" notify-me

  payload='{"session_id":"sess-A","hook_event_name":"SessionEnd"}'
  run bash -c "echo '${payload}' | ${REPO_ROOT}/scripts/disarm.sh"
  [ "$status" -eq 0 ]

  [ ! -f "${CLAUDE_CALL_STATE_DIR}/notify-me.sess-A.json" ]
  [ ! -f "${CLAUDE_CALL_STATE_DIR}/dial-me-on-blocked.sess-A.json" ]
  [ -f "${CLAUDE_CALL_STATE_DIR}/notify-me.sess-B.json" ]
}

@test "disarm.sh by-arg removes a single flag for current session" {
  setup_armed "sess-A" notify-me
  setup_armed "sess-A" dial-me-on-blocked

  export CLAUDE_SESSION_ID="sess-A"
  run "${REPO_ROOT}/scripts/disarm.sh" notify-me
  [ "$status" -eq 0 ]

  [ ! -f "${CLAUDE_CALL_STATE_DIR}/notify-me.sess-A.json" ]
  [ -f "${CLAUDE_CALL_STATE_DIR}/dial-me-on-blocked.sess-A.json" ]
}

@test "disarm.sh by-arg with unknown flag exits non-zero" {
  export CLAUDE_SESSION_ID="sess-A"
  run "${REPO_ROOT}/scripts/disarm.sh" not-a-real-flag
  [ "$status" -ne 0 ]
}

@test "disarm.sh from-stdin with no flags is a no-op (exit 0)" {
  payload='{"session_id":"sess-empty","hook_event_name":"SessionEnd"}'
  run bash -c "echo '${payload}' | ${REPO_ROOT}/scripts/disarm.sh"
  [ "$status" -eq 0 ]
}

@test "disarm.sh from-stdin removes stale flags older than 24h on any session" {
  state="${CLAUDE_CALL_STATE_DIR}"
  mkdir -m 0700 -p "$state"
  stale_ts="$(date -u -v-2d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '2 days ago' +%Y-%m-%dT%H:%M:%SZ)"
  printf '%s\n' "{\"flag\":\"notify-me\",\"number\":\"+15555550100\",\"session_id\":\"sess-stale\",\"armed_at\":\"${stale_ts}\"}" > "${state}/notify-me.sess-stale.json"

  payload='{"session_id":"sess-other","hook_event_name":"SessionEnd"}'
  run bash -c "echo '${payload}' | ${REPO_ROOT}/scripts/disarm.sh"
  [ "$status" -eq 0 ]
  [ ! -f "${state}/notify-me.sess-stale.json" ]
}
