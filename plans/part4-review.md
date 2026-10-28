# mydotfiles review: toward a platform-engineering + AI SDLC baseline

Scope: full read of the repo at `6d618eb`, plus your active GitHub repos (`vectra`, `friend-programmer` = TS; `thinkcenter-cluster` = PVE/shell; `flipper` = Python/embedded; `StatcanLM` = Rust) so the toolset advice fits how you actually work.

## Decisions (from Q&A)

| Topic | Decision |
|---|---|
| AI tools to render rules/skills/MCP for | omp, agy, Claude Code, Devin (Devin has `.devin/` rules plus AGENTS.md support, so keep the stubs as a real target, not dead code) |
| Secrets | Bitwarden: chezmoi `bitwarden`/`bitwardenFields` template functions (or `rbw` for an unattended agent), rendered into a `private_` agent-env file |
| mise migration | Incremental, one tool per PR, CI green on each |
| Execution | Advisory now; implement later on a separate worktree branch |
| OS targets / other environments | Unanswered. Assuming the current Ubuntu/Debian + WSL + Windows, and treating server/ephemeral profiles as recommended but optional |

## Verdict

The foundation is **better than most dotfiles I see**: chezmoi, one pin file, checksum-verified bootstrap, CI that renders templates and runs `chezmoi apply` into a temp HOME, a `modify_` template that merges omp config instead of clobbering it, and a tested permission shim. You're already thinking like a platform engineer.

The main risk is **scaling**. Each new tool costs 4 edits in 2 languages, agent rules live in 3 hand-synced copies, and nothing separates a workstation from a server. Fix those three and the repo grows cleanly for years.

---

## P0: Fix these first

### 1. Each new tool costs 4 edits in 2 languages

> **Status: In Progress (Pilot Completed)**
> - [x] **Pilot:** Migrated `ripgrep` to `aqua:BurntSushi/ripgrep` in mise; removed custom installer scripts and URL reachability checks.
> - [x] Added `npm:agy-crew` to mise and made skill linking robust via `mise exec`.
> - [ ] Remaining tools to migrate: `fd`, `git_delta`, `zoxide`, `just`.

To add one CLI today you have to touch:
1. `.chezmoidata.toml` (pin)
2. `run_onchange_after_install-packages.sh.tmpl` (600 lines of bash)
3. `run_onchange_after_install-packages.ps1.tmpl` (517 lines of PowerShell)
4. `scripts/ci-check.sh` (URL reachability list)

**Recommendation: make mise the tool manifest.** You already install mise on both OSes. mise's `aqua:` and `github:` backends install `rg`, `fd`, `delta`, `zoxide`, `just`, `oh-my-posh`, `gh`, `kubectl`, `opentofu`, and others on Linux, macOS and Windows. `aqua:` also verifies checksums and attestations. Then:

```toml
# dot_config/mise/config.toml.tmpl
[tools]
"aqua:BurntSushi/ripgrep" = "{{ .packages.ripgrep }}"
"aqua:sharkdp/fd"         = "{{ .packages.fd }}"
"aqua:dandavison/delta"   = "{{ .packages.git_delta }}"
"aqua:ajeetdsouza/zoxide" = "{{ .packages.zoxide }}"
"aqua:casey/just"         = "{{ .packages.just }}"
"npm:agy-crew"            = "{{ .packages.agy_crew }}"
{{ if .toolsets.infra }}"aqua:opentofu/opentofu" = "1.x"{{ end }}
```

- Bootstrap shrinks to **chezmoi + mise + OS packages** (apt/winget for `zsh`, fonts, `git`).
- Adding a tool becomes **one line**. Commit `mise.lock` for reproducible checksums.
- About 700 lines of hand-rolled download/extract/verify code across both installers go away.
- Exceptions that stay as scripts: git (PPA/winget), Nerd Fonts, agy (self-updating installer).

### 2. Automate pin bumps with Renovate
Every pin is a manual bump today. Renovate supports mise config natively and has a regex manager for `.chezmoidata.toml`. You get a PR per bump, CI runs on it, and you merge. This is the habit that matters for platform work: **pins plus automated, tested bumps**.

### 3. Agent rules in 3 hand-synced copies (they already drift)
- `dot_gemini/GEMINI.md`, `agent/cursor-user-rules.md`, and the user rule I'm running under all say "keep in sync" by hand. The Cursor copy already differs ("New shared automation = **Node**").
- That Node rule also contradicts this repo, which is bash + PowerShell + just.

**Recommendation:** one source, `.chezmoitemplates/agent-core.md`, included into every target:

| Target | Tool |
|---|---|
| `~/.gemini/GEMINI.md` | agy / Gemini CLI |
| `~/.omp/agent/AGENTS.md` (core + omp contract) | omp |
| `~/.claude/CLAUDE.md` | Claude Code |
| `~/.codex/AGENTS.md` | Codex |
| `agent/cursor-user-rules.md` (rendered by `just`, pasted into Cursor) | Cursor |

Do the same for **skills**: keep them in one directory (for example `~/.agents/skills`, fed by the repo and agy-crew) and symlink it into each tool. Do the same for **MCP servers**: one list in `.chezmoidata`, rendered into each tool's format.

### 4. The global omp contract is too absolute for a global file
`AGENTS.md` applies to **every** project, but several rules only make sense inside the spec workflow:
- "Touch only files listed in `.agent-spec.md`" breaks exploratory or no-spec sessions. Make it: *"When `.agent-spec.md` exists, …"*.
- "Never use `grep`/`cat`" for symbols isn't workable in shell scripts, YAML, Terraform, or Proxmox configs, where no LSP exists. Make it: *"Prefer LSP where a server exists."*
- Absolute rules that can't be followed teach models to ignore the file. Keep the hard "never" rules for safety only: secrets, destructive commands, out-of-workspace writes.

### 5. Permission allowlist: some "safe" entries can run arbitrary code
In `permissions.defaults.json` these auto-allowed commands run whatever code the repo contains:
- `just`, `npm test`, `npm run build`, `npm run lint`, `pytest` (conftest), `cargo build` / `cargo test` (build.rs), `go test`
- `chezmoi execute-template` and `chezmoi cat`: templates can call `output` and run commands

In your own repos that's an acceptable trade. In a **freshly cloned, untrusted repo** it means the agent runs attacker-controlled code with no prompt. Options:
- Keep it, and document the trade explicitly in the SHIM header.
- Or add a per-repo trust gate: the build/test allows only apply when the repo root is listed in a `trusted` file. This mirrors Phase 2 of your own `plans/part3`.
- Smaller gap: `git branch` allows `git branch -D`. Consider `git branch --list` / `-a` / `-v` only.

---

## P1: Needed for platform engineering

### 6. Machine profiles
You're a sysadmin, so these dotfiles will land on servers, cluster nodes, containers, and Codespaces. None of those should get Nerd Fonts, Windows Terminal edits, agy, or omp.

```gotemplate
{{- $profile := promptChoiceOnce . "profile" "Machine profile" (list "workstation" "server" "ephemeral") -}}
[data]
profile = {{ $profile | quote }}
[data.toolsets]
infra    = {{ promptBoolOnce . "toolsets.infra" "Infra tools (tofu/ansible/kubectl)" }}
embedded = {{ promptBoolOnce . "toolsets.embedded" "Embedded tools" }}
```

- `server`: shell, git, rg/fd, and the prompt only. No sudo-requiring installs unless asked.
- `ephemeral`: detect `$CODESPACES`, `$REMOTE_CONTAINERS`, or a missing TTY, and skip prompts. chezmoi supports `--promptString`/`--promptBool` for non-interactive init. This makes the repo usable as a **devcontainer dotfiles repo**, which is how you'd sandbox agents on untrusted code.

### 7. Toolsets that match your actual work

| Toolset | Suggested (via mise) | Why |
|---|---|---|
| core | `gh`, `jq`, `yq`, `uv`, `shfmt`, `direnv` (or mise `[env]`) | `uv` replaces pip/pipx/venv; `yq` for every YAML you'll touch |
| infra | `opentofu`, `ansible` (via `uv tool`), `kubectl`, `helm`, `k9s`, `sops`, `age` | `thinkcenter-cluster` → bpg/proxmox provider + ansible is the standard PVE path |
| containers | `podman` or docker CLI, `dive`, `hadolint` | |
| rust | `rust` via mise (rustup) | `StatcanLM` |
| embedded | keep per-project (`flipper` mise.toml + ufbt), as you do now ✅ | Correct call; don't globalize toolchains |

### 8. No secrets story (needed for AI tooling)
AI tools need API keys (Anthropic, Gemini, OpenAI, GitHub tokens for MCP, and so on). The repo has nowhere for them, so they end up in rc files or shell history. Pick one:
- chezmoi + **age** encryption for a `private_dot_config/agent-secrets.env.age`
- chezmoi's **Bitwarden / 1Password / pass** template functions, so secrets never enter the repo
- At minimum, an unmanaged `~/.config/agent-env.local.sh` sourced last. Mirror the `.gitconfig.local` pattern you already use.

Add `gitleaks` to CI and to a pre-commit hook either way.

### 9. CI: split checks that depend on the network from checks that don't
- The URL reachability checks make PR CI flaky and slow. Move them to a **scheduled** workflow. Renovate covers most of it anyway.
- Add a **matrix of real installs** in containers: `ubuntu:22.04`, `ubuntu:24.04`, `debian:12`, running full `chezmoi init --apply` with `profile=server`. Add a `windows-latest` job that runs the PS installer with a dry-run flag.
- Run `PSScriptAnalyzer`, not only the parse check.
- [x] **Done:** The ~150 lines of PowerShell embedded in a bash string inside a Go template (`ensure_wsl_windows_nerd_fonts`) never gets linted. Extracted to `dot_local/share/mydotfiles/configure-terminal-fonts.ps1` and added to `.github/workflows/ci.yml` parser list.

---

## P2: Likely bugs and cleanup

- [x] **Done: WSL font setup on Windows Terminal:** Extracted PowerShell script to `dot_local/share/mydotfiles/configure-terminal-fonts.ps1`. Eliminated cross-boundary Windows invocation from WSL install script. Replaced synchronous `SendMessage` with non-blocking `SendMessageTimeout`. Added JSON comments protection (skips rewrite with warning). Added non-elevated user-space font check in `run_after_zz-wsl-notice.sh.tmpl`.
- Move `run_*` scripts into `.chezmoiscripts/` to declutter the repo root (chezmoi convention).
- [x] **Done:** `bootstrap.sh` pin assertion in `scripts/ci-check.sh` ensuring `DEFAULT_CHEZMOI_VERSION` matches `.chezmoidata.toml`.
- [x] **Done:** Isolated `scripts/ci-check.sh` to a temporary directory config so local CI checks never clobber `$HOME/.config/chezmoi/chezmoi.toml` or `$HOME/.gitconfig`.
- [x] **Done:** Added `git-filter-repo` to package manifests (Linux apt, Windows pip).
- `dot_justfile`: `seed` and `agent-init` mostly duplicate each other. `devin-worktree` and `devin-clean` are dead stubs; delete them and add them back when you need them (they're in git history).
- `plans/part2-*.md` and `plans/part3-*.md` are finished agent work orders. Delete them, or turn the reasoning into `docs/adr/NNNN-*.md`. "Why chezmoi", "why mise", and "why a bash permission shim" are good ADRs and good platform-engineer portfolio material.
- Commit style is mixed (`feat(omp): …` vs `Added jq`). Pick Conventional Commits; agents follow the pattern once it's in AGENTS.md.
- `just -g doctor`: add **drift detection** (installed version vs pin), `chezmoi status` (unapplied changes), and a check that the agent-core render is current.

---

## AI SDLC: getting the most out of models

Your plan → spec → worktree → verify loop (`just -g plan`, `run-omp`, `git-guard`, `worktree-new`) is the right shape. To make it work across every tool:

1. **Every project gets a committed `AGENTS.md`** with build, test, and lint commands, layout, and gotchas. This file affects agent output quality more than anything else. Change `just -g seed` to generate an `AGENTS.md` skeleton. Keep `.agent-profile.md` for *personal* preferences only.
2. **Use `just check` in every repo.** The global contract can then say "run `just check` before reporting done" without knowing the language. You already do this here.
3. **Pre-commit hooks** (shellcheck, shfmt, ruff, prettier, gitleaks) give agents fast, deterministic feedback and catch issues before CI.
4. **Sandbox tiers:** your own repo → native. Unfamiliar repo → `omp-sandbox` (bwrap, nice). Untrusted repo → devcontainer, which the `ephemeral` profile enables.
5. **Single-source skills and MCP**, as in #3. Keep MCP minimal: GitHub plus a docs server covers most value. Each server is attack surface and context cost.

---

## Documentation: a reference structure for humans and agents

### What AnyPS5 does well (checked against `boykopovar/AnyPS5`)
- **`AGENTS.md` is short and lists only "the rules agents break".** The canonical rules live in `CONTRIBUTING.md` and `docs/dev/CONVENTIONS.md`; AGENTS.md links to them and adds a few sharp, testable rules. It doesn't duplicate them.
- **Docs are split by audience:** `docs/user/` (usage, compatibility) and `docs/dev/` (architecture, build, conventions, environment).
- **Known gaps have a fixed home**, one file per component (`docs/dev/debt/<library>.md`). It also states where things *don't* go: "notes, reports and logs go in the PR; add no other files." That stops agents from scattering `NOTES.md` files.
- **Conventions are enforced by tools** (`tools/check_conventions.py`), not just by prose.
- **The PR template has an `AI-assisted` field** and requires every box to be ticked.

### Best-practice alternative: AnyPS5 conventions + Diátaxis + ADRs
AnyPS5's audience split works for a project with users and contributors. A dotfiles/platform repo has one human (you) in different *modes*: onboarding a new machine, doing a task, looking something up, or understanding why it works this way. **[Diátaxis](https://diataxis.fr)** sorts docs by those modes, and it's the most widely adopted docs framework (Django, Canonical, NumPy). Combine it with AnyPS5's agent conventions and add ADRs:

```text
README.md                 # what + 3-command quickstart + doc map. Nothing else.
AGENTS.md                 # ≤40 lines: commands, "rules agents break", links
CLAUDE.md -> AGENTS.md    # symlink (Claude Code); Devin/agy/omp read AGENTS.md
CONTRIBUTING.md           # commit style, PR flow, how to add a tool (the canonical rules)
.github/pull_request_template.md   # What / Tested / AI-assisted
docs/
  tutorials/              # learning: "New machine from zero" (Windows+WSL, Linux)
  how-to/                 # tasks: add-a-tool.md, add-a-toolset.md, rotate-ssh-key.md,
                          #        add-agent-skill.md, add-mcp-server.md, bump-pins.md
  reference/              # facts: pins.md (GENERATED), just-recipes.md (GENERATED),
                          #        layout.md (source path → $HOME path), env-vars.md,
                          #        permissions.md (allow/ask/deny tiers)
  explanation/            # why: agent-control-plane.md, security-model.md,
                          #        platform-matrix.md
  adr/                    # 0001-chezmoi.md, 0002-mise-as-manifest.md,
                          # 0003-bash-permission-shim.md, 0004-bitwarden-secrets.md
  debt.md                 # known gaps/shims (e.g. the omp bash-permission SHIM)
```

### Rules that keep docs useful to agents
1. **One canonical home per fact; everything else links to it.** That's the AnyPS5 rule, and it fixes the 3-copy drift in #3.
2. **Generate reference docs; don't hand-write them.** `just docs` renders `pins.md` from `.chezmoidata.toml` and `just-recipes.md` from `just --list`. CI fails if they're stale (`git diff --exit-code`). This is what keeps docs trustworthy for agents, which take every line literally.
3. **Specific beats vague in AGENTS.md:** exact commands (`just check`), exact paths, "never X, do Y instead". Link to `docs/` for depth so the always-loaded context stays small.
4. **A how-to for every recurring task.** `how-to/add-a-tool.md` becomes the checklist an agent follows when you say "add kubectl". This is the "inevitably include new tools" workflow written down.
5. **Say where things don't go:** "scratch notes go in the PR or `plans/*.local.md`; add no new top-level files."
6. **CI for docs:** `markdownlint`, `lychee` (dead links), and the generated-docs freshness check.
7. **Optional:** a root `llms.txt` (an emerging convention) that indexes `docs/` for tools that fetch repos over the web.

### Making it reusable as a template
Put the skeleton under `dot_omp/seeds/docs-skeleton/` and add a `just -g docs-init` recipe that copies AGENTS.md, CONTRIBUTING.md, the PR template, `docs/{tutorials,how-to,reference,explanation,adr}/` and an ADR template into any repo. `vectra`, `thinkcenter-cluster` and `flipper` would then share one structure that both you and every agent know.

---

## Suggested order

```mermaid
flowchart LR
  A["Agent rules single-source (#3, #4)"] --> A2["Docs skeleton + AGENTS.md + ADRs"]
  A2 --> B["Machine profiles + toolsets (#6, #7)"]
  B --> C["mise as manifest (#1)"]
  C --> D["Renovate + CI split (#2, #9)"]
  D --> E["Secrets + gitleaks (#8)"]
  E --> F["Cleanup + ADRs (P2)"]
```

#3/#4 are small and improve every AI session right away. #1 is the largest refactor and is easier once profiles exist to gate it.
