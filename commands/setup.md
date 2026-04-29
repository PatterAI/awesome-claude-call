---
description: Configure Twilio + voice engine credentials for claude-call
---

# /claude-call:setup

You are running the claude-call setup wizard. Walk the user through configuring credentials.

## Step 1 — Check existing config

```bash
test -s "$HOME/.claude-call/credentials" && echo EXISTS || echo MISSING
```

If `EXISTS`, ask the user with AskUserQuestion: "Existing credentials found at ~/.claude-call/credentials. Overwrite?" (Yes / No). If No, exit with the message "Setup cancelled. Existing credentials kept."

## Step 2 — Collect Twilio credentials

Use AskUserQuestion sequentially. **Validate each answer before moving on.** If invalid, re-prompt.

1. **Twilio Account SID** — must match `^AC[0-9a-fA-F]{32}$`
2. **Twilio Auth Token** — non-empty, opaque
3. **Twilio Phone Number** — E.164, must match `^\+[1-9]\d{1,14}$`

## Step 3 — Voice engine choice

AskUserQuestion with options:
- `openai_realtime` (default; recommended)
- `elevenlabs_convai`
- `pipeline` (Deepgram STT + ElevenLabs TTS + OpenAI LLM)

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
✓ Setup complete. Try: /call +<your-number> say hello
```

If exit non-zero, print the doctor output verbatim and tell the user to re-run /claude-call:setup or fix the failing key in `~/.claude-call/credentials` directly.

## Step 7 — Reload MCP

Tell the user the bundled MCP server picks up new credentials the next time it starts. Recommend:
- `/exit` and reopen the Claude Code session, **or**
- `/mcp restart claude-call` if available in the user's Claude Code version.

## Hard rules

- NEVER print collected credentials back to the user (only the masked Twilio SID prefix from the doctor output).
- NEVER commit, log, or paste any credential value into NDJSON / log files / chat history.
- The credentials file MUST end up at mode 0600.
