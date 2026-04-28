---
description: List recent calls (status, duration, cost) by querying patter-mcp.
---

Run the bash command `${CLAUDE_PLUGIN_ROOT}/scripts/preflight.sh`. If it exits non-zero, tell the user patter-mcp is not running and stop.

Then call the `mcp__patter-mcp__get_calls` MCP tool with no arguments.

Format the response as a markdown table with columns: `Call ID | To | Status | Duration | Cost | Started`.

If the response is empty, reply: "No recent calls."
