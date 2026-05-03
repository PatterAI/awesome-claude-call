# Changelog

All notable changes to claude-call are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/).

## [Unreleased]

## [0.2.2] — 2026-05-02

### Fixed
- **Outbound calls dropped immediately with `duration_seconds: 0` and an empty transcript.** Three compounding root causes, found by tracing the Patter SDK source:
  1. **No tunnel for outbound.** `make_call.ts` called `patter.call()` directly without ever calling `patter.serve()`. The SDK only spawns the Cloudflare tunnel inside `serve()`, so Twilio had no public webhook to deliver call audio to. Added a `serve()` step before every dial.
  2. **The `agent` argument to `phone.call()` is ignored by the SDK.** Inspecting `getpatter`'s `Patter.call()` shows the TwiML it generates points Twilio at the same `/ws/stream/outbound` endpoint that the embedded server already serves with the `serve()`-time agent. So to dial with a custom agent, we must `serve({agent})` with that agent first. Added `ensureServing(ctx, target)` in `server/src/patter.ts` keyed on the agent identity (mode + systemPrompt + firstMessage + tool names); it disconnects and re-spawns the tunnel only when the agent actually changes, no-ops otherwise.
  3. **`patter.call()` returns when Twilio accepts the dial — not when the call ends.** `make_call.ts` was reading `metricsStore.getCalls()` immediately after, which returned empty (call still active). Replaced with the documented SDK pattern: subscribe to `metricsStore`'s `sse` event for `call_initiated` (capture the real Twilio call_id) and `call_end` (resolves with the completed record). Verified end-to-end: a real outbound call now produces a real `CA…` call_id and a multi-turn transcript.
- **Race between the inbound watcher and outbound calls.** The watcher's `setInterval` fires every 1s; without re-entry guarding, concurrent ticks could fan out and call `stopServing()` on a tunnel `make_call` had just spawned. Added an in-flight promise guard so only one transition runs at a time, and switched the watcher to consult `currentServingMode()` instead of a stale `lastDesired` cache so it never tears down state owned by `make_call`.
- **Wrong unit on `duration_seconds`.** The Patter SDK records `started_at` / `ended_at` as Unix **seconds** (`Date.now() / 1e3`), but `make_call.ts` was treating them as milliseconds and dividing by 1000 — yielding 0 for short calls. Added a magnitude heuristic: values > 1e11 are ms, otherwise seconds.
- **Concurrent outbound calls would scramble call_ids.** Two simultaneous `make_call` invocations both subscribed to the SDK's shared `metricsStore` `sse` channel; the first `call_initiated` event resolved both listeners, so call B captured call A's call_id and attributed A's transcript to itself. Added a module-level `dialMutex` that serializes the dial→call_id capture critical section (mirrors the SDK's own `PatterTool.dialQueue`). Practical exposure was low under typical single-user usage but real once a `/claude-call:notify-me` Stop hook could fire while a `/claude-call:call-me` was in flight.
- **`/call`, `/notify-me`, `/calls`, etc. were "Unknown command".** Plugin slash commands are namespaced — the actual names are `/claude-call:call`, `/claude-call:notify-me`, etc. Fixed every reference in `README.md`, `commands/setup.md` (the success message), and the docs/diagrams to use the namespaced form.
- **`commands/call.md` and `commands/calls.md` shelled out to `${CLAUDE_PLUGIN_ROOT}/scripts/preflight.sh`** — that script was deleted in v0.2.0 (this CHANGELOG, [0.2.0] § Removed). Removed the dead invocations.
- **`commands/call.md` and `commands/calls.md` named `mcp__patter-mcp__*` MCP tools** — the server was renamed to `claude-call` in v0.2.0. Updated to the current names.
- **`agents/phone-agent.md` declared `tools: mcp__claude-call__*`** — when installed via the plugin loader the actual exposed names are `mcp__plugin_claude-call_claude-call__*`, so the subagent could not reach any of its declared tools and outbound dispatch silently failed. Updated the `tools:` list to the verified-working long-form names.

### Added
- **`/claude-call:setup` Step 1.5** — "Import from `.env` file" branch. The wizard accepts an absolute path to an existing `.env` file, parses out the standard Twilio + OpenAI / ElevenLabs / Deepgram keys, and skips the per-key prompts. Falls back to manual entry on missing or invalid required keys.
- **`call_failed` `ToolErrorCode`** — distinct error code for telephony-layer failures (no `call_initiated` event within 30 s, `call_end` timeout exceeded, `metricsStore` null after `serve()`). Surfaces actionable diagnostics rather than the generic `internal`.
- **`CLAUDE_CALL_TIMEOUT_MS` env override** — caps how long an individual call may run before `make_call` rejects with `call_failed`. Default 5 minutes.
- **README "Requirements" section** — explicit minimum (Twilio + OpenAI) vs. optional alternatives (ElevenLabs, pipeline mode), per user feedback.
- **README "How it works"** — note that the Cloudflare tunnel auto-starts on first call; no ngrok or manual webhook setup.

### Changed
- **`/claude-call:serve-me` and `/claude-call:serve-me-cancel` semantics simplified.** Previously the inbound watcher unconditionally `disconnect()`ed when the flag was removed, even if `make_call` was mid-dial — killing the live call. Now the watcher only acts on transitions it owns (`'inbound'` mode), tracked via `currentServingMode()`, never on `'outbound'` state owned by `make_call`. After an outbound call ends, the next watcher tick re-arms inbound automatically if `~/.claude-call/inbound-armed` is still set.

## [0.2.1] — 2026-04-29

### Fixed
- **Plugin manifest validation rejected at install time.** v0.2.0's `plugin.json` contained `commands`/`agents`/`hooks`/`mcpServers` override fields with directory paths (e.g. `"agents": "./agents/"`). Per the current Claude Code plugin schema, those fields expect file paths or arrays — directory paths with trailing slashes fail with `Validation errors: agents: Invalid input`. The manifest is optional; Claude Code auto-discovers components in default locations. Removed the four redundant override fields.
- **`server/dist/` was silently excluded from git** by the root `.gitignore`'s `dist/` rule (which caught nested `server/dist/` despite a contradictory comment in `server/.gitignore`). Added explicit negation `!server/dist/` so the compiled JS ships with the plugin.
- **`server/node_modules/` is not part of the plugin** (Claude Code copies the plugin verbatim and does not run `npm install`). Wrapped `.mcp.json`'s command in a shell script that lazy-installs runtime dependencies on first launch (`npm install --omit=dev`) if `node_modules` is missing. Auto-reinstalls on plugin updates because `${CLAUDE_PLUGIN_ROOT}` contents are wiped on update.

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
- AI-disclosure phrase ("an AI assistant calling on behalf of the user") is hard-coded into outbound system prompts; non-overridable in v0.1.
- Phone numbers in logs redacted to last-4 digits.
- State directory created with mode `0700`.
