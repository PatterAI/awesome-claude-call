# Changelog

All notable changes to claude-call are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/).

## [Unreleased]

## [0.2.0] — 2026-04-28

### Added
- Self-contained bundled MCP server in `server/` (TypeScript, ESM, Node 20+). No more external `patter-mcp` repo dependency. Wraps the [`getpatter`](https://www.npmjs.com/package/getpatter) SDK directly.
- Marketplace manifest at `.claude-plugin/marketplace.json` enabling `/plugin marketplace add` install path.
- `/claude-call:setup` slash command — interactive credential wizard with doctor-mode validation.
- `/serve-me` and `/serve-me-cancel` — toggle inbound voice agent (poll-based, 1 Hz watcher inside the bundled server).
- `--doctor` CLI mode for non-interactive credential validation (Twilio + OpenAI / ElevenLabs / Deepgram health checks).
- `SessionStart` hook prints first-run reminder when unconfigured.
- 43 new server-side tests (`node:test` + `node:assert/strict`) covering credentials parsing, store persistence, phone redaction, NDJSON logger, all 4 tool input validators, and 3 MCP-protocol integration tests against a spawned `dist/index.js`.

### Changed
- **BREAKING:** MCP server name changes from `patter-mcp` to `claude-call`. Phone-agent tool prefix updated from `mcp__patter-mcp__*` to `mcp__claude-call__*`.
- **BREAKING:** `PATTER_MCP_URL` env var removed. Configuration now lives in `~/.claude-call/credentials` (mode 0600).
- `.mcp.json` switches transport from HTTP to stdio (the bundled server is launched by Claude Code as a child process).
- Three-command install replaces "clone two repos + edit `.env` + `npm run dev`" flow.
- Build toolchain uses `tsc` + `node:test` (zero-dep, no esbuild) — chosen because esbuild's prebuilt binary is killed by macOS 26 kernel restrictions on the developer's machine.

### Removed
- `scripts/preflight.sh` HTTP `/health` polling — no longer needed (server starts on demand via stdio).
- `tests/unit/preflight.bats` — corresponding bats test.

### Migration from v0.1
1. Update plugin: `/plugin update claude-call@claude-call`
2. Run `/claude-call:setup` and paste credentials previously in `~/dev/patter-mcp/.env`
3. Optionally `rm -rf ~/dev/patter-mcp`

## [0.1.0] — 2026-04-27

### Added
- `/call <number> <objective>` — outbound third-party calls via patter-mcp's `call_third_party`.
- `/notify-me <number>` and `/notify-me-cancel` — one-shot Stop hook that calls the user when the current task completes.
- `/dial-me-on-blocked <number>` and `/dial-me-on-blocked-cancel` — Notification hook that calls the user on `permission_prompt` and `idle_prompt`.
- `/calls` — list recent calls.
- `phone-agent` subagent for call orchestration: number validation, objective composition, transcript parsing, structured outcome emission.
- Hook scripts: `arm.sh`, `disarm.sh`, `preflight.sh`, `on-stop.sh`, `on-notification.sh`, with bats unit + integration tests against a fake patter-mcp.
- GitHub Actions CI running 26 bats tests + JSON validation on Ubuntu.

### Security
- AI-disclosure phrase ("an AI assistant calling on behalf of Francesco") is hard-coded into outbound system prompts; non-overridable in v0.1.
- Phone numbers in logs redacted to last-4 digits.
- State directory created with mode `0700`.
