---
description: Configure Twilio + voice engine credentials for claude-call
---

# /claude-call:setup

You are running the claude-call setup wizard. Walk the user through configuring credentials.

**Minimum requirements:** Twilio account (SID, auth token, phone number) + OpenAI API key.
**Optional alternatives:** ElevenLabs ConvAI, or pipeline mode (Deepgram STT + ElevenLabs TTS + OpenAI LLM).

## Step 1 — Check existing config

```bash
test -s "$HOME/.claude-call/credentials" && echo EXISTS || echo MISSING
```

If `EXISTS`, ask the user with AskUserQuestion: "Existing credentials found at ~/.claude-call/credentials. Overwrite?" (Yes / No). If No, exit with the message "Setup cancelled. Existing credentials kept."

## Step 1.5 — Choose credential source

Use AskUserQuestion: "How do you want to provide credentials?"

- **Enter manually** — Walk through Twilio + voice-engine prompts.
- **Import from a `.env` file** — Skip the prompts; read keys from a path you give me.

If the user picks **Import from `.env`**, ask AskUserQuestion for the absolute path. Read it with the Read tool. Extract these keys (case-sensitive, last value wins):

- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` (required)
- `OPENAI_API_KEY` (required for the default engine)
- `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, `DEEPGRAM_API_KEY` (optional; pick them up only if present)

Validate `TWILIO_ACCOUNT_SID` matches `^AC[0-9a-fA-F]{32}$` and `TWILIO_PHONE_NUMBER` matches `^\+[1-9]\d{1,14}$`. If a required key is missing or invalid, show which one and ask the user to fix the `.env` and re-run, or fall back to manual entry.

If found and valid, choose engine from what's present (default `openai_realtime` if `OPENAI_API_KEY` is set), then jump to **Step 5**.

Otherwise (manual entry), continue with Step 2.

## Step 2 — Collect Twilio credentials

Use AskUserQuestion sequentially. **Validate each answer before moving on.** If invalid, re-prompt.

1. **Twilio Account SID** — must match `^AC[0-9a-fA-F]{32}$`
2. **Twilio Auth Token** — non-empty, opaque
3. **Twilio Phone Number** — E.164, must match `^\+[1-9]\d{1,14}$`

## Step 3 — Voice engine choice

AskUserQuestion with options (OpenAI Realtime is the minimum and recommended path):

- `openai_realtime` (**default; recommended — only requires `OPENAI_API_KEY`**)
- `elevenlabs_convai` (advanced — requires ElevenLabs API key + agent ID)
- `pipeline` (advanced — Deepgram STT + ElevenLabs TTS + OpenAI LLM)

## Step 4 — Engine-specific keys

Based on the engine the user picked:

- **openai_realtime** → ask for `OPENAI_API_KEY` (validate non-empty, typically starts with `sk-`)
- **elevenlabs_convai** → ask for `ELEVENLABS_API_KEY` and `ELEVENLABS_AGENT_ID`
- **pipeline** → ask for `OPENAI_API_KEY`, `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`

## Step 5 — Write credentials file

Construct the file content by substituting captured values into the template below (replace `<PLACEHOLDERS>`). Then write it with mode 0600. Use a quoted heredoc so shell expansion doesn't run on the body.

```bash
mkdir -m 0700 -p "$HOME/.claude-call"
cat > "$HOME/.claude-call/credentials" << 'EOF'
# claude-call credentials — managed by /claude-call:setup
# Do not commit this file. Re-run /claude-call:setup to update.
TWILIO_ACCOUNT_SID=<SID>
TWILIO_AUTH_TOKEN=<TOKEN>
TWILIO_PHONE_NUMBER=<PHONE>
VOICE_ENGINE=<ENGINE>
<ENGINE_KEYS>
EOF
chmod 0600 "$HOME/.claude-call/credentials"
```

The `<ENGINE_KEYS>` block:

- For `openai_realtime`: `OPENAI_API_KEY=...`
- For `elevenlabs_convai`: `ELEVENLABS_API_KEY=...` and `ELEVENLABS_AGENT_ID=...`
- For `pipeline`: all three (`OPENAI_API_KEY`, `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`)

## Step 6 — Run doctor to validate

```bash
node "${CLAUDE_PLUGIN_ROOT}/server/dist/index.js" --doctor
```

If exit 0, print:

```
✓ Setup complete. Try: /claude-call:call +<your-number> say hello
```

If exit non-zero, print the doctor output verbatim and tell the user to re-run /claude-call:setup or fix the failing key in `~/.claude-call/credentials` directly.

## Step 7 — Reload MCP

Tell the user the bundled MCP server picks up new credentials the next time it starts. Recommend:

- `/exit` and reopen the Claude Code session, **or**
- `/mcp restart claude-call` if available in the user's Claude Code version.

The Cloudflare tunnel that Twilio uses to reach this server is started **lazily on the first call** — no extra setup needed.

## Hard rules

- NEVER print collected credentials back to the user (only the masked Twilio SID prefix from the doctor output).
- NEVER commit, log, or paste any credential value into NDJSON / log files / chat history.
- The credentials file MUST end up at mode 0600.
