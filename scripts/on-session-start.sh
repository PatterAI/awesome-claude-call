#!/usr/bin/env bash
# claude-call SessionStart hook — prints first-run reminder if unconfigured.
set -euo pipefail

CRED_PATH="${CLAUDE_CALL_CREDENTIALS:-$HOME/.claude-call/credentials}"

if [ ! -s "$CRED_PATH" ]; then
  echo "claude-call: not yet configured. Run /claude-call:setup to enable phone calls."
fi

exit 0
