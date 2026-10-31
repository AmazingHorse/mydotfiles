# Part 8: Secrets (fnox + rbw) and layered copier templates — MVP for `thinkcenter-cluster`

> **Handoff note (2026-10-30):** written at the end of a design session. The design decisions are settled. The facts under "Verified" were checked against upstream docs. Do the items under "Verify first" **before** writing code that depends on them. This file supersedes the detail of part5 Phases 8 and 9; part5 should be updated to point here (WP0).

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
| Global agent keys | **Leave `~/.config/agent-secrets.env` auto-sourcing alone for now** (earlier decision), but fix the locked-vault wipe (WP1). Moving to fnox's global config is a follow-up | |
| Company specifics | Base answers `secrets_folder` and `bw_profile` (company → `folder = "<company>"`, `profile = "<company>"` → `RBW_PROFILE`). The private overlay adds only company-only files (CODEOWNERS, company CI, extra agent rules). The company → URL/folder/profile map lives in an unmanaged `~/.config/mydotfiles/companies.toml` | No employer names in public repos, and no files shared between layers |
| `.chezmoiroot` (part5 P7.5) | **Demoted to optional tidying.** Templates no longer live in this repo, so there's nothing dev-only to hide from servers | |

## Verified (upstream docs, 2026-10-30)

- **Copier** (`copier.readthedocs.io/en/stable/configuring/`):
  - `_subdirectory` separates template metadata from template code. It is not meant for multiple templates in one repo.
  - Multiple templates per project are supported via `copier copy -a .copier-answers.<x>.yml` and `copier update -a ...`.
  - `_tasks` runs post-copy/update commands.
  - Questions support `secret: true` (never saved to the answers file), `when`, `validator`, `choices`, and dynamic defaults.
  - Without `--vcs-ref`, copier uses the latest **PEP 440 tag**, so templates must be tagged (`v0.1.0`).
- **chezmoi:** `init --recurse-submodules` defaults to `true`. chezmoi has `bitwardenSecrets` (bws) and `rbw` / `rbwFields` template functions.
- **Bitwarden Secrets Manager:** the free plan has 2 users, 3 projects and 3 machine accounts; Teams has unlimited projects. `bws run --project-id --no-inherit-env -- cmd` exists. Kept only as a future provider.
- **fnox v1.45.0** (`fnox.jdx.dev`):
  - **Config load order:** global `~/.config/fnox/config.toml`, then for each directory from root down: `fnox.toml` / `.fnox.toml` / `.config/fnox.toml`, then `fnox.<profile>.toml`, then `fnox.local.toml` (never commit). `root = true` stops the upward search.
  - **Top-level config fields:** `import` (array; relative paths resolve against the declaring file), `env` (`true` / `"exec"` / `false`), `if_missing` (`error` / `warn` / `ignore`), `default_provider`, `profiles`, `proxy`, `mcp`, `daemon`.
  - **Bitwarden provider:** `type = "bitwarden"`, `backend = "rbw"` (marked **experimental** upstream) or `"bw"` (needs `BW_SESSION`), plus `folder`, `profile` (rbw → `RBW_PROFILE`) and `auth_command = "rbw unlock"`. References are `Item` (password), `Item/username|password|notes|uri|totp`, or `Item/<custom field>`. The provider is read-only: you create items in Bitwarden, not with `fnox set`.
  - **CLI:** `exec`, `get`, `list`, `check [-a]`, `doctor`, `config-files`, `provider test`, `scan`, `proxy run [--sandbox]`, `mcp`, `--non-interactive`, `--if-missing`.
  - **`[proxy]`:** `egress = "strict"`, `allow_domains`, `allow_private`, and `[[proxy.rules]]` that inject a secret into requests for a matching domain/method/path, so the process never sees the value. This is a strong candidate for part5 Phase 10 (agent sandbox).
  - **mise integration:** fnox installs via mise (`mise use fnox`, registry `github:jdx/fnox`). jdx recommends wrapping commands with `fnox exec` over the experimental `mise-env-fnox` plugin.
- **mise registry (checked locally):** `fnox` → `github:jdx/fnox`, `copier` → `pipx:copier`, `ansible-core` → `pipx:ansible-core`, `yamllint` → `pipx:yamllint`, `opentofu` → `aqua:opentofu/opentofu`, `actionlint` → `aqua:rhysd/actionlint`, `shfmt` → `aqua:mvdan/sh`, `uv`, `yq`, `gh`, `lychee`, `pre-commit` (aqua). **`rbw` is not in the registry.** `ansible-lint` was not checked.

## Verify first (unresolved; check before depending on them)

1. **rbw install route on Linux/WSL.** In order of preference: Ubuntu `apt-cache policy rbw` (add to the apt package list if noble has it) → GitHub release binaries at `doy/rbw` (`github:doy/rbw` via mise if assets exist) → `cargo install rbw` (needs the rust toolset). Pick the first that works and record it in ADR 0005. On Windows, rbw is unsupported: fall back to `backend = "bw"` there (base question `bw_backend`).
2. **fnox `backend = "rbw"` end to end** (it's experimental): `rbw login && rbw unlock`, create folder `proj`, item `fnox-smoke` with custom field `HELLO=world`, then `fnox exec -- printenv HELLO` from a scratch dir with the provider config below. If it fails, use `backend = "bw"` and document `export BW_SESSION=$(bw unlock --raw)`.
3. **Does `import` carry `[providers]`** from `.config/fnox/provider.toml` into `fnox.toml` as expected? Check with `fnox provider list` and `fnox config-files` in a scratch dir.
4. **Release ages (supply-chain rule):** pin fnox, copier and rbw to versions published at least 7 days ago (`gh api repos/jdx/fnox/releases`, the PyPI JSON for copier).
5. **Copier's `gh:` URL shortcut** (`gh:AmazingHorse/copier-base`). If unsupported, use `https://github.com/AmazingHorse/copier-base.git`.
6. **Copier `_skip_if_exists`** behaviour on `copier update` (it should never overwrite a project-owned file). Test with a scratch render.
7. **just `import?`** (optional import) and recipe override across imports: confirm `set allow-duplicate-recipes` is needed so `archetype.just` can override base `check`/`lint`. Check `just --help` / the docs for the pinned just 1.58.

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
| Tasks | `justfile`: settings, standard verbs (`setup check test fmt lint run build smoke doctor`), `import? 'archetype.just'`, `import? 'project.just'` | `archetype.just` (overrides `check`/`lint`/`fmt`/`test` bodies, adds archetype verbs) | `project.just` |
| Tools | `mise.toml` (core: `fnox`, `just`, `pre-commit`, `actionlint`, `shfmt`) | `.config/mise/conf.d/<archetype>.toml` (verify mise loads `.config/mise/conf.d/*.toml` in a project; otherwise `mise.<archetype>.toml` via `MISE_ENV`) | `mise.local.toml` (gitignored) |
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
# EXAMPLE_TOKEN = { value = "{{ project_slug }}/EXAMPLE_TOKEN" }
```

`copier-base/template/justfile.jinja` (shape; verify the `allow-duplicate-recipes` semantics, Verify-first item 7):
```just
set shell := ["bash", "-euo", "pipefail", "-c"]
set allow-duplicate-recipes
set positional-arguments

import? 'archetype.just'
import? 'project.just'

default:
    @just --list

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
| No `mise.toml`, tools assumed on the host | **Not reproducible** | infra-ops `.config/mise/conf.d/infra-ops.toml`: `ansible-core`, `ansible-lint`, `yamllint`, `opentofu` |
| `just test` hits live endpoints; no `check` | **No safe gate** | Move to `project.just` as `smoke-boot`. `check` = yamllint + ansible-lint + `ansible-playbook --syntax-check` |
| `.agents/AGENTS.md` (hidden, includes a stale matchbox file map, a "do not re-debate" decision table, and ~40 lines of PXE debugging) | **Mis-scoped** | Root `AGENTS.md` (base). Decision table → `docs/adr/0001-0010`. PXE notes → `docs/investigations/pxe-uefi.md`. Fix the file map (nginx, not matchbox) in `.agents/project.md` |
| "Agent: don't run commands on the host" lives in the scratchpad | **Unenforced** | `.omp/permissions.json` project denies (`just up`, `just site`, `just bootstrap`, `docker compose`, `ansible-playbook` without `--syntax-check`/`--check`) + `sandbox.toml` |
| `fetch_assets_justfile_plan.md` at the repo root | **Clutter** | Move to `plans/` |
| `terraform/` stub | **Keep, but rename** | `opentofu` per the dotfiles toolset. Keep it as a stub |

## Work packages (each is an omp-ready spec; run omp from the named repo root)

Order: WP0 → WP1 → WP2 → WP3 → WP4 → WP5 → WP6. WP2 and WP3 need the Verify-first items done. Each WP = one branch, one PR, Conventional Commits.

### WP0: Align part5 with this plan (mydotfiles, docs only)
**Task:** point part5 Phases 8/9 at this file and record the changed decisions. Assumption: docs only.
**Files:** `plans/part5-platform-roadmap.md`
**Steps:**
1. In the part5 status note, replace "P8 MVP … `templates/project/`" with "see part8". Mark P7.5 as optional. Check: `rg -n 'part8' plans/part5-platform-roadmap.md`.
2. In Phase 8: replace the "Personal base copier template at `templates/project/`" row and the `copier.yml`/`_subdirectory` rows with "separate repos `copier-base` + archetypes; see part8". Change open question 10 to "resolved: one repo per template". Check: `rg -n '_subdirectory|templates/project' plans/part5-platform-roadmap.md` returns only historical mentions.
3. In Phase 9: replace `with-secrets`/`bws` with "fnox + rbw; see part8". In the "Decided" list, change "Bitwarden item per project `<org>/<repo>`" to "folder `<org>`, item `<repo>`".
4. In Phase 10: add a row "evaluate `fnox proxy run --sandbox` with `[proxy] egress = "strict"` before building a custom bwrap launcher".
**Verification:** `just test-fast`
**Out of scope:** any non-doc file.

### WP1: Dotfiles secrets plumbing (mydotfiles)
**Task:** install fnox and rbw, fix the locked-vault wipe, and add `just -g doctor` secret checks. Assumption: Verify-first items 1, 2 and 4 are done.
**Files:** `.chezmoidata.toml`, `dot_config/mise/config.toml.tmpl`, `.chezmoiscripts/run_onchange_after_install-packages.sh.tmpl` (only if rbw comes from apt), `.chezmoiignore`, `dot_config/private_agent-secrets.env.tmpl`, `dot_justfile` (`doctor`), `docs/adr/0005-fnox-rbw-secrets.md` (new), `docs/explanation/security-model.md` (new), `.github/renovate.json` (if the new pins need a datasource)
**Steps:**
1. Add the pins `fnox` (`# renovate: datasource=github-releases depName=jdx/fnox`) and `rbw` (route from Verify-first item 1). Add `"fnox" = "{{ .packages.fnox }}"` to the mise config, outside any profile gate (fnox is useful on servers too). Check: `chezmoi execute-template < dot_config/mise/config.toml.tmpl | rg fnox`.
2. Locked-vault fix: in `.chezmoiignore`, add a block that ignores `.config/agent-secrets.env` when `not (and (lookPath "bw") (env "BW_SESSION"))`, so an apply with a locked vault leaves the existing file untouched. Check: `env -u BW_SESSION chezmoi diff ~/.config/agent-secrets.env` shows no change.
3. `doctor`: add a `secrets:` section that prints `fnox version`, `rbw unlocked` status (`rbw unlocked && echo unlocked || echo locked`), and `fnox doctor` when run inside a repo containing `fnox.toml`. Check: `just -g doctor`.
4. Write ADR 0005 (context: bws free-tier limits; decision: fnox + Bitwarden PM via rbw; folder/item/field convention; consequences: no secrets in git, network needed, rbw backend is experimental with a `bw` fallback, Windows uses `bw`) and `security-model.md` (what's global, what's per-project, and that the sandbox doesn't get the token).
5. CI: add a check in `scripts/ci-check.sh` that the rendered mise config contains `fnox`. Check: `just test-fast`.
**Verification:** `just test-fast`; `just apply` on the workstation; `fnox --version`; `rbw --version`.
**Out of scope:** moving global agent keys to fnox; the template repos.

### WP2: Template recipes in dotfiles (mydotfiles)
**Task:** copier tooling plus the `new`, `adopt`, `sync-template` and `dev-clone` global recipes. Assumption: WP3 has published `copier-base` v0.1.0 (develop against local paths first).
**Files:** `.chezmoidata.toml` (`[templates]` table + `copier` pin), `dot_config/mise/config.toml.tmpl` (copier, workstation only), `dot_justfile`, `docs/how-to/start-a-project.md` (new)
**Steps:**
1. `.chezmoidata.toml`: add `[templates] base = "gh:AmazingHorse/copier-base"`, `infra_ops = "gh:AmazingHorse/copier-infra-ops"`, and `dev_root = "projects/templates"`. Add the `copier` pin. mise: `"pipx:copier" = "{{ .packages.copier }}"` inside `{{ if eq .profile "workstation" }}`. Check: rendered config contains copier on the workstation, not on server (`--promptChoice profile=server`).
2. `dot_justfile` `new dir archetype="" company=""`:
   - Refuse if `dir` exists and is non-empty.
   - `git init`.
   - `copier copy --trust -a .copier-answers.base.yml <base> <dir>`, passing `-d secrets_folder=… -d bw_profile=…` from `~/.config/mydotfiles/companies.toml` when `company` is set (read with `yq -p toml`).
   - Commit.
   - If `archetype` is set: `copier copy -a .copier-answers.<archetype>.yml <url> <dir>` and commit.
   - If `company` is set: apply the overlay URL from `companies.toml` and commit.
   - Run `just setup && just check` in the new repo.
   
   Check: `just -g new /tmp/demo` renders, and `just check` passes there.
3. `adopt archetype="" company=""` (run inside an existing repo): require a clean worktree on a non-main branch (reuse the `git-guard` logic), then the same copier calls with `--overwrite` **off**, so copier prompts per conflict. Print `git status` at the end. Check: dry run on a scratch clone.
4. `sync-template`: for each `.copier-answers*.yml` in the repo root, run `copier update -a <file> --skip-answered` (verify the flag name), stopping on conflicts. Check: run it in `/tmp/demo` after bumping the template tag.
5. `dev-clone`: for each `[templates]` URL, clone into `~/<dev_root>/<name>` if missing. Never pull. Check: run twice; the second run is a no-op.
6. Write `docs/how-to/start-a-project.md` (new, adopt, sync, company overlay setup, the vault folder/item convention).
**Verification:** `just test-fast`; manual `just -g new /tmp/demo --archetype infra-ops`.
**Out of scope:** template content.

### WP3: `copier-base` v0.1.0 (new repo `~/projects/templates/copier-base`)
**Task:** build the underlay template exactly as in "File ownership" and "Key file contents". Assumption: Verify-first items 3, 5, 6 and 7 are done; the repo is public on GitHub under `AmazingHorse`.
**Files:** `copier.yml`, `README.md`, `template/**` (every base-owned and seeded file in the ownership table), `tests/render.sh`, `.github/workflows/ci.yml`, `justfile`, `mise.toml`, `LICENSE`
**Steps:**
1. `copier.yml`: `_subdirectory: template`, `_answers_file: .copier-answers.base.yml`, `_min_copier_version` (the pinned version), `_skip_if_exists: [fnox.toml, project.just, README.md, .agents/project.md, .agents/sandbox.toml, .omp/permissions.json]`, the questions listed above, and `_tasks: ["git add -A"]` only if useful (otherwise none). Check: `copier copy --defaults . /tmp/b1` succeeds.
2. Author the `template/` files. Each `.jinja` file uses only the answers above. `CLAUDE.md` is a symlink to `AGENTS.md` (verify copier preserves symlinks; otherwise render a one-line `See AGENTS.md`). Check: `tree -a /tmp/b1`.
3. `tests/render.sh`: render into a tmpdir with `--defaults` and with `-d bw_backend=bw -d secrets_folder=acme -d bw_profile=acme`, then run `just check` in each render (run `mise install` first). Check: `bash tests/render.sh`.
4. Template repo CI: `jdx/mise-action` + `bash tests/render.sh`, actions pinned by SHA.
5. Tag `v0.1.0` after CI is green.
**Verification:** `bash tests/render.sh`; rendered `AGENTS.md` ≤ 40 lines (`wc -l`).
**Out of scope:** archetype files; language toolchains.

### WP4: `copier-infra-ops` v0.1.0 (new repo `~/projects/templates/copier-infra-ops`)
**Task:** build the infra-ops archetype layer. Assumption: `copier-base` v0.1.0 exists.
**Files:** `copier.yml`, `template/archetype.just`, `template/.config/mise/conf.d/infra-ops.toml`, `template/.agents/archetype.md`, `template/.agents/skills/infra-ops-runbook/SKILL.md`, `template/.agents/skills/infra-ops-add-secret/SKILL.md`, `template/{% if 'ansible' in iac %}ansible{% endif %}/{.gitignore,ansible.cfg,requirements.yml}`, `template/{% if 'opentofu' in iac %}opentofu{% endif %}/.gitignore`, `template/docs/runbooks/README.md`, `tests/render.sh`, CI
**Steps:**
1. `archetype.just`: override `lint` (pre-commit + `yamllint .` + `ansible-lint` if ansible), `test` (`ansible-playbook --syntax-check` over `ansible/playbooks/*.yml` if ansible; `tofu fmt -check && tofu validate` if opentofu). Add `plan` (dry runs: `ansible-playbook --check --diff`, `tofu plan`) wrapped in `fnox exec --`. Check: renders on top of base, and `just --list` shows the overrides.
2. `ansible.cfg`: `host_key_checking = True`, `callback_result_format = yaml`, `collections_path = ./.ansible/collections`, `inventory = inventory/`, `retry_files_enabled = False`. `requirements.yml` is empty but present.
3. `.agents/archetype.md`: manifest-driven state; idempotency; a runbook per operation; never apply without a dry run; live targets `{{ live_targets }}` need user approval.
4. Skills:
   - `infra-ops-runbook`: how to write a runbook.
   - `infra-ops-add-secret`: add a field to Bitwarden item `<slug>` in folder `<folder>`, add a ref to `fnox.toml`, `lookup('env', …)` in Ansible, and never echo the value.
5. `tests/render.sh`: render base and then infra-ops with each `iac` combination, then `just check`. Then tag `v0.1.0`.
**Verification:** `bash tests/render.sh`.
**Out of scope:** Proxmox-specific roles (those stay in the project).

### WP5: Adopt into `thinkcenter-cluster` (branch `chore/adopt-templates`)
**Task:** apply base + infra-ops via `just -g adopt infra-ops`, then migrate the project onto the new conventions per the "Audit" table. Assumption: WP1–WP4 are done. The user runs anything that touches live systems.
**Files:** generated template files plus `ansible/ansible.cfg`, `ansible/playbooks/*.yml` (env lookups), `.github/workflows/{lint,sops-check}.yml` (delete), `.sops.yaml` and `ansible/secrets/` (delete), `.agents/AGENTS.md` → `.agents/project.md` + `docs/adr/*` + `docs/investigations/pxe-uefi.md`, `justfile` → `project.just`, `fetch_assets_justfile_plan.md` → `plans/`, `fnox.toml`, `.omp/permissions.json`
**Steps:**
1. Run `just -g adopt infra-ops` and resolve conflicts. The existing `justfile` recipes move to `project.just`, and `test` is renamed `smoke-boot`. Check: `just --list` shows both the standard verbs and the project verbs.
2. Secrets: create Bitwarden folder `proj`, item `thinkcenter-cluster`, fields `PROXMOX_ROOT_PASSWORD`, `PROXMOX_API_TOKEN_ID`, `PROXMOX_API_TOKEN_SECRET` (the user does this in Bitwarden). Add the refs to `fnox.toml`. Replace vault vars in playbooks/group_vars with `lookup('env', …)`. Wrap `site`/`bootstrap` in `fnox exec --`. Delete the sops files. Check: `fnox check` (names resolve); `rg -n 'sops' .` is empty outside docs/adr.
3. Split AGENTS: decision table → ADRs (one per row, short); PXE scratchpad → `docs/investigations/pxe-uefi.md`; the rest → `.agents/project.md` (file map corrected to nginx). Check: `wc -l AGENTS.md` ≤ 40.
4. Project permissions: deny `just up`, `just site`, `just bootstrap`, `docker compose`. Allow `just check`, `just plan`. Check: `bun test` is not applicable here; review manually.
5. `ansible.cfg` hardening: `known_hosts` generated from `cluster-manifest.yml` by `00-generate-boot-config.yml`. Check: `just check` is green.
**Verification:** `just check` (green on CI too); `just doctor`. The user runs `just plan` against live nodes.
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
