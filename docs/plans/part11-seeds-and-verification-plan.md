# Plan: Modernize `.omp/seeds`, Enforced Verification Gate, and Headless Background Dispatch (`part11`)

> **Target Assignee:** SWE-2  
> **Scope:** `dot_omp/seeds/*.md`, `dot_omp/archetypes/*.md`, `dot_justfile`  
> **Goal:** Align the language seeds with our actual modern toolchain (`uv`/`ruff`/`pytest`, `bun`/`tsc`, `just check`), add a deterministic pre-merge/post-agent verification gate, and add a `just -g dispatch <branch> "<task>"` recipe for parallel headless execution in isolated worktrees.

---

## 1. Problem Statement

1. **Stale Language Seeds (`dot_omp/seeds/`):**
   - `dot_omp/seeds/typescript-node.md` still instructs agents to run `npx tsc --noEmit && npm test` and `npm run lint`, whereas our environment pins `bun` and uses `just check` / `bun test`.
   - `dot_omp/seeds/python.md` says `pytest` without `uv run` (`uv run ruff check && uv run pytest`), causing agents to invoke bare `pytest` outside the project's `uv` virtualenv if `.venv/bin` isn't manually activated.
   - None of the seeds establish `just check` (when a `justfile` is present) as the primary deterministic verification command.
2. **Verification Is Advisory Instead of Enforced:**
   - Agents are instructed in `AGENTS.md` to run `just check` / `just test`, but nothing programmatically runs the verification command from `.agent-spec.md` (or `just check`) before a worktree branch is merged or a headless run concludes.
3. **No Single-Command Headless Background Dispatch:**
   - Today, running a task in an isolated worktree requires 4 manual steps: `just -g worktree-new <br>`, `cd ../wt-<br>`, `just -g plan "<task>"`, `just -g omp-run`.

---

## 2. Step-by-Step Implementation Plan

### Phase 1: Modernize `dot_omp/seeds/*.md`

1. **`dot_omp/seeds/typescript-node.md`**:
   - Update toolchain guidance to prefer `bun` (`bun test`, `bun x tsc --noEmit`) when `bun.lock` or `bun.lockb` is present, falling back to `pnpm`/`npm` only when the project lockfile dictates.
   - Set Verification priority:
     ```bash
     just check   # if justfile defines `check`, else:
     bun x tsc --noEmit && bun test
     ```
2. **`dot_omp/seeds/python.md`**:
   - Update toolchain guidance to use `uv run` (`uv run pytest`, `uv run ruff check`, `uv run mypy`) when `uv.lock` or `pyproject.toml` is present; forbid bare `pip install` (use `uv add` or `mise`).
   - Set Verification priority:
     ```bash
     just check   # if justfile defines `check`, else:
     uv run ruff check && uv run pytest
     ```
3. **`dot_omp/seeds/systems-shell.md` & `dot_omp/seeds/minimal.md`**:
   - Prefer `just check` / `just test-fast` when a `justfile` exists, falling back to `shellcheck` + `bash -n`.

### Phase 2: Add Deterministic Verification Gate (`just -g verify`)

In `dot_justfile` (`~/.justfile`), add a `verify` recipe that resolves and executes the active repository's verification command in strict priority order:

1. **If `.agent-spec.md` exists and has a `## Verification` section:** extract and run the command listed under `## Verification`.
2. **Else if a project `justfile` exists with a `check` or `test-fast` or `test` recipe:** run `just check` (or `just test-fast` / `just test`).
3. **Else auto-detect by lockfile:**
   - `bun.lock` / `bun.lockb` → `bun test`
   - `uv.lock` / `pyproject.toml` → `uv run pytest`
   - `Cargo.toml` → `cargo check && cargo test`
4. Wire `just -g verify` into Worktrunk's `[pre-merge]` hook in `dot_config/worktrunk/config.toml` (from `part10`) so `wt merge` / `just -g worktree-merge` automatically blocks merging any agent worktree whose verification check fails!

### Phase 3: Add `just -g dispatch <branch> "<task>"` (Parallel Headless Worker)

In `dot_justfile`, add a `dispatch` recipe that chains worktree creation, spec planning, execution, and verification:

```just
[no-cd]
dispatch branch task *args:
    #!/usr/bin/env bash
    set -euo pipefail
    just --justfile {{quote(justfile())}} worktree-new "$1"
    wt_dir="../wt-$(printf '%s' "$1" | tr '/' '-')"
    cd "$wt_dir"
    just --justfile {{quote(justfile())}} plan "$2"
    shift 2
    just --justfile {{quote(justfile())}} omp-run "$@"
    just --justfile {{quote(justfile())}} verify
```

---

## 3. Verification & Acceptance Criteria

1. Run `just test-fast` to validate `dot_justfile` syntax and template renders.
2. Run `just -g seed typescript-node` and `just -g seed python` in a scratch directory and verify the generated `AGENTS.md` reflects `bun` / `uv` / `just check`.
3. Run `just -g verify` inside `mydotfiles` and confirm it detects and runs the verification suite cleanly.
