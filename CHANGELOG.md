# Changelog

All notable changes to claude-call are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/).

## [Unreleased]

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
