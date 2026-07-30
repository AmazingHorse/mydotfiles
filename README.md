# mydotfiles

Cross-platform shell setup managed with [chezmoi](https://www.chezmoi.io/).

Supports:

- Windows PowerShell 7
- WSL Ubuntu/Debian
- bare-metal Debian/Ubuntu

Primary Linux interactive shell: **zsh** (bash kept as a minimal fallback).

## One-liner bootstrap

### Windows (PowerShell 7)

```powershell
irm https://raw.githubusercontent.com/AmazingHorse/mydotfiles/master/bootstrap.ps1 | iex
```

Or from a checkout:

```powershell
.\bootstrap.ps1
.\bootstrap.ps1 -Ssh          # also create/upload a local SSH key
.\bootstrap.ps1 -SkipWsl      # Windows only
```

### Linux / WSL

```bash
sh -c "$(curl -fsLS https://get.chezmoi.io)" -- init --apply https://github.com/AmazingHorse/mydotfiles.git
```

Or from a checkout:

```bash
./bootstrap.sh
./bootstrap.sh --ssh
```

## Daily update

```bash
chezmoi update
```

```powershell
chezmoi update
```

Preview first:

```bash
chezmoi update --apply=false
chezmoi diff
```

## What this manages

- Oh My Posh theme + PowerShell 7 profile loader
- zsh + bash startup files
- shared `~/.ssh/config` (no private keys)
- package bootstrap for prompt/shell dependencies

## SSH (lean on purpose)

Private keys are **never** stored in this repo.

- Shared config lives in `~/.ssh/config`
- Sensitive hosts go in `~/.ssh/config.d/*.conf` (local only)
- Create a machine-local key:

```bash
./setup-ssh.sh
./setup-ssh.sh --gh    # upload public key with GitHub CLI
```

```powershell
.\setup-ssh.ps1
.\setup-ssh.ps1 -Gh
```

### Future option (not implemented yet)

A password-manager SSH agent (1Password / Bitwarden) can replace on-disk keys later via `IdentityAgent` in `ssh/config`. Left open intentionally so terminal features can come next.

## History rewrite note

This repository was reset to a clean history. Legacy encrypted SSH private-key blobs were removed and should not be reintroduced. Existing clones must re-clone after the remote is force-updated.

Local backup of the previous history (if created during migration):

`../mydotfiles-legacy-backup/`
