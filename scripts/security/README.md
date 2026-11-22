# Secret enforcement kit

- Hooks live in `githooks/` (standard kit layout); `install-hooks.sh` sets
  `core.hooksPath=githooks`, failing fast if gitleaks is missing (skipped in CI).
- `pre-commit` runs `gitleaks protect --staged`; `pre-push` runs a full
  `gitleaks detect` over history; both exit 1 on findings.
- Remediation: real secrets from AWS SSM at runtime; test material generated
  at runtime; CI mirror in `.github/workflows/security.yml`.
