# Implementation plan: mydotfiles → platform + AI SDLC baseline

Source: [part4-review.md](part4-review.md)

## Ground rules

- **Isolation:** all work happens in a separate worktree (`just -g worktree-new <branch>`) so it doesn't collide with omp's session in the main checkout.
- **One phase = one branch = one PR**, Conventional Commits, `just check` green before merge.
- **Incremental:** the mise migration (Phase 4) moves one tool per commit, with CI green on each.
- **Agent targets:** omp, agy, Claude Code, Devin.
- **Secrets:** Bitwarden.
- **Assumed OS targets:** Ubuntu/Debian, WSL, Windows. Server and ephemeral profiles are built but optional.

```mermaid
flowchart LR
  P0["P0 Prep + bug fix"] --> P1["P1 Agent rules single-source"]
  P1 --> P2["P2 Docs skeleton"]
  P2 --> P3["P3 Profiles + toolsets"]
  P3 --> P4["P4 mise as manifest"]
  P4 --> P5["P5 Renovate + CI split"]
  P3 --> P6["P6 Bitwarden secrets"]
  P5 --> P7["P7 Trust gate + cleanup"]
  P6 --> P7
  P7 -.-> P75["P7.5 .chezmoiroot layout (optional)"]
  P7 --> P8["P8 Layered copier templates (part8)"]
  P6 --> P9["P9 Secrets: fnox + rbw (part8)"]
  P8 --> P10["P10 Sandbox profiles (fnox proxy / bwrap)"]
  P9 --> P10
```

> **Status (audit 2026-11-01, `94d9511`):** P0–P6 have mostly shipped. The open items are listed in [part4-review.md § Remaining work](part4-review.md#remaining-work-audit-2026-10-30-against-94d9511). P7 is partly done: the cleanup rows have shipped, but the trust tier remains. The command approver was rewritten as `command-guard/` ([part7](part7-command-approver-plan.md), implemented). **Next focus:** P9 (secrets: `fnox` + `rbw`) + P8 MVP (layered copier templates `copier-base` + `copier-infra-ops`, first consumer `thinkcenter-cluster`) — **see [part8-secrets-and-templates.md](part8-secrets-and-templates.md) for the authoritative specification and work packages (WP0–WP6)**. P7.5 (`.chezmoiroot`) is optional tidying because templates live in their own git repos rather than inside `mydotfiles`.

---

## Phase 0: Prep and quick fix
**Branch:** `fix/wsl-font-json`

| Change | Files |
|---|---|
| Move the embedded PowerShell into a real script. Prefer `pwsh` and fall back to `powershell.exe`. Skip any JSON file that fails to parse **with a warning** instead of `catch {}`. Limit edits to the known editor list (no `%APPDATA%\*` discovery). | `run_onchange_after_install-packages.sh.tmpl`, new `dot_local/share/mydotfiles/configure-terminal-fonts.ps1` |
| Add the new `.ps1` to the CI parse list | `.github/workflows/ci.yml` |
| Add a CI assertion that `bootstrap.sh`'s `DEFAULT_CHEZMOI_VERSION` matches the pin | `scripts/ci-check.sh` |

**Acceptance criteria:** on a Windows Terminal setup whose `settings.json` contains comments, the script either applies the font or prints a clear warning. Comments are never stripped.
**Verify:** `just check`; on Windows, `pwsh -File ...configure-terminal-fonts.ps1 -WhatIf`.

---

## Phase 1: Single-source agent rules (omp / agy / Claude Code / Devin)
**Branch:** `feat/agent-rules-single-source`

| Change | Files |
|---|---|
| Create the canonical core rules (merged from GEMINI.md, cursor-user-rules.md and the user rule). Remove the "automation = Node" contradiction. | new `.chezmoitemplates/agent-core.md` |
| Render the core rules to each tool | `dot_gemini/GEMINI.md.tmpl`, new `dot_claude/CLAUDE.md.tmpl`, `dot_omp/private_agent/AGENTS.md.tmpl` (core + omp contract), Devin global rules target (confirm path; see Open questions) |
| Soften the omp contract: make spec-scope rules conditional on `.agent-spec.md` existing; change LSP to "prefer, where a server exists"; keep hard "never" rules for safety only | `AGENTS.md.tmpl` |
| Generate the Cursor rules file instead of hand-syncing it (kept as a reference copy) | `agent/cursor-user-rules.md` via `just render-rules` |
| Single skills directory: `~/.agents/skills`, symlinked into omp, Claude Code, agy and Devin. agy-crew installs into it. | `run_onchange_after_link-agent-skills.sh.tmpl` |
| MCP server list kept in data and rendered per tool (start empty or with GitHub only) | `.chezmoidata.toml` `[mcp]`, `dot_omp/private_agent/mcp.json.tmpl`, Claude/agy equivalents |
| CI fails if any rendered rules file differs from the core source | `scripts/ci-check.sh` |

**Acceptance criteria:** editing `agent-core.md` once and running `chezmoi apply` updates all four tools. No "keep in sync" comments remain.
**Verify:** `just check`; `chezmoi diff` shows identical core sections in each target.

---

## Phase 2: Docs skeleton (AnyPS5 conventions + Diátaxis + ADRs)
**Branch:** `docs/diataxis-skeleton`

```text
README.md                 # what + 3-command quickstart + doc map
AGENTS.md                 # ≤40 lines: commands, rules agents break, links
CLAUDE.md -> AGENTS.md
CONTRIBUTING.md           # commit style, PR flow, canonical rules
.github/pull_request_template.md   # What / Tested / AI-assisted
docs/
  tutorials/new-machine.md
  how-to/{add-a-tool,add-a-toolset,bump-pins,rotate-ssh-key,add-agent-skill,add-mcp-server}.md
  reference/{pins,just-recipes}.md   # GENERATED
  reference/{layout,env-vars,permissions}.md
  explanation/{agent-control-plane,security-model,platform-matrix}.md
  adr/{0000-template,0001-chezmoi,0002-mise-as-manifest,0003-bash-permission-shim,0004-bitwarden-secrets}.md
  debt.md                 # omp bash-permission SHIM, etc.
```

| Change | Files |
|---|---|
| Slim the README down to the doc map. Move the SSH, git identity and WSL sections into the matching how-to and reference docs. | `README.md`, `docs/**` |
| Turn finished plans into ADRs, then delete the plans | `plans/part2-*.md`, `plans/part3-*.md` → `docs/adr/0003-*` |
| `just docs` generates `pins.md` and `just-recipes.md`. CI runs `just docs && git diff --exit-code`. | `justfile`, `scripts/gen-docs.sh`, `ci.yml` |
| Docs lint: `markdownlint` + `lychee` link check | `.markdownlint.yaml`, `ci.yml` |
| Reusable template: folded into `copier-base` (`just -g new` / `just -g adopt`; see [part8-secrets-and-templates.md](part8-secrets-and-templates.md)) | external `copier-base` repo, `dot_justfile` |
| Add the docs and `.chezmoiignore` entries so nothing under `docs/` is applied to `$HOME` | `.chezmoiignore` |

**Acceptance criteria:** a fresh agent session can answer "how do I add a tool?" from `AGENTS.md` → `how-to/add-a-tool.md` without reading installer code.
**Verify:** `just check`; `just docs && git diff --exit-code`; `just -g docs-init` in a scratch repo.

---

## Phase 3: Machine profiles and toolsets
**Branch:** `feat/profiles-toolsets`

| Change | Files |
|---|---|
| `promptChoiceOnce profile` (workstation / server / ephemeral) and `promptBoolOnce toolsets.{infra,containers,rust}`. Choose ephemeral automatically when `$CODESPACES`, `$REMOTE_CONTAINERS` or `!stdinIsATTY` is set. | `.chezmoi.toml.tmpl` |
| Gate fonts, WT/editor edits, agy, omp and agent skills behind `profile == "workstation"` | `run_onchange_*`, `.chezmoiignore` |
| Server profile installs: shell, git, rg/fd, prompt; no sudo prompts unless already root or sudo works non-interactively | install scripts |
| Write `docs/explanation/platform-matrix.md` (profile × OS × what's installed) | docs |

**Acceptance criteria:** `chezmoi init --apply --promptChoice profile=server` in an `ubuntu:24.04` container completes non-interactively, with no fonts and no agents.
**Verify:** `docker run --rm -v $PWD:/src ubuntu:24.04 bash -c '... chezmoi init --apply --source /src --promptChoice profile=server'`

---

## Phase 4: mise as the tool manifest (incremental)
**Branch:** `feat/mise-manifest` (one commit per tool)

Migration order, lowest risk first: `fd` → `rg` → `zoxide` → `delta` → `just` → `agy-crew` (`npm:`) → `oh-my-posh` (last, because the profile checks its version strictly).

For each tool:
1. Add `"aqua:<owner>/<repo>" = "{{ .packages.<pin> }}"` to `dot_config/mise/config.toml.tmpl`.
2. Remove its block from **both** `install-packages.sh.tmpl` and `install-packages.ps1.tmpl`.
3. Remove its URL from `scripts/ci-check.sh`.
4. Run `just check` and commit.

Then:
- Add the core toolset: `gh`, `yq`, `uv`, `shfmt`, `direnv`.
- Add the gated toolsets: infra (`opentofu`, `kubectl`, `helm`, `k9s`, `sops`, `age`; `ansible` via `uv tool`), containers (`hadolint`, `dive`), rust.
- Commit `mise.lock`.
- Clean up old binaries: remove the stale `~/.local/bin/{rg,fd,...}` once the mise shims take over, so PATH order can't shadow them.

**Remains as scripts:** git (PPA/winget), Nerd Fonts, agy installer, chezmoi, mise itself.
**Acceptance criteria:** adding a new tool is a one-line diff, plus a pin, plus a line in `docs/how-to/add-a-tool.md`.
**Verify:** `just check`; `mise doctor`; `mise ls --current`; a fresh container apply (from Phase 3).

---

## Phase 5: Renovate and CI split
**Branch:** `ci/renovate-matrix`

| Change | Files |
|---|---|
| Renovate config: native mise manager plus a regex manager for `.chezmoidata.toml` pins; group minor/patch updates; schedule weekly | `renovate.json` |
| Move URL reachability checks to a scheduled workflow | `.github/workflows/pins-reachable.yml` |
| Install matrix: `ubuntu:22.04`, `ubuntu:24.04`, `debian:12` × `profile=server`; `windows-latest` running the PS installer with `-WhatIf` | `ci.yml` |
| `PSScriptAnalyzer` job | `ci.yml` |
| Pin action SHAs (`actions/checkout@<sha>`) | `ci.yml` |

**Verify:** a PR shows all matrix jobs green; Renovate's onboarding PR detects all pins.

---

## Phase 6: Bitwarden secrets and leak scanning
**Branch:** `feat/bitwarden-secrets`

| Change | Files |
|---|---|
| `private_dot_config/agent-secrets.env.tmpl` using `bitwardenFields`, rendered only on the workstation profile and only when `bw` is unlocked; otherwise skipped with a notice | new |
| Source the secrets file last from `agent-env.sh` / `agent-env.ps1`; support an unmanaged `agent-env.local.sh` override | `dot_config/agent-env.sh.tmpl`, `dot_config/powershell/agent-env.ps1` |
| Install `bw` (or `rbw`) via mise | mise config |
| `gitleaks` in CI and as a pre-commit hook | `ci.yml`, `.pre-commit-config.yaml` |
| ADR 0004 + `docs/explanation/security-model.md` | docs |

**Verify:** `chezmoi apply` with `bw` locked → clear skip message; unlocked → env vars present; `gitleaks detect` passes.

---

## Phase 7: Permission trust gate and cleanup
**Branch:** `feat/permission-trust-gate`

| Change | Files |
|---|---|
| Move build/test commands that can run repo code (`just`, `npm test`, `npm run *`, `pytest`, `cargo build/test`, `go test`, `chezmoi execute-template`, `chezmoi cat`) into a `trustedAllow` tier that applies only when the repo root is listed in `~/.omp/agent/trusted-repos`. Note: `chezmoi execute-template` was moved into plain `allow` by part7; decide whether it moves back | `command-guard/rules.ts`, `command-guard/store.ts`, `permissions.defaults.json` |
| ~~Narrow `git branch` to read-only forms~~ (done: destructive forms are in `ask`, part4 #5) | `permissions.defaults.json` |
| Add a `just -g trust` recipe (asks for confirmation; never agent-writable, since the file is protected) | `dot_justfile` |
| Tests for the trusted vs untrusted decision | `scripts/omp-permissions.test.ts` |
| ~~Merge `seed` and `agent-init`~~ (done). Committed `AGENTS.md` generation is superseded by the copier template (P8) | `dot_justfile` |
| ~~Wire up or remove the Devin recipes~~ (done: removed in `00d6aaa`) | `dot_justfile` |
| ~~`doctor`: pin drift, `chezmoi status`, rendered-rules freshness~~ (done, part4 P2) | `dot_justfile` |
| ~~Move `run_*` into `.chezmoiscripts/`~~ (done) | repo root |

**Verify:** `bun test scripts/omp-permissions.test.ts`; `just check`; `just -g doctor`.

---

## Phase 7.5 (Optional): `.chezmoiroot` layout and dev-context checkout
**Branch:** `refactor/chezmoiroot`

> **Note:** Demoted to optional tidying (see [part8-secrets-and-templates.md](part8-secrets-and-templates.md)). Project templates live in dedicated git repositories (`copier-base`, `copier-infra-ops`), so there is no template tree inside `mydotfiles` to hide from servers.

**Goal:** separate "what lands in `$HOME`" from "repo-only material", and don't check out development material (docs, plans, CI scripts) on machines that aren't dev machines. Dev context = **`profile == "workstation"`** (no new toggle).

Target layout:

```text
.chezmoiroot              # contains: home
home/                     # chezmoi source state (everything chezmoi reads)
  .chezmoi.toml.tmpl  .chezmoidata.toml  .chezmoiignore
  .chezmoiscripts/  .chezmoitemplates/
  dot_* private_* dot_config/ dot_omp/ dot_local/ dot_justfile ...
docs/  scripts/  agent/  .github/  .cursor/
README.md AGENTS.md CLAUDE.md CONTRIBUTING.md LICENSE justfile
scripts/bootstrap.sh scripts/bootstrap.ps1 scripts/setup-ssh.sh scripts/setup-ssh.ps1 .pre-commit-config.yaml
```

| Change | Files |
|---|---|
| Add `.chezmoiroot` (`home`). Use `git mv` to move every chezmoi source entry into `home/` in one commit with no content changes, so `git log --follow` still works | repo root → `home/` |
| Cut `.chezmoiignore` down to target-path rules only. Repo-only entries (`README.md`, `docs/`, `scripts/`, …) are no longer needed because they sit outside `home/` | `home/.chezmoiignore` |
| Update the hardcoded source paths (≈75 references) | `scripts/ci-check.sh`, `.github/workflows/*.yml`, `.github/renovate.json` (`fileMatch` → `home/dot_config/mise/...`, `home/.chezmoidata.toml`), `justfile` (`render-rules`), `scripts/bootstrap.sh` / `scripts/bootstrap.ps1` (pin reads, local-checkout link), `CONTRIBUTING.md`, `AGENTS.md`, `docs/**`, `.cursor/rules/*.mdc` |
| Non-workstation checkout: bootstrap clones with `--filter=blob:none`. A `run_once_after_` script (non-workstation profiles only) runs `git -C "$(chezmoi source-path)/.." sparse-checkout set --cone home` (plus the root files bootstrap needs). Workstation keeps the full checkout. If the profile changes later, the same script re-runs via a `run_onchange_` hash of `.profile` and widens or narrows the checkout | `bootstrap.sh`, `bootstrap.ps1`, new `home/.chezmoiscripts/run_onchange_after_sparse-checkout.{sh,ps1}.tmpl` |
| Local dev checkouts: the `~/.local/share/chezmoi` → repo symlink/junction rule is unchanged (it still points at the repo root; `.chezmoiroot` handles the rest) | `bootstrap.*` |
| CI: assert `chezmoi source-path` ends in `/home`, run the existing dry-run/apply matrix unchanged, and add a server-profile container job asserting `docs/` is absent after bootstrap | `scripts/ci-check.sh`, `ci.yml` |
| ADR 0006: `.chezmoiroot` + profile-driven sparse checkout | `docs/adr/0006-chezmoiroot-sparse-checkout.md` |

**Acceptance criteria:** `chezmoi diff` on this workstation is empty right after the move (the move is invisible to `$HOME`). A `profile=server` container bootstrap has no `docs/`, `plans/` or `scripts/` in the source checkout. `chezmoi update` works on both.
**Verify:** `just test`; `chezmoi diff` (expect no output); container bootstrap with `--promptChoice profile=server` then `ls "$(chezmoi source-path)/.."`.

---

## Phase 8: Cross-project conventions (copier)
**Branch:** `feat/project-template`

> **Superseded in detail by [part8-secrets-and-templates.md](part8-secrets-and-templates.md) (WP2–WP5).** Summary of the settled design:

**Goal:** moving between repos (TS, Python, Rust, shell/infra, embedded) should feel the same. Each repo answers the same five questions the same way, and conventions can be updated in existing repos, not just at creation.

| Question | Convention |
|---|---|
| What tools? | Per-repo `mise.toml` (core gates) + `.config/mise/conf.d/<archetype>.toml` (archetype tools). mise activation switches toolchains on `cd`. Global mise stays CLI-only. |
| How do I work in it? | `justfile` importing `project.just`, `archetype.just`, and `.config/just/base.just` (`set allow-duplicate-recipes`), exposing fixed verbs: `setup`, `check`, `test`, `fmt`, `lint`, `smoke`, `doctor`. `just check` is the offline, secret-free gate that agents, pre-commit, and CI call. **just stays the interface; mise is only for tools/env.** |
| What env / IO? | `fnox.toml` (project-owned secret references, never plaintext or encrypted blobs in git) importing `.config/fnox/provider.toml` (base-owned Bitwarden provider). Secrets are injected only into live commands via `fnox exec -- <cmd>` (Phase 9 / part8). Inputs in `data/`, outputs in `out/`, both gitignored. |
| How do agents behave? | Committed `AGENTS.md` (≤40 lines: verbs, rules agents break, links to `.agents/archetype.md`, `.agents/project.md`, `.agents/skills/`), with `CLAUDE.md -> AGENTS.md` symlink. `.agent-profile.md` stays personal and ignored. |
| How trusted is it? | Per-repo `.agents/sandbox.toml` + `.omp/permissions.json`, consumed by Phase 10. |

| Change | Files |
|---|---|
| Separate public template repos `copier-base` and archetypes (`copier-infra-ops`, later `copier-python`, `copier-typescript`, `copier-embedded-kicad`, `copier-mcp-frontend`); see [part8-secrets-and-templates.md](part8-secrets-and-templates.md). Every file is owned by exactly one layer or seeded once via `_skip_if_exists`. | `~/projects/templates/copier-base`, `~/projects/templates/copier-infra-ops` |
| Company overlays as **separate private copier templates**, one repo per company, applied as a third layer (`.copier-answers.<company>.yml`). Base answers `secrets_folder` and `bw_profile` from `~/.config/mydotfiles/companies.toml`; the private overlay adds only company-only files (`CODEOWNERS`, company CI, extra agent rules). | external private repos; `~/.config/mydotfiles/companies.toml` |
| Add `uv` (`aqua:astral-sh/uv`), `yq` (`aqua:mikefarah/yq`), and `copier` (`pipx:copier`, workstation profile only) via mise | `dot_config/mise/config.toml.tmpl`, `.chezmoidata.toml` |
| Global recipes in `dot_justfile`: `just -g new <dir> [--archetype <name>] [--company <name>]`, `just -g adopt [--archetype <name>] [--company <name>]`, `just -g sync-template`, and `just -g dev-clone` (clones template repos into `~/projects/templates/<name>`) | `dot_justfile`, `docs/how-to/start-a-project.md` |
| Global agent rule: "in any repo, discover verbs via `just --list`; `just check` before reporting done" | `.chezmoitemplates/agent-core.md` |

**Acceptance criteria:** `just -g new /tmp/demo --archetype infra-ops` produces a repo where `just check` passes on first run. Changing a template tag and running `just -g sync-template` updates the target repo cleanly without clobbering `_skip_if_exists` files.
**Verify:** see [part8-secrets-and-templates.md](part8-secrets-and-templates.md) WP2–WP5.

---

## Phase 9: Secrets hardening (fnox + rbw; prerequisite for sandbox)
**Branch:** `feat/fnox-rbw-secrets`

> **Superseded in detail by [part8-secrets-and-templates.md](part8-secrets-and-templates.md) (WP1).** Summary of the settled design:

Decisions: **fnox + Bitwarden Password Manager (`rbw` backend on Linux/WSL, `bw` on Windows)** for per-project secrets; no secrets or SOPS files in git. **Global agent keys keep `~/.config/agent-secrets.env` auto-sourcing for now** (using `rbwFields` on Linux/WSL and `bitwardenFields` on Windows) with the locked-vault wipe fixed; moving global keys to fnox's global config is tracked in part8 WP6.

| Change | Files |
|---|---|
| Install `fnox` (`github:jdx/fnox`, all profiles), `rbw` (`github:doy/rbw` on Linux/WSL + `pinentry-curses` via apt), and `bw` (`aqua:bitwarden/clients` on Windows) via mise | `.chezmoidata.toml`, `dot_config/mise/config.toml.tmpl`, `.chezmoiscripts/run_onchange_after_install-packages.sh.tmpl` |
| Fix the locked-vault wipe and unify Linux on `rbw`: update `dot_config/private_agent-secrets.env.tmpl` to use `rbwFields "ai-agent-keys"` on Linux/WSL (`bitwardenFields "item" "ai-agent-keys"` on Windows), and gate `.config/agent-secrets.env` in `.chezmoiignore` when the vault is locked (`rbw unlocked` on Linux/WSL, `BW_SESSION` on Windows) so `chezmoi apply` leaves the existing file untouched | `.chezmoiignore`, `dot_config/private_agent-secrets.env.tmpl` |
| Per-project convention: Bitwarden **folder** = `<org>` (`proj` for personal, `<company>` for work), **item** = `<repo>`, **custom fields** = env var names. `.config/fnox/provider.toml` (base-owned) configures the Bitwarden provider; `fnox.toml` (project-owned) declares secret references and runs with `env = "exec"` and `if_missing = "error"` via `fnox exec -- <cmd>` | `copier-base` template (`part8` WP3) |
| `just -g doctor`: report `fnox --version`, `rbw unlocked` status (or `bw` on Windows), and `fnox doctor` when inside a repo with `fnox.toml` | `dot_justfile` |
| ADR 0005 (`fnox` + `rbw` secrets) and `docs/explanation/security-model.md` | `docs/adr/0005-fnox-rbw-secrets.md`, `docs/explanation/security-model.md` |

**Verify:** see [part8-secrets-and-templates.md](part8-secrets-and-templates.md) WP1.

---

## Phase 10: Sandbox profiles (to be designed)
**Branch:** `feat/sandbox-profiles`

Scope for the next discussion:
- **Evaluate `fnox proxy run --sandbox` with `[proxy] egress = "strict"` first** (reading `.agents/sandbox.toml` `allow_domains` and `allow_private`, and injecting secrets via `[[proxy.rules]]` so the sandboxed process never sees raw secret values) before building a custom `bwrap` launcher.
- Known gaps in today's `just -g omp-sandbox` to address if/where `bwrap` is used:
  - `--ro-bind / /` exposes `~/.ssh`, `~/.config/agent-secrets.env`, browser profiles, and `/mnt/c` read-only. Switch to an allowlist: system dirs (`/usr`, `/etc` subset, `/lib*`), mise installs, the repo, and per-tool state dirs.
  - No `--clearenv`: `BW_SESSION`, every agent key, and `SSH_AUTH_SOCK` are inherited. Pass through an explicit env list, plus project secrets via `fnox`.
  - No `--unshare-*`: network, pid, and ipc are shared. Default to `--unshare-all` and gate network access via `.agents/sandbox.toml`.
  - Profile source: `.agents/sandbox.toml` (seeded by `copier-base` in Phase 8 / part8) consumed across omp, agy, Claude Code, and Devin.
  - Once in place, revisit `docs/debt.md` #1 (`command-guard/`) and the Phase 7 trust tier.

---

## Open questions

1. **OS targets / environments:** confirm the assumption, or add macOS, servers or devcontainers (this changes Phase 3 scope).
2. **Devin:** which global rules location do you use (Devin CLI, desktop, or web knowledge)? This decides the Phase 1 target.
3. ~~Bitwarden CLI (`bw` vs `rbw`)~~: **resolved** — `rbw` on Linux/WSL (`github:doy/rbw` + `pinentry-curses`), `bw` on Windows (`aqua:bitwarden/clients`), managed with `fnox` for project secrets (see [part8](part8-secrets-and-templates.md)).
4. **MCP:** start with none, or GitHub plus a docs server?
5. **Execution:** run each work package from its repo root in a worktree (`just -g worktree-new <branch>`), following the specs in [part8-secrets-and-templates.md](part8-secrets-and-templates.md).
6. ~~Copier template location~~, 7. ~~Bitwarden item naming~~, 8. ~~Dev-context checkout~~, 9. ~~Company overlays~~: all decided below.
10. ~~Copier `_subdirectory` + `copier update` from a repo shared with dotfiles~~: **resolved: one repo per template** (`copier-base`, `copier-infra-ops`, etc., tagged with PEP 440 tags `v0.1.0`; see [part8-secrets-and-templates.md](part8-secrets-and-templates.md)).

### Decided (updated 2026-11-01; see [part8-secrets-and-templates.md](part8-secrets-and-templates.md))
- Scaffolding: **copier** with **one public git repo per template** (`copier-base` underlay + archetype repos like `copier-infra-ops`), cloned to `~/projects/templates/<name>` on workstations via `just -g dev-clone`.
- Task runner: **just** stays the per-repo interface (`justfile` importing `project.just`, `archetype.just`, and `.config/just/base.just`); mise is only for tools/env (`mise.toml` + `.config/mise/conf.d/<archetype>.toml`).
- Per-project secrets: **fnox + Bitwarden Password Manager** (`rbw` backend on Linux/WSL, `bw` on Windows), injected at command execution via `fnox exec -- <cmd>` (`env = "exec"`, `if_missing = "error"`). No secrets or SOPS files in git.
- Vault layout: **folder `<org>`, item `<repo>`, custom fields = env var names** (`org` = `proj` for personal projects, `<company>` for employer work).
- Global agent keys: **keep `~/.config/agent-secrets.env` auto-sourcing for now** (using `rbwFields` on Linux/WSL, `bitwardenFields` on Windows, with `.chezmoiignore` protecting against locked-vault wipes); migrating global keys to fnox's global config is a WP6 follow-up.
- Layout: **`.chezmoiroot = home` is optional tidying** (no longer blocks templates since templates live in separate git repos).
- Company-specific template info: base answers `secrets_folder` and `bw_profile` from unmanaged `~/.config/mydotfiles/companies.toml`; **separate private copier overlay templates** add only company-owned files (`CODEOWNERS`, company CI, extra agent rules).
---

## Day to day once these phases land

**New machine.** Run `bootstrap.sh` or `bootstrap.ps1` and answer the profile prompt. A workstation gets the full checkout (templates, docs, copier, agents, fonts). A server or ephemeral box gets a partial clone of `home/` only: shell, git, rg/fd, prompt, no agents. After that, `just update` keeps it current. Renovate opens PRs for pin bumps, CI tests them, and you merge them.

**Starting a project.** `just -g new ~/projects/foo --archetype infra-ops` applies `copier-base` and `copier-infra-ops`. Add `--company acme` to populate company vault settings and layer the private overlay. The result has the same shape every time: `mise.toml`, a layered `justfile` (`project.just` > `archetype.just` > `.config/just/base.just`) with `setup/check/test/fmt/lint/smoke/doctor`, a committed `AGENTS.md` (`CLAUDE.md` symlink), `fnox.toml` + `.config/fnox/provider.toml`, pre-commit, a CI workflow that runs `just check`, and `docs/adr/`. Existing repos are brought in line with `just -g adopt --archetype <name>`.

**Switching projects.** When you `cd` into a repo, mise switches toolchains (`mise.toml` + `.config/mise/conf.d/*.toml`). `just --list` shows the same verbs everywhere. You never need to remember whether a project is npm, uv, or cargo, because `just check` is the answer in all of them. `just -g sync-template` pulls convention changes into older repos across all `.copier-answers*.yml` layers as a reviewable diff.

**Secrets.** Day to day nothing changes for global agent keys (and `chezmoi apply` with a locked vault never wipes them). Project secrets live in Bitwarden under folder `<org>`, item `<repo>` and only enter a process through `fnox exec -- <cmd>` (wrapped inside live `just` recipes like `plan`, `site`, `bootstrap`). They are never written to disk, committed to git, or exported to your interactive shell.

**Agents.** Every harness (omp, agy, Claude Code, Devin) reads the same rendered core rules, the same skills directory, and the repo's `AGENTS.md`. Work follows plan → `.agent-spec.md` → worktree → `just check`. Unfamiliar or infra-touching repos run inside the bwrap launcher, which gives the agent only the repo, its own state, the project's secrets, and the network the repo's sandbox profile allows.

**Maintenance.** `just -g doctor` reports pin drift, chezmoi status, whether the rendered rules are fresh, and the profile summary. Debt has one home (`docs/debt.md`) and decisions have another (`docs/adr/`).

---

## After the roadmap: distributed-systems / platform-engineering practice

### Recommendation: return to `thinkcenter-cluster`, but don't wait for every phase

The dotfiles are now good enough that more polish has diminishing returns, and none of it builds distributed-systems experience. Do the minimum that makes the cluster the **first real consumer** of these conventions, then switch:

1. **Must do first:** Execute [part8-secrets-and-templates.md](part8-secrets-and-templates.md) WP1 (`fnox` + `rbw` + locked-vault fix) → WP2 (`new` / `adopt` / `sync-template` / `dev-clone`) → WP3 (`copier-base` v0.1.0) → WP4 (`copier-infra-ops` v0.1.0) → WP5 (adopt in `thinkcenter-cluster`).
2. **Do alongside the cluster:** Phase 10 (`fnox proxy run --sandbox` / `bwrap` consuming `.agents/sandbox.toml`). Agents that can reach `192.168.50.0/24` and run Ansible against live nodes are exactly the case the sandbox profile exists for, so design it against that real need.
3. **Do opportunistically:** docs generation, markdownlint/lychee, Renovate grouping, the remaining part4 toolset gaps, Phase 7's trust tier, optional Phase 7.5 `.chezmoiroot`.

### What adopting the conventions means for `thinkcenter-cluster` (as of `dbd142c`)
- **Full audit and step-by-step adoption spec:** see [part8-secrets-and-templates.md § Audit and WP5](part8-secrets-and-templates.md).
- **Summary:** apply `copier-base` + `copier-infra-ops` via `just -g adopt --archetype infra-ops`. Replace SOPS + age with `fnox` + `rbw` (Bitwarden folder `proj`, item `thinkcenter-cluster`, custom fields `PROXMOX_ROOT_PASSWORD`, `PROXMOX_API_TOKEN_ID`, `PROXMOX_API_TOKEN_SECRET`, read via `lookup('env', ...)` in Ansible and wrapped with `fnox exec --` in live `just` verbs). Split `.agents/AGENTS.md` into root `AGENTS.md`, `.agents/project.md`, `docs/adr/0001-0010`, and `docs/investigations/pxe-uefi.md`. Harden `ansible.cfg` (`host_key_checking = True` with manifest-generated `known_hosts`) and move CI `check` onto GitHub-hosted runners.
### Getting unstuck: PXE is a side quest
PXE plus an initrd-embedded ISO is boot plumbing, not distributed systems. Time-box it. If it isn't working after one more session, install from USB with the same answer file (`proxmox-auto-install-assistant prepare-iso --fetch-from http` against the existing nginx answer endpoint), get all three nodes into Ansible, and come back to PXE later as its own task. The learning starts once corosync and Ceph are up.

### Learning path (each stage ends with a written runbook or postmortem in `docs/`)

| Stage | Build | Distributed-systems concept you'll actually hit |
|---|---|---|
| 1. Cluster formation | `site.yml` to green on 3 nodes; corosync 2 rings; Ceph 3 MON + 3 OSD | Quorum (why 3, not 2), membership, replication factor vs. available RAM/disk |
| 2. Failure drills | Pull a mesh cable, pull a node, fill an OSD, kill a MON. Use `tc netem` on cluster links for latency/loss | OSPF reconvergence, corosync token timeouts, Ceph degraded → recovery/backfill, split-brain prevention, recovery-time budgets |
| 3. Observability | Prometheus + Grafana + Loki (pve/node/ceph exporters), alerting, 2–3 SLOs | The metrics/logs/traces split, SLIs vs. symptoms, alert fatigue |
| 4. IaC for workloads | Terraform `bpg/proxmox` provider for VMs/templates; cloud-init; CI plan on PR, apply via a gated job on the self-hosted runner | Declarative reconciliation, drift, state locking |
| 5. Kubernetes on top | Talos (or k3s) with 3 control-plane VMs, Ceph CSI (external Rook) for PVs, Cilium, cert-manager, external-secrets, Argo CD/Flux GitOps | etcd quorum *on top of* corosync quorum (failure-domain thinking), controllers/reconcile loops, CSI/CNI |
| 6. Stateful distributed workloads | CloudNativePG (replicated Postgres), NATS JetStream or Redpanda, Chaos Mesh experiments | Leader election, replication lag, consistency vs. availability under partition, idempotent consumers |
| 7. Platform layer | A copier "service" template that deploys to the cluster (Dockerfile, k8s manifests/Helm, CI, SLO dashboard stub), so the golden path is something you built | Platform-as-product: paved roads, self-service, guardrails |

**Constraints to plan around:** 32 GB total RAM, with Ceph and ZFS ARC taking a share, makes 3 control-plane VMs plus workers tight. Keep Talos/k3s nodes small, or run control planes on `pve01`'s headroom and accept a less even failure domain for a while (and write that tradeoff down as an ADR). The 1G shared management NIC limits VM and Ceph public traffic until the Mikrotik VLAN phase.

**Reading alongside:** *Designing Data-Intensive Applications* (Kleppmann) for stages 2 and 6, and the Google *SRE* book's chapters on SLOs and postmortems for stages 3 and 7.
