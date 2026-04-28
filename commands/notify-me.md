---
description: Arm a one-shot Stop hook so Claude calls you when the current task finishes. Usage: /notify-me <e164-number>
---

The user has invoked /notify-me with arguments: $ARGUMENTS

Parse the single argument as a phone number. Validate it is E.164 (`^\+[1-9][0-9]{6,14}$`). If invalid, ask for clarification and stop.

Then run this bash command:

```bash
CLAUDE_SESSION_ID="$CLAUDE_SESSION_ID" ${CLAUDE_PLUGIN_ROOT}/scripts/arm.sh notify-me "$NUMBER"
```

(Substitute `$NUMBER` with the validated number.)

If the script exits 0, reply to the user exactly:

> Armed. I'll call you at the number you provided when this task completes. Use `/notify-me-cancel` to disarm.

If the script exits non-zero, surface its stderr to the user.

Do NOT place a call now. The hook handles dialing on Stop.
