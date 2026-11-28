#!/bin/bash
# Install hooks for opencode-glm-quota-mac-dev.
# Hooks live in githooks/ (standard kit layout); core.hooksPath is repointed
# there. Both hooks depend on gitleaks.
#
# CI note: npm ci runs the root prepare script, and CI runners have no
# gitleaks. Hooks never fire on ephemeral CI runners (no commits are made
# there), so installation skips when CI is set; .github/workflows/security.yml
# is the CI-side gitleaks gate.
set -euo pipefail

if [ -n "${CI:-}" ]; then
  echo "CI detected; skipping hook install (gitleaks runs in security.yml)"
  exit 0
fi

cd "$(git rev-parse --show-toplevel)"

if ! command -v gitleaks >/dev/null 2>&1; then
  if [ ! -x "$HOME/.local/bin/gitleaks" ]; then
    echo "ERROR: gitleaks not found on PATH or at \$HOME/.local/bin/gitleaks." >&2
    echo "Install gitleaks 8.30.1 from https://github.com/gitleaks/gitleaks/releases." >&2
    exit 1
  fi
fi

git config core.hooksPath githooks
echo "core.hooksPath set to githooks"
