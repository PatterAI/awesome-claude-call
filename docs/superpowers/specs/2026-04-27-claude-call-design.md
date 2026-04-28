# claude-call — Design Spec

**Date:** 2026-04-27
**Status:** Draft (pre-implementation)
**Repo:** https://github.com/FrancescoRosciano/claude-call (private)
**Depends on:** [patter-mcp](https://github.com/PatterAI/patter-mcp) (already exists)

---

## 1. Overview

`claude-call` is a Claude Code plugin that gives Claude a phone. Three flows in v0.1:

1. **Claude → third party.** Claude calls a restaurant, dentist, airline, etc. to accomplish a goal (book a table, reschedule, ask a question) and reports back with a transcript and a structured outcome.
2. **Claude → user.** Claude calls the user when it finishes a long task, or when it gets blocked and needs input. Two-way conversation: the user can answer questions, steer Claude, or simply hang up.
3. **User → Claude.** The user calls a phone number from anywhere and is dropped into a voice conversation with their currently-running Claude Code session. They can dictate work, ask for status, or trigger commands.

The plugin does **not** re-implement voice/telephony. It depends on [`patter-mcp`](https://github.com/PatterAI/patter-mcp), which already provides:

- `make_call(to, systemPrompt, firstMessage?, voice?)` — outbound call with a custom AI agent persona
- `call_third_party(to, task, voice?)` — synchronous outbound call with autonomous goal-completion (returns transcript when done)
- `get_calls`, `get_transcript`
- Inbound call answering with the Claude Code Agent SDK piped into the call

`claude-call` is the **Claude-Code-native UX layer** on top: hooks, slash commands, a subagent, and a single-step plugin install. It does not duplicate voice plumbing.

---

## 2. Goals and non-goals

### Goals (v0.1)

- One-step install via Claude Code plugin manifest
- `/call <number> <objective>` slash command for ad-hoc third-party calls
- Hook-driven autonomous notifications: Claude calls the user when a long-running task finishes, or when it stalls waiting on input
- A `phone-agent` subagent specialized in writing tight call objectives, parsing transcripts, and reporting structured outcomes
- All three flows working end-to-end against a locally-running `patter-mcp`

### Non-goals (v0.1)

- Hosting or self-hosted voice infrastructure (delegated to `patter-mcp` + Patter SDK + Twilio)
- Multi-tenant / multi-user support — v0.1 targets a single developer's machine
- Always-on remote agents that answer calls when no Claude session is running (rejected during brainstorm; only Active-Session-Only inbound is supported)
- SMS / email / Slack notifications (out of scope; the value prop is voice)
- Publishing to a public plugin marketplace (private repo, install via direct git URL)

---

## 3. Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│  Claude Code session (terminal)                                        │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  claude-call plugin                                               │  │
│  │   ├─ commands/   (slash commands the user types)                  │  │
│  │   ├─ agents/     (phone-agent subagent)                           │  │
│  │   ├─ hooks/      (Stop / Notification → autonomous outbound calls)│  │
│  │   └─ scripts/    (small shell helpers used by hooks)              │  │
│  └────────────────────────────┬─────────────────────────────────────┘  │
│                               │ MCP (Streamable HTTP)                   │
└───────────────────────────────┼────────────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  patter-mcp  (separate repo, runs as a local server)                     │
│  Tools: make_call, call_third_party, get_calls, get_transcript           │
└──────────────────────────────┬──────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Patter SDK ──→ Twilio ──→ PSTN  (real phone calls)                     │
└─────────────────────────────────────────────────────────────────────────┘
```

The plugin contains **no voice code**. It composes existing pieces.

---

## 4. Plugin layout (file tree)

```
claude-call/
├── .claude-plugin/
│   └── plugin.json                # manifest
├── .mcp.json                      # registers patter-mcp as the MCP server
├── commands/                      # slash commands (one .md per command)
│   ├── call.md                    # /call <number> <objective>
│   ├── notify-me.md               # /notify-me <number>
│   ├── notify-me-cancel.md        # /notify-me-cancel (disarms the Stop flag)
│   ├── dial-me-on-blocked.md      # /dial-me-on-blocked <number>
│   ├── dial-me-on-blocked-cancel.md
│   └── calls.md                   # /calls (recent call list)
├── agents/
│   └── phone-agent.md             # specialized subagent for phone tasks
├── hooks/
│   └── hooks.json                 # Stop / Notification / SessionEnd config
├── scripts/
│   ├── arm.sh                     # writes a JSON flag file when /notify-me fires
│   ├── disarm.sh                  # clears flags on SessionEnd
│   ├── on-stop.sh                 # reads transcript, calls user if armed
│   └── on-notification.sh         # calls user on permission_prompt / idle_prompt
├── docs/
│   └── superpowers/specs/         # design specs (this file)
├── tests/
│   ├── integration/               # spawn a fake patter-mcp, run hooks against it
│   └── unit/                      # shell-script unit tests via bats-core
├── README.md
├── CHANGELOG.md
├── LICENSE                        # MIT
└── .gitignore
```

Total surface area target: **< 600 LOC** across all shell scripts, command markdown, hook JSON, and the subagent definition. The plugin is a wiring layer — by design.

---

## 5. Component specs

### 5.1 `.claude-plugin/plugin.json`

```json
{
  "name": "claude-call",
  "version": "0.1.0",
  "description": "Two-way voice bridge for Claude Code via Patter — make outbound calls, get called when work is done.",
  "author": { "name": "Francesco Rosciano", "url": "https://github.com/FrancescoRosciano" },
  "repository": "https://github.com/FrancescoRosciano/claude-call",
  "license": "MIT",
  "keywords": ["voice", "phone", "patter", "mcp", "telephony"],
  "commands": "./commands/",
  "agents": "./agents/",
  "hooks": "./hooks/hooks.json",
  "mcpServers": "./.mcp.json"
}
```

### 5.2 `.mcp.json` — patter-mcp registration

```json
{
  "mcpServers": {
    "patter-mcp": {
      "type": "http",
      "url": "${PATTER_MCP_URL:-http://localhost:3000/mcp}"
    }
  }
}
```

The user is expected to run `patter-mcp` separately. Plugin install does NOT auto-start it (that's the patter-mcp project's responsibility — `npm run dev` or a launchd plist).

### 5.3 Slash commands

Each is a single `.md` file with frontmatter and a body that becomes a prompt template. Claude Code expands the prompt and Claude decides which MCP tool to call.

#### `/call <number> <objective>` — `commands/call.md`

```markdown
---
description: Make an outbound call to a phone number with an autonomous AI agent.
---

You are the user's phone-call orchestrator. The user wants you to call **$1** to accomplish: **$2**.

Use the `phone-agent` subagent to:
1. Validate the number is in E.164 format. If not, reformat or ask the user.
2. Compose a tight, goal-directed task description (≤ 200 chars) for the call agent.
3. Invoke the patter-mcp `call_third_party` tool with `to=$1` and the composed task.
4. When the call completes, parse the returned transcript.
5. Report back to the user: outcome (success/failure), key details extracted, and any follow-ups required.
```

#### `/notify-me <number>` — `commands/notify-me.md`

```markdown
---
description: Arm a one-shot Stop hook that calls you when Claude finishes its current task.
---

Arm the notify-me flag at the user's number **$1**. Use the Bash tool to run:

  scripts/arm.sh notify-me "$1"

Then tell the user: "Armed. I'll call you at $1 when this task is done. Use /notify-me-cancel to disarm."

Important: do not place any call yet. The hook handles that on Stop.
```

(Symmetric `/dial-me-on-blocked` and `/notify-me-cancel` follow the same shape.)

#### `/calls` — `commands/calls.md`

Wraps `get_calls` and pretty-prints recent activity. No special logic.

### 5.4 Hooks (`hooks/hooks.json`)

```json
{
  "hooks": {
    "Stop": [
      { "hooks": [
        { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/scripts/on-stop.sh" }
      ] }
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
      { "hooks": [
        { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/scripts/disarm.sh" }
      ] }
    ]
  }
}
```

#### `scripts/arm.sh`

Writes `~/.claude-call/state/{flag}.json` with `{ "number": "+...", "armed_at": "<iso>", "session_id": "<sid>" }`. Idempotent.

#### `scripts/disarm.sh`

`rm -f ~/.claude-call/state/*.json` for the current session_id. Reads `session_id` from stdin (Claude Code provides hook event JSON on stdin).

#### `scripts/on-stop.sh`

1. Reads hook event JSON from stdin → `last_assistant_message`, `session_id`.
2. Checks if `~/.claude-call/state/notify-me.{session_id}.json` exists. If not, exits 0 (no-op).
3. Composes a system prompt: "You are the user's coding agent. Call them and tell them the work is done. Summary: {last_assistant_message truncated to 500 chars}. They can ask follow-ups; relay them via the in-call Claude bridge."
4. POSTs to the local MCP server's `make_call` tool (via curl + JSON-RPC; the patter-mcp endpoint is HTTP).
5. Logs result to `~/.claude-call/log.ndjson`.
6. Disarms the flag.

#### `scripts/on-notification.sh`

Same shape, different system prompt: "Claude is asking for permission to {action}. Call the user and ask if they approve."

### 5.5 `agents/phone-agent.md` (subagent)

```markdown
---
name: phone-agent
description: Specialized subagent for phone-call orchestration. Use when the user asks you to call someone or when a phone call's transcript needs parsing.
tools: Bash, mcp__patter-mcp__call_third_party, mcp__patter-mcp__make_call, mcp__patter-mcp__get_calls, mcp__patter-mcp__get_transcript
---

You orchestrate phone calls via the patter-mcp MCP tools (`call_third_party`, `make_call`, `get_calls`, `get_transcript`).

When called:
1. **Validate phone numbers** — must be E.164 (`+` followed by country code and digits). If not, fix it or ask for clarification before calling.
2. **Compose the call objective** — keep it tight, single-purpose, and unambiguous. Bad: "ask the restaurant about availability". Good: "ask whether they have a table for 2 at 8 pm tonight; if not, ask for the next available time within the next 2 hours".
3. **Pick the right tool**:
   - `call_third_party` for goal-directed autonomous calls (booking, asking a question, leaving a message).
   - `make_call` when the user is the callee and you need a custom system prompt that gives the in-call agent more context.
4. **Parse the transcript** when the call returns. Extract: outcome (success/failure/unclear), key facts (times, names, confirmation numbers), and any open follow-ups.
5. **Report concisely**. The user wants a 2-3 sentence answer plus a one-line "next step" if any.

Never reveal API keys, the user's number, or session IDs in spoken output during a call.
```

---

## 6. Data flow

### 6.1 Outbound to third party (the killer feature)

```
User: "/call +390212345678 book a table for 2 at 8pm Saturday at Pizzeria Roma"
  → command expands to a prompt
  → Claude dispatches phone-agent subagent
  → phone-agent validates +39..., composes task: "Book a table for 2 at 8pm on Saturday at Pizzeria Roma. Confirm with our name 'Rosciano'."
  → MCP call_third_party(to=..., task=...)  [SYNCHRONOUS — blocks until call ends]
  → patter-mcp dials, runs autonomous voice agent, returns transcript when call ends
  → phone-agent parses transcript: { confirmed: true, time: "20:00 Sat", name_on_booking: "Rosciano" }
  → Claude responds: "Booked. Saturday 8pm, table for 2, under 'Rosciano'."
```

### 6.2 Claude → user (autonomous notify on Stop)

```
User: "/notify-me +393331234567" (early in the session)
  → /notify-me command runs scripts/arm.sh notify-me +393331234567
  → flag file written to ~/.claude-call/state/notify-me.{session_id}.json
User: "Now refactor the entire auth module" (long-running task)
  → ... Claude works for 20 minutes ...
Claude finishes its turn → Stop hook fires
  → scripts/on-stop.sh
  → flag exists → compose summary + system prompt
  → POST to patter-mcp /mcp/tools/make_call → phone rings
  → User answers; in-call AI agent reads the summary + answers follow-ups via Claude bridge
  → Call ends, scripts/on-stop.sh writes log entry, disarms flag
```

### 6.3 User → Claude (inbound)

This flow is fully owned by patter-mcp's existing inbound-call handler. The plugin does NOT add code here — it only documents how to enable it (set the Twilio number's voice webhook to the patter-mcp server). Listed here so the spec covers all three flows promised to the user.

---

## 7. Configuration & state

### 7.1 Required env vars

The plugin itself reads only one variable directly:

| Var | Default | Purpose |
|---|---|---|
| `PATTER_MCP_URL` | `http://localhost:3000/mcp` | MCP server endpoint |
| `CLAUDE_CALL_STATE_DIR` | `~/.claude-call/state` | Flag files for armed hooks |
| `CLAUDE_CALL_LOG` | `~/.claude-call/log.ndjson` | Append-only log of triggered calls |

All telephony / provider keys (Twilio, OpenAI, Deepgram, ElevenLabs) are owned by `patter-mcp`'s `.env`. The plugin never sees them — clean separation.

### 7.2 State files

`~/.claude-call/state/{flag}.{session_id}.json`:

```json
{
  "number": "+393331234567",
  "armed_at": "2026-04-27T14:32:11Z",
  "session_id": "abc123",
  "matcher": "permission_prompt"
}
```

One file per (flag × session). Cleaned up by `disarm.sh` on `SessionEnd`. State directory mode `0700`.

---

## 8. Error handling

| Failure | Behavior |
|---|---|
| `patter-mcp` not running when slash command fires | Hook scripts and slash commands first ping `${PATTER_MCP_URL%/mcp}/health` (1.5s timeout). On failure: subagent reports "Patter MCP isn't reachable at $PATTER_MCP_URL. Start it with `cd patter-mcp && npm run dev` (Node 22+ required)." Hooks log to `$CLAUDE_CALL_LOG` and exit 0 (never block Claude). |
| Invalid E.164 number | Subagent refuses to call; asks user to clarify the format. |
| Hook script fails (network, missing patter-mcp) | Logs to `$CLAUDE_CALL_LOG`. Hook exits 0 — never blocks Claude's normal flow. |
| Call connects but voicemail picked up | `make_call` accepts `voicemailMessage`; the agent's system prompt always includes a fallback message. |
| Stop hook fires while a call is already in flight from a previous Stop | State file deleted on first call; second Stop sees no flag and exits. (Idempotency.) |
| Hook timeout (Claude Code default 60s, raised via env if needed) | Caller of `make_call` is fire-and-forget from the hook's POV: POST is async, response not waited on past 5s. |

Hooks **never block** the user. They are best-effort notifications; if the call fails, the user notices when they look at the terminal.

---

## 9. Security & disclosure

| Concern | Mitigation |
|---|---|
| Outbound call discloses AI nature | Default system prompts include: "Identify yourself as 'an AI assistant calling on behalf of Francesco' on first turn." Required by US/EU AI-disclosure norms; non-overridable in v0.1. |
| Phone number leakage in logs | `scripts/on-stop.sh` redacts to last-4: `+33***1234` in `$CLAUDE_CALL_LOG`. |
| Untrusted hook input | Hook scripts validate JSON from stdin; never `eval` it. Use `jq` for parsing. |
| State directory permissions | Created with `mkdir -m 0700` on first arm. |
| Cost runaway | `patter-mcp` already enforces rate-limits per user. Plugin-side: hooks can fire only once per session per flag (state file deletion is the gate). |
| Disarm-on-crash | `SessionEnd` hook clears flags. If Claude Code crashes mid-session, stale flag files remain — `disarm.sh` also runs on next `SessionStart` if a stale flag is older than 24h (TTL check). |

---

## 10. Testing

### 10.1 Test surface

| Layer | Tool | What's covered |
|---|---|---|
| Shell scripts (unit) | [bats-core](https://github.com/bats-core/bats-core) | `arm.sh`, `disarm.sh`, JSON parsing in `on-stop.sh` (mocked stdin) |
| Hook integration | bats + a fake `patter-mcp` (Python `http.server`) | Stop hook fires `make_call` request with correct shape |
| End-to-end | Manual checklist in `tests/e2e.md` | Real Twilio call to a test number; verified once per release |

CI: GitHub Actions running `bats tests/` on every push. No real phone calls in CI (cost + flakiness).

### 10.2 Authenticity discipline (per Patter rules carryover)

- Mock only the patter-mcp HTTP boundary in integration tests. The hook scripts, JSON parsing, state file logic — all real code.
- Phone numbers in tests: NANP fiction range (`+15555550100`) only. Same convention as Patter.
- No real Twilio SIDs, no real OpenAI keys committed.

### 10.3 Coverage target

80% of shell scripts measured by [kcov](https://github.com/SimonKagstrom/kcov) (matches global testing rule).

---

## 11. Install & UX

End-state install for a new user:

```bash
# Prerequisites: Node 22+ (patter-mcp requirement), an active Twilio number,
# and API keys for OpenAI + Deepgram + ElevenLabs.

# 1. Clone patter-mcp + start it (one-time)
git clone https://github.com/PatterAI/patter-mcp ~/dev/patter-mcp
cd ~/dev/patter-mcp && cp .env.example .env && $EDITOR .env
npm install && npm run dev   # leave running, or launchd it
# Verify: curl http://localhost:3000/health → 200 OK

# 2. Install the plugin
claude plugin install https://github.com/FrancescoRosciano/claude-call

# 3. First call
# (in any Claude Code session)
> /call +390212345678 ask if there's a table for 2 tonight at 8pm
```

Optional `make install-launchd` target ships a launchd plist that auto-starts patter-mcp on login. v0.2 nice-to-have, not v0.1.

---

## 12. Open questions / future work

- **v0.2:** Web UI (reuse patter-mcp's call dashboard) for browsing transcripts
- **v0.2:** SMS fallback when callee doesn't answer (requires Twilio Programmable Messaging — out of scope for v0.1)
- **v0.3:** Multi-number support — different Twilio numbers per project (e.g., one for personal, one for work)
- **v0.3:** Voice persona presets — friendly / formal / Italian-accented for IT bookings
- **TBD:** Whether to publish to a public Claude Code plugin marketplace once the patter-mcp dependency is stable

---

## 13. Approval checklist (pre-implementation)

- [ ] User has approved Approach A (plugin layer over patter-mcp) — **YES (brainstorm 2026-04-27)**
- [ ] All three flows (third-party, → user, ← user) are in scope for v0.1 — **YES**
- [ ] Active-session-only inbound is acceptable — **YES**
- [ ] AI disclosure at call start is non-overridable — **YES (assumed; flag if not)**
- [ ] Plugin distribution is private repo, install via git URL — **YES**

Ready for the writing-plans skill once the user signs off on this spec.
