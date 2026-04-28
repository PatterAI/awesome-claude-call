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
