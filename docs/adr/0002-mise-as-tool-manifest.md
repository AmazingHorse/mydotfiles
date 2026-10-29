# ADR 0002: Mise as Declarative Tool Manifest

## Status
Accepted

## Context
Adding or updating a CLI previously required touching 4 separate files across 2 languages:
- `.chezmoidata.toml` (version pin)
- `run_onchange_after_install-packages.sh.tmpl` (custom bash download/extract/verify)
- `run_onchange_after_install-packages.ps1.tmpl` (custom PowerShell download/extract/verify or winget)
- `scripts/ci-check.sh` (URL reachability assertions)

This pattern scaled poorly and led to hand-rolled extraction and checksum validation code across platforms.

## Decision
Use **mise** with the `aqua:` and `github:` backends as the single cross-platform tool manifest:
1. Declare CLI tools in `dot_config/mise/config.toml.tmpl`.
2. Pin versions via `.chezmoidata.toml`.
3. Automate dependency upgrades using Renovate.
4. Retire custom download and unpack scripts in bash and PowerShell.

## Consequences
- Adding or bumping a tool becomes declarative and single-line.
- Checksums and release asset URLs are managed automatically by aqua registry.
- Windows and Linux share the exact same tool definitions.
