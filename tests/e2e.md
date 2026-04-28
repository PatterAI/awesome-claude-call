# E2E manual smoke test (v0.1)

Run before each release. Costs ~$0.05 per test call.

## Setup

1. Start patter-mcp with real keys:
   ```bash
   cd ~/dev/patter-mcp && npm run dev
   ```
2. Install the plugin into Claude Code (or symlink the repo into `~/.claude/plugins/claude-call`).
3. Restart Claude Code.

## Smoke test 1: `/call` to a real number you own

1. In a new session: `/call <your-own-number> ask whether I can hear you and then say goodbye`
2. Expected: Claude dispatches phone-agent. Phone-agent calls `mcp__patter-mcp__call_third_party`. Your phone rings within ~5s.
3. Pick up. Verify the agent:
   - Identifies as "an AI assistant calling on behalf of the user"
   - Asks "can you hear me?"
   - Says goodbye when you confirm
4. Hang up. Within 1-2s the parent Claude session reports the outcome with a transcript snippet.
5. **Pass criteria**: outcome is "success", transcript contains both turns, no API keys leaked in any logs.

## Smoke test 2: `/notify-me` triggers on Stop

1. In a new session: `/notify-me <your-own-number>`
2. Verify reply: "Armed. I'll call you at the number you provided when this task completes."
3. Run a small task: "list the files in the current directory and tell me how many there are."
4. After Claude responds and the turn ends, the Stop hook fires. Phone rings.
5. Pick up. The agent reads the summary and offers follow-ups.
6. **Pass criteria**: phone rings within ~5s of Stop, summary matches the actual last assistant message.

## Smoke test 3: `/dial-me-on-blocked` triggers on permission prompt

1. In a new session: `/dial-me-on-blocked <your-own-number>`
2. Try to make Claude do something requiring confirmation (e.g., `Bash(rm -rf /tmp/cc-test)` outside the allowlist).
3. When the permission prompt appears, the Notification hook should fire and your phone should ring.
4. **Pass criteria**: phone rings within ~5s of the permission prompt.

## Cleanup

- `/notify-me-cancel` and `/dial-me-on-blocked-cancel` to disarm.
- Stop patter-mcp.
