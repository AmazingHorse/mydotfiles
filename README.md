# mydotfiles

Cross-platform shell setup managed with [chezmoi](https://www.chezmoi.io/).

- Windows PowerShell 7
- WSL Ubuntu/Debian
- bare-metal Debian/Ubuntu

Primary Linux interactive shell: **zsh** (bash as fallback).

## Bootstrap

### Windows (PowerShell 7)

```powershell
irm https://raw.githubusercontent.com/AmazingHorse/mydotfiles/master/bootstrap.ps1 | iex
```

From a checkout:

```powershell
.\bootstrap.ps1
.\bootstrap.ps1 -Ssh          # also create/upload a local SSH key
.\bootstrap.ps1 -SkipWsl      # Windows only
```

If WSL never finished first-run setup, open it once (`wsl -d Ubuntu`), then
retry. Prefer cloning outside OneDrive. `sudo` may prompt during the Linux
half — that is expected.

### Linux / WSL

From a checkout (preferred):

```bash
./bootstrap.sh
./bootstrap.sh --ssh
```

One-shot (reliable networks only):

```bash
sh -c "$(curl -fsLS https://get.chezmoi.io)" -- init --apply https://github.com/AmazingHorse/mydotfiles.git
```

## Daily update

```bash
chezmoi update
```

```powershell
chezmoi update
```

Preview: `chezmoi update --apply=false` then `chezmoi diff`.

## What you get

- Oh My Posh + Everforest; PowerShell 7 profile
- zsh/bash + shared helpers; preferred-editor chain
- `zoxide`, `rg`, `fd`, `delta`, `mise`, `just` (pinned); `fzf` helpers
- Git defaults + machine-local identity
- shared `~/.ssh/config` (no private keys)

Pinned versions: `.chezmoidata.toml`. In-shell cheat sheet: **`dots`**
(same command in zsh/bash and PowerShell). Repo tasks: **`just`** (see
`justfile`).

Portable agent guidance: `agent/cursor-user-rules.md` (paste into Cursor User
Rules) and `~/.gemini/GEMINI.md` (Antigravity; `chezmoi apply`).

`mise` is scaffolding only (global Python pin + activate). Flipper / embedded
toolchains and flashing hosts belong in separate project repos.

## Git identity

Chezmoi prompts for name/email **per machine**. Overrides go in unmanaged
`~/.gitconfig.local` (included last).

Per-folder email example:

```gitconfig
[includeIf "gitdir:~/work/"]
    path = ~/.gitconfig-work
```

```gitconfig
# ~/.gitconfig-work
[user]
    email = you@company.com
```

On Windows use forward slashes and an absolute `gitdir:`
(e.g. `gitdir:C:/Users/you/work/`).

## SSH

Private keys are never in this repo.

- Shared: `~/.ssh/config`
- Local hosts: `~/.ssh/config.d/*.conf`
- First apply migrates an existing unmanaged config into
  `config.d/private.conf` and keeps `config.pre-chezmoi.bak`

```bash
./setup-ssh.sh --gh --gl --copy ansible.gbtel.ca
```

```powershell
.\setup-ssh.ps1 -Gh -Gl -Copy ansible.gbtel.ca
```

Default key `~/.ssh/id_ed25519`. See `dots` or `--help` for flags.

## History note

This repo was reset to a clean history. Re-clone after the remote force-update.
Do not reintroduce encrypted private-key blobs. Optional local backup:
`../mydotfiles-legacy-backup/`.
