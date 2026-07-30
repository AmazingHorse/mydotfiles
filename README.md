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

## Design choices

- **One repository, machine-local data:** shared files live here; secrets and
  sensitive host aliases stay on each machine.
- **One default SSH key per machine:** `setup-ssh` creates `id_ed25519` and the
  shared GitHub host uses it. Other services are not forced to use that key;
  local `config.d` entries can select service-, work-, or host-specific keys.
- **Declarative first:** prefer managed files over scripts. Lifecycle scripts
  are small, idempotent, and reserved for package/profile setup.
- **Pinned binary versions:** Oh My Posh is locked in `.chezmoidata.toml`.
  Bootstrap installs that exact version; shells refuse mismatched installs
  instead of evaluating broken init output. Distro packages (`zsh`, `fzf`, …)
  stay floating because apt pins do not travel cleanly across Ubuntu/Debian
  releases.
- **Templates only for real differences:** OS and host templates will be added
  when behavior actually differs, rather than speculatively.
- **No `just` dependency yet:** chezmoi already owns apply/update lifecycle
  scripts. A future `justfile` may provide optional contributor shortcuts such
  as `just check` or `just apply`, but bootstrap and normal use will not require
  it.

### Adding a feature (required pattern)

Use this for the next terminal/tooling additions. Do not invent a second
bootstrap style.

1. **Declare desired state** as managed files (`dot_*`, `private_*`,
   `dot_config/...`) whenever possible.
2. **Pin third-party binaries** in `.chezmoidata.toml` when we control the
   install path (GitHub release / winget version). Bump pins deliberately.
3. **Install/upgrade only in `run_onchange_*` scripts**, templated from that
   pin, idempotent, and verified after install.
4. **Fail soft in shell profiles** when the binary is missing or the version
   does not match the pin — never `eval` broken init output.
5. **Keep machine-local / secret data out of git** (`config.d`, local chezmoi
   config, password-manager agents later).
6. **Document the bump path** in this README when a new pin is introduced.

To bump Oh My Posh later, change `packages.oh_my_posh` in `.chezmoidata.toml`
and re-run bootstrap/`chezmoi apply`.

### Sensible next features (same pattern)

Candidates that fit best-practice dotfiles without exploding scope:

- shared Git defaults (`~/.gitconfig` template for name/email only)
- editor/`EDITOR` + basic pager/history consistency
- `direnv` or `mise` with a pinned binary
- fuzzy helpers layered on existing `fzf` (no Oh My Zsh)
- password-manager SSH agent as an optional IdentityAgent template

Skip for now unless needed: full plugin frameworks, package sprawl, encrypted
private keys in-repo, and per-host secret sync.
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

If an existing `~/.ssh/config` is replaced on first apply, chezmoi/bootstrap should leave a backup (for example `~/.ssh/config.pre-chezmoi.bak`). Move host aliases into `~/.ssh/config.d/private.conf` so they stay local and continue to work via `Include`.

### Future option (not implemented yet)

A password-manager SSH agent (1Password / Bitwarden) can replace on-disk keys later via `IdentityAgent` in `ssh/config`. Left open intentionally so terminal features can come next.

## History rewrite note

This repository was reset to a clean history. Legacy encrypted SSH private-key blobs were removed and should not be reintroduced. Existing clones must re-clone after the remote is force-updated.

Local backup of the previous history (if created during migration):

`../mydotfiles-legacy-backup/`
