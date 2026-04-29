---
description: Disarm the inbound voice agent
---

# /serve-me-cancel

Disable inbound voice calls.

## Steps

1. Remove the flag:

   ```bash
   rm -f "$HOME/.claude-call/inbound-armed"
   ```

2. Print:

   ```
   ✓ Inbound voice agent disarmed.
   ```

The bundled MCP server detects the missing flag within 1 second and stops `Patter.serve()`.
