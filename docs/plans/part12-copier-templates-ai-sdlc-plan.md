# Plan: Upgrading `copier-base` & `copier-infra-ops` for AI-Native SDLC (`part12`)

> **Target Assignee:** SWE-2 / Template Maintainer  
> **Scope:** External template repositories [`AmazingHorse/copier-base`](https://github.com/AmazingHorse/copier-base) & [`AmazingHorse/copier-infra-ops`](https://github.com/AmazingHorse/copier-infra-ops), plus `dot_justfile` (`new` / `adopt` ref bump in `mydotfiles`)  
> **Goal:** Ensure every repository created via `just -g new` or migrated via `just -g adopt` ships out of the box with synchronized cross-harness permissions (`.claude/settings.json` + `.devin/config.json` + `.omp/permissions.json`), Worktrunk (`wt`) hooks, `betterleaks` pre-commit secret scanning, and a uniform `just check` contract.

---

## 1. Current Gap Between `mydotfiles` and `copier-base` (`v0.1.0`)

Currently, running `just -g new <dir>` scaffolds a repository using `copier-base` (`v0.1.0`), but leaves several AI-SDLC pieces to manual follow-up (`just -g seed`, manual `.gitignore` edits, manual permission approvals):

1. **No Pre-Seeded Cross-Harness Permissions:** Every new project prompts from scratch for `just check`, `bun test`, `uv run pytest`, `ruff check`, etc., and does not gitignore `.claude/settings.local.json`, `.devin/config.local.json`, or `.omp/permissions.local.json`.
2. **No Worktrunk (`.config/wt.toml`) Project Config:** New projects don't define a `[post-create]` dependency warmup (`uv sync` / `bun install`) or `[pre-merge]` verification gate (`just check`).
3. **Inconsistent Task Runner Targets:** Agents rely on a single deterministic `just check` target across Python, TypeScript, Rust, and Infra-Ops repos.
4. **Missing `betterleaks` Pre-Commit Hook:** Agents running in autonomous worktrees need a hard pre-commit secret-scanning gate so secrets are caught before `wt merge`.

---

## 2. Deliverables for `AmazingHorse/copier-base` (`v0.2.0`)

### 2.1 Committed Cross-Harness Permission Baseline
Generate `.claude/settings.json`, `.devin/config.json`, and `.omp/permissions.json` templated by project language (`python`, `typescript`, `rust`, `shell`):

```json
{
  "permissions": {
    "allow": [
      "Bash(just check *)",
      "Bash(just test *)",
      "Bash(just fmt *)",
      "Bash(git status *)",
      "Bash(git diff *)",
      "Bash(git log *)"
    ],
    "ask": [
      "Bash(git push *)"
    ],
    "deny": [
      "Bash(sudo *)",
      "Read(**/.env)",
      "Read(**/.env.*)"
    ]
  }
}
```
*(Plus language-specific allow entries: `"Bash(uv run pytest *)"`, `"Bash(uv run ruff *)"` for Python; `"Bash(bun test *)"`, `"Bash(bun x tsc *)"` for TypeScript; `"Bash(cargo check *)"`, `"Bash(cargo test *)"` for Rust).*

### 2.2 Standard AI-SDLC `.gitignore` Block
Append to template `.gitignore`:
```gitignore
# AI Agent local state & specs (never commit)
.agent-spec.md
.claude/settings.local.json
.devin/config.local.json
.omp/permissions.local.json
.omp/scratch/
```

### 2.3 Worktrunk Project Hook Config (`.config/wt.toml`)
Include `.config/wt.toml` so `wt switch --create` and `wt merge` work zero-config in every scaffolded repo:
```toml
[post-create]
copy-ignored = "wt step copy-ignored"
{{- if eq project_type "python" }}
deps = "uv sync --frozen || uv sync"
{{- else if eq project_type "typescript" }}
deps = "bun install --frozen-lockfile || bun install"
{{- end }}

[pre-merge]
verify = "just check"
```

### 2.4 Uniform `justfile` Contract (`check`, `test`, `fmt`, `scan-secrets`)
Ensure every scaffolded `justfile` exposes:
- `just check` — runs formatter check + linter + typecheck + unit tests + `betterleaks git --pre-commit`.
- `just test` — runs unit/integration test suite.
- `just fmt` — formats code in-place.

### 2.5 Optional Bundled `command-guard` Extension
Once `command-guard` v2 (`part9`) is complete, optionally vendor or symlink `.omp/extensions/command-guard/` in `copier-base` (or load globally from `~/.omp/agent/extensions/command-guard/`) so contributors using `omp` get the interactive permission guard automatically.

---

## 3. Deliverables for `AmazingHorse/copier-infra-ops` (`v0.2.0`)

1. Pre-seed `.agent-profile.md` from `dot_omp/archetypes/infra-ops.md` directly during `copier copy` so `just -g agent-init infra-ops` is already applied.
2. Add pre-flight syntax check recipes to `just check` (`shellcheck`, `ansible-lint` / `terraform validate` / `nginx -t` dry-run guards where applicable).
3. Add `Read(**/*.pem)`, `Read(**/*.key)`, `Edit(/etc/**)` to `permissions.deny` / `ask` in `.claude/settings.json`.

---

## 4. Follow-Up in `mydotfiles` (`dot_justfile`)

1. Bump `copier_default_ref := "v0.2.0"` in `dot_justfile` once `copier-base` and `copier-infra-ops` `v0.2.0` tags are pushed.
2. Update `just -g new` and `just -g adopt` to automatically run `just -g seed <lang> <archetype>` if `AGENTS.md` is not already rendered by the template.

---

## 5. Verification & Acceptance Criteria

1. Run `just -g new /tmp/test-proj` with the updated template.
2. Verify `.claude/settings.json`, `.devin/config.json`, `.omp/permissions.json`, `.config/wt.toml`, and `justfile` exist and pass `just check` on first run.
3. Verify `wt switch --create feat-test` copies local ignored files and `wt merge` executes `[pre-merge] verify = "just check"`.
