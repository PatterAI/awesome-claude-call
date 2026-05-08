## Summary

<!-- One or two sentences. What changed, and why. -->

## Type of change

- [ ] `fix` &mdash; bug fix (non-breaking)
- [ ] `feat` &mdash; new behavior (non-breaking)
- [ ] `refactor` &mdash; no behavior change
- [ ] `docs` &mdash; docs / copy only
- [ ] `chore` &mdash; tooling, deps, CI
- [ ] breaking change

## Test plan

<!-- Bullet list. What you ran, what you saw. -->
- [ ] `make ci` passes locally
- [ ] Bats tests cover any new shell behavior
- [ ] `node:test` cases cover any new server behavior

## Privacy / security checklist

- [ ] No new outbound HTTP destinations beyond Twilio, the voice engine, and Cloudflare
- [ ] Phone numbers still redacted to last-4 in logs
- [ ] Credentials still loaded only from `~/.claude-call/credentials` (mode `0600`)
- [ ] AI disclosure on outbound calls preserved

## Linked issues

<!-- "Fixes #123" or "Refs #123" -->
