---
description: Disarm the /notify-me Stop hook for this session.
---

Run this bash command:

```bash
CLAUDE_SESSION_ID="$CLAUDE_SESSION_ID" ${CLAUDE_PLUGIN_ROOT}/scripts/disarm.sh notify-me
```

If exit 0, reply: "Disarmed. I will not call you when this task completes."
If exit non-zero, surface stderr.
