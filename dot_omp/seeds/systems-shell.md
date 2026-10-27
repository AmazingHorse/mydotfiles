# Seed: systems-shell

## Goal
Portable, robust, and idempotent shell scripts and automation harnesses.

## Rules
- **POSIX-first.** Write standard POSIX `sh` unless bash-specific features are explicitly required.
- **Strict mode.** Use `set -eu` (and `set -o pipefail` when running under bash).
- **Idempotence.** Scripts must be safe to re-run; guard file creations, mounts, and state changes.
- **Clean error handling.** Fail early with informative error messages directed to stderr.

## Verification
```bash
shellcheck <changed-scripts> && bash -n <changed-scripts>
```
