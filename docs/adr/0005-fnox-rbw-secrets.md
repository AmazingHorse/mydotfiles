# ADR 0005: fnox with Bitwarden Password Manager

## Context

Bitwarden Secrets Manager free-tier limits do not suit per-project secrets for these repositories. Bitwarden Password Manager already holds the workstation's agent credentials and supports project items without storing credentials in Git.

## Decision

Use pinned fnox with Bitwarden Password Manager: the rbw provider on Linux/WSL and the bitwarden provider with bw on Windows. Install rbw with mise's locked Cargo backend; upstream does not publish GitHub binaries for it.

Store one item per project in folder `proj`, named after the project slug, with one custom field per environment variable. Project `fnox.toml` files contain references, never values. Each secret explicitly sets `provider = "vault"`; this keeps `fnox list` and `fnox doctor` consistent with `fnox exec` and `fnox check`.

Global agent keys remain in the `ai-agent-keys` item, rendered through chezmoi into private `~/.config/agent-secrets.env`. Projects receive their secrets only through `fnox exec`.

## Consequences

No secret values enter Git. Login and synchronization require network access; login/unlock remain interactive operations. Linux/WSL requires pinentry-curses. A locked or missing vault excludes the existing agent secrets file from chezmoi application rather than replacing it with an empty file. Windows uses an authenticated `BW_SESSION` instead of rbw.
