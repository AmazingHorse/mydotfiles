# ADR 0001: Chezmoi for Dotfiles Management

## Status
Accepted

## Context
Cross-platform dotfiles management across Linux (Debian/Ubuntu), WSL2, and Windows requires:
- Handling OS-specific path conventions, file permissions, and template variables.
- Deterministic, repeatable bootstrap without clobbering existing machine configurations.
- Merging existing tool configurations rather than blindly overwriting.

## Decision
Adopt **chezmoi** as the single dotfiles manager across all environments:
1. Declarative file templates (`.tmpl`, `.chezmoitemplates/`).
2. Central version pinning in `.chezmoidata.toml`.
3. Profile support (`workstation`, `server`, `ephemeral`) via `.chezmoi.toml.tmpl`.
4. Automated verification via `chezmoi apply --dry-run` in CI.

## Consequences
- Single entrypoint for apply and updates.
- Bootstrap scripts shrink to installing chezmoi and executing `chezmoi init --apply`.
