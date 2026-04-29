# claude-call v0.2.0 — Smooth Setup Design

**Status:** Draft
**Author:** Francesco Rosciano
**Date:** 2026-04-28
**Supersedes (in part):** [`2026-04-27-claude-call-design.md`](./2026-04-27-claude-call-design.md)

---

## 1. Goal

Reduce the install ritual from "clone two repos, edit `.env`, run `npm run dev` in a second terminal" to **three commands inside Claude Code**:

```
/plugin marketplace add https://github.com/FrancescoRosciano/claude-call
/plugin install claude-call@claude-call
/claude-call:setup
```

After step 3, the user can immediately run `/call +39...` and have a working phone agent.

## 2. Non-Goals

The following are explicitly out of scope for v0.2.0:

- GUI for setup. Terminal prompts only.
- Automatic credential rotation or refresh.
- Multi-user or shared installs across machines.
- Telnyx carrier (`getpatter` supports it, but we ship Twilio-only in v0.2).
- Routing an inbound call to a *specific* Claude Code session. v0.2 hosts one global voice agent per machine. Multi-session inbound routing is deferred to v0.3+.

## 3. Architecture

The plugin becomes self-contained — no external `patter-mcp` repo. It bundles its own MCP server which imports `getpatter` (the SDK published on npm as `getpatter@0.5.4` or later) and exposes the four MCP tools that v0.1 expected from `patter-mcp`.

### 3.1 Repo layout

```
claude-call/
├── .claude-plugin/
│   ├── marketplace.json        ← NEW: makes the repo a marketplace
│   └── plugin.json             ← unchanged
├── server/                     ← NEW: bundled MCP + voice server
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts            (MCP stdio entrypoint)
│   │   ├── credentials.ts      (read ~/.claude-call/credentials)
│   │   ├── patter.ts           (Patter instance + tunnel lifecycle)
│   │   ├── store.ts            (CallRecord persistence to ~/.claude-call/calls.ndjson)
│   │   ├── doctor.ts           (--doctor mode for setup validation)
│   │   └── tools/
│   │       ├── make_call.ts
│   │       ├── call_third_party.ts
│   │       ├── get_calls.ts
│   │       └── get_transcript.ts
│   ├── tests/                  (vitest unit + integration)
│   └── dist/                   (compiled JS, committed)
├── commands/
│   ├── setup.md                ← NEW: /claude-call:setup wizard
│   ├── serve-me.md             ← NEW: /serve-me — arm inbound voice agent
│   ├── serve-me-cancel.md      ← NEW: /serve-me-cancel — disarm it
│   └── ... (existing call.md, notify-me.md, etc. — unchanged surface)
├── scripts/
│   ├── on-session-start.sh     ← NEW: first-run reminder
│   └── ... (existing arm.sh, on-stop.sh, etc. — unchanged)
├── .mcp.json                   ← CHANGED: stdio command instead of HTTP URL
├── hooks/hooks.json            ← CHANGED: adds SessionStart entry
├── README.md                   ← updated install + quickstart
├── CHANGELOG.md                ← documents breaking change
└── ... (Makefile, LICENSE, .github/, tests/, agents/ — unchanged)
```

### 3.2 Why bundle the server inside the plugin

Three reasons:

1. **Single install path.** Users only run `/plugin install`. No second clone, no `.env` editing in another directory.
2. **Owned dependency surface.** v0.1 depended on `patter-mcp` repo state we don't control. Bundling the SDK directly means we can pin `getpatter` versions and ship reproducible behavior.
3. **Plugin isolation.** Claude Code copies the plugin into `~/.claude/plugins/cache/...` on install. Committing built `dist/` artefacts means the install doesn't need to run `npm install`.

### 3.3 Why a separate `server/` package

The plugin metadata (commands, hooks, agents) is shell + markdown. The MCP server is TypeScript with native dependencies (`onnxruntime-node` via `getpatter`'s optional deps, `cloudflared` binary). Keeping these in a sub-package with its own `package.json` and `node_modules` lets the plugin layer stay light and testable in isolation.

## 4. Components

### 4.1 Marketplace manifest

`.claude-plugin/marketplace.json`:

```json
{
  "$schema": "https://code.claude.com/schemas/marketplace.json",
  "name": "claude-call",
  "owner": {
    "name": "Francesco Rosciano",
    "email": "francesco.rosciano@me.com"
  },
  "description": "Two-way voice bridge for Claude Code — make outbound calls, get rung when work is done.",
  "plugins": [
    {
      "name": "claude-call",
      "source": "./",
      "description": "Two-way voice bridge for Claude Code via Patter",
      "version": "0.2.0",
      "category": "communication",
      "tags": ["voice", "phone", "telephony", "patter"]
    }
  ]
}
```

The marketplace name and the plugin name are both `claude-call`. After install, users address the plugin as `claude-call@claude-call` (`<plugin>@<marketplace>`).

### 4.2 Bundled MCP server

**Tech stack:** Node 20+, TypeScript, ESM, `tsup` for builds, `vitest` for tests, `@modelcontextprotocol/sdk` for MCP, `getpatter` for telephony.

**Lifecycle:**

1. Claude Code spawns `node ${CLAUDE_PLUGIN_ROOT}/server/dist/index.js` over stdio when the plugin loads.
2. `index.ts` reads `~/.claude-call/credentials`. If missing, the server starts in **degraded mode**: MCP tools register but every invocation returns `{ error: "credentials_missing", action: "Run /claude-call:setup" }`. The server does NOT exit — Claude Code would then mark the MCP server as failed and require restart after setup.
3. If credentials present, instantiate `Patter` with the configured carrier + engine.
4. On first tool invocation that requires it, lazily start a CloudflareTunnel (so server startup stays fast).
5. Subscribe to `Patter`'s `MetricsStore` events (`call_initiated`, `call_start`, `call_end`) and append each to `~/.claude-call/calls.ndjson`.

**MCP tools (preserve v0.1 contract):**

| Tool | Input | Output |
|---|---|---|
| `make_call` | `{ to: string, system_prompt: string, first_message?: string, recording?: boolean }` | `{ call_id, status, duration_seconds, cost_usd, transcript: Turn[] }` |
| `call_third_party` | `{ to: string, objective: string, max_turns?: number }` | `{ call_id, outcome: "success"\|"failure"\|"unclear", summary, transcript, structured_outcome?: object }` |
| `get_calls` | `{ limit?: number, since?: ISO8601 }` | `{ calls: CallRecord[] }` |
| `get_transcript` | `{ call_id: string }` | `{ call_id, turns: Turn[], duration_seconds }` |

`call_third_party` wraps `make_call` with a goal-pursuit system prompt template that instructs the agent to end the call by silently emitting (via a tool call, not a spoken line) a single JSON object with shape `{ "outcome": "success"|"failure"|"unclear", "summary": string, "structured": object }`. The MCP server registers a one-shot `report_outcome` tool with the agent for this purpose. If the call ends without a `report_outcome` invocation, the server returns `{ outcome: "unclear", summary: "Call ended without structured outcome", structured: null }` and includes the full transcript so the caller can reason about what happened.

### 4.3 Updated `.mcp.json`

```json
{
  "mcpServers": {
    "claude-call": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/server/dist/index.js"],
      "cwd": "${CLAUDE_PLUGIN_ROOT}/server"
    }
  }
}
```

No `env` block. Credentials are loaded by the server itself from `~/.claude-call/credentials`. Rationale: keeps secrets out of Claude Code's process env (visible to all MCP servers and hooks) and out of `.mcp.json` (which lives in the plugin cache directory).

The MCP server name changes from `patter-mcp` (v0.1) to `claude-call` (v0.2). This means MCP tool identifiers in the phone-agent subagent change from `mcp__patter-mcp__*` to `mcp__claude-call__*`. Documented in CHANGELOG as a breaking change.

### 4.4 Setup wizard (`/claude-call:setup`)

`commands/setup.md` instructs Claude Code to walk the user through configuration. It is implemented as an agent-driven flow rather than a fixed script, because Claude Code slash commands are markdown prompts, not interactive REPLs.

The command body instructs Claude to:

1. Check whether `~/.claude-call/credentials` exists. If yes, ask whether to overwrite or quit.
2. Prompt sequentially using `AskUserQuestion`-style dialogs:
   - Twilio Account SID (validate `^AC[0-9a-f]{32}$`)
   - Twilio Auth Token (validate non-empty, opaque)
   - Twilio Phone Number (validate E.164 `^\+[1-9]\d{1,14}$`)
   - Voice engine: choice of `openai_realtime` (default), `elevenlabs_convai`, or `pipeline`
   - Engine-specific keys (OpenAI key, or ElevenLabs key + agent ID, or Deepgram + ElevenLabs for pipeline)
3. Write the credentials file using the format below.
4. Run `node ${CLAUDE_PLUGIN_ROOT}/server/dist/index.js --doctor` to validate keys against Twilio and the chosen engine. Print PASS/FAIL per check.
5. Print next steps and a sample command.

**Credentials file format** (`~/.claude-call/credentials`, mode 0600):

```sh
# claude-call credentials — managed by /claude-call:setup
# Do not commit this file. Re-run /claude-call:setup to update.
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+1...
VOICE_ENGINE=openai_realtime
OPENAI_API_KEY=sk-...
# Optional, only if VOICE_ENGINE=elevenlabs_convai or pipeline:
# ELEVENLABS_API_KEY=...
# ELEVENLABS_AGENT_ID=agent_...
# DEEPGRAM_API_KEY=...
```

Parsed in `server/src/credentials.ts` with strict KEY=VALUE handling (no shell expansion, no quoting tricks). Only the keys listed above are recognized; unknown keys are ignored with a warning.

### 4.5 First-run hook (`SessionStart`)

`scripts/on-session-start.sh` is registered under the `SessionStart` event. It always exits 0. Its only job:

```sh
if [ ! -s "${HOME}/.claude-call/credentials" ]; then
  echo "claude-call: not yet configured. Run /claude-call:setup to enable phone calls."
fi
```

This makes the first-run experience self-explanatory without crashing or blocking the session.

### 4.6 Doctor mode

`server/dist/index.js --doctor` runs a non-interactive validation and exits with status 0/1:

- Loads credentials.
- Calls Twilio's `/Accounts/{SID}.json` endpoint with the auth token. PASS if 200, FAIL with detail otherwise.
- For `openai_realtime`: pings `api.openai.com/v1/realtime/sessions` (or models endpoint as a proxy) with the OpenAI key.
- For `elevenlabs_convai`: pings `api.elevenlabs.io/v1/user`.
- For `pipeline`: pings Deepgram + ElevenLabs.
- Prints a short report:
  ```
  claude-call doctor
  ✓ Twilio auth (account: AC***1234)
  ✓ Twilio phone number reachable
  ✓ OpenAI Realtime API reachable
  All checks passed.
  ```

## 5. Data Flows

### 5.1 Outbound call: `/call +39... book a table`

```
User → /call slash command
        │
        ▼
phone-agent subagent
  validates input, builds objective
        │
        ▼
mcp__claude-call__call_third_party({ to, objective })
        │
        ▼ stdio
server/dist/index.js
  ├─ ensure tunnel up (lazy)
  ├─ build AgentOptions(systemPrompt: "Pursue this objective: …")
  ├─ patter.call({ to, agent })   ──► Twilio dial
  │                                   ├─ media stream to local server via tunnel
  │                                   └─ OpenAI Realtime drives conversation
  ├─ on call_end: parse transcript, extract OUTCOME line
  ├─ append CallRecord to ~/.claude-call/calls.ndjson
  └─ return { call_id, outcome, summary, transcript }
        │
        ▼
phone-agent reports to user
```

### 5.2 Inbound call: user dials Twilio number

Inbound is **opt-in** via `/serve-me`:

```
User → /serve-me
        │
        ▼
write ~/.claude-call/inbound-armed
        │
        ▼
server polls flag (1 Hz) → starts Patter.serve()
        │
        ▼
Twilio webhook configured to point at tunnel URL
```

When armed, `Patter.serve()` runs continuously while the plugin is loaded. Inbound calls reach a generic OpenAI Realtime agent with system prompt: *"You are Claude Code's voice channel for Francesco. Take messages and answer general questions. You cannot execute Claude Code commands."* Messages are appended to `~/.claude-call/messages.ndjson`.

`/serve-me-cancel` removes the flag; the server stops `Patter.serve()` on next poll.

**Known limitation:** The inbound agent does not have access to the Claude Code session state. It can answer general questions and take messages, but it cannot execute slash commands or steer the active session. Multi-session inbound routing is v0.3+ work.

### 5.3 Setup flow

```
User → /claude-call:setup
        │
        ▼
Claude Code agent
  ├─ check existing credentials
  ├─ prompt: Twilio SID
  ├─ prompt: Twilio Auth Token
  ├─ prompt: Twilio Phone Number
  ├─ prompt: Voice engine choice
  ├─ prompt: engine-specific keys
  ├─ write ~/.claude-call/credentials (mode 0600)
  └─ exec: node server/dist/index.js --doctor
        │
        ▼
print results, exit
```

## 6. Error Handling

| Failure mode | Surface | Server behavior |
|---|---|---|
| Credentials file missing | MCP tool returns `{ error: "credentials_missing", action: "Run /claude-call:setup" }` | Server stays up, ready for setup completion. SessionStart hook prints reminder. |
| Credentials malformed | Server logs to `~/.claude-call/log.ndjson`, returns `{ error: "credentials_invalid", details }` | Server stays up. |
| Twilio auth failure | Tool returns `{ error: "twilio_auth_failed", details }` (verbatim from `getpatter`'s `AuthenticationError`) | Server stays up. |
| Tunnel start failure | Tool returns `{ error: "tunnel_failed", details }` | Server stays up. Subsequent calls re-attempt tunnel. |
| Call rejected (busy/no-answer) | Tool returns normally with `{ status: "no-answer" \| "busy" \| "failed" }` | Recorded to calls store. |
| `getpatter` SDK throws | Wrap in try/catch in tool layer, return `{ error: "internal", details }`. Log full stack to `log.ndjson`. | Server stays up. |
| Doctor mode failure | Exit code 1, structured stderr report. Setup wizard catches and presents to user. | N/A |

All errors logged to `~/.claude-call/log.ndjson` with phone numbers redacted via `cc_redact_phone` (preserves v0.1 behavior). Each log line is a single JSON object with `ts`, `event`, and arbitrary fields.

## 7. Security

Inherits and tightens v0.1's posture:

- Credentials live at `~/.claude-call/credentials` with mode 0600 (owner read/write only). Setup wizard enforces permissions on write; server refuses to start if file is world-readable.
- State directory `~/.claude-call/` created with mode 0700.
- Phone numbers redacted in `log.ndjson` to last-4 digits.
- AI disclosure on every outbound call. The system prompt template mandates first-turn identification: *"This is an AI assistant calling on behalf of Francesco."* Non-overridable in v0.2 (same as v0.1).
- No outbound HTTP from the server except to Twilio, OpenAI / ElevenLabs / Deepgram, and the cloudflared control plane (when tunnel is up).
- Cloudflare Quick Tunnels are public but URL is unguessable. The webhook endpoint validates Twilio request signatures (`getpatter` does this internally).

## 8. Testing Strategy

**Unit tests** (`server/tests/unit/`, vitest):
- Credentials parser: valid file, missing file, missing keys, malformed lines, world-readable permissions.
- Tool input validators: E.164 enforcement, objective length limits, malicious input.
- Store persistence: write/read round-trip, concurrent appends, NDJSON format invariants.
- Phone number redaction: copy of v0.1 test cases.

**Integration tests** (`server/tests/integration/`, vitest):
- Stub Twilio carrier using `getpatter`'s `test-mode-MVJ3SKG4.mjs` exports. Verify `make_call` end-to-end without real telephony.
- Stub OpenAI Realtime via `getpatter`'s test mode. Verify agent loop emits expected transcript turns.
- MCP protocol layer: spawn server, send `tools/list` + `tools/call` over stdio, verify responses match contract.
- Doctor mode: stub upstream HTTP, verify exit codes and report formatting.

**E2E (manual)** (`tests/e2e.md`):
- Real Twilio call to user's personal number. Documented procedure, not in CI.
- `/plugin marketplace add` + `/plugin install` + `/claude-call:setup` happy path on a clean machine.

**CI:**
- GitHub Actions on Ubuntu and macOS.
- Server: `npm ci && npm run build && npm test`.
- Plugin layer: existing 26 bats tests plus new `setup.md` lint and `marketplace.json` schema validation.

## 9. Configuration

| Path / Var | Purpose | Set by |
|---|---|---|
| `~/.claude-call/credentials` | Telephony credentials (mode 0600) | `/claude-call:setup` |
| `~/.claude-call/calls.ndjson` | Call history append-only log | server |
| `~/.claude-call/log.ndjson` | Plugin + server log (redacted) | server + hooks |
| `~/.claude-call/inbound-armed` | Flag file: serve inbound calls | `/serve-me` (cleared by `/serve-me-cancel`) |
| `~/.claude-call/messages.ndjson` | Inbound voice messages append-only log | server (when armed) |
| `CLAUDE_CALL_STATE_DIR` env | Override state dir | optional |
| `CLAUDE_CALL_LOG` env | Override log path | optional |
| `CLAUDE_CALL_VOICE_ENGINE` env | Override engine without rewriting credentials | optional |

`PATTER_MCP_URL` from v0.1 is removed. Documented in CHANGELOG.

## 10. Migration from v0.1

Step-by-step migration in `CHANGELOG.md` and README:

1. Update plugin: `/plugin update claude-call@claude-call`
2. Run `/claude-call:setup` and paste credentials from old `patter-mcp/.env`
3. Optionally delete `~/dev/patter-mcp` — no longer needed
4. v0.1 hooks/commands continue to work; only the MCP server identity changes from `patter-mcp` to `claude-call`. Phone-agent's tool list is updated in the same release.

Breaking changes:
- MCP server name `patter-mcp` → `claude-call`
- Removed env var `PATTER_MCP_URL`
- Credentials moved from `patter-mcp/.env` to `~/.claude-call/credentials`

Non-breaking:
- All slash command names unchanged (`/call`, `/notify-me`, etc.)
- Phone-agent subagent name and behavior unchanged
- Hook contracts unchanged

## 11. Open Questions

None at this time. All ambiguities resolved during brainstorming:

- ✅ Bundle vs. external server: bundle.
- ✅ Marketplace topology: single repo serves as marketplace + plugin (`source: "./"`).
- ✅ Credentials transport: file at `~/.claude-call/credentials`, server reads directly. No env block in `.mcp.json`.
- ✅ Engine choice in setup: ask explicitly, default `openai_realtime`.
- ✅ Inbound routing: global agent in v0.2; per-session routing deferred.
- ✅ Tunnel lifecycle: lazy start, kept alive while server runs.

## 12. Estimated Effort

| Component | Approx. LOC | Tests |
|---|---|---|
| `server/src/index.ts` | 80 | — |
| `server/src/credentials.ts` | 60 | 8 |
| `server/src/patter.ts` | 100 | 4 (integration) |
| `server/src/store.ts` | 80 | 6 |
| `server/src/doctor.ts` | 90 | 4 |
| `server/src/tools/*.ts` (4 files) | 250 | 16 |
| `commands/setup.md` | 120 | 1 (markdown lint) |
| `commands/serve-me.md` + `serve-me-cancel.md` | 40 | — |
| `scripts/on-session-start.sh` | 15 | 2 (bats) |
| `.claude-plugin/marketplace.json` | 20 | 1 (schema) |
| `.mcp.json` (rewrite) | 10 | — |
| `hooks/hooks.json` (delta) | 8 | — |
| README + CHANGELOG updates | 200 | — |
| **Total** | **~1,073** | **~42** |

## 13. Acceptance Criteria

A v0.2.0 release is acceptable when, on a clean machine with Node 20+, Claude Code 2.0+, and a Twilio account:

- `/plugin marketplace add https://github.com/FrancescoRosciano/claude-call` succeeds.
- `/plugin install claude-call@claude-call` succeeds.
- `/claude-call:setup` collects all required credentials, writes them at mode 0600, and reports all doctor checks PASS.
- `/call <my-personal-number> say hello` rings the phone, OpenAI agent speaks the AI disclosure, conversation completes, and the structured outcome returns to Claude Code.
- `/calls` lists the just-completed call.
- All 42+ unit and integration tests pass on Ubuntu and macOS in CI.
- README install section accurately reflects the new flow with no mentions of `patter-mcp`.
