---
description: Disarm the /dial-me-on-blocked Notification hook for this session.
---

Run:

```bash
CLAUDE_SESSION_ID="$CLAUDE_SESSION_ID" ${CLAUDE_PLUGIN_ROOT}/scripts/disarm.sh dial-me-on-blocked
```

If exit 0, reply: "Disarmed. I will not call you on permission/idle prompts."
If exit non-zero, surface stderr.
