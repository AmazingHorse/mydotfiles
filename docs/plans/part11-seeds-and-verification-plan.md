# Plan: Modernize `.omp/seeds`, Enforced Verification Gate, Worktree-by-Default Sessions, and Plugin Discovery (`part11`)

> **Target Assignee:** SWE-2  
> **Scope:** `dot_omp/seeds/*.md`, `dot_omp/archetypes/*.md`, `dot_config/shell/helpers.sh`, `dot_config/powershell/profile.ps1`, `dot_config/worktrunk/config.toml`, `dot_justfile`, `.chezmoiscripts/run_onchange_after_link-agent-skills.sh.tmpl`  
> **Goal:** Make bare `omp` in any git repo automatically run in a self-cleaning linked worktree (so the normal workflow is just `omp` $\to$ `wt merge`, with no `just -g` commands required), scan and auto-install Worktrunk harness plugins (`omp`, `claude`, `codex`, `opencode`, `pi`), align language seeds with our modern toolchain, and enforce a deterministic `[pre-merge]` verification gate.

---

## 1. Problem Statement

1. **Stale Language Seeds (`dot_omp/seeds/`):**
   - `dot_omp/seeds/typescript-node.md` still instructs agents to run `npx tsc --noEmit && npm test` and `npm run lint`, whereas our environment pins `bun` and uses `just check` / `bun test`.
   - `dot_omp/seeds/python.md` says `pytest` without `uv run` (`uv run ruff check && uv run pytest`), causing agents to invoke bare `pytest` outside the project's `uv` virtualenv if `.venv/bin` isn't manually activated.
   - None of the seeds establish `just check` (when a `justfile` is present) as the primary deterministic verification command.
2. **Verification Is Advisory Instead of Enforced:**
   - Agents are instructed in `AGENTS.md` to run `just check` / `just test`, but nothing programmatically runs the verification command from `.agent-spec.md` (or `just check`) before a worktree branch is merged or a headless run concludes.
3. **Main Worktree Is Still the Default & Requires `just -g` Ceremony:**
   - Starting `omp` directly mutates the main checkout, while `just -g worktree-new` / `just -g omp-run` adds friction to the daily loop. Typing bare `omp` inside a repository should transparently spawn into an isolated linked worktree and clean up after itself on exit if no changes were made, leaving `just -g` strictly for maintenance (`doctor`, `worktree-gc`, `new`).
4. **Static Plugin Registration, No Insight Bus, and Worktree Sprawl:**
   - Worktrunk supports plugins for `omp`, `claude`, `codex`, `opencode`, and `pi`, plus `agy-crew` host skills, but plugin registration currently hardcodes only two targets instead of scanning installed agent CLIs and reporting status in `just -g doctor`.
   - Sibling worktrees have no shared scratchpad to leave short handoff notes without polluting git status.
   - Worktree-by-default sessions risk leaving behind empty/no-op worktrees (`wt-<repo>-agent-session-*`), merged branches, stale `.git/worktrees` metadata, and old `.git/agent-bus/*.md` notes unless session exit and merge recipes enforce deterministic cleanup.
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

### Phase 3: Cross-Harness Auto-Worktree Wrappers (`omp`, `claude`, `devin`), Review Helper & Shared Insight Bus (`helpers.sh` & `profile.ps1`)

1. **Shared `_wt_agent_exec <harness> [args...]` helper backing `omp()`, `claude()`, and `devin()` in `dot_config/shell/helpers.sh` (and PowerShell equivalents in `profile.ps1`):**
   - **Pass-through conditions** (calls `command <harness> "$@"` directly without creating a worktree):
     - Non-interactive stdin/stdout (`! [ -t 0 ]` or `! [ -t 1 ]`), or `AGENT_NO_WT=1` / `OMP_NO_WT=1`.
     - Informational/headless/subcommand flags (`-h`, `--help`, `-v`, `--version`, `--no-tui`, `-p`, `--print`, `-w`, `--worktree`, `mcp`, `auth`, `config`).
     - Not inside a git worktree (`! git rev-parse --is-inside-work-tree`), or `wt` is not installed.
     - **Already inside a linked worktree** (`[ "$(git rev-parse --git-dir)" != "$(git rev-parse --git-common-dir)" ]`).
   - **Auto-worktree when invoked from the primary checkout:**
     - Ensure `$(git rev-parse --git-common-dir)/agent-bus/` exists so parallel sessions across `omp`, `claude`, and `devin` can read/write `<branch>.md` insight notes.
     - Derive branch `agent/<harness>-$(date +%Y%m%d-%H%M%S)` (or `AGENT_BRANCH` / `OMP_BRANCH` if provided).
     - Run `wt switch --create "$branch"` (triggering `.worktreeinclude` to copy `.omp/permissions.local.json`, `.claude/settings.local.json`, `.devin/config.local.json`) and launch `command <harness> "$@"` inside that worktree.
2. **Review & Merge-Check Helper (`wtr <branch> [harness]`):**
   - Switches to `<branch>`, displays `git log --oneline <base>..HEAD`, `git diff --stat <base>...HEAD`, and any `.git/agent-bus/<branch>.md` note, and optionally opens a review session in the chosen harness (`omp` / `claude` / `devin`) before running `wt merge`.
3. **Headless Sidecar Dispatch (`wt switch --create <branch> -x -- omp --no-tui ...`):**
   - Keep `just -g dispatch <branch> "<task>"` as an optional headless background helper around `wt switch --create "$branch" -x --`, without requiring `just -g` in normal interactive use.

### Phase 4: Dynamic Plugin Scan & Health Check (`link-agent-skills` + `just -g doctor`)

1. **Scan and install available Worktrunk & `agy-crew` plugins (`run_onchange_after_link-agent-skills.sh.tmpl`):**
   - Loop over all supported Worktrunk plugin targets (`omp`, `claude`, `codex`, `opencode`, `pi`): for each target whose CLI binary is on `PATH` (excluding `/mnt/c/*` WSL bridges), run `wt config plugins <target> install --yes`.
   - Detect installed `agy-crew` hosts and link skills accordingly.
2. **Surface plugin & worktree readiness in `just -g doctor`:**
   - Report installed `wt` plugins (`~/.omp/agent/hooks/pre/worktrunk.ts`, Claude hooks, etc.), `command-guard` `PreToolUse` hook status in `~/.claude/settings.json`, and active worktrees (`wt list`).

### Phase 5: Self-Cleaning Worktree Lifecycle & GC (`helpers.sh` + `config.toml` + `dot_justfile`)

1. **Zero-Diff Session Auto-Cleanup on Exit (inside the `omp` wrapper):**
   - When `command omp "$@"` exits inside an auto-created session worktree:
     - Check if the branch has **zero commits ahead of base** (`git rev-list --count HEAD ^<base> == 0`) and **zero tracked/staged changes** (`git status --porcelain --untracked-files=no` is empty).
     - If clean/untouched: automatically `cd` back to the primary checkout and run `wt remove "$branch" --yes` silently. Ask-only or read-only sessions leave zero trace.
     - If commits or dirty edits exist: stay in (or print path to) the worktree and show a one-line hint: `wt merge` (verify & merge) or `wt remove` (discard).
2. **Post-Merge Teardown (`wt merge` & `[pre-merge]`):**
   - `wt merge` natively runs `[pre-merge]` (`just -g verify`), merges the branch, removes the linked worktree directory and local branch, and returns to the primary checkout.
   - Clean up `$(git rev-parse --git-common-dir)/agent-bus/<branch>.md` on merge and ensure `.agent-spec.md` is never staged into a commit.
3. **Maintenance Garbage Collection (`just -g worktree-gc`):**
   - Reserved for periodic cleanup when needed: runs `git worktree prune`, removes clean worktrees whose branch is already merged, deletes orphaned `.git/agent-bus/*.md` notes, and warns on dirty unmerged worktrees older than 7 days.

---

## 3. Verification & Acceptance Criteria

1. Run `just test-fast` to validate shell syntax (`shellcheck`), PowerShell parse, and template renders.
2. Run `omp` from a primary git checkout, exit without changes, and verify the temporary worktree + branch are auto-removed with zero leftovers (`wt list` clean).
3. Run `omp` from a primary git checkout, commit a change, exit, and run `wt merge` — verify `[pre-merge]` runs `just -g verify`, merges, deletes the worktree + branch, and returns to the main checkout.
4. Run `just -g worktree-gc` and `just -g doctor` for maintenance and plugin status verification.
