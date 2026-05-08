# Security policy

## Supported versions

Security fixes land on the `main` branch and are released as patch versions on the latest minor. The most recent minor release is supported.

| Version | Supported |
|---|---|
| 0.2.x | yes |
| < 0.2 | no |

## Reporting a vulnerability

Please **do not** open a public GitHub issue for a security vulnerability. Instead:

- Use GitHub's [private vulnerability reporting](https://github.com/PatterAI/awesome-claude-call/security/advisories/new) (preferred), or
- Email the maintainers at `security@getpatter.com`.

Include reproduction steps, the affected version, and any logs or stack traces you can share. Phone numbers, Twilio Account SIDs, OpenAI keys, and similar identifiers should be redacted before sending.

## What to expect

- An acknowledgement within 3 business days.
- A triage assessment (severity, scope) within 7 business days.
- A fix or mitigation plan with a target release date for confirmed issues.
- Credit in the changelog and release notes if you wish.

## Scope

In scope:

- The plugin itself (slash commands, hooks, subagent prompts).
- The bundled MCP server in `server/`.
- Any code path that handles Twilio credentials, OpenAI / ElevenLabs / Deepgram keys, phone numbers, or call transcripts.

Out of scope:

- Issues in upstream dependencies (`getpatter`, `cloudflared`, `@modelcontextprotocol/sdk`) &mdash; please report those upstream.
- Vulnerabilities that require local root or physical access to the user's machine.
- Social engineering of the user during a live call.

## Threat model summary

claude-call is a developer tool that runs locally and places real phone calls on the user's behalf. Its trust boundaries are:

- **Credentials file** at `~/.claude-call/credentials` (mode `0600`). The server refuses to start if the mode is loose.
- **State directory** at `~/.claude-call/state/` (mode `0700`).
- **Outbound HTTP** is restricted to Twilio, the configured voice engine (OpenAI / ElevenLabs / Deepgram), and Cloudflare's tunnel control plane.
- **Phone numbers** are redacted to last-4 digits in all logs.
- **AI disclosure** is hard-coded into outbound system prompts on the first turn.

If you find a way to break any of these, please let us know via the channels above.
