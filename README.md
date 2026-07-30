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
- zsh + bash startup files + shared shell helpers
- preferred editor picker (Cursor → Antigravity → VS Code → nvim/vim/vi)
- portable Git defaults, aliases, and machine-local identity
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
- **Pinned binary versions:** Oh My Posh and Git are locked in
  `.chezmoidata.toml`. Bootstrap installs those exact versions; shells refuse
  mismatched Oh My Posh installs instead of evaluating broken init output.
  Git is pinned because managed config uses modern features (`zdiff3`, etc.)
  and distro defaults lag badly (especially Windows/WSL). Other apt packages
  (`zsh`, `fzf`, …) stay floating because their exact pins do not travel
  cleanly across Ubuntu/Debian releases.

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

To bump pins later, change values under `[packages]` in `.chezmoidata.toml`
and re-run bootstrap/`chezmoi apply`:

- `packages.oh_my_posh` — GitHub release / winget exact version
- `packages.git` — semantic `x.y.z`; Windows uses winget `Git.Git`, Linux uses
  the [git-core PPA](https://launchpad.net/~git-core/+archive/ubuntu/ppa).
  Keep this at a version both channels publish (PPA often lags Git for Windows).

### Sensible next features (same pattern)

Already shipped in-shell: preferred editor chain, `PAGER`, Git aliases
(`st`/`co`/`sw`/`br`/`ci`/`last`/`lg`/`amend`), and soft-fail fzf helpers
(`gsw` / `gco`).

Still good candidates later:

- `direnv` or `mise` with a pinned binary
- password-manager SSH agent as an optional IdentityAgent template
- richer fuzzy helpers (repo jump, stash pick) without a plugin framework

Skip for now unless needed: full plugin frameworks, package sprawl, encrypted
private keys in-repo, and per-host secret sync.

## Git

Chezmoi prompts for Git name/email separately on each machine. This keeps
personal and work identities out of the public source tree.

Managed defaults include:

- `main` for new repositories
- automatic upstream setup on first push
- pruning deleted remote branches
- `zdiff3` conflict context (requires the pinned Git ≥ 2.35)
- histogram diffs, moved-line coloring, verbose commits, and rerere
- short aliases: `st`, `co`, `sw`, `br`, `ci`, `last`, `lg`, `amend`
- `core.editor` via `preferred-editor` (same picker as `$EDITOR`)
- a small global ignore file at `~/.config/git/ignore`

Shell helpers (soft-fail if tools are missing):

- `$EDITOR` / `$VISUAL` from `preferred-editor`: Cursor → Antigravity (`antigravity` / `agy`) → VS Code (`code`) → `nvim` / `vim` / `vi`
- `gsw` / `gco`: fuzzy branch switch/checkout via `fzf`

### Shell cheat sheet

Git aliases (use as `git <alias>`):

- `git st` → `git status`
- `git co` → `git checkout`
- `git sw` → `git switch`
- `git br` → `git branch`
- `git ci` → `git commit`
- `git last` → show the latest commit
- `git lg` → compact decorated graph of the latest 20 commits
- `git amend` → amend the latest commit without changing its message

Fuzzy helpers (run directly inside a repository):

- `gsw` → select a local/remote branch with `fzf`, then `git switch`
- `gco` → select a local/remote branch with `fzf`, then `git checkout`

Linux/WSL zsh and bash key bindings supplied by the distro `fzf` scripts:

- `Ctrl-R` → fuzzy-search shell history
- `Ctrl-T` → fuzzy-select a file and insert its path at the prompt
- `Alt-C` → fuzzy-select a directory and change into it
- Inside an `fzf` picker: type to filter, use arrows or `Ctrl-J`/`Ctrl-K`,
  press `Enter` to choose, or `Esc`/`Ctrl-C` to cancel

PowerShell supports `gsw` / `gco`; the `Ctrl-R`, `Ctrl-T`, and `Alt-C` bindings
above are currently Linux/WSL-only.

Machine-specific overrides belong in unmanaged `~/.gitconfig.local`, which is
included last. Credentials, signing keys, and forced pull/rebase policy are
intentionally not managed.

### Per-folder Git email

Use unmanaged `~/.gitconfig.local` with directory-based includes. Example: use a
work email under `~/work/` while keeping the machine default elsewhere:

```gitconfig
[includeIf "gitdir:~/work/"]
    path = ~/.gitconfig-work
```

And in `~/.gitconfig-work`:

```gitconfig
[user]
    email = you@company.com
```

On Windows, prefer forward slashes and an absolute path, for example
`gitdir:C:/Users/you/work/`. Trailing slash matters: it matches that directory
and its children. Verify with `git config user.email` inside a repo under that
tree.

Commit author email is independent of how you authenticate to GitHub. Pushing
with a personal account that has joined the org still works if the commit uses
a corporate email. Attribution is cleaner if that email is added and verified
on the GitHub account; some orgs also enforce verified-email or signing rules.

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
