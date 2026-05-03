---
description: List recent calls (status, duration, cost) by querying the bundled claude-call MCP server.
---

Call the `get_calls` MCP tool from the `claude-call` MCP server with no arguments.

Format the response as a markdown table with columns: `Call ID | To | Status | Duration | Cost | Started`.

If the response is empty, reply: "No recent calls."

If the MCP server reports `credentials_missing`, tell the user to run `/claude-call:setup` first.
