#!/usr/bin/env bash
# PreToolUse hook on Bash. Blocks a command if it contains what looks like a live
# API key / token / secret pasted inline. Rationale: live credentials have been
# pasted into chat before; a committed secret means a key rotation.
#
# Exit 2 = block the tool call and show stderr to the agent. Exit 0 = allow.
# Input: JSON on stdin, { tool_input: { command: "..." }, ... }

set -euo pipefail
payload="$(cat)"

cmd="$(printf '%s' "$payload" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\(.*\)".*/\1/p')"
[ -z "$cmd" ] && exit 0

# Known-prefix credentials (high confidence)
patterns=(
  'sk-[A-Za-z0-9_-]{16,}'            # OpenAI / generic
  'sk-ant-[A-Za-z0-9_-]{16,}'        # Anthropic
  're_[A-Za-z0-9_-]{16,}'            # Resend
  'rk_(live|test)_[A-Za-z0-9]{16,}'  # Resend restricted / others
  'xox[baprs]-[A-Za-z0-9-]{10,}'     # Slack
  'ghp_[A-Za-z0-9]{36}'              # GitHub PAT
  'github_pat_[A-Za-z0-9_]{40,}'     # GitHub fine-grained PAT
  'AKIA[0-9A-Z]{16}'                 # AWS access key id
  'AIza[0-9A-Za-z_-]{35}'            # Google API key
  'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'  # JWT
  'pplx-[A-Za-z0-9]{32,}'            # Perplexity
  'xai-[A-Za-z0-9]{32,}'            # xAI / Grok
)

for p in "${patterns[@]}"; do
  if printf '%s' "$cmd" | grep -qiE "$p"; then
    echo "BLOCKED: this command appears to contain a live credential (matched /$p/)." >&2
    echo "Do not pass secrets on the command line. Put it in .env.local or the deploy" >&2
    echo "dashboard and reference it by variable. If this is a false positive, run the" >&2
    echo "command yourself with the ! prefix." >&2
    exit 2
  fi
done

# Generic "NAME=<long high-entropy value>" assignments for secret-ish names
if printf '%s' "$cmd" | grep -qiE '(API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY)[A-Z_]*=[^ ]{20,}'; then
  echo "BLOCKED: looks like a secret is being assigned inline on the command line." >&2
  echo "Use .env.local or the deploy dashboard instead." >&2
  exit 2
fi

exit 0
