---
description: Arm the inbound voice agent — calls to your Twilio number reach Claude
---

# /serve-me

Enable inbound voice calls.

## Steps

1. Verify credentials exist:

   ```bash
   test -s "$HOME/.claude-call/credentials" || echo "Run /claude-call:setup first"
   ```

   If missing, abort with that message.

2. Create the flag file:

   ```bash
   mkdir -m 0700 -p "$HOME/.claude-call"
   touch "$HOME/.claude-call/inbound-armed"
   ```

3. Print:

   ```
   ✓ Inbound voice agent armed. Dial your Twilio number to reach Claude.
   Inbound messages are stored at ~/.claude-call/messages.ndjson.
   Run /serve-me-cancel to disarm.
   ```

The bundled MCP server polls this flag every 1 second and starts `Patter.serve()` automatically.
