# Contributing

Thanks for considering a contribution. The fastest path:

1. Open an issue first for anything beyond a typo or one-line fix &mdash; it saves both of us round-trips.
2. Fork, branch (`fix/<short-slug>` or `feat/<short-slug>`), commit in [Conventional Commits](https://www.conventionalcommits.org/) format.
3. Run `make ci` locally before pushing &mdash; it must be green.
4. Open a PR against `main`. CI runs on Ubuntu and macOS.

## Local setup

```bash
git clone https://github.com/PatterAI/awesome-claude-call
cd awesome-claude-call
make install-dev    # verifies bats, jq, node 20+
make ci             # full pipeline: server build + typecheck + test + bats
```

## What gets reviewed

- **Tests.** New behavior needs a test. Bats for shell, `node:test` for the bundled server.
- **Brand voice.** Docs and copy follow the Patter style: sentence case, no emoji, Oxford commas, specific numbers over adjectives.
- **No dependency creep.** The bundled server has a deliberately small dependency footprint. New runtime deps need a justification in the PR description.
- **Privacy invariants.** The guarantees in [`SECURITY.md`](SECURITY.md) (mode-`0600` credentials, last-4 redaction, hard-coded AI disclosure) are non-negotiable. PRs that weaken them will not merge.

## Releases

Maintainers cut releases. Version bumps land in `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `server/package.json`, and `server/src/server.ts`, paired with a `CHANGELOG.md` entry. Tags are annotated and pushed manually.

## Reporting bugs

Use the issue templates. For security issues, follow [`SECURITY.md`](SECURITY.md) instead &mdash; do not open a public issue.
