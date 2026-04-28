# claude-call v0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the v0.1 of `claude-call`: a Claude Code plugin that lets Claude make outbound phone calls (third-party + user) and lets the user call back into an active Claude session, all via the existing `patter-mcp` server.

**Architecture:** Claude Code plugin (manifest + hooks + commands + subagent) that delegates 100% of voice/telephony to a separately-running `patter-mcp` HTTP MCP server. The plugin contains shell scripts (for hooks) and prompt-template markdown (for slash commands and the subagent). No voice code.

**Tech Stack:** Bash (POSIX), `jq` for JSON, `curl` for HTTP, `bats-core` for shell tests, Python 3 stdlib (`http.server`) for a fake patter-mcp test fixture, GitHub Actions for CI, Markdown for plugin manifests.

**Spec:** `docs/superpowers/specs/2026-04-27-claude-call-design.md`

---

## Prerequisites for the Engineer

Before starting any task:

- The repo is at `~/Desktop/codes/claude-call` (cloned from https://github.com/FrancescoRosciano/claude-call). Already has the design spec committed on `main`.
- `git config user.name` and `user.email` are already set for the repo.
- Install dev tools on macOS: `brew install bats-core jq`. (Linux: `apt-get install bats jq` or equivalent.)
- Python 3.11+ is on `PATH` (used by the fake patter-mcp test fixture; no extra packages needed — stdlib only).
- The engineer does not need Twilio / OpenAI / patter-mcp credentials. All automated tests use a fake server. Only the final manual e2e (Task 20) needs real credentials.
- Work on a feature branch: `git checkout -b feat/v0.1` from `main` before Task 1. All commits go to that branch. PR opened at the end.

## File Structure (locked after this section)

Files this plan creates (paths relative to repo root):

```
claude-call/
├── .claude-plugin/plugin.json            (Task 18)
├── .mcp.json                              (Task 17)
├── .gitignore                             (Task 1)
├── LICENSE                                (Task 1)
├── README.md                              (Task 1 stub, Task 21 full)
├── CHANGELOG.md                           (Task 22)
├── Makefile                               (Task 1)
├── commands/
│   ├── call.md                            (Task 13)
│   ├── notify-me.md                       (Task 14)
│   ├── notify-me-cancel.md                (Task 14)
│   ├── dial-me-on-blocked.md              (Task 15)
│   ├── dial-me-on-blocked-cancel.md       (Task 15)
│   └── calls.md                           (Task 16)
├── agents/
│   └── phone-agent.md                     (Task 19)
├── hooks/
│   └── hooks.json                         (Task 12)
├── scripts/
│   ├── lib.sh                             (Task 3)
│   ├── arm.sh                             (Task 4)
│   ├── disarm.sh                          (Task 5)
│   ├── preflight.sh                       (Task 6)
│   ├── on-stop.sh                         (Task 9)
│   └── on-notification.sh                 (Task 11)
├── tests/
│   ├── unit/
│   │   ├── lib.bats                       (Task 3)
│   │   ├── arm.bats                       (Task 4)
│   │   ├── disarm.bats                    (Task 5)
│   │   └── preflight.bats                 (Task 6)
│   ├── integration/
│   │   ├── fake_patter_mcp.py             (Task 7)
│   │   ├── on-stop.bats                   (Task 8)
│   │   └── on-notification.bats           (Task 10)
│   ├── helpers/
│   │   └── setup.bash                     (Task 2)
│   └── e2e.md                             (Task 23)
├── .github/workflows/ci.yml               (Task 20)
└── docs/superpowers/{specs,plans}/        (already exists)
```

Why these boundaries:
- `scripts/lib.sh` holds shared bash helpers (state-dir resolution, jq wrappers, redact-phone). Other scripts source it. Keeps each hook script focused and < 80 lines.
- One bats file per script under test. One integration bats file per hook script.
- Fake patter-mcp lives as a tiny Python script (no extra deps, no npm) — usable from CI without booting the real `patter-mcp`.

---

## Task 1: Repo scaffolding (.gitignore, LICENSE, Makefile, README stub)

**Files:**
- Create: `~/Desktop/codes/claude-call/.gitignore`
- Create: `~/Desktop/codes/claude-call/LICENSE`
- Create: `~/Desktop/codes/claude-call/Makefile`
- Create: `~/Desktop/codes/claude-call/README.md`

- [ ] **Step 1: Create the feature branch**

```bash
cd ~/Desktop/codes/claude-call
git checkout -b feat/v0.1
```

Expected: `Switched to a new branch 'feat/v0.1'`

- [ ] **Step 2: Write `.gitignore`**

```
# claude-call .gitignore
.DS_Store
*.log
node_modules/
dist/
.coverage/
.idea/
.vscode/
*.bats.tmp
tests/.tmp/
```

- [ ] **Step 3: Write `LICENSE` (MIT)**

```
MIT License

Copyright (c) 2026 Francesco Rosciano

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 4: Write `Makefile`**

```makefile
.PHONY: test test-unit test-integration lint clean install-dev

test: test-unit test-integration

test-unit:
	@bats tests/unit

test-integration:
	@bats tests/integration

lint:
	@find scripts -name '*.sh' -print0 | xargs -0 -I{} sh -c 'shellcheck {} || true'

clean:
	@rm -rf tests/.tmp

install-dev:
	@command -v bats >/dev/null || (echo "Install bats-core: brew install bats-core" && exit 1)
	@command -v jq >/dev/null || (echo "Install jq: brew install jq" && exit 1)
	@echo "Dev tools OK"
```

- [ ] **Step 5: Write README stub**

```markdown
# claude-call

Two-way voice bridge for Claude Code via Patter — make outbound calls, get called when work is done.

> **Status:** v0.1 in progress. See [`docs/superpowers/plans/2026-04-27-claude-call-v0.1.md`](docs/superpowers/plans/2026-04-27-claude-call-v0.1.md).

Full README arriving in Task 21.
```

- [ ] **Step 6: Commit**

```bash
cd ~/Desktop/codes/claude-call
git add .gitignore LICENSE Makefile README.md
git commit -m "chore: repo scaffolding (gitignore, license, makefile, readme stub)"
```

---

## Task 2: bats test helpers (`tests/helpers/setup.bash`)

**Files:**
- Create: `~/Desktop/codes/claude-call/tests/helpers/setup.bash`

This is the shared `setup()` for every bats file. Sets up an isolated temp state dir, points env vars at it, cleans up after.

- [ ] **Step 1: Create the helpers directory and file**

```bash
mkdir -p ~/Desktop/codes/claude-call/tests/helpers
```

- [ ] **Step 2: Write `tests/helpers/setup.bash`**

```bash
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
```

- [ ] **Step 3: Commit**

```bash
cd ~/Desktop/codes/claude-call
git add tests/helpers/setup.bash
git commit -m "test: add shared bats setup helper with isolated tmp state dir"
```

---

## Task 3: Shared library (`scripts/lib.sh`) — TDD

**Files:**
- Create: `~/Desktop/codes/claude-call/tests/unit/lib.bats`
- Create: `~/Desktop/codes/claude-call/scripts/lib.sh`

Library exposes three functions: `cc_state_dir`, `cc_log`, `cc_redact_phone`.

- [ ] **Step 1: Write the failing test**

```bash
mkdir -p ~/Desktop/codes/claude-call/tests/unit ~/Desktop/codes/claude-call/scripts
```

Write `tests/unit/lib.bats`:

```bash
#!/usr/bin/env bats

load '../helpers/setup'

@test "cc_state_dir creates the directory if missing and returns it" {
  source "${REPO_ROOT}/scripts/lib.sh"
  result="$(cc_state_dir)"
  [ "$result" = "${CLAUDE_CALL_STATE_DIR}" ]
  [ -d "${CLAUDE_CALL_STATE_DIR}" ]
  perms="$(stat -f '%Lp' "${CLAUDE_CALL_STATE_DIR}" 2>/dev/null || stat -c '%a' "${CLAUDE_CALL_STATE_DIR}")"
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
  # +393331234567 → 13 chars: keep first 3 (+39) + last 4 (4567), mask 6 in the middle
  [ "$(cc_redact_phone '+393331234567')" = '+39******4567' ]
  # +15551234567 → 12 chars: keep first 3 (+15) + last 4 (4567), mask 5 in the middle
  [ "$(cc_redact_phone '+15551234567')" = '+15*****4567' ]
}

@test "cc_redact_phone returns empty when input is empty" {
  source "${REPO_ROOT}/scripts/lib.sh"
  [ "$(cc_redact_phone '')" = '' ]
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd ~/Desktop/codes/claude-call
bats tests/unit/lib.bats
```

Expected: 4 failures with messages about `scripts/lib.sh` not existing.

- [ ] **Step 3: Write minimal implementation in `scripts/lib.sh`**

```bash
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd ~/Desktop/codes/claude-call
bats tests/unit/lib.bats
```

Expected: `4 tests, 0 failures`.

- [ ] **Step 5: Commit**

```bash
cd ~/Desktop/codes/claude-call
git add scripts/lib.sh tests/unit/lib.bats
git commit -m "feat(scripts): add lib.sh with state dir, log, and phone redaction helpers"
```

---

## Task 4: `scripts/arm.sh` + tests — TDD

**Files:**
- Create: `~/Desktop/codes/claude-call/tests/unit/arm.bats`
- Create: `~/Desktop/codes/claude-call/scripts/arm.sh`

`arm.sh` writes a flag file. Usage: `arm.sh <flag-name> <number>`. Reads `$CLAUDE_SESSION_ID` from env (Claude Code sets it for hooks; the slash command supplies it via prompt context too — for tests we set it directly).

- [ ] **Step 1: Write the failing test**

`tests/unit/arm.bats`:

```bash
#!/usr/bin/env bats

load '../helpers/setup'

@test "arm.sh creates a flag file with the right shape" {
  export CLAUDE_SESSION_ID="sess-abc"
  run "${REPO_ROOT}/scripts/arm.sh" notify-me "+393331234567"
  [ "$status" -eq 0 ]
  flag="${CLAUDE_CALL_STATE_DIR}/notify-me.sess-abc.json"
  [ -f "$flag" ]
  jq -e '.number == "+393331234567" and .session_id == "sess-abc" and .flag == "notify-me" and .armed_at' "$flag"
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
  run "${REPO_ROOT}/scripts/arm.sh" notify-me "+393331234567"
  [ "$status" -ne 0 ]
  [[ "$output" == *"CLAUDE_SESSION_ID"* ]]
}

@test "arm.sh re-arming overwrites the previous flag (idempotent)" {
  export CLAUDE_SESSION_ID="sess-abc"
  "${REPO_ROOT}/scripts/arm.sh" notify-me "+393331234567"
  "${REPO_ROOT}/scripts/arm.sh" notify-me "+393339999999"
  flag="${CLAUDE_CALL_STATE_DIR}/notify-me.sess-abc.json"
  jq -e '.number == "+393339999999"' "$flag"
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/Desktop/codes/claude-call
bats tests/unit/arm.bats
```

Expected: 6 failures (script doesn't exist).

- [ ] **Step 3: Write `scripts/arm.sh`**

```bash
#!/usr/bin/env bash
# arm.sh — write a flag file so a hook will trigger an outbound call later.
# Usage: arm.sh <flag-name> <e164-number>

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${DIR}/lib.sh"

usage() {
  echo "Usage: arm.sh <flag-name> <e164-number>" >&2
  echo "  flag-name: notify-me | dial-me-on-blocked" >&2
  exit 64
}

[ $# -eq 2 ] || usage
flag="$1"
number="$2"

case "$flag" in
  notify-me|dial-me-on-blocked) ;;
  *) echo "Unknown flag: $flag" >&2; usage ;;
esac

if [[ ! "$number" =~ ^\+[1-9][0-9]{6,14}$ ]]; then
  echo "Number must be E.164 (e.g. +393331234567)" >&2
  exit 65
fi

if [ -z "${CLAUDE_SESSION_ID:-}" ]; then
  echo "CLAUDE_SESSION_ID env var required" >&2
  exit 66
fi

state_dir="$(cc_state_dir)"
out="${state_dir}/${flag}.${CLAUDE_SESSION_ID}.json"
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

jq -nc \
  --arg flag "$flag" \
  --arg number "$number" \
  --arg sid "$CLAUDE_SESSION_ID" \
  --arg ts "$ts" \
  '{flag: $flag, number: $number, session_id: $sid, armed_at: $ts}' \
  > "$out"

cc_log "$(jq -nc --arg flag "$flag" --arg redacted "$(cc_redact_phone "$number")" \
  '{event: "armed", flag: $flag, redacted_number: $redacted}')"

echo "Armed: ${flag} → ${number}"
```

- [ ] **Step 4: Make it executable**

```bash
chmod +x ~/Desktop/codes/claude-call/scripts/arm.sh
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd ~/Desktop/codes/claude-call
bats tests/unit/arm.bats
```

Expected: `6 tests, 0 failures`.

- [ ] **Step 6: Commit**

```bash
cd ~/Desktop/codes/claude-call
git add scripts/arm.sh tests/unit/arm.bats
git commit -m "feat(scripts): add arm.sh to write notify-me / dial-me-on-blocked flags"
```

---

## Task 5: `scripts/disarm.sh` + tests — TDD

**Files:**
- Create: `~/Desktop/codes/claude-call/tests/unit/disarm.bats`
- Create: `~/Desktop/codes/claude-call/scripts/disarm.sh`

`disarm.sh` clears flags. Two modes:
- Called by `SessionEnd` hook: reads JSON from stdin, gets `session_id`, deletes flags for that session.
- Called by `/notify-me-cancel` slash command: takes a flag name as arg, deletes flag for current `$CLAUDE_SESSION_ID`.

- [ ] **Step 1: Write the failing test**

`tests/unit/disarm.bats`:

```bash
#!/usr/bin/env bats

load '../helpers/setup'

setup_armed() {
  export CLAUDE_SESSION_ID="$1"
  "${REPO_ROOT}/scripts/arm.sh" "$2" "+393331234567"
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
  printf '%s\n' "{\"flag\":\"notify-me\",\"number\":\"+393331234567\",\"session_id\":\"sess-stale\",\"armed_at\":\"${stale_ts}\"}" > "${state}/notify-me.sess-stale.json"

  payload='{"session_id":"sess-other","hook_event_name":"SessionEnd"}'
  run bash -c "echo '${payload}' | ${REPO_ROOT}/scripts/disarm.sh"
  [ "$status" -eq 0 ]
  [ ! -f "${state}/notify-me.sess-stale.json" ]
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/Desktop/codes/claude-call
bats tests/unit/disarm.bats
```

Expected: 5 failures.

- [ ] **Step 3: Write `scripts/disarm.sh`**

```bash
#!/usr/bin/env bash
# disarm.sh — clear notify-me / dial-me-on-blocked flags.
#
# Two modes:
#   1. SessionEnd hook (no args, reads JSON from stdin) — clears flags for
#      that session_id, plus any flag older than 24h on any session.
#   2. Slash command (one arg: flag name) — clears that flag for the current
#      $CLAUDE_SESSION_ID.

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${DIR}/lib.sh"

state_dir="$(cc_state_dir)"

if [ $# -ge 1 ]; then
  flag="$1"
  case "$flag" in
    notify-me|dial-me-on-blocked) ;;
    *) echo "Unknown flag: $flag" >&2; exit 64 ;;
  esac
  if [ -z "${CLAUDE_SESSION_ID:-}" ]; then
    echo "CLAUDE_SESSION_ID env var required" >&2
    exit 66
  fi
  target="${state_dir}/${flag}.${CLAUDE_SESSION_ID}.json"
  rm -f "$target"
  cc_log "$(jq -nc --arg flag "$flag" '{event:"disarmed_by_arg", flag: $flag}')"
  echo "Disarmed: ${flag}"
  exit 0
fi

# Stdin mode (SessionEnd hook).
payload="$(cat)"
sid="$(printf '%s' "$payload" | jq -r '.session_id // empty')"

if [ -n "$sid" ]; then
  for f in "${state_dir}"/*."${sid}".json; do
    [ -f "$f" ] && rm -f "$f"
  done
fi

# TTL sweep: remove any flag older than 24h.
now_epoch=$(date -u +%s)
for f in "${state_dir}"/*.json; do
  [ -f "$f" ] || continue
  armed_at="$(jq -r '.armed_at // empty' "$f" 2>/dev/null || true)"
  [ -z "$armed_at" ] && continue
  if armed_epoch=$(date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$armed_at" +%s 2>/dev/null) \
     || armed_epoch=$(date -u -d "$armed_at" +%s 2>/dev/null); then
    age=$(( now_epoch - armed_epoch ))
    if [ "$age" -gt 86400 ]; then
      rm -f "$f"
    fi
  fi
done

cc_log "$(jq -nc --arg sid "$sid" '{event:"disarmed_by_session", session_id: $sid}')"
exit 0
```

- [ ] **Step 4: Make it executable and run tests**

```bash
chmod +x ~/Desktop/codes/claude-call/scripts/disarm.sh
cd ~/Desktop/codes/claude-call
bats tests/unit/disarm.bats
```

Expected: `5 tests, 0 failures`.

- [ ] **Step 5: Commit**

```bash
cd ~/Desktop/codes/claude-call
git add scripts/disarm.sh tests/unit/disarm.bats
git commit -m "feat(scripts): add disarm.sh (stdin + by-arg modes, with 24h TTL sweep)"
```

---

## Task 6: `scripts/preflight.sh` + tests — TDD

**Files:**
- Create: `~/Desktop/codes/claude-call/tests/unit/preflight.bats`
- Create: `~/Desktop/codes/claude-call/scripts/preflight.sh`

Pings `${PATTER_MCP_URL%/mcp}/health` with a 1.5s timeout. Exit 0 if healthy, exit 1 otherwise. Prints a clear failure message to stderr.

- [ ] **Step 1: Write the failing test**

`tests/unit/preflight.bats`:

```bash
#!/usr/bin/env bats

load '../helpers/setup'

start_fake_health_server() {
  local port="$1"
  local response="$2"
  python3 -c "
import http.server, socketserver, sys, threading
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/health':
            self.send_response($response)
            self.end_headers()
            self.wfile.write(b'ok')
        else:
            self.send_response(404)
            self.end_headers()
    def log_message(self, *a): pass
s = socketserver.TCPServer(('127.0.0.1', $port), H)
threading.Thread(target=s.serve_forever, daemon=True).start()
import time
while True: time.sleep(1)
" &
  echo $! > "${CLAUDE_CALL_TMP}/server.pid"
  sleep 0.3
}

stop_fake_health_server() {
  if [ -f "${CLAUDE_CALL_TMP}/server.pid" ]; then
    kill "$(cat "${CLAUDE_CALL_TMP}/server.pid")" 2>/dev/null || true
    rm -f "${CLAUDE_CALL_TMP}/server.pid"
  fi
}

@test "preflight passes when /health returns 200" {
  start_fake_health_server 19101 200
  export PATTER_MCP_URL="http://127.0.0.1:19101/mcp"
  run "${REPO_ROOT}/scripts/preflight.sh"
  stop_fake_health_server
  [ "$status" -eq 0 ]
}

@test "preflight fails when /health returns 500" {
  start_fake_health_server 19102 500
  export PATTER_MCP_URL="http://127.0.0.1:19102/mcp"
  run "${REPO_ROOT}/scripts/preflight.sh"
  stop_fake_health_server
  [ "$status" -ne 0 ]
  [[ "$output" == *"Patter MCP"* ]]
}

@test "preflight fails when no server is listening" {
  export PATTER_MCP_URL="http://127.0.0.1:19199/mcp"
  run "${REPO_ROOT}/scripts/preflight.sh"
  [ "$status" -ne 0 ]
  [[ "$output" == *"npm run dev"* ]]
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/Desktop/codes/claude-call
bats tests/unit/preflight.bats
```

Expected: 3 failures.

- [ ] **Step 3: Write `scripts/preflight.sh`**

```bash
#!/usr/bin/env bash
# preflight.sh — verify patter-mcp is reachable. Exit 0 if healthy, 1 otherwise.

set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${DIR}/lib.sh"

mcp_url="${PATTER_MCP_URL:-http://localhost:3000/mcp}"
health_url="${mcp_url%/mcp}/health"

http_code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 1.5 "$health_url" 2>/dev/null || echo "000")

if [ "$http_code" = "200" ]; then
  exit 0
fi

cat >&2 <<EOF
Patter MCP isn't reachable at ${mcp_url} (got HTTP ${http_code}).
Start it with: cd patter-mcp && npm run dev   (Node 22+ required)
EOF

cc_log "$(jq -nc --arg url "$mcp_url" --arg code "$http_code" \
  '{event:"preflight_failed", url:$url, http_code:$code}')"
exit 1
```

- [ ] **Step 4: Make it executable and run tests**

```bash
chmod +x ~/Desktop/codes/claude-call/scripts/preflight.sh
cd ~/Desktop/codes/claude-call
bats tests/unit/preflight.bats
```

Expected: `3 tests, 0 failures`.

- [ ] **Step 5: Commit**

```bash
cd ~/Desktop/codes/claude-call
git add scripts/preflight.sh tests/unit/preflight.bats
git commit -m "feat(scripts): add preflight.sh to ping patter-mcp /health before calls"
```

---

## Task 7: Fake patter-mcp test fixture (`tests/integration/fake_patter_mcp.py`)

**Files:**
- Create: `~/Desktop/codes/claude-call/tests/integration/fake_patter_mcp.py`

A tiny stdlib-only HTTP server that:
- Returns 200 on `GET /health`
- Accepts `POST /mcp` and writes the request body to `$FAKE_MCP_LOG` (one JSON-line per request)
- Replies with a canned MCP success response

- [ ] **Step 1: Create the integration test directory**

```bash
mkdir -p ~/Desktop/codes/claude-call/tests/integration
```

- [ ] **Step 2: Write `tests/integration/fake_patter_mcp.py`**

```python
#!/usr/bin/env python3
"""Fake patter-mcp HTTP server for integration tests. Stdlib only.

Usage: fake_patter_mcp.py <port> <log_file>

  GET  /health  -> 200 "ok"
  POST /mcp     -> 200 with a canned MCP response; appends request body to log_file.
"""
from __future__ import annotations
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = int(sys.argv[1])
LOG_PATH = sys.argv[2]

_lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"ok")
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if not self.path.startswith("/mcp"):
            self.send_response(404)
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length).decode("utf-8") if length else ""
        with _lock:
            with open(LOG_PATH, "a", encoding="utf-8") as f:
                f.write(body.replace("\n", " ") + "\n")
        try:
            req = json.loads(body) if body else {}
        except Exception:
            req = {}
        rid = req.get("id", 1)
        resp = {
            "jsonrpc": "2.0",
            "id": rid,
            "result": {
                "content": [{"type": "text", "text": "Call initiated. Call ID: fake-call-001"}],
            },
        }
        payload = json.dumps(resp).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        return


def main() -> None:
    open(LOG_PATH, "w").close()
    server = HTTPServer(("127.0.0.1", PORT), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Make it executable**

```bash
chmod +x ~/Desktop/codes/claude-call/tests/integration/fake_patter_mcp.py
```

- [ ] **Step 4: Smoke-test it manually**

```bash
cd ~/Desktop/codes/claude-call
python3 tests/integration/fake_patter_mcp.py 19200 /tmp/fake-mcp.log &
PID=$!
sleep 0.3
curl -sS http://127.0.0.1:19200/health
curl -sS -X POST -d '{"jsonrpc":"2.0","id":1}' http://127.0.0.1:19200/mcp
kill $PID
cat /tmp/fake-mcp.log
```

Expected:
- First curl prints `ok`
- Second curl prints `{"jsonrpc": "2.0", "id": 1, "result": ...}`
- The log file contains the request body

- [ ] **Step 5: Commit**

```bash
cd ~/Desktop/codes/claude-call
git add tests/integration/fake_patter_mcp.py
git commit -m "test: add stdlib fake patter-mcp server for integration tests"
```

---

## Task 8: `scripts/on-stop.sh` + integration test — TDD

**Files:**
- Create: `~/Desktop/codes/claude-call/tests/integration/on-stop.bats`
- Create: `~/Desktop/codes/claude-call/scripts/on-stop.sh`

`on-stop.sh` is the `Stop` hook handler. Reads JSON from stdin (Claude Code provides `session_id`, `last_assistant_message`). If a `notify-me.{sid}.json` flag exists, POSTs a `make_call` JSON-RPC request to patter-mcp. Always exits 0.

- [ ] **Step 1: Write the failing integration test**

`tests/integration/on-stop.bats`:

```bash
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
  sleep 0.3
}

teardown() {
  if [ -f "${CLAUDE_CALL_TMP}/server.pid" ]; then
    kill "$(cat "${CLAUDE_CALL_TMP}/server.pid")" 2>/dev/null || true
  fi
  rm -rf "${CLAUDE_CALL_TMP}"
}

@test "on-stop fires make_call when notify-me flag is armed" {
  export CLAUDE_SESSION_ID="sess-X"
  "${REPO_ROOT}/scripts/arm.sh" notify-me "+393331234567"

  payload='{"session_id":"sess-X","hook_event_name":"Stop","last_assistant_message":"All tests passing. Refactor complete.","stop_hook_active":true}'
  run bash -c "echo '${payload}' | ${REPO_ROOT}/scripts/on-stop.sh"
  [ "$status" -eq 0 ]

  sleep 0.2
  [ -s "${FAKE_LOG}" ]
  body="$(cat "${FAKE_LOG}")"
  echo "$body" | jq -e '.method == "tools/call"'
  echo "$body" | jq -e '.params.name == "make_call"'
  echo "$body" | jq -e '.params.arguments.to == "+393331234567"'
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
  "${REPO_ROOT}/scripts/arm.sh" notify-me "+393331234567"

  payload='{"session_id":"sess-Z","hook_event_name":"Stop","last_assistant_message":"done","stop_hook_active":true}'
  echo "${payload}" | "${REPO_ROOT}/scripts/on-stop.sh"
  [ ! -f "${CLAUDE_CALL_STATE_DIR}/notify-me.sess-Z.json" ]
}

@test "on-stop logs preflight failure and exits 0 when patter-mcp is down" {
  export CLAUDE_SESSION_ID="sess-W"
  "${REPO_ROOT}/scripts/arm.sh" notify-me "+393331234567"
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/Desktop/codes/claude-call
bats tests/integration/on-stop.bats
```

Expected: 4 failures (script doesn't exist).

- [ ] **Step 3: Write `scripts/on-stop.sh`**

```bash
#!/usr/bin/env bash
# on-stop.sh — Stop hook. If notify-me is armed, POST make_call to patter-mcp.
# Always exits 0 (never blocks Claude). Reads hook event JSON from stdin.

set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${DIR}/lib.sh"

payload="$(cat)"
sid="$(printf '%s' "$payload" | jq -r '.session_id // empty')"
last_msg="$(printf '%s' "$payload" | jq -r '.last_assistant_message // ""')"

if [ -z "$sid" ]; then
  cc_log '{"event":"on_stop_no_sid"}'
  exit 0
fi

state_dir="$(cc_state_dir)"
flag_file="${state_dir}/notify-me.${sid}.json"
[ -f "$flag_file" ] || exit 0

number="$(jq -r '.number' "$flag_file")"

if ! "${DIR}/preflight.sh" >/dev/null 2>&1; then
  cc_log "$(jq -nc --arg sid "$sid" '{event:"on_stop_skipped_preflight_failed", session_id:$sid}')"
  exit 0
fi

# Truncate summary to 500 chars to keep the system prompt tight.
summary="${last_msg:0:500}"

system_prompt="You are an AI assistant calling on behalf of Francesco. Identify yourself as such on the first turn. Francesco asked to be notified when the current task finished. Read this summary, then offer to take follow-up questions:

${summary}"

first_message="Hi Francesco, this is your AI assistant. Your task just finished — got a moment for the summary?"

req=$(jq -nc \
  --arg to "$number" \
  --arg sp "$system_prompt" \
  --arg fm "$first_message" \
  '{jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"make_call",arguments:{to:$to,systemPrompt:$sp,firstMessage:$fm}}}')

http_code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 \
  -H 'Content-Type: application/json' \
  -X POST "$PATTER_MCP_URL" \
  -d "$req" 2>/dev/null || echo "000")

cc_log "$(jq -nc \
  --arg sid "$sid" \
  --arg redacted "$(cc_redact_phone "$number")" \
  --arg code "$http_code" \
  '{event:"on_stop_fired", session_id:$sid, redacted_number:$redacted, http_code:$code}')"

rm -f "$flag_file"
exit 0
```

- [ ] **Step 4: Make it executable and run tests**

```bash
chmod +x ~/Desktop/codes/claude-call/scripts/on-stop.sh
cd ~/Desktop/codes/claude-call
bats tests/integration/on-stop.bats
```

Expected: `4 tests, 0 failures`.

- [ ] **Step 5: Commit**

```bash
cd ~/Desktop/codes/claude-call
git add scripts/on-stop.sh tests/integration/on-stop.bats
git commit -m "feat(scripts): add on-stop.sh Stop hook handler with preflight + auto-disarm"
```

---

## Task 9: `scripts/on-notification.sh` + integration test — TDD

**Files:**
- Create: `~/Desktop/codes/claude-call/tests/integration/on-notification.bats`
- Create: `~/Desktop/codes/claude-call/scripts/on-notification.sh`

`on-notification.sh` handles `Notification` hook (Claude needs input). If `dial-me-on-blocked.{sid}.json` flag is armed, fires `make_call`. Reads matcher type from `$1` (e.g. `permission_prompt`).

- [ ] **Step 1: Write the failing integration test**

`tests/integration/on-notification.bats`:

```bash
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
  sleep 0.3
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/Desktop/codes/claude-call
bats tests/integration/on-notification.bats
```

Expected: 4 failures.

- [ ] **Step 3: Write `scripts/on-notification.sh`**

```bash
#!/usr/bin/env bash
# on-notification.sh — Notification hook. If dial-me-on-blocked is armed,
# POST make_call so the user is reached on their phone.
# Does NOT auto-disarm — the user explicitly chose "ring me whenever you stall".
# Always exits 0.

set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${DIR}/lib.sh"

matcher="${1:-unknown}"
payload="$(cat)"
sid="$(printf '%s' "$payload" | jq -r '.session_id // empty')"
message="$(printf '%s' "$payload" | jq -r '.message // ""')"

if [ -z "$sid" ]; then
  cc_log '{"event":"on_notification_no_sid"}'
  exit 0
fi

state_dir="$(cc_state_dir)"
flag_file="${state_dir}/dial-me-on-blocked.${sid}.json"
[ -f "$flag_file" ] || exit 0

number="$(jq -r '.number' "$flag_file")"

if ! "${DIR}/preflight.sh" >/dev/null 2>&1; then
  cc_log "$(jq -nc --arg sid "$sid" '{event:"on_notification_skipped_preflight_failed", session_id:$sid}')"
  exit 0
fi

context="${message:0:400}"
system_prompt="You are an AI assistant calling on behalf of Francesco. Identify yourself as such on the first turn. Claude Code stalled with a ${matcher}. Tell Francesco the question/blocker and gather his answer:

${context}"

first_message="Hi Francesco, your AI assistant. Claude needs your input on something — got a sec?"

req=$(jq -nc \
  --arg to "$number" \
  --arg sp "$system_prompt" \
  --arg fm "$first_message" \
  '{jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"make_call",arguments:{to:$to,systemPrompt:$sp,firstMessage:$fm}}}')

http_code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 \
  -H 'Content-Type: application/json' \
  -X POST "$PATTER_MCP_URL" \
  -d "$req" 2>/dev/null || echo "000")

cc_log "$(jq -nc \
  --arg sid "$sid" \
  --arg matcher "$matcher" \
  --arg redacted "$(cc_redact_phone "$number")" \
  --arg code "$http_code" \
  '{event:"on_notification_fired", session_id:$sid, matcher:$matcher, redacted_number:$redacted, http_code:$code}')"
exit 0
```

- [ ] **Step 4: Make it executable and run tests**

```bash
chmod +x ~/Desktop/codes/claude-call/scripts/on-notification.sh
cd ~/Desktop/codes/claude-call
bats tests/integration/on-notification.bats
```

Expected: `4 tests, 0 failures`.

- [ ] **Step 5: Commit**

```bash
cd ~/Desktop/codes/claude-call
git add scripts/on-notification.sh tests/integration/on-notification.bats
git commit -m "feat(scripts): add on-notification.sh hook handler (no auto-disarm by design)"
```

---

## Task 10: `hooks/hooks.json`

**Files:**
- Create: `~/Desktop/codes/claude-call/hooks/hooks.json`

- [ ] **Step 1: Create the hooks directory**

```bash
mkdir -p ~/Desktop/codes/claude-call/hooks
```

- [ ] **Step 2: Write `hooks/hooks.json`**

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/scripts/on-stop.sh" }
        ]
      }
    ],
    "Notification": [
      {
        "matcher": "permission_prompt",
        "hooks": [
          { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/scripts/on-notification.sh permission_prompt" }
        ]
      },
      {
        "matcher": "idle_prompt",
        "hooks": [
          { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/scripts/on-notification.sh idle_prompt" }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/scripts/disarm.sh" }
        ]
      }
    ]
  }
}
```

- [ ] **Step 3: Validate JSON**

```bash
cd ~/Desktop/codes/claude-call
jq . hooks/hooks.json
```

Expected: pretty-printed JSON, exit 0.

- [ ] **Step 4: Commit**

```bash
cd ~/Desktop/codes/claude-call
git add hooks/hooks.json
git commit -m "feat(hooks): wire Stop / Notification / SessionEnd to handler scripts"
```

---

## Task 11: `.mcp.json` — patter-mcp registration

**Files:**
- Create: `~/Desktop/codes/claude-call/.mcp.json`

- [ ] **Step 1: Write `.mcp.json`**

```json
{
  "mcpServers": {
    "patter-mcp": {
      "type": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

Note: the URL is hard-coded to localhost:3000 (the patter-mcp default) for v0.1. Users who need a different URL can edit this file or override via `PATTER_MCP_URL` env var (used by hook scripts; the MCP client itself reads only this file).

- [ ] **Step 2: Validate JSON**

```bash
cd ~/Desktop/codes/claude-call
jq . .mcp.json
```

- [ ] **Step 3: Commit**

```bash
cd ~/Desktop/codes/claude-call
git add .mcp.json
git commit -m "feat(plugin): register patter-mcp as Streamable HTTP MCP server"
```

---

## Task 12: `commands/call.md` — `/call` slash command

**Files:**
- Create: `~/Desktop/codes/claude-call/commands/call.md`

- [ ] **Step 1: Create the commands directory**

```bash
mkdir -p ~/Desktop/codes/claude-call/commands
```

- [ ] **Step 2: Write `commands/call.md`**

```markdown
---
description: Make an outbound phone call to a number with an autonomous AI agent that pursues a goal and reports back. Usage: /call <e164-number> <objective>
---

The user has invoked /call with arguments: $ARGUMENTS

Parse the arguments. The first whitespace-separated token is the **phone number** (must be E.164, starting with `+`). The rest of the line is the **objective** (the goal of the call).

Then:

1. **Validate the phone number.** It must match `^\+[1-9][0-9]{6,14}$`. If not, ask the user to clarify before calling. Do not attempt to "fix" obviously malformed numbers.
2. **Preflight patter-mcp.** Run the bash command `${CLAUDE_PLUGIN_ROOT}/scripts/preflight.sh`. If it exits non-zero, tell the user patter-mcp is not running and stop.
3. **Delegate to the phone-agent subagent** with the objective. Tell phone-agent: "Call $NUMBER and accomplish: $OBJECTIVE. Use the `call_third_party` MCP tool. Report back with outcome, key facts, and any follow-ups."
4. **Wait for the subagent's report.** It returns a 2-3 sentence summary plus a structured outcome.
5. **Relay** that summary to the user verbatim. Do not paraphrase or expand.

Hard rules:
- NEVER place the call yourself directly via `mcp__patter-mcp__make_call`. Always go through phone-agent so transcripts are parsed consistently.
- NEVER call a number that wasn't supplied by the user in this command's arguments.
- If the objective implies sensitive actions (financial transactions, legal commitments above €100, anything irreversible), ASK the user to confirm before calling.
```

- [ ] **Step 3: Commit**

```bash
cd ~/Desktop/codes/claude-call
git add commands/call.md
git commit -m "feat(commands): add /call slash command (outbound third-party calls)"
```

---

## Task 13: `commands/notify-me.md` + `commands/notify-me-cancel.md`

**Files:**
- Create: `~/Desktop/codes/claude-call/commands/notify-me.md`
- Create: `~/Desktop/codes/claude-call/commands/notify-me-cancel.md`

- [ ] **Step 1: Write `commands/notify-me.md`**

```markdown
---
description: Arm a one-shot Stop hook so Claude calls you when the current task finishes. Usage: /notify-me <e164-number>
---

The user has invoked /notify-me with arguments: $ARGUMENTS

Parse the single argument as a phone number. Validate it is E.164 (`^\+[1-9][0-9]{6,14}$`). If invalid, ask for clarification and stop.

Then run this bash command:

```bash
CLAUDE_SESSION_ID="$CLAUDE_SESSION_ID" ${CLAUDE_PLUGIN_ROOT}/scripts/arm.sh notify-me "$NUMBER"
```

(Substitute `$NUMBER` with the validated number.)

If the script exits 0, reply to the user exactly:

> Armed. I'll call you at the number you provided when this task completes. Use `/notify-me-cancel` to disarm.

If the script exits non-zero, surface its stderr to the user.

Do NOT place a call now. The hook handles dialing on Stop.
```

- [ ] **Step 2: Write `commands/notify-me-cancel.md`**

```markdown
---
description: Disarm the /notify-me Stop hook for this session.
---

Run this bash command:

```bash
CLAUDE_SESSION_ID="$CLAUDE_SESSION_ID" ${CLAUDE_PLUGIN_ROOT}/scripts/disarm.sh notify-me
```

If exit 0, reply: "Disarmed. I will not call you when this task completes."
If exit non-zero, surface stderr.
```

- [ ] **Step 3: Commit**

```bash
cd ~/Desktop/codes/claude-call
git add commands/notify-me.md commands/notify-me-cancel.md
git commit -m "feat(commands): add /notify-me and /notify-me-cancel"
```

---

## Task 14: `commands/dial-me-on-blocked.md` + cancel

**Files:**
- Create: `~/Desktop/codes/claude-call/commands/dial-me-on-blocked.md`
- Create: `~/Desktop/codes/claude-call/commands/dial-me-on-blocked-cancel.md`

- [ ] **Step 1: Write `commands/dial-me-on-blocked.md`**

```markdown
---
description: Arm a Notification hook so Claude calls you whenever it stalls waiting for permission or input. Usage: /dial-me-on-blocked <e164-number>
---

The user has invoked /dial-me-on-blocked with arguments: $ARGUMENTS

Parse the single argument as a phone number. Validate E.164. If invalid, ask for clarification and stop.

Run:

```bash
CLAUDE_SESSION_ID="$CLAUDE_SESSION_ID" ${CLAUDE_PLUGIN_ROOT}/scripts/arm.sh dial-me-on-blocked "$NUMBER"
```

If exit 0, reply:

> Armed. Whenever I stall waiting for permission or input during this session, I'll call the number you provided. Use `/dial-me-on-blocked-cancel` to disarm.

Note: this flag does NOT auto-disarm after firing. It stays armed for the entire session until the user runs the cancel command or the session ends.

Do NOT place a call now.
```

- [ ] **Step 2: Write `commands/dial-me-on-blocked-cancel.md`**

```markdown
---
description: Disarm the /dial-me-on-blocked Notification hook for this session.
---

Run:

```bash
CLAUDE_SESSION_ID="$CLAUDE_SESSION_ID" ${CLAUDE_PLUGIN_ROOT}/scripts/disarm.sh dial-me-on-blocked
```

If exit 0, reply: "Disarmed. I will not call you on permission/idle prompts."
If exit non-zero, surface stderr.
```

- [ ] **Step 3: Commit**

```bash
cd ~/Desktop/codes/claude-call
git add commands/dial-me-on-blocked.md commands/dial-me-on-blocked-cancel.md
git commit -m "feat(commands): add /dial-me-on-blocked and cancel"
```

---

## Task 15: `commands/calls.md` — `/calls`

**Files:**
- Create: `~/Desktop/codes/claude-call/commands/calls.md`

- [ ] **Step 1: Write `commands/calls.md`**

```markdown
---
description: List recent calls (status, duration, cost) by querying patter-mcp.
---

Run the bash command `${CLAUDE_PLUGIN_ROOT}/scripts/preflight.sh`. If it exits non-zero, tell the user patter-mcp is not running and stop.

Then call the `mcp__patter-mcp__get_calls` MCP tool with no arguments.

Format the response as a markdown table with columns: `Call ID | To | Status | Duration | Cost | Started`.

If the response is empty, reply: "No recent calls."
```

- [ ] **Step 2: Commit**

```bash
cd ~/Desktop/codes/claude-call
git add commands/calls.md
git commit -m "feat(commands): add /calls (list recent calls via patter-mcp)"
```

---

## Task 16: `agents/phone-agent.md` — subagent

**Files:**
- Create: `~/Desktop/codes/claude-call/agents/phone-agent.md`

- [ ] **Step 1: Create the agents directory**

```bash
mkdir -p ~/Desktop/codes/claude-call/agents
```

- [ ] **Step 2: Write `agents/phone-agent.md`**

```markdown
---
name: phone-agent
description: Specialized subagent for phone-call orchestration via patter-mcp. Use when the user asks you to call someone, when a phone call's transcript needs parsing, or when a call objective needs to be tightened before dialing.
tools: Bash, mcp__patter-mcp__call_third_party, mcp__patter-mcp__make_call, mcp__patter-mcp__get_calls, mcp__patter-mcp__get_transcript
---

You are phone-agent. You orchestrate phone calls placed through patter-mcp.

## Your job

1. **Validate phone numbers.** Must be E.164 (`^\+[1-9][0-9]{6,14}$`). If a number isn't, fix it (add `+`, country code) only when the correction is unambiguous; otherwise ask the user.
2. **Compose the call objective.** A good objective is:
   - Single-purpose. One question or one task. Multi-step calls fail.
   - Concrete. "Book a table for 2 at 8pm Saturday under name Rosciano" — not "ask about availability".
   - Bounded. Include fallbacks: "If 8pm is unavailable, ask for the next available time within 2 hours".
   - Polite. Open with "Buongiorno" / "Hello" depending on the country code.
   ≤ 200 chars total.
3. **Pick the right tool**:
   - `call_third_party` — synchronous; blocks until the call completes; ideal for booking, asking a question, leaving a message. Returns transcript.
   - `make_call` — when the callee is the user (Francesco) and you need a custom system prompt giving the in-call agent more context.
4. **Parse the returned transcript.** Extract:
   - **Outcome**: `success` / `failure` / `unclear`
   - **Key facts**: confirmation numbers, times, names, costs, callback windows
   - **Follow-ups**: anything that needs another call or action
5. **Report concisely.** 2-3 sentence summary + a structured JSON block:
   ```json
   {"outcome": "success", "facts": {"time": "20:00 Sat", "name": "Rosciano"}, "followups": []}
   ```

## Hard rules

- NEVER reveal the user's phone number, API keys, or session IDs in spoken output during the call. The system prompt you compose for the call agent should never include them either.
- ALWAYS include in the system prompt: "Identify yourself on the first turn as 'an AI assistant calling on behalf of Francesco'. If asked whether you are human, answer truthfully."
- If the receiving party gets confused or hostile, the call agent should politely end the call and report the situation. Do not push through.
- For time-sensitive bookings, include the user's local timezone explicitly in the objective.
- If the objective implies a financial commitment > €100 or anything legally binding, refuse — return to the parent and tell the user this needs human handling.
```

- [ ] **Step 3: Commit**

```bash
cd ~/Desktop/codes/claude-call
git add agents/phone-agent.md
git commit -m "feat(agents): add phone-agent subagent for call orchestration"
```

---

## Task 17: `.claude-plugin/plugin.json` — manifest

**Files:**
- Create: `~/Desktop/codes/claude-call/.claude-plugin/plugin.json`

- [ ] **Step 1: Create the manifest directory**

```bash
mkdir -p ~/Desktop/codes/claude-call/.claude-plugin
```

- [ ] **Step 2: Write `.claude-plugin/plugin.json`**

```json
{
  "name": "claude-call",
  "version": "0.1.0",
  "description": "Two-way voice bridge for Claude Code via Patter — make outbound calls, get called when work is done.",
  "author": {
    "name": "Francesco Rosciano",
    "url": "https://github.com/FrancescoRosciano"
  },
  "repository": "https://github.com/FrancescoRosciano/claude-call",
  "license": "MIT",
  "keywords": ["voice", "phone", "patter", "mcp", "telephony"],
  "commands": "./commands/",
  "agents": "./agents/",
  "hooks": "./hooks/hooks.json",
  "mcpServers": "./.mcp.json"
}
```

- [ ] **Step 3: Validate JSON**

```bash
cd ~/Desktop/codes/claude-call
jq . .claude-plugin/plugin.json
```

- [ ] **Step 4: Commit**

```bash
cd ~/Desktop/codes/claude-call
git add .claude-plugin/plugin.json
git commit -m "feat(plugin): add plugin.json manifest for claude-call v0.1"
```

---

## Task 18: Run the full local test suite

This is a checkpoint — no new files. Verify all bats tests pass together.

- [ ] **Step 1: Run the full suite via Makefile**

```bash
cd ~/Desktop/codes/claude-call
make test
```

Expected output:
- `tests/unit/lib.bats` — 4 passing
- `tests/unit/arm.bats` — 6 passing
- `tests/unit/disarm.bats` — 5 passing
- `tests/unit/preflight.bats` — 3 passing
- `tests/integration/on-stop.bats` — 4 passing
- `tests/integration/on-notification.bats` — 4 passing
- **Total: 26 passing, 0 failing**

- [ ] **Step 2: If any test fails, fix the underlying script (not the test)**

Re-run `make test` until clean.

- [ ] **Step 3: Confirm no uncommitted changes**

```bash
cd ~/Desktop/codes/claude-call
git status
```

Expected: `nothing to commit, working tree clean`.

- [ ] **Step 4: No commit needed (no file changes); proceed to Task 19**

---

## Task 19: GitHub Actions CI

**Files:**
- Create: `~/Desktop/codes/claude-call/.github/workflows/ci.yml`

- [ ] **Step 1: Create the workflows directory**

```bash
mkdir -p ~/Desktop/codes/claude-call/.github/workflows
```

- [ ] **Step 2: Write `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main, "feat/**"]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install bats-core and jq
        run: |
          sudo apt-get update
          sudo apt-get install -y bats jq

      - name: Set up Python (for fake patter-mcp fixture)
        uses: actions/setup-python@v5
        with:
          python-version: "3.11"

      - name: Run unit tests
        run: bats tests/unit

      - name: Run integration tests
        run: bats tests/integration

      - name: Verify plugin.json is valid
        run: jq . .claude-plugin/plugin.json

      - name: Verify .mcp.json is valid
        run: jq . .mcp.json

      - name: Verify hooks.json is valid
        run: jq . hooks/hooks.json
```

- [ ] **Step 3: Commit**

```bash
cd ~/Desktop/codes/claude-call
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions workflow (bats + JSON validation)"
```

- [ ] **Step 4: Push the branch and verify CI runs**

```bash
cd ~/Desktop/codes/claude-call
git push -u origin feat/v0.1
```

Open https://github.com/FrancescoRosciano/claude-call/actions and confirm the CI run starts. Wait for it to complete. Expected: green check, all 26 bats tests pass, all 3 JSON validations pass.

If CI fails, debug locally and push fixes until green.

---

## Task 20: Full README

**Files:**
- Modify: `~/Desktop/codes/claude-call/README.md` (rewrite stub from Task 1)

- [ ] **Step 1: Replace `README.md` content**

```markdown
# claude-call

> Two-way voice bridge for Claude Code via [Patter](https://github.com/PatterAI/Patter) — make outbound calls, get called when work is done.

`claude-call` is a Claude Code plugin that gives Claude a phone. Three flows:

1. **Claude → third party.** `/call +390212345678 ask if there's a table for 2 at 8pm tonight` — Claude dials, talks to the restaurant, reports back with a transcript and structured outcome.
2. **Claude → you.** `/notify-me +393331234567` arms a Stop hook; when the current task finishes, Claude rings your phone with a summary you can talk back to.
3. **You → Claude.** Your patter-mcp Twilio number, when dialed, drops you into a voice conversation with the active Claude Code session (delegated to patter-mcp's existing inbound handler).

The plugin contains no voice code. It composes [`patter-mcp`](https://github.com/PatterAI/patter-mcp), which owns telephony and AI voice plumbing.

## Prerequisites

- macOS or Linux
- [Claude Code](https://claude.com/claude-code) ≥ 2.0 with plugin support
- Node 22+ (for patter-mcp)
- Python 3.11+ (only for running tests; not needed at runtime)
- A running [`patter-mcp`](https://github.com/PatterAI/patter-mcp) instance with valid Twilio + OpenAI + Deepgram + ElevenLabs keys
- `bats` and `jq` for development: `brew install bats-core jq`

## Install

```bash
# 1. Run patter-mcp (one-time setup)
git clone https://github.com/PatterAI/patter-mcp ~/dev/patter-mcp
cd ~/dev/patter-mcp
cp .env.example .env && $EDITOR .env       # fill in API keys
npm install && npm run dev                  # leave running, or use launchd

# Verify it's up:
curl http://localhost:3000/health

# 2. Install the plugin
claude plugin install https://github.com/FrancescoRosciano/claude-call
```

## Slash commands

| Command | What it does |
|---|---|
| `/call <e164-number> <objective>` | Outbound call to a third party. Returns transcript + structured outcome. |
| `/notify-me <e164-number>` | Arms a one-shot Stop hook: when the current task finishes, Claude calls you. |
| `/notify-me-cancel` | Disarms `/notify-me`. |
| `/dial-me-on-blocked <e164-number>` | Arms a Notification hook: whenever Claude stalls waiting for permission or input, it calls you. Persists for the whole session. |
| `/dial-me-on-blocked-cancel` | Disarms `/dial-me-on-blocked`. |
| `/calls` | Lists recent calls (status, duration, cost). |

## Subagent

The plugin ships a `phone-agent` subagent specialized for call orchestration. It validates numbers, composes tight call objectives, parses transcripts, and emits structured outcomes. Invoked automatically by `/call` and available for explicit dispatch.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `PATTER_MCP_URL` | `http://localhost:3000/mcp` | MCP server endpoint |
| `CLAUDE_CALL_STATE_DIR` | `~/.claude-call/state` | Flag files for armed hooks |
| `CLAUDE_CALL_LOG` | `~/.claude-call/log.ndjson` | Append-only log (with redacted phone numbers) |

All telephony / provider credentials (Twilio, OpenAI, Deepgram, ElevenLabs) live in **patter-mcp's** `.env`. The plugin never touches them.

## Privacy & disclosure

- Outbound calls always identify as "an AI assistant calling on behalf of Francesco" on the first turn (non-overridable in v0.1).
- Phone numbers in logs are redacted to last-4 digits.
- State directory is created with mode `0700`.
- The plugin makes no outbound HTTP calls except to your local patter-mcp.

## Development

```bash
make install-dev       # check that bats + jq are installed
make test              # run all bats tests
make lint              # run shellcheck (best-effort)
```

CI runs on every push and PR via GitHub Actions.

## Architecture

See [`docs/superpowers/specs/2026-04-27-claude-call-design.md`](docs/superpowers/specs/2026-04-27-claude-call-design.md).

## License

MIT
```

- [ ] **Step 2: Commit**

```bash
cd ~/Desktop/codes/claude-call
git add README.md
git commit -m "docs: full README with install, commands, configuration, privacy notes"
```

---

## Task 21: `CHANGELOG.md`

**Files:**
- Create: `~/Desktop/codes/claude-call/CHANGELOG.md`

- [ ] **Step 1: Write `CHANGELOG.md`**

```markdown
# Changelog

All notable changes to claude-call are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/).

## [Unreleased]

## [0.1.0] — 2026-04-27

### Added
- `/call <number> <objective>` — outbound third-party calls via patter-mcp's `call_third_party`.
- `/notify-me <number>` and `/notify-me-cancel` — one-shot Stop hook that calls the user when the current task completes.
- `/dial-me-on-blocked <number>` and `/dial-me-on-blocked-cancel` — Notification hook that calls the user on `permission_prompt` and `idle_prompt`.
- `/calls` — list recent calls.
- `phone-agent` subagent for call orchestration: number validation, objective composition, transcript parsing, structured outcome emission.
- Hook scripts: `arm.sh`, `disarm.sh`, `preflight.sh`, `on-stop.sh`, `on-notification.sh`, with bats unit + integration tests against a fake patter-mcp.
- GitHub Actions CI running 26 bats tests + JSON validation on Ubuntu.

### Security
- AI-disclosure phrase ("an AI assistant calling on behalf of Francesco") is hard-coded into outbound system prompts; non-overridable in v0.1.
- Phone numbers in logs redacted to last-4 digits.
- State directory created with mode `0700`.
```

- [ ] **Step 2: Commit**

```bash
cd ~/Desktop/codes/claude-call
git add CHANGELOG.md
git commit -m "docs: add CHANGELOG for v0.1.0"
```

---

## Task 22: Manual end-to-end smoke test (single real call)

**Files:**
- Create: `~/Desktop/codes/claude-call/tests/e2e.md`

This is a manual checklist — not run in CI because it places a real Twilio call. Run it once before merging to `main`.

- [ ] **Step 1: Write `tests/e2e.md`**

```markdown
# E2E manual smoke test (v0.1)

Run before each release. Costs ~$0.05 per test call.

## Setup

1. Start patter-mcp with real keys:
   ```bash
   cd ~/dev/patter-mcp && npm run dev
   ```
2. Install the plugin into Claude Code (or symlink the repo into `~/.claude/plugins/claude-call`).
3. Restart Claude Code.

## Smoke test 1: `/call` to a real number you own

1. In a new session: `/call <your-own-number> ask whether I can hear you and then say goodbye`
2. Expected: Claude dispatches phone-agent. Phone-agent calls `mcp__patter-mcp__call_third_party`. Your phone rings within ~5s.
3. Pick up. Verify the agent:
   - Identifies as "an AI assistant calling on behalf of Francesco"
   - Asks "can you hear me?"
   - Says goodbye when you confirm
4. Hang up. Within 1-2s the parent Claude session reports the outcome with a transcript snippet.
5. **Pass criteria**: outcome is "success", transcript contains both turns, no API keys leaked in any logs.

## Smoke test 2: `/notify-me` triggers on Stop

1. In a new session: `/notify-me <your-own-number>`
2. Verify reply: "Armed. I'll call you at the number you provided when this task completes."
3. Run a small task: "list the files in the current directory and tell me how many there are."
4. After Claude responds and the turn ends, the Stop hook fires. Phone rings.
5. Pick up. The agent reads the summary and offers follow-ups.
6. **Pass criteria**: phone rings within ~5s of Stop, summary matches the actual last assistant message.

## Smoke test 3: `/dial-me-on-blocked` triggers on permission prompt

1. In a new session: `/dial-me-on-blocked <your-own-number>`
2. Try to make Claude do something requiring confirmation (e.g., `Bash(rm -rf /tmp/cc-test)` outside the allowlist).
3. When the permission prompt appears, the Notification hook should fire and your phone should ring.
4. **Pass criteria**: phone rings within ~5s of the permission prompt.

## Cleanup

- `/notify-me-cancel` and `/dial-me-on-blocked-cancel` to disarm.
- Stop patter-mcp.
```

- [ ] **Step 2: Run the three smoke tests against your own number**

(Document outcomes in `tests/e2e.md` if anything fails — they should pass on a clean install.)

- [ ] **Step 3: Commit**

```bash
cd ~/Desktop/codes/claude-call
git add tests/e2e.md
git commit -m "test: add manual e2e smoke-test checklist for v0.1"
```

---

## Task 23: Open the PR

- [ ] **Step 1: Push the branch (if not already pushed in Task 19)**

```bash
cd ~/Desktop/codes/claude-call
git push
```

- [ ] **Step 2: Open the PR**

```bash
cd ~/Desktop/codes/claude-call
gh pr create --title "claude-call v0.1: outbound + inbound voice via patter-mcp" --body "$(cat <<'EOF'
## Summary
- Implements claude-call v0.1 per spec `docs/superpowers/specs/2026-04-27-claude-call-design.md`
- Plugin layer over `patter-mcp`: hooks + slash commands + `phone-agent` subagent
- 26 bats tests (unit + integration), GitHub Actions CI

## Flows shipped
- `/call <number> <objective>` — outbound third-party calls
- `/notify-me` and `/dial-me-on-blocked` — autonomous Claude → user calls via Stop and Notification hooks
- Inbound (you → Claude) delegated to `patter-mcp`'s existing handler — no new code, documented in README

## Test plan
- [x] All bats unit tests pass locally and in CI
- [x] All bats integration tests pass against fake patter-mcp fixture
- [x] All JSON manifests validate
- [ ] Manual E2E smoke tests (see tests/e2e.md) executed on a real Twilio number
- [ ] Plugin installs cleanly via `claude plugin install <git-url>`

## Spec coverage
All v0.1 goals from the design spec are implemented. Non-goals (multi-tenant, public marketplace, SMS fallback) deferred to later versions per the spec.
EOF
)"
```

Expected: PR URL printed.

- [ ] **Step 3: Verify CI is green on the PR**

Open the PR URL. Wait for CI checks. If anything fails, fix and push.

- [ ] **Step 4: Merge to main**

```bash
gh pr merge --squash --delete-branch
```

- [ ] **Step 5: Tag v0.1.0**

```bash
cd ~/Desktop/codes/claude-call
git checkout main && git pull
git tag -a v0.1.0 -m "claude-call v0.1.0"
git push origin v0.1.0
```

---

## Done — v0.1 shipped

At this point:
- Repo has 26 passing bats tests + GitHub Actions CI
- Plugin manifest, hooks, commands, subagent are all in place
- CHANGELOG documents v0.1.0
- Manual e2e smoke checklist is in `tests/e2e.md`
- v0.1.0 tag is pushed

Next: install the plugin into your Claude Code config and try `/call`, `/notify-me`, and `/dial-me-on-blocked` against your own number.
