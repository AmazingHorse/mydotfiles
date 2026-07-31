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

- Oh My Posh + Everforest theme; PowerShell 7 profile
- zsh/bash startup + shared helpers
- preferred editor: Cursor → Antigravity → VS Code → nvim/vim/vi
- gentle terminal bell (Windows Terminal)
- Git defaults, aliases, machine-local identity
- shared `~/.ssh/config` (no private keys)
- prompt/shell package bootstrap

Pinned tool versions live in `.chezmoidata.toml` (chezmoi, Oh My Posh, Git).

## Git

Chezmoi prompts for name/email **per machine**. Overrides go in unmanaged
`~/.gitconfig.local` (included last). Credentials and signing are not managed.

### Aliases (`git <alias>`)

- `st` → status · `co` → checkout · `sw` → switch · `br` → branch
- `ci` → commit · `last` → latest commit · `lg` → recent graph · `amend`

### Fuzzy helpers

- `gsw` / `gco` — pick a branch with `fzf`, then switch/checkout
- Linux/WSL `fzf` keys: `Ctrl-R` history, `Ctrl-T` file, `Alt-C` directory

### Per-folder email

In `~/.gitconfig.local`:

```gitconfig
[includeIf "gitdir:~/work/"]
    path = ~/.gitconfig-work
```

```gitconfig
# ~/.gitconfig-work
[user]
    email = you@company.com
```

On Windows use forward slashes and an absolute `gitdir:` path
(e.g. `gitdir:C:/Users/you/work/`). Trailing slash matches that tree.

## SSH

Private keys are never in this repo.

- Shared: `~/.ssh/config`
- Local hosts: `~/.ssh/config.d/*.conf`
- First apply migrates an existing unmanaged config into
  `config.d/private.conf` and keeps `config.pre-chezmoi.bak`

```bash
./setup-ssh.sh
./setup-ssh.sh --gh --gl
./setup-ssh.sh --copy ansible.gbtel.ca --copy backup.gbtel.ca
./setup-ssh.sh --identity ~/.ssh/business_ed25519 --gh --gl --copy ansible.gbtel.ca
```

```powershell
.\setup-ssh.ps1
.\setup-ssh.ps1 -Gh -Gl
.\setup-ssh.ps1 -Copy ansible.gbtel.ca,backup.gbtel.ca
.\setup-ssh.ps1 -Identity ~/.ssh/business_ed25519 -Gh -Gl -Copy ansible.gbtel.ca
```

Default key `~/.ssh/id_ed25519`. `--gh`/`-Gh` = GitHub CLI, `--gl`/`-Gl` =
GitLab CLI, `--copy`/`-Copy` = `ssh-copy-id` or portable `authorized_keys`
append.

## History note

This repo was reset to a clean history. Re-clone after the remote force-update.
Do not reintroduce encrypted private-key blobs. Optional local backup:
`../mydotfiles-legacy-backup/`.
