# claude-call

> Two-way voice bridge for Claude Code via [Patter](https://github.com/PatterAI/Patter) — make outbound calls, get called when work is done.

`claude-call` is a Claude Code plugin that gives Claude a phone. Three flows:

1. **Claude → third party.** `/call +15555550200 ask if there's a table for 2 at 8pm tonight` — Claude dials, talks to the restaurant, reports back with a transcript and structured outcome.
2. **Claude → you.** `/notify-me +15555550100` arms a Stop hook; when the current task finishes, Claude rings your phone with a summary you can talk back to.
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
claude plugin install https://github.com/PatterAI/awesome-claude-call
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

- Outbound calls always identify as "an AI assistant calling on behalf of the user" on the first turn (non-overridable in v0.1).
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
