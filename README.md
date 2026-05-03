<div align="center">

<br/>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg" />
  <img src="docs/assets/logo.svg" alt="claude-call" width="220" />
</picture>

<h1>claude&#8209;call</h1>

<p><strong>Give Claude Code a phone.</strong><br/>
Make outbound calls, get rung when work is done, talk to your agent from anywhere.</p>

<p>
  <a href="https://github.com/PatterAI/awesome-claude-call/releases/tag/v0.2.2"><img alt="version" src="https://img.shields.io/badge/version-0.2.2-1f6feb?style=flat-square" /></a>
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-1a7f37?style=flat-square" /></a>
  <a href="https://github.com/PatterAI/awesome-claude-call/actions"><img alt="ci" src="https://img.shields.io/badge/ci-passing-1a7f37?style=flat-square" /></a>
  <img alt="tests" src="https://img.shields.io/badge/tests-43%2B26-1a7f37?style=flat-square" />
  <a href="https://github.com/PatterAI/patter-mcp"><img alt="powered by patter" src="https://img.shields.io/badge/powered_by-Patter-d946a3?style=flat-square" /></a>
</p>

<sub>A Claude Code plugin layered over <a href="https://github.com/PatterAI/patter-mcp">patter-mcp</a>. The plugin contains no voice code — it composes existing telephony.</sub>

</div>

<br/>

## ✦ What it does

Three flows. One plugin install. Real phone calls.

|   | Flow | Example |
|---|---|---|
| 📞 | **Claude → third party** *(killer feature)* | `/claude-call:call-me +15555550200 book a table for 2 at 8pm Saturday` — Claude dials, negotiates, and reports a structured outcome. |
| 🔔 | **Claude → you** | `/claude-call:notify-me +15555550100` arms a Stop hook. When the long task finishes, Claude rings you with a summary you can talk back to. |
| 📥 | **You → Claude** | Dial your Twilio number from anywhere, drop straight into a voice conversation with your active Claude Code session. |

<br/>

## ✦ Requirements

**Minimum (everyone needs these):**

- A **Twilio** account — Account SID, Auth Token, and a phone number you own.
- An **OpenAI API key** — used by the default `openai_realtime` voice engine.

That's it. The wizard wires both in for you.

**Optional alternatives** (advanced — pick one engine):

- **ElevenLabs ConvAI** — needs `ELEVENLABS_API_KEY` + `ELEVENLABS_AGENT_ID`.
- **Pipeline mode** — Deepgram STT + ElevenLabs TTS + OpenAI LLM (needs all three keys).

> **Platform** — Claude Code 2.0+ · Node 20+ · macOS or Linux.

<br/>

## ✦ Adding to Claude Code

### Step 1 — Install the plugin

Open any Claude Code session (terminal, desktop app, or IDE extension) and run:

```
/plugin marketplace add https://github.com/PatterAI/awesome-claude-call
/plugin install claude-call@claude-call
```

This clones the plugin into `~/.claude/plugins/` and registers its MCP server, slash commands, and hooks. No `npm install` needed — the bundled server ships with pre-built `dist/` files.

### Step 2 — Configure credentials

```
/claude-call:setup
```

The wizard asks for your Twilio Account SID, Auth Token, and phone number, plus an OpenAI API key for the voice engine. If you already have a `.env` file with those keys, the wizard can import them directly — just provide the absolute path when prompted.

Credentials are written to `~/.claude-call/credentials` (mode `0600`) and never stored anywhere else.

### Step 3 — Restart the session

```
/exit
```

Reopen Claude Code. The bundled MCP server starts automatically on session init and picks up the new credentials.

### Step 4 — Make your first call

```
/claude-call:call-me +15551234567 say hello and confirm the line works
```

The Cloudflare tunnel spins up automatically on the first call — no webhook setup, no ngrok.

---

> **Already have credentials?** Skip to Step 3.
> **Updating an existing install?** Re-run `/claude-call:setup` to overwrite credentials, then `/exit` to restart.

<br/>

## ✦ Quick start

In any Claude Code session:

```
> /claude-call:call-me +15555550200 ask if there's a table for 2 at 8pm tonight
```

Claude dispatches the `phone-agent` subagent, dials, has the conversation, and reports back:

```
✓ Confirmed. Table for 2 at 20:00 tonight, under "Smith".
  Transcript: 4 turns · Duration: 28s · Cost: $0.04
```

<br/>

## ✦ Slash commands

| Command | What it does |
|---|---|
| `/claude-call:call-me <number> <objective>` | Outbound call to a third party with autonomous goal pursuit. |
| `/claude-call:notify-me <number>` | Arms a Stop hook — Claude calls you when the current task finishes. |
| `/claude-call:notify-me-cancel` | Disarms `/claude-call:notify-me`. |
| `/claude-call:dial-me-on-blocked <number>` | Arms a Notification hook — Claude calls you whenever it stalls on permission or idle prompts. |
| `/claude-call:dial-me-on-blocked-cancel` | Disarms `/claude-call:dial-me-on-blocked`. |
| `/claude-call:calls` | Lists recent calls (status, duration, cost). |
| `/claude-call:serve-me` / `/claude-call:serve-me-cancel` | Arm / disarm the inbound voice agent (callers reach Claude). |

Numbers must be E.164 (e.g. `+15555550100`).

<br/>

## ✦ How it works

```
┌────────────────────────────────┐
│  Claude Code session           │
│  ├─ /claude-call:call-me, ...  │  slash commands
│  ├─ phone-agent                │  subagent (validation, parsing)
│  └─ hooks/                     │  Stop, Notification, SessionStart, SessionEnd
└──────────────┬─────────────────┘
               │ stdio MCP
               ▼
┌────────────────────────────────┐
│  bundled server (server/)      │
│  ├─ make_call · call_third_party
│  ├─ get_calls · get_transcript │
│  └─ Patter SDK + Cloudflare    │  ← tunnel auto-starts on first call
└──────────────┬─────────────────┘
               ▼
        Twilio → PSTN
```

The plugin layer is **<700 LOC** of shell + markdown. The bundled server (`server/`) is **~800 LOC** of TypeScript that wraps the [`getpatter`](https://www.npmjs.com/package/getpatter) SDK directly — no external `patter-mcp` repo required.

**The Cloudflare tunnel that Twilio uses for call audio is started lazily on the first outbound call (or when `/claude-call:serve-me` arms inbound).** No manual webhook configuration. No ngrok.

<br/>

## ✦ Configuration

| Path / Var | Default | Purpose |
|---|---|---|
| `~/.claude-call/credentials` | — | Telephony credentials (mode 0600). Managed by `/claude-call:setup`. |
| `~/.claude-call/calls.ndjson` | — | Append-only call history. |
| `~/.claude-call/log.ndjson` | — | Append-only event log (phone numbers redacted). |
| `~/.claude-call/inbound-armed` | — | Flag file. Created by `/claude-call:serve-me`, removed by `/claude-call:serve-me-cancel`. |
| `CLAUDE_CALL_STATE_DIR` | `~/.claude-call/state` | Flag files for armed hooks (`/claude-call:notify-me`, `/claude-call:dial-me-on-blocked`). |
| `CLAUDE_CALL_LOG` | `~/.claude-call/log.ndjson` | Override log path. |

<br/>

## ✦ Privacy & security

- **AI disclosure on every call.** Outbound system prompts identify the agent as *"an AI assistant calling on behalf of the user"* on the first turn. Non-overridable in v0.2.
- **Phone numbers redacted in logs** to last-4 digits.
- **Credentials file** mode `0600` enforced — server refuses to start if it's world- or group-readable.
- **State directory** created with mode `0700` (owner-only).
- **No outbound HTTP** from the plugin except to Twilio, OpenAI/ElevenLabs/Deepgram, and Cloudflare's tunnel control plane (when serving inbound or after the first outbound call spawns the tunnel).
- **Rate limits & budget caps** enforced upstream by Patter.

<br/>

## ✦ Development

```bash
make install-dev    # verify bats + jq + node are installed
make ci             # full CI: server build + typecheck + test + bats
make server-test    # just the bundled server's tests
make test           # just the bats tests
make lint           # shellcheck (best-effort)
```

GitHub Actions CI runs on every push and PR (Ubuntu + macOS matrix). Manual end-to-end smoke tests live in [`tests/e2e.md`](tests/e2e.md) and require real Twilio credentials.

<br/>

## ✦ Project docs

- 📄 **v0.1 Spec** — [`docs/superpowers/specs/2026-04-27-claude-call-design.md`](docs/superpowers/specs/2026-04-27-claude-call-design.md)
- 🗺 **v0.1 Plan** — [`docs/superpowers/plans/2026-04-27-claude-call-v0.1.md`](docs/superpowers/plans/2026-04-27-claude-call-v0.1.md)
- 📄 **v0.2 Spec** — [`docs/superpowers/specs/2026-04-28-claude-call-smooth-setup-design.md`](docs/superpowers/specs/2026-04-28-claude-call-smooth-setup-design.md)
- 🗺 **v0.2 Plan** — [`docs/superpowers/plans/2026-04-28-claude-call-v0.2.0.md`](docs/superpowers/plans/2026-04-28-claude-call-v0.2.0.md)
- 📓 **Changelog** — [`CHANGELOG.md`](CHANGELOG.md)
- 🎨 **HTML landing page** — [`docs/landing/index.html`](docs/landing/index.html) *(open locally)*

<br/>

## ✦ License

[MIT](LICENSE) © 2026 PatterAI. Built on [Patter](https://github.com/PatterAI/Patter).

<br/>

<div align="center"><sub>Made with ☕ and a Twilio number.</sub></div>
