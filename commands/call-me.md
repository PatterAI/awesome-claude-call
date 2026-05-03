---
description: Make an outbound phone call to a number with an autonomous AI agent that pursues a goal and reports back. Usage: /call-me <e164-number> <objective>
---

The user has invoked /call-me with arguments: $ARGUMENTS

Parse the arguments. The first whitespace-separated token is the **phone number** (must be E.164, starting with `+`). The rest of the line is the **objective** (the goal of the call).

Then:

1. **Validate the phone number.** It must match `^\+[1-9][0-9]{6,14}$`. If not, ask the user to clarify before calling. Do not attempt to "fix" obviously malformed numbers.
2. **Delegate to the phone-agent subagent** with the objective. Tell phone-agent: "Call $NUMBER and accomplish: $OBJECTIVE. Use the `call_third_party` MCP tool. Report back with outcome, key facts, and any follow-ups." (The bundled MCP server lazy-starts the Cloudflare tunnel on the first call — no preflight needed.)
3. **Wait for the subagent's report.** It returns a 2-3 sentence summary plus a structured outcome.
4. **Relay** that summary to the user verbatim. Do not paraphrase or expand.

If the MCP server reports `credentials_missing`, tell the user to run `/claude-call:setup` first.

Hard rules:
- NEVER place the call yourself directly via the `make_call` MCP tool. Always go through phone-agent so transcripts are parsed consistently.
- NEVER call a number that wasn't supplied by the user in this command's arguments.
- If the objective implies sensitive actions (financial transactions, legal commitments above €100, anything irreversible), ASK the user to confirm before calling.
