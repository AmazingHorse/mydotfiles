# mydotfiles

Cross-platform shell setup managed with [chezmoi](https://www.chezmoi.io/).

- Linux (bare-metal Debian/Ubuntu and WSL Ubuntu/Debian)
- Windows PowerShell 7

Primary Linux interactive shell: **zsh** (bash as fallback).

## Bootstrap

### Linux / WSL

From a checkout (preferred):

```bash
./scripts/bootstrap.sh
./scripts/bootstrap.sh --ssh          # also create/upload a local SSH key
```

One-shot (reliable networks only):

```bash
sh -c "$(curl -fsLS https://get.chezmoi.io)" -- init --apply https://github.com/AmazingHorse/mydotfiles.git
```

### Windows (PowerShell 7)

```powershell
irm https://raw.githubusercontent.com/AmazingHorse/mydotfiles/master/scripts/bootstrap.ps1 | iex
```

From a checkout:

```powershell
.\scripts\bootstrap.ps1
.\scripts\bootstrap.ps1 -Ssh          # also create/upload a local SSH key
.\scripts\bootstrap.ps1 -SkipWsl      # Windows only
```

If WSL never finished first-run setup, open it once (`wsl -d Ubuntu`), then
retry. Prefer cloning outside OneDrive. `sudo` may prompt during the Linux
half — that is expected.

WSL disables `appendWindowsPath` and re-adds System32 plus Cursor, VS Code, and Antigravity CLI paths; run `wsl.exe --shutdown` from Windows PowerShell to apply.

## Daily update

```bash
chezmoi update
```

```powershell
chezmoi update
```

Preview: `chezmoi update --apply=false` then `chezmoi diff`.

## What you get

- zsh/bash + shared helpers; preferred-editor chain (`Cursor → Antigravity → VS Code → nvim/vim/vi`)
- Oh My Posh + Everforest + CaskaydiaCove Nerd Font; PowerShell 7 profile on Windows
- Pinned CLI stack via `mise`: `zoxide`, `rg`, `fd`, `delta`, `just`, `uv`, `yq`, `fnox`, `betterleaks`, plus `rbw` (Linux/WSL) / `bw` (Windows); `fzf` shell helpers
- AI & project tooling (`workstation` / `ephemeral` profiles): Python, Node, Bun, Oh My Pi (`omp`), `agy-crew`, and `copier` via `mise`; Antigravity CLI (`agy`) on Linux/WSL via official installer to `~/.local/bin`
- Optional `mise` toolsets (`.chezmoidata.toml` / `~/.config/chezmoi/chezmoi.toml`): `infra` (`opentofu`, `kubectl`), `containers` (`helm`), `rust` (`cargo-binstall`)
- Machine profiles: `workstation` (default), `server` (headless/minimal CLI), `ephemeral` (containers/Codespaces)
- Git defaults + machine-local identity + `betterleaks` pre-commit hook
- Shared `~/.ssh/config` (no private keys)

Pinned versions: `.chezmoidata.toml`. In-shell cheat sheet: **`dots`**
(same command in zsh/bash and PowerShell). Repo tasks: **`just`** (see
`justfile`). Global agent/project tasks: **`just -g`** (deployed to `~/.justfile`).

Portable agent guidance: `.chezmoitemplates/agent-core.md` rendered via `just render-rules` to `agent/cursor-user-rules.md` (paste into Cursor User Rules), `~/.gemini/GEMINI.md` (Antigravity), and `~/.omp/agent/AGENTS.md` (omp).

## Agent control plane (`just -g`)

The global omp contract, seeds (`python`, `typescript-node`, `systems-shell`, `minimal`), archetypes (`infra-ops`, `agent-cli`, `data-pipeline`, `legacy-port`), Prompts, and `command-guard` extension are deployed under `~/.omp/`; Linux also links `agy-crew` skills into omp. Bash/zsh and PowerShell load platform-specific agent environment defaults (`~/.config/agent-env.sh` / PowerShell profile).

Run `just -g` from any directory:

```bash
just -g doctor                                      # inspect env, stack, pins, secrets, command-guard
just -g seed [lang] [archetype]                     # scaffold AGENTS.md + .agent-profile.md
just -g agent-init [archetype]                      # attach an archetype profile to current repo
just -g omp-wt <branch> [args...]                   # named-branch worktree + omp inside (wt switch -x)
just -g worktree-new <branch>                       # create ../wt-<branch> sibling git worktree
just -g worktree-done <branch>                      # remove sibling worktree when clean
```

## Project scaffolding (Copier)

`just -g new` and `just -g adopt` wrap layered [Copier](https://copier.readthedocs.io/) templates (pinned in `.chezmoidata.toml`, default ref `v0.1.0`):

- **Base underlay (`copier-base`):** [`https://github.com/AmazingHorse/copier-base`](https://github.com/AmazingHorse/copier-base) — `.editorconfig`, `.gitignore`, `.gitattributes`, `.pre-commit-config.yaml` (`betterleaks`), `AGENTS.md`, `fnox.toml`, `justfile`, `.copier-answers.base.yml`
- **Infra-ops archetype (`copier-infra-ops`):** [`https://github.com/AmazingHorse/copier-infra-ops`](https://github.com/AmazingHorse/copier-infra-ops) — `.agent-profile.md`, `mise.toml` (Ansible/uv, OpenTofu, or both), `ansible.cfg`, `inventory/`, `playbooks/`, `infra/`, `.copier-answers.infra-ops.yml`

```bash
just -g new ~/projects/my-service                                        # base template only
just -g new ~/projects/my-cluster --archetype infra-ops --company Acme   # base + infra-ops overlay
just -g adopt . --archetype infra-ops --ref v0.1.0                       # adopt in existing repo
copier update --answers-file .copier-answers.base.yml --UNSAFE           # pull template updates
copier update --answers-file .copier-answers.infra-ops.yml --UNSAFE
```

See [`docs/how-to/start-a-project.md`](docs/how-to/start-a-project.md) for full lifecycle details.

## Secrets (`fnox` + Bitwarden)

- **Global agent keys:** Chezmoi reads custom fields from Bitwarden's `ai-agent-keys` item into `~/.config/agent-secrets.env` (using `rbw` on Linux/WSL, `bw` on Windows). Local overrides go in `~/.config/agent-env.local.sh`.
- **Per-project secrets:** Stored in Bitwarden folder `proj` under the project slug and referenced in `fnox.toml` (`provider = "vault"`). Inject into child processes without polluting shell state:

```bash
rbw login && rbw unlock          # Linux/WSL vault unlock (Windows: bw unlock)
fnox check                       # verify all secret references resolve
fnox doctor                      # diagnose vault provider status
fnox exec -- just deploy         # run command with project secrets injected
```

See [`docs/explanation/security-model.md`](docs/explanation/security-model.md) for architecture and sandbox boundaries.

`mise` manages global CLI pins and language runtimes. Flipper / embedded toolchains and flashing hosts belong in separate project repos.

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
just setup-ssh --gh --gl ansible.gbtel.ca
# or copy an existing key directly:
just copy-ssh-id ansible.gbtel.ca
```

```powershell
just setup-ssh -Gh -Gl ansible.gbtel.ca
# or directly via PowerShell shim:
copy-ssh-id ansible.gbtel.ca
```

Default key `~/.ssh/id_ed25519`. Use `-f` / `--force` to regenerate a new key without a passphrase (backs up old key first). See `dots` or `just setup-ssh --help` for all flags.

## Documentation

- [`docs/how-to/start-a-project.md`](docs/how-to/start-a-project.md) — Project scaffolding and adoption with Copier (`copier-base`, `copier-infra-ops`)
- [`docs/how-to/add-a-tool.md`](docs/how-to/add-a-tool.md) — Adding and pinning new CLI tools via `mise` and `.chezmoidata.toml`
- [`docs/explanation/security-model.md`](docs/explanation/security-model.md) — Secret delivery (`fnox`, `rbw`/`bw`) and sandbox boundaries
- [`docs/adr/`](docs/adr/) — Architectural Decision Records
- [`docs/plans/`](docs/plans/) — Roadmap, architecture reviews, and design plans
- [`docs/debt.md`](docs/debt.md) — Tracked technical debt and shims
- [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) — Commit conventions (`feat:`, `fix:`) and PR rules
