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
  <a href="https://github.com/PatterAI/awesome-claude-call/releases/tag/v0.1.0"><img alt="version" src="https://img.shields.io/badge/version-0.1.0-1f6feb?style=flat-square" /></a>
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-1a7f37?style=flat-square" /></a>
  <a href="https://github.com/PatterAI/awesome-claude-call/actions"><img alt="ci" src="https://img.shields.io/badge/ci-passing-1a7f37?style=flat-square" /></a>
  <img alt="tests" src="https://img.shields.io/badge/tests-26%2F26-1a7f37?style=flat-square" />
  <a href="https://github.com/PatterAI/patter-mcp"><img alt="powered by patter" src="https://img.shields.io/badge/powered_by-Patter-d946a3?style=flat-square" /></a>
</p>

<sub>A Claude Code plugin layered over <a href="https://github.com/PatterAI/patter-mcp">patter-mcp</a>. The plugin contains no voice code — it composes existing telephony.</sub>

</div>

<br/>

## ✦ What it does

Three flows. One plugin install. Real phone calls.

|   | Flow | Example |
|---|---|---|
| 📞 | **Claude → third party** *(killer feature)* | `/call +15555550200 book a table for 2 at 8pm Saturday` — Claude dials, negotiates, and reports a structured outcome. |
| 🔔 | **Claude → you** | `/notify-me +15555550100` arms a Stop hook. When the long task finishes, Claude rings you with a summary you can talk back to. |
| 📥 | **You → Claude** | Dial your Twilio number from anywhere, drop straight into a voice conversation with your active Claude Code session. |

<br/>

## ✦ Quick install

```bash
# 1. Start patter-mcp (one-time)
git clone https://github.com/PatterAI/patter-mcp ~/dev/patter-mcp
cd ~/dev/patter-mcp && cp .env.example .env && $EDITOR .env
npm install && npm run dev

# 2. Install the plugin
claude plugin install https://github.com/PatterAI/awesome-claude-call
```

> **Prerequisites** — Claude Code 2.0+ · Node 22+ · macOS or Linux · A Twilio number plus OpenAI / Deepgram / ElevenLabs keys (configured inside patter-mcp's `.env` — the plugin never sees them).

<br/>

## ✦ Quick start

In any Claude Code session:

```
> /call +15555550200 ask if there's a table for 2 at 8pm tonight
```

Claude dispatches the `phone-agent` subagent, dials, has the conversation, and reports back:

```
✓ Confirmed. Table for 2 at 20:00 tonight, under "Patter".
  Transcript: 4 turns · Duration: 28s · Cost: $0.04
```

<br/>

## ✦ Slash commands

| Command | What it does |
|---|---|
| `/call <number> <objective>` | Outbound call to a third party with autonomous goal pursuit. |
| `/notify-me <number>` | Arms a Stop hook — Claude calls you when the current task finishes. |
| `/notify-me-cancel` | Disarms `/notify-me`. |
| `/dial-me-on-blocked <number>` | Arms a Notification hook — Claude calls you whenever it stalls on permission or idle prompts. |
| `/dial-me-on-blocked-cancel` | Disarms `/dial-me-on-blocked`. |
| `/calls` | Lists recent calls (status, duration, cost). |

Numbers must be E.164 (e.g. `+15555550100`).

<br/>

## ✦ How it works

```
┌────────────────────────────────┐
│  Claude Code session           │
│  ├─ /call, /notify-me, ...     │  slash commands
│  ├─ phone-agent                │  subagent (validation, parsing)
│  └─ hooks/ (Stop, Notify, ...) │  autonomous triggers
└──────────────┬─────────────────┘
               │ MCP over HTTP
               ▼
┌────────────────────────────────┐
│  patter-mcp  (separate repo)   │
│  make_call · call_third_party  │
│  get_calls  · get_transcript   │
└──────────────┬─────────────────┘
               ▼
        Twilio → PSTN
```

The plugin layer is **<600 LOC** of shell + markdown. All telephony lives in patter-mcp.

<br/>

## ✦ Configuration

| Env var | Default | Purpose |
|---|---|---|
| `PATTER_MCP_URL` | `http://localhost:3000/mcp` | MCP server endpoint |
| `CLAUDE_CALL_STATE_DIR` | `~/.claude-call/state` | Flag files for armed hooks |
| `CLAUDE_CALL_LOG` | `~/.claude-call/log.ndjson` | Append-only log (with redacted phone numbers) |

<br/>

## ✦ Privacy & security

- **AI disclosure on every call.** Outbound system prompts identify the agent as *"an AI assistant calling on behalf of the user"* on the first turn. Non-overridable in v0.1.
- **Phone numbers redacted in logs** to last-4 digits via `cc_redact_phone`.
- **State directory** created with mode `0700` (owner-only).
- **No outbound HTTP** from the plugin except to your local `patter-mcp`. Telephony credentials never leave that one process.
- **Rate limits & budget caps** enforced upstream by patter-mcp.

<br/>

## ✦ Development

```bash
make install-dev    # verify bats + jq are installed
make test           # run all 26 bats tests (unit + integration)
make lint           # run shellcheck (best-effort)
```

GitHub Actions CI runs on every push and PR. Manual end-to-end smoke tests live in [`tests/e2e.md`](tests/e2e.md) and require real Twilio credentials.

<br/>

## ✦ Project docs

- 📄 **Spec** — [`docs/superpowers/specs/2026-04-27-claude-call-design.md`](docs/superpowers/specs/2026-04-27-claude-call-design.md)
- 🗺 **Plan** — [`docs/superpowers/plans/2026-04-27-claude-call-v0.1.md`](docs/superpowers/plans/2026-04-27-claude-call-v0.1.md)
- 📓 **Changelog** — [`CHANGELOG.md`](CHANGELOG.md)
- 🎨 **Cool HTML version** — [`docs/landing/index.html`](docs/landing/index.html) *(open locally)*

<br/>

## ✦ License

[MIT](LICENSE) © 2026 PatterAI. Built on [Patter](https://github.com/PatterAI/Patter).

<br/>

<div align="center"><sub>Made with ☕ and a Twilio number.</sub></div>
