# Part 8: Secrets (fnox + rbw) and layered copier templates — MVP for `thinkcenter-cluster`

> **Handoff note (updated 2026-11-01):** All design decisions and "Verify first" items have been verified locally and against upstream releases. This file supersedes the detail of part5 Phases 8 and 9; `part4-review.md` and `part5-platform-roadmap.md` have been aligned (WP0 complete). Every Work Package below is written with explicit pins and copy-pasteable skeletons so a smaller coding model (e.g., SWE-2 / Gemini Flash / Sonic) can execute each WP mechanically.

## Goals

1. **Primary:** best practices that cost little effort to follow. One repo (`mydotfiles`) onboards any workstation or server, and it spawns new repos from layered templates that carry the same conventions.
2. **Secondary:** AI-first features in every project, so switching between projects is seamless for you and for every agent harness (omp, agy, Claude Code, Devin).
3. **Portfolio:** the templates and the repos built from them show what a platform engineer brings: golden paths, secrets hygiene, reproducible tooling, agent-ready repos.
4. **Not a goal:** keeping a convention just because a repo already has it. Every convention adopted from `thinkcenter-cluster` was judged on its merits (see "Audit").

## Decisions (settled)

| Topic | Decision | Why |
|---|---|---|
| Template hosting | **One template = one public git repo**: `copier-base`, `copier-infra-ops`. Later archetypes (`copier-embedded-kicad`, `copier-mcp-frontend`, `copier-python`, `copier-typescript`) are their own repos | Copier docs: "1 template = 1 Git repository". `copier update` versions from git tags, which are repo-wide |
| Template dev workflow | Workstations clone the templates into `~/projects/templates/<name>` via `just -g dev-clone`. **No submodule** | `chezmoi init` recurses submodules by default (`--recurse-submodules` defaults to `true`), so servers would download them. A submodule also needs a pin bump on every template change |
| Layering | `copier-base` is the underlay for every project. An archetype layers on top with its own answers file. A company overlay is a third, private layer | Copier supports several templates per project, one `-a .copier-answers.<name>.yml` each |
| File ownership | **Every file is owned by exactly one layer.** The base provides extension points (see table below). A project owns files that are seeded once (`_skip_if_exists`) | Copier layers can't merge files. A later layer overwrites, and the next base update clobbers it back |
| Secrets in git | **None.** No sops and no encrypted files. Repos commit only *references* (`fnox.toml`) | Your decision. Less key management; secrets live in one vault |
| Secrets tooling | **fnox** (by jdx, the mise author) with the **Bitwarden Password Manager** provider, `rbw` backend | Free with unlimited items and folders, uses your existing account, and agent-friendly (the rbw agent keeps the vault unlocked). The Bitwarden Secrets Manager free plan is capped at 3 projects / 3 machine accounts |
| Upgrade path | Changing provider (Bitwarden Secrets Manager Teams, Infisical, 1Password, …) is a change to `.config/fnox/provider.toml` in the base template. Each project's secret names stay the same | fnox is provider-agnostic |
| Vault layout | Bitwarden **folder** = org (`proj` for personal, `<company>` for employer work). **Item** = repo slug. **Custom fields** = env var names | fnox references are `<item>/<field>`, and item names can't contain `/`, so the org goes in the folder |
| Injection | `fnox exec -- <cmd>`, with `env = "exec"` so secrets never enter the interactive shell. `if_missing = "error"` | Secrets reach only the process that needs them |
| Global agent keys | **Keep `~/.config/agent-secrets.env` auto-sourcing for now**, unified on `rbw` (`rbwFields`) on Linux/WSL and `bw` (`bitwardenFields`) on Windows, with `.chezmoiignore` preventing locked-vault wipes (WP1). Moving global agent keys to fnox's global config is WP6 | |
| Company specifics | Base answers `secrets_folder` and `bw_profile` (company → `folder = "<company>"`, `profile = "<company>"` → `RBW_PROFILE`). The private overlay adds only company-only files (CODEOWNERS, company CI, extra agent rules). The company → URL/folder/profile map lives in an unmanaged `~/.config/mydotfiles/companies.toml` | No employer names in public repos, and no files shared between layers |
| `.chezmoiroot` (part5 P7.5) | **Demoted to optional tidying.** Templates no longer live in this repo, so there's nothing dev-only to hide from servers | |

## Verified (upstream docs + local CLI verification, 2026-11-01)

- **Copier 9.19.1** (`copier.readthedocs.io/en/stable/configuring/`, tested locally via `pipx:copier@9.19.1`):
  - `_subdirectory: template` separates template metadata from template code. It is not meant for multiple templates in one repo.
  - Multiple templates per project are supported via `copier copy -a .copier-answers.<x>.yml` and `copier update -a .copier-answers.<x>.yml --skip-answered` (`-A`).
  - **Answers file requirement:** every template's `template/` directory **must** include `{{ _copier_conf.answers_file }}.jinja` containing `{{ _copier_answers|to_nice_yaml }}`—otherwise Copier never writes `.copier-answers.<layer>.yml` and `copier update` fails.
  - **Symlink preservation:** `_preserve_symlinks: true` **must** be set in `copier.yml` when `template/CLAUDE.md` is a symlink to `AGENTS.md`. With Copier's default (`_preserve_symlinks: false`), Copier tries to dereference `template/CLAUDE.md -> template/AGENTS.md` inside the source tree before rendering `.jinja`, crashing with `FileNotFoundError`.
  - **`_skip_if_exists` on update:** verified that `_skip_if_exists` skips project-owned files on **both** `copier copy` and `copier update` even when the template's version of that file changes between tags.
  - **`gh:` shortcut:** verified `copier._vcs.get_repo("gh:AmazingHorse/copier-base")` expands natively to `https://github.com/AmazingHorse/copier-base.git`.
  - Without `--vcs-ref`, copier uses the latest **PEP 440 tag**, so templates must be tagged (`v0.1.0`).
- **chezmoi:** `init --recurse-submodules` defaults to `true`. chezmoi has `rbw` / `rbwFields` (invokes `rbw get --raw <item>`) and `bitwarden` / `bitwardenFields` template functions.
- **Bitwarden Secrets Manager:** the free plan has 2 users, 3 projects and 3 machine accounts; Teams has unlimited projects. `bws run --project-id --no-inherit-env -- cmd` exists. Kept only as a future provider.
- **fnox v1.45.0** (`fnox.jdx.dev`, tested locally):
  - **Config load order:** global `~/.config/fnox/config.toml`, then for each directory from root down: `fnox.toml` / `.fnox.toml` / `.config/fnox.toml`, then `fnox.<profile>.toml`, then `fnox.local.toml` (never commit). `root = true` stops the upward search.
  - **Top-level config fields:** `import` (array; relative paths resolve against the declaring file), `env` (`true` / `"exec"` / `false`), `if_missing` (`error` / `warn` / `ignore`), `default_provider`, `profiles`, `proxy`, `mcp`, `daemon`.
  - **`import` & secret syntax quirk (verified):** `import = [".config/fnox/provider.toml"]` carries `[providers.vault]` into `fnox.toml` (`fnox config-files` and `fnox provider list` both list `vault (bitwarden)`). However, if a secret entry omits `provider = "vault"` (writing only `{ value = "slug/KEY" }`), `fnox list` and `fnox doctor` misreport it as `stored value` / `provider: plain` even though `fnox exec` and `fnox check` use `default_provider`. **Always write `{ provider = "vault", value = "slug/KEY" }` in `[secrets]`** so `list`, `doctor`, `check`, `get`, and `exec` all agree.
  - **Bitwarden `rbw` backend (verified):** `type = "bitwarden"`, `backend = "rbw"` invokes `rbw get <item> --field <field> --folder <folder>` (with `RBW_PROFILE=<profile>` when `profile` is set), which matches `rbw 1.15.0`'s exact CLI flags. On Windows (where `rbw` is unsupported), `backend = "bw"` uses `BW_SESSION`.
  - **CLI:** `exec`, `get`, `list`, `check [-a]`, `doctor`, `config-files`, `provider list`, `provider test`, `scan`, `proxy run [--sandbox]`, `mcp`, `--no-daemon`, `--if-missing`.
  - **`[proxy]`:** `egress = "strict"`, `allow_domains`, `allow_private`, and `[[proxy.rules]]` that inject a secret into requests for a matching domain/method/path, so the process never sees the value (candidate for part5 Phase 10).
- **rbw install route on Linux/WSL (verified):**
  - Ubuntu 24.04 (`noble`) apt does **not** package `rbw` (`apt-cache policy rbw` is empty).
  - `"github:doy/rbw"` (`1.15.0`) installs cleanly via mise from `rbw_1.15.0_linux_amd64.tar.gz` and bundles **both** `rbw` and `rbw-agent`.
  - `rbw unlock` requires a `pinentry` binary on Linux/WSL (`pinentry-curses` from apt).
  - Because `doy/rbw` publishes only Linux and macOS tarballs, gate `"github:doy/rbw"` with `{{ if ne .chezmoi.os "windows" }}` in `dot_config/mise/config.toml.tmpl`, and install `"aqua:bitwarden/clients"` (`bw`) on Windows (`{{ if eq .chezmoi.os "windows" }}`).
- **mise registry & `.config/mise/conf.d/*.toml` (verified):**
  - `pipx:*` packages in mise (`pipx:copier`, `pipx:ansible-core`, `pipx:ansible-lint`, `pipx:yamllint`) **require `uv` (`aqua:astral-sh/uv`) or `pipx` to be installed first** (`mise` uses `uvx` automatically when `uv` is present).
  - `ansible-lint` is not in the mise short registry; specify `"pipx:ansible-lint"` explicitly.
  - Verified `mise cfg` and `mise ls --current` automatically load `.config/mise/conf.d/<archetype>.toml` alongside `mise.toml` in a project directory.
- **Release ages ≥ 7 days old as of 2026-11-01 (verified):**
  - `fnox` (`github:jdx/fnox`): `1.45.0` (published `2026-10-16`)
  - `rbw` (`github:doy/rbw`): `1.15.0` (published `2026-03-04`)
  - `bw` (`aqua:bitwarden/clients`): `2026.10.0` (published `2026-10-15`, tag `cli-v2026.10.0`)
  - `copier` (`pipx:copier`): `9.19.1` (published `2026-08-29`)
  - `uv` (`aqua:astral-sh/uv`): `0.13.5` (published `2026-10-22`)
  - `yq` (`aqua:mikefarah/yq`): `4.54.1` (published `2026-09-29`)
- **just 1.58.0 `import?`, `allow-duplicate-recipes`, and `[arg]` (verified):**
  - In `just 1.58.0`, recipes defined in the root `justfile` **always** override recipes in `import`ed files, and **earlier** `import` statements override **later** `import` statements.
  - Therefore, `copier-base` puts only settings, `default: @just --list`, and `import? 'project.just'`, `import? 'archetype.just'`, `import '.config/just/base.just'` in root `justfile`, and places the base fallback recipes (`setup`, `check`, `lint`, `test`, `fmt`, `smoke`, `doctor`) in `.config/just/base.just`. That gives exact `project.just` > `archetype.just` > `.config/just/base.just` override priority.
  - `just 1.58.0` supports `[arg("archetype", long="archetype")]` and `[arg("company", long="company")]`, enabling `just -g new <dir> [--archetype <name>] [--company <name>]`.

## Architecture

```text
mydotfiles (this repo)                         ~/projects/templates/ (workstation only, via just -g dev-clone)
  home: fnox, copier, rbw via mise               copier-base        (public, tagged)  ← underlay for every project
  just -g new | adopt | sync-template | dev-clone copier-infra-ops   (public, tagged)  ← archetype
  .chezmoidata.toml [templates] URLs             <company>-overlay  (private, per employer, URL in companies.toml)
            │
            ▼  just -g new ~/projects/foo --archetype infra-ops [--company acme]
project repo
  .copier-answers.base.yml  .copier-answers.infra-ops.yml  [.copier-answers.<company>.yml]
  fnox.toml (project-owned refs) → .config/fnox/provider.toml (base-owned) → Bitwarden folder/item/field
```

### File ownership and extension points

| Concern | `copier-base` owns | Archetype owns | Project owns (seeded once via `_skip_if_exists`) |
|---|---|---|---|
| Tasks | `justfile` (settings, `default`, `import? 'project.just'`, `import? 'archetype.just'`, `import '.config/just/base.just'`) + `.config/just/base.just` (`setup check test fmt lint smoke doctor`) | `archetype.just` (overrides `check`/`lint`/`fmt`/`test` bodies, adds archetype verbs) | `project.just` |
| Tools | `mise.toml` (core: `fnox`, `just`, `pre-commit`, `actionlint`, `shfmt`) | `.config/mise/conf.d/<archetype>.toml` (verified: mise loads `.config/mise/conf.d/*.toml` automatically) | `mise.local.toml` (gitignored) |
| Secrets | `.config/fnox/provider.toml` | (none) | `fnox.toml` (`[secrets]` refs) |
| Agent context | `AGENTS.md` (universal rules + verb table + a link to `.agents/archetype.md`), `CLAUDE.md` → `AGENTS.md` symlink | `.agents/archetype.md`, `.agents/skills/<archetype>-*/SKILL.md` | `.agents/project.md` (layout, gotchas), `.agents/skills/<project>-*` |
| Sandbox intent | `.agents/sandbox.toml` schema + defaults | (none) | values inside it, seeded once |
| Agent permissions | `.omp/permissions.json` (allow standard verbs; ask `run`/`smoke`) | (none; extend via project) | (seeded once, so the project can add denies like `just site`) |
| Gate | `.pre-commit-config.yaml` (betterleaks, check-yaml, end-of-file, trailing-whitespace, local hook `just lint`), `.github/workflows/ci.yml` (`jdx/mise-action` → `just check`, actions pinned by SHA, GitHub-hosted runners) | (none; extend `just check`) | (none) |
| Ignores | `.gitignore` (generic + `.scratch/`, `fnox.local.toml`, `mise.local.toml`, `.env`, `data/`, `out/`, `.agent-spec.md`, `.agent-profile.md`) | per-directory `.gitignore` (`ansible/.gitignore`, `terraform/.gitignore`) | (none) |
| Docs | `docs/adr/0000-template.md`, `docs/debt.md`, `.github/pull_request_template.md` (What / Tested / AI-assisted), `.editorconfig`, `CONTRIBUTING.md` | `docs/runbooks/README.md` (infra-ops) | `README.md`, `docs/adr/0001+` |

**Base copier questions:** `project_name`, `project_slug` (validator `^[a-z][a-z0-9-]+$`), `description`, `owner` (default `AmazingHorse`), `license` (`MIT`/`none`), `secrets_folder` (default `proj`), `bw_profile` (default empty), `bw_backend` (`rbw`/`bw`, default `rbw`), `ci` (bool, default true). `_answers_file: .copier-answers.base.yml`.

**Infra-ops questions:** `iac` (multiselect: `ansible`, `opentofu`), `live_targets` (str, CIDR, used for `sandbox.toml` and AGENTS.md safety rules). `_answers_file: .copier-answers.infra-ops.yml`.

### Key file contents (authoritative skeletons)

`copier-base/template/.config/fnox/provider.toml.jinja`:
```toml
#:schema https://fnox.jdx.dev/schema.json
[providers.vault]
type = "bitwarden"
backend = "{{ bw_backend }}"
folder = "{{ secrets_folder }}"
{% if bw_backend == "rbw" %}auth_command = "rbw unlock"
{% endif %}{% if bw_profile %}profile = "{{ bw_profile }}"
{% endif %}
```

`copier-base/template/fnox.toml.jinja` (listed in `_skip_if_exists`):
```toml
#:schema https://fnox.jdx.dev/schema.json
root = true
import = [".config/fnox/provider.toml"]
default_provider = "vault"
env = "exec"
if_missing = "error"

[secrets]
# Bitwarden: folder "{{ secrets_folder }}", item "{{ project_slug }}", one custom field per variable.
# Always include `provider = "vault"` so `fnox list` and `fnox doctor` match `fnox exec`/`fnox check`.
# EXAMPLE_TOKEN = { provider = "vault", value = "{{ project_slug }}/EXAMPLE_TOKEN" }
```

`copier-base/template/{{ _copier_conf.answers_file }}.jinja`:
```yaml
# Changes here will be overwritten by Copier; NEVER EDIT MANUALLY
{{ _copier_answers|to_nice_yaml }}
```

`copier-base/template/justfile.jinja`:
```just
set shell := ["bash", "-euo", "pipefail", "-c"]
set allow-duplicate-recipes
set positional-arguments

default:
    @just --list

# Earlier imports win in just 1.58: project > archetype > base.
import? 'project.just'
import? 'archetype.just'
import '.config/just/base.just'
```

`copier-base/template/.config/just/base.just`:
```just
# Install pinned tools and git hooks.
setup:
    mise install
    pre-commit install

# Fast, offline, deterministic gate used by agents, pre-commit and CI. Must not need secrets.
check: lint test

lint:
    pre-commit run --all-files

test:
    @echo "test: n/a"

fmt:
    @echo "fmt: n/a"

# Live checks against real systems; never run in CI.
smoke:
    @echo "smoke: n/a"

# Report tool versions and which declared secrets resolve (names only, never values).
doctor:
    mise doctor
    fnox check || true
```
Rule: secrets are only used by recipes that touch live systems, which wrap the command in `fnox exec --`. `check` must pass with no vault access, on CI.

`copier-base/template/mise.toml`:
```toml
[tools]
"github:jdx/fnox" = "1.45.0"
"aqua:casey/just" = "1.58.0"
"aqua:pre-commit/pre-commit" = "4.7.0"
"aqua:rhysd/actionlint" = "1.7.12"
"aqua:mvdan/sh" = "3.14.1"
```

`copier-base/template/.agents/sandbox.toml.jinja` (intent only until part5 Phase 10 consumes it):
```toml
# Consumed by the agent sandbox launcher (part5 Phase 10). Until then: documentation of intent.
network = "none"            # none | allowlist | full
allow_domains = []
allow_private = []          # CIDRs, e.g. live targets
extra_rw_paths = []
secrets = "fnox"            # secrets reach the sandbox only via fnox exec / fnox proxy rules
```

`copier-base/template/AGENTS.md.jinja` (keep to ≤40 rendered lines):
```markdown
# {{ project_name }}

{{ description }}

## Commands
| Verb | Purpose |
|---|---|
| `just setup` | Install pinned tools (mise) and git hooks |
| `just check` | The gate: run before reporting done. Offline, no secrets |
| `just smoke` | Live checks; ask the user before running |
| `just doctor` | Tool versions + which secrets resolve |
Run `just --list` for project-specific verbs.

## Rules agents break
1. Never print, log, or commit secret values. Secrets come only from `fnox exec -- <cmd>`.
2. Never run recipes that touch live systems (`smoke`, deploy/apply verbs) without explicit user approval.
3. Decisions go in `docs/adr/`, known gaps in `docs/debt.md`, plans in `plans/` or the PR. Never use this file as a scratchpad.
4. Conventional Commits. Touch only files related to the task.

## More context
- Archetype conventions: `.agents/archetype.md`
- Project layout and gotchas: `.agents/project.md`
- Repo-specific procedures: `.agents/skills/`
```

## Audit: `thinkcenter-cluster` conventions (`dbd142c`) and what the templates do instead

| Today | Verdict | Template / adoption action |
|---|---|---|
| `cluster-manifest.yml` as the single source of truth, numbered playbooks, `docs/runbook.md`, `docs/design.md` | **Keep.** Good practice | infra-ops `.agents/archetype.md`: "manifest-driven; runbook per operation" |
| sops + age, with `vault.sops.yaml.example` saying "do NOT commit vault.sops.yaml" and a placeholder key in `.sops.yaml` | **Drop** (secrets out of git) | Remove `.sops.yaml` and `ansible/secrets/`. Ansible reads `lookup('env', 'PROXMOX_ROOT_PASSWORD')` etc. Live verbs (`site`, `bootstrap`) run through `fnox exec --` |
| CI `runs-on: self-hosted` on `pull_request` for a public repo | **Security hole:** fork PRs run code on a LAN machine | GitHub-hosted runners only for the `check` CI. Self-hosted only for future gated apply jobs (environment protection, no fork PRs) |
| CI downloads `sops-v3.x.linux.amd64` (that URL doesn't exist), unpinned `pip install`, `checkout@v4` | **Broken, not reproducible** | Base CI: `jdx/mise-action` + `just check`, actions pinned by SHA |
| `ansible.cfg`: `host_key_checking = False`, `stdout_callback = yaml`, `collections_paths` | **Insecure / deprecated** | `host_key_checking = True` with a managed `known_hosts` (from the manifest), `callback_result_format = yaml`, `collections_path`, plus `requirements.yml` pinning collections |
| No `mise.toml`, tools assumed on the host | **Not reproducible** | infra-ops `.config/mise/conf.d/infra-ops.toml`: `"pipx:ansible-core"`, `"pipx:ansible-lint"`, `"pipx:yamllint"`, `"aqua:opentofu/opentofu"` |
| `just test` hits live endpoints; no `check` | **No safe gate** | Move to `project.just` as `smoke-boot`. `check` = yamllint + ansible-lint + `ansible-playbook --syntax-check` |
| `.agents/AGENTS.md` (hidden, includes a stale matchbox file map, a "do not re-debate" decision table, and ~40 lines of PXE debugging) | **Mis-scoped** | Root `AGENTS.md` (base). Decision table → `docs/adr/0001-0010`. PXE notes → `docs/investigations/pxe-uefi.md`. Fix the file map (nginx, not matchbox) in `.agents/project.md` |
| "Agent: don't run commands on the host" lives in the scratchpad | **Unenforced** | `.omp/permissions.json` project denies (`just up`, `just site`, `just bootstrap`, `docker compose`, `ansible-playbook` without `--syntax-check`/`--check`) + `sandbox.toml` |
| `fetch_assets_justfile_plan.md` at the repo root | **Clutter** | Move to `plans/` |
| `terraform/` stub | **Keep, but rename** | `opentofu` per the dotfiles toolset. Keep it as a stub |

## Work packages (each is an omp-ready spec; run omp from the named repo root)

Order: WP0 (done) → WP1 (done) → WP1.5 (done) → WP2 (done) → WP3 (done) → WP4 (done) → WP5 (separate repo) → WP6. Each WP = one branch, one PR, Conventional Commits.

### WP0: Align part4 and part5 with this plan (mydotfiles, docs only) — **Done (2026-11-01)**
**Status:** Completed. `plans/part4-review.md` and `plans/part5-platform-roadmap.md` now point to this file and reflect all verified decisions.

### WP1: Dotfiles secrets plumbing (mydotfiles) — **Done (2026-11-01)**
**Branch:** `feat/fnox-rbw-secrets`
**Task:** install `fnox`, `rbw` (Linux/WSL), `bw` (Windows), `uv`, and `yq`; unify Linux global secrets on `rbw`; fix the locked-vault wipe; and add `just -g doctor` secret checks.
**Files:** `.chezmoidata.toml`, `dot_config/mise/config.toml.tmpl`, `.chezmoiscripts/run_onchange_after_install-packages.sh.tmpl`, `.chezmoiignore`, `dot_config/private_agent-secrets.env.tmpl`, `dot_justfile`, `scripts/ci-check.sh`, `docs/adr/0005-fnox-rbw-secrets.md` (new), `docs/explanation/security-model.md` (new)
**Steps:**
1. In `.chezmoidata.toml` under `[packages]`, add these exact pins (all >7 days old):
   ```toml
   # renovate: datasource=github-releases depName=jdx/fnox
   fnox = "1.45.0"
   # renovate: datasource=github-releases depName=doy/rbw
   rbw = "1.15.0"
   # renovate: datasource=github-releases depName=bitwarden/clients extractVersion=^cli-v(?<version>.+)$
   bw = "2026.10.0"
   # renovate: datasource=github-releases depName=astral-sh/uv
   uv = "0.13.5"
   # renovate: datasource=github-releases depName=mikefarah/yq
   yq = "4.54.1"
   ```
2. In `dot_config/mise/config.toml.tmpl`, add under `[tools]` (outside the `workstation` block so `fnox`, `uv`, `yq`, and `rbw` are available on all profiles):
   ```toml
   "github:jdx/fnox" = "{{ .packages.fnox }}"
   "aqua:astral-sh/uv" = "{{ .packages.uv }}"
   "aqua:mikefarah/yq" = "{{ .packages.yq }}"
   {{ if ne .chezmoi.os "windows" -}}
   "github:doy/rbw" = "{{ .packages.rbw }}"
   {{ else -}}
   "aqua:bitwarden/clients" = "{{ .packages.bw }}"
   {{ end -}}
   ```
3. In `.chezmoiscripts/run_onchange_after_install-packages.sh.tmpl`, add `pinentry-curses` to the `apt-get install` package list so `rbw unlock` always has a pinentry helper on Linux/WSL.
4. Unify `dot_config/private_agent-secrets.env.tmpl` on `rbw` (Linux/WSL) and `bw` (Windows):
   ```gotmpl
   # Agent API secrets. Sourced by ~/.config/agent-env.sh.
   # Managed by chezmoi. Local overrides go in ~/.config/agent-env.local.sh.

   {{- if eq .profile "workstation" }}
   {{-   if eq .chezmoi.os "windows" }}
   {{-     if and (lookPath "bw") (env "BW_SESSION") }}
   {{-       range $k, $v := (bitwardenFields "item" "ai-agent-keys") }}
   export {{ $k }}={{ $v.value | quote }}
   {{-       end }}
   {{-     end }}
   {{-   else if and (lookPath "rbw") (eq (output "sh" "-c" "rbw unlocked >/dev/null 2>&1 && echo 1 || true" | trim) "1") }}
   {{-     range $k, $v := (rbwFields "ai-agent-keys") }}
   export {{ $k }}={{ $v.value | quote }}
   {{-     end }}
   {{-   end }}
   {{- end }}
   ```
5. Locked-vault fix in `.chezmoiignore`: append at the bottom of `.chezmoiignore` so an apply with a locked vault leaves `~/.config/agent-secrets.env` untouched:
   ```gotmpl
   {{- $vaultUnlocked := false -}}
   {{- if eq .chezmoi.os "windows" -}}
   {{-   $vaultUnlocked = and (ne (lookPath "bw") "") (ne (env "BW_SESSION") "") -}}
   {{- else if ne (lookPath "rbw") "" -}}
   {{-   $vaultUnlocked = eq (output "sh" "-c" "rbw unlocked >/dev/null 2>&1 && echo 1 || true" | trim) "1" -}}
   {{- end -}}
   {{- if not (and (eq .profile "workstation") $vaultUnlocked) }}
   .config/agent-secrets.env
   {{- end }}
   ```
6. In `dot_justfile` (`doctor` recipe), add a `--- Secrets ---` section that prints `fnox --version` (if installed), `rbw unlocked` status (`unlocked` / `locked`), and runs `fnox doctor` when `./fnox.toml` exists in the current directory.
7. Write `docs/adr/0005-fnox-rbw-secrets.md` (context: bws free-tier limits; decision: fnox + Bitwarden PM via `github:doy/rbw` on Linux/WSL and `bw` on Windows; folder/item/field convention; consequences: no secrets in git, network needed, `provider = "vault"` on each secret entry) and `docs/explanation/security-model.md` (global `agent-secrets.env` vs per-project `fnox exec`, locked-vault protection, and sandbox isolation).
8. In `scripts/ci-check.sh`, add `'github:jdx/fnox'`, `'aqua:astral-sh/uv'`, and `'aqua:mikefarah/yq'` to the `for mise_tool in ...` loop checking `rendered_mise_config`.
**Verification:** `just test-fast`. Interactive workstation smoke test (run by user after `just apply`): `rbw config set email <email> && rbw login && rbw unlock`.
**Out of scope:** moving global agent keys to fnox; the template repos.

### WP1.5: Renovate activation and config hardening (mydotfiles) — **Done (2026-11-01, pending GitHub App install)**
**Branch:** `ci/renovate-hardening`
**Task:** make Renovate PR generation active and CI-clean (including in-place PR updates when newer versions release before merge, 7-day release cooldown, and synchronized `chezmoi` pin updates across `.chezmoidata.toml` and `bootstrap.sh`).
**Files:** `.github/renovate.json`, `bootstrap.sh`, `scripts/ci-check.sh`
**Steps:**
1. In `bootstrap.sh`, add the Renovate annotation immediately above `DEFAULT_CHEZMOI_VERSION` (line 7) so Renovate updates `bootstrap.sh` alongside `.chezmoidata.toml` in the same `twpayne/chezmoi` PR (preventing `scripts/ci-check.sh` line 505 from failing):
   ```bash
   # renovate: datasource=github-releases depName=twpayne/chezmoi
   DEFAULT_CHEZMOI_VERSION='2.71.1'
   ```
2. Replace `.github/renovate.json` with:
   ```json
   {
     "$schema": "https://docs.renovatebot.com/renovate-schema.json",
     "extends": [
       "config:recommended"
     ],
     "semanticCommits": "enabled",
     "minimumReleaseAge": "7 days",
     "labels": [
       "dependencies"
     ],
     "packageRules": [
       {
         "matchUpdateTypes": [
           "minor",
           "patch",
           "pin",
           "digest"
         ],
         "automerge": false
       }
     ],
     "customManagers": [
       {
         "customType": "regex",
         "fileMatch": [
           "^\\.chezmoidata\\.toml$",
           "^bootstrap\\.sh$"
         ],
         "matchStrings": [
           "# renovate: datasource=(?<datasource>[a-z-]+?)(?: depName=(?<depName>[^\\s]+?))(?: versioning=(?<versioning>[^\\s]+?))?(?: extractVersion=(?<extractVersion>[^\\s]+?))?\\r?\\n(?:[a-z_]+ = \"|DEFAULT_CHEZMOI_VERSION=')(?<currentValue>[^'\"\\s]+?)['\"]"
         ]
       }
     ]
   }
   ```
   *(Note: `"extends": ["config:recommended"]` keeps one branch/PR per dependency and force-pushes in place when newer versions release before merge; `"minimumReleaseAge": "7 days"` enforces the supply-chain rule; removing `mise.fileMatch` avoids TOML parse warnings on Go-templated `dot_config/mise/config.toml.tmpl`.)*
3. In `scripts/ci-check.sh` (`Verify Renovate configuration` block, around line 238), also assert that `bootstrap.sh` matches the `customManagers[0].matchStrings[0]` regex at least once (`[...fs.readFileSync("bootstrap.sh", "utf8").matchAll(regex)].length === 1`).
4. **User step (GitHub UI):** Install the [Mend Renovate GitHub App](https://github.com/apps/renovate) and grant it access to `AmazingHorse/mydotfiles` (plus `copier-base` and `copier-infra-ops` once created in WP3/WP4).
**Verification:** `just test-fast`. After merging and enabling the GitHub App, confirm Renovate opens the Dependency Dashboard issue and version-bump PRs on GitHub.
**Out of scope:** auto-merging PRs.

### WP2: Template recipes in dotfiles (mydotfiles) — **Done (2026-11-01)**
**Branch:** `feat/template-recipes`
**Task:** add `copier` pin + `[templates]` data, plus `new`, `adopt`, `sync-template` and `dev-clone` global recipes in `dot_justfile`. (Can be developed and tested against local template paths or after WP3/WP4 publish `v0.1.0`.)
**Files:** `.chezmoidata.toml`, `dot_config/mise/config.toml.tmpl`, `dot_justfile`, `scripts/ci-check.sh`, `docs/how-to/start-a-project.md` (new)
**Steps:**
1. In `.chezmoidata.toml`:
   - Under `[packages]`, add:
     ```toml
     # renovate: datasource=pypi depName=copier
     copier = "9.19.1"
     ```
   - Add a `[templates]` table at the bottom:
     ```toml
     [templates]
     base = "gh:AmazingHorse/copier-base"
     infra_ops = "gh:AmazingHorse/copier-infra-ops"
     dev_root = "projects/templates"
     ```
2. In `dot_config/mise/config.toml.tmpl`, inside `{{ if eq .profile "workstation" -}}`, add:
   ```toml
   "pipx:copier" = "{{ .packages.copier }}"
   ```
   Add `'pipx:copier'` to the workstation check and a negative `grep -q "pipx:copier" "${server_mise_config}"` check in `scripts/ci-check.sh`.
3. In `dot_justfile`, add the four template recipes using `just 1.58`'s `[arg(..., long=...)]` attribute:
   - `new`:
     ```just
     [no-cd]
     [arg("archetype", long="archetype")]
     [arg("company", long="company")]
     new dir archetype="" company="":
     ```
     - Refuse if `dir` exists and is non-empty (`[[ -d "$1" ]] && [[ -n "$(ls -A "$1" 2>/dev/null)" ]]`).
     - `mkdir -p "$dir" && git -C "$dir" init`.
     - Resolve base template URL (`${COPIER_BASE_URL:-gh:AmazingHorse/copier-base}`). When `company` is non-empty, read `secrets_folder` and `bw_profile` from `~/.config/mydotfiles/companies.toml` via `yq -p toml -oy ".${company}.secrets_folder"` / `.bw_profile` and pass `-d secrets_folder=... -d bw_profile=...`.
     - Run `copier copy --trust -a .copier-answers.base.yml <base_url> "$dir"` and `git -C "$dir" add -A && git -C "$dir" commit -m "chore: initial copier-base scaffold"`.
     - If `archetype` is non-empty: map `infra-ops` → `gh:AmazingHorse/copier-infra-ops` (or `COPIER_ARCHETYPE_URL` override), run `copier copy --trust -a ".copier-answers.${archetype}.yml" <arch_url> "$dir"`, and commit (`chore: apply <archetype> archetype`).
     - If `company` is non-empty and `.${company}.overlay_url` exists in `companies.toml`: run `copier copy --trust -a ".copier-answers.${company}.yml" <overlay_url> "$dir"` and commit.
     - Run `(cd "$dir" && just setup && just check)`.
   - `adopt`:
     ```just
     [no-cd]
     [arg("archetype", long="archetype")]
     [arg("company", long="company")]
     adopt archetype="" company="":
     ```
     - Require a clean worktree on a non-`main`/`master` branch (`just --justfile {{quote(justfile())}} git-guard`).
     - Run `copier copy --trust -a .copier-answers.base.yml <base_url> .` (without `--overwrite`, so copier prompts on conflicts), plus the archetype and company layers if specified. Print `git status -sb` at the end.
   - `sync-template`:
     - Require clean worktree (`git status --porcelain` empty).
     - Loop over `.copier-answers*.yml` in `.`: run `copier update --trust -a "$f" --skip-answered`.
   - `dev-clone`:
     - Clone `https://github.com/AmazingHorse/copier-base.git` and `https://github.com/AmazingHorse/copier-infra-ops.git` into `~/projects/templates/<name>` if missing; skip if directory already exists.
4. Write `docs/how-to/start-a-project.md` covering `new`, `adopt`, `sync-template`, `dev-clone`, `~/.config/mydotfiles/companies.toml` schema, and the Bitwarden `folder`/`item`/`field` layout.
**Verification:** `just test-fast`.
**Out of scope:** template repository contents (WP3, WP4).

### WP3: `copier-base` v0.1.0 (new repo `~/projects/templates/copier-base`) — **Done (`9d01507`, tagged `v0.1.0`)**
**Branch:** `main` (initial repo creation + `v0.1.0` tag)
**Task:** build the underlay template repository and publish `AmazingHorse/copier-base` `v0.1.0`.
**Files:** `copier.yml`, `README.md`, `LICENSE`, `justfile`, `mise.toml`, `.github/workflows/ci.yml`, `tests/render.sh`, and `template/**`:
- `template/{{ _copier_conf.answers_file }}.jinja`
- `template/justfile.jinja`
- `template/.config/just/base.just`
- `template/mise.toml`
- `template/.config/fnox/provider.toml.jinja`
- `template/fnox.toml.jinja`
- `template/AGENTS.md.jinja`
- `template/CLAUDE.md` (symlink to `AGENTS.md`)
- `template/.agents/project.md.jinja`
- `template/.agents/sandbox.toml.jinja`
- `template/.omp/permissions.json`
- `template/.pre-commit-config.yaml`
- `template/.github/workflows/ci.yml.jinja` (or conditional `{% if ci %}.github{% endif %}/workflows/ci.yml`)
- `template/.github/pull_request_template.md`
- `template/.gitignore`
- `template/.editorconfig`
- `template/CONTRIBUTING.md`
- `template/README.md.jinja`
- `template/docs/adr/0000-template.md`
- `template/docs/debt.md`
**Steps:**
1. Author `copier.yml` with these exact settings:
   ```yaml
   _subdirectory: template
   _answers_file: .copier-answers.base.yml
   _min_copier_version: "9.19.1"
   _preserve_symlinks: true
   _skip_if_exists:
     - fnox.toml
     - project.just
     - README.md
     - .agents/project.md
     - .agents/sandbox.toml
     - .omp/permissions.json
   ```
   plus the questions: `project_name` (`str`), `project_slug` (`str`, default `{{ project_name | lower | replace(' ', '-') }}`, validator `^[a-z][a-z0-9-]+$`), `description` (`str`), `owner` (`str`, default `AmazingHorse`), `license` (`str`, choices `[MIT, none]`, default `MIT`), `secrets_folder` (`str`, default `proj`), `bw_profile` (`str`, default `""`), `bw_backend` (`str`, choices `[rbw, bw]`, default `rbw`), `ci` (`bool`, default `true`).
2. Author `template/**` using the exact skeletons in "Key file contents" above (including `template/{{ _copier_conf.answers_file }}.jinja` and `template/.config/just/base.just`). Ensure `template/CLAUDE.md` is a relative symlink `AGENTS.md`.
3. Write `tests/render.sh`:
   - Creates a temporary git tag `v0.0.0-test` if no tag exists yet.
   - Renders into `/tmp/test-render-default` with `copier copy --defaults -d project_name=demo-app -d description="Demo" . /tmp/test-render-default` and verifies:
     - `.copier-answers.base.yml` exists
     - `CLAUDE.md` is a symlink (`[[ -L /tmp/test-render-default/CLAUDE.md ]]`)
     - `wc -l < /tmp/test-render-default/AGENTS.md` is `<= 40`
     - `(cd /tmp/test-render-default && git init && git add -A && just check)` succeeds
   - Renders into `/tmp/test-render-company` with `-d bw_backend=bw -d secrets_folder=acme -d bw_profile=acme` and verifies `.config/fnox/provider.toml` contains `backend = "bw"` and `profile = "acme"` and does not contain `auth_command`.
   - Tests `_skip_if_exists`: appends a line to `/tmp/test-render-default/fnox.toml`, commits, runs `copier copy --defaults --overwrite . /tmp/test-render-default`, and asserts the custom line in `fnox.toml` is preserved.
4. Configure `.github/workflows/ci.yml` (`jdx/mise-action` + `bash tests/render.sh`, actions pinned by commit SHA). Push to `AmazingHorse/copier-base` and tag `v0.1.0`.
**Verification:** `bash tests/render.sh` exits 0.
**Out of scope:** archetype files; language toolchains.

### WP4: `copier-infra-ops` v0.1.0 (new repo `~/projects/templates/copier-infra-ops`) — **Done (`6ea3ee6`, tagged `v0.1.1`)**
**Branch:** `main` (initial repo creation + `v0.1.0` tag)
**Task:** build the `infra-ops` archetype template repository and publish `AmazingHorse/copier-infra-ops` `v0.1.0`.
**Files:** `copier.yml`, `README.md`, `LICENSE`, `justfile`, `mise.toml`, `.github/workflows/ci.yml`, `tests/render.sh`, and `template/**`:
- `template/{{ _copier_conf.answers_file }}.jinja`
- `template/archetype.just.jinja`
- `template/.config/mise/conf.d/infra-ops.toml.jinja`
- `template/.agents/archetype.md.jinja`
- `template/.agents/skills/infra-ops-runbook/SKILL.md`
- `template/.agents/skills/infra-ops-add-secret/SKILL.md`
- `template/{% if 'ansible' in iac %}ansible{% endif %}/.gitignore`
- `template/{% if 'ansible' in iac %}ansible{% endif %}/ansible.cfg`
- `template/{% if 'ansible' in iac %}ansible{% endif %}/requirements.yml`
- `template/{% if 'opentofu' in iac %}opentofu{% endif %}/.gitignore`
- `template/docs/runbooks/README.md`
**Steps:**
1. Author `copier.yml`:
   ```yaml
   _subdirectory: template
   _answers_file: .copier-answers.infra-ops.yml
   _min_copier_version: "9.19.1"

   iac:
     type: yaml
     help: Which IaC tools does this repository use?
     multiselect: true
     choices:
       - ansible
       - opentofu
     default:
       - ansible

   live_targets:
     type: str
     help: Live target CIDR(s) requiring explicit user approval before apply/smoke
     default: "192.168.50.0/24"
   ```
2. Author `template/.config/mise/conf.d/infra-ops.toml.jinja` using exact verified mise registry identifiers and ≥7-day-old versions:
   ```toml
   [tools]
   "aqua:astral-sh/uv" = "0.13.5"
   "pipx:yamllint" = "1.38.0"
   {% if 'ansible' in iac -%}
   "pipx:ansible-core" = "2.21.5"
   "pipx:ansible-lint" = "26.10.1"
   {% endif -%}
   {% if 'opentofu' in iac -%}
   "aqua:opentofu/opentofu" = "1.13.2"
   {% endif -%}
   ```
   *(Note: `"aqua:astral-sh/uv"` is included so GitHub Actions CI runners using `jdx/mise-action` can install the `pipx:*` tools without needing a separate global `uv` install step.)*
3. Author `template/archetype.just.jinja`:
   - Overrides `lint` (`pre-commit run --all-files`, `yamllint .`, plus `ansible-lint` when `ansible` in `iac` and playbooks exist).
   - Overrides `test` (`ansible-playbook --syntax-check` over `ansible/playbooks/*.yml` if present; `tofu -chdir=opentofu fmt -check && tofu -chdir=opentofu validate` when `opentofu` in `iac` and `.tf` files exist).
   - Adds `plan` (dry-run `fnox exec -- ansible-playbook --check --diff ...` / `fnox exec -- tofu -chdir=opentofu plan`).
4. Author `ansible.cfg`: `host_key_checking = True`, `callback_result_format = yaml`, `collections_path = ./.ansible/collections`, `inventory = inventory/`, `retry_files_enabled = False`.
5. Author `.agents/archetype.md.jinja` and the two skills (`infra-ops-runbook` and `infra-ops-add-secret`, noting `{ provider = "vault", value = "<slug>/<FIELD>" }` in `fnox.toml`).
6. Write `tests/render.sh`: renders `copier-base` into a tmpdir, then layers `copier-infra-ops` on top for `iac=[ansible]`, `iac=[opentofu]`, and `iac=[ansible, opentofu]`, verifying `just --list` and `just check` pass in each. Push and tag `v0.1.0`.
**Verification:** `bash tests/render.sh` exits 0.
**Out of scope:** Proxmox-specific roles (those stay in `thinkcenter-cluster`).

### WP5: Adopt into `thinkcenter-cluster` (branch `chore/adopt-templates`)
**Task:** apply `copier-base` + `copier-infra-ops` via `just -g adopt --archetype infra-ops`, then migrate the project onto the new conventions per the "Audit" table. Assumption: WP1–WP4 are done. The user runs anything that touches live systems.
**Files:** generated template files plus `ansible/ansible.cfg`, `ansible/playbooks/*.yml` (env lookups), `.github/workflows/{lint,sops-check}.yml` (delete), `.sops.yaml` and `ansible/secrets/` (delete), `.agents/AGENTS.md` → `.agents/project.md` + `docs/adr/*` + `docs/investigations/pxe-uefi.md`, `justfile` → `project.just`, `fetch_assets_justfile_plan.md` → `plans/`, `fnox.toml`, `.omp/permissions.json`
**Steps:**
1. In `thinkcenter-cluster` worktree (`just -g worktree-new chore/adopt-templates`), move existing `justfile` recipes to `project.just` (renaming `test` to `smoke-boot`), then run `just -g adopt --archetype infra-ops`. Check: `just --list` shows both the standard verbs and the project verbs, and `just check` calls `archetype.just`'s `lint` and `test`.
2. Secrets: create Bitwarden folder `proj`, item `thinkcenter-cluster`, fields `PROXMOX_ROOT_PASSWORD`, `PROXMOX_API_TOKEN_ID`, `PROXMOX_API_TOKEN_SECRET` (the user does this in Bitwarden). Add the refs to `fnox.toml` with `provider = "vault"`:
   ```toml
   PROXMOX_ROOT_PASSWORD = { provider = "vault", value = "thinkcenter-cluster/PROXMOX_ROOT_PASSWORD" }
   PROXMOX_API_TOKEN_ID = { provider = "vault", value = "thinkcenter-cluster/PROXMOX_API_TOKEN_ID" }
   PROXMOX_API_TOKEN_SECRET = { provider = "vault", value = "thinkcenter-cluster/PROXMOX_API_TOKEN_SECRET" }
   ```
   Replace vault vars in playbooks/group_vars with `lookup('env', …)`. Wrap `site`/`bootstrap` in `fnox exec --`. Delete `.sops.yaml`, `ansible/secrets/`, and `.github/workflows/{lint,sops-check}.yml`. Check: `rg -n 'sops' .` is empty outside `docs/adr/`.
3. Split `.agents/AGENTS.md`: decision table → `docs/adr/0001-0010` (one per row, short); PXE scratchpad → `docs/investigations/pxe-uefi.md`; the rest → `.agents/project.md` (file map corrected to nginx). Delete `.agents/AGENTS.md`. Check: `wc -l < AGENTS.md` ≤ 40.
4. Project permissions (`.omp/permissions.json`): deny `just up*`, `just site*`, `just bootstrap*`, `docker compose*`. Allow `just check`, `just lint`, `just test`. Ask `just plan*`, `just smoke*`.
5. `ansible.cfg` hardening: `host_key_checking = True` with `known_hosts` generated from `cluster-manifest.yml` by `00-generate-boot-config.yml`. Move `fetch_assets_justfile_plan.md` to `plans/`. Rename `terraform/` stub to `opentofu/`.
**Verification:** `just check` (green locally and on GitHub-hosted CI); `just doctor`. The user runs `fnox check` and `just plan` against live nodes.
**Out of scope:** PXE/UEFI fixes; Ceph/Corosync changes.

### WP6: Follow-ups (not MVP)
- Move global agent keys from `agent-secrets.env` to fnox global config `~/.config/fnox/config.toml` (refs only), then retire the chezmoi Bitwarden template.
- part5 Phase 10: prototype `fnox proxy run --sandbox` with `egress = "strict"` and `allow_private = [<live_targets>]`, reading `.agents/sandbox.toml`. Compare with a custom bwrap launcher. Retire `just -g omp-sandbox` if fnox covers it.
- Skills linking: symlink each repo's `.agents/skills/` into omp, Claude Code, agy and Devin on `cd` (or via `just setup`), and the shared `~/.agents/skills` from part4 #3.
- More archetypes: `copier-python`, `copier-typescript` (vectra, friend-programmer), `copier-embedded-kicad`, `copier-mcp-frontend`.
- Bitwarden Secrets Manager Teams or Infisical as a provider option in `provider.toml.jinja` (`secrets_provider` question).

## Notes for the implementing agent (omp / Gemini Flash)

- Run each WP from its repo root, in a worktree on its own branch (`just -g worktree-new <branch>`). Never edit across repos in one session.
- Treat the "Key file contents" as authoritative. Don't redesign interfaces. If a Verify-first item fails, stop and report rather than improvising.
- Pin every new tool to a release at least 7 days old. Never use `latest`.
- Don't run anything that touches live hosts (`site`, `bootstrap`, `up`, `smoke*`, `plan` against real nodes). Hand those commands to the user.
