# Plan: Multi-Agent Git Worktree Lifecycle via Worktrunk (`wt`) (`part10`)

> **Target Assignee:** SWE-2  
> **Scope:** `.chezmoidata.toml`, `dot_config/mise/config.toml.tmpl`, `dot_config/worktrunk/config.toml`, `.chezmoiscripts/run_onchange_after_link-agent-skills.sh.tmpl`, `dot_justfile`, `.chezmoitemplates/omp-managed-config.yml`, `dot_omp/private_agent/permissions.defaults.json`, `dot_omp/private_agent/extensions/command-guard/rules.ts`  
> **Goal:** Ship `mydotfiles` pre-configured with **[Worktrunk (`wt`)](https://worktrunk.dev/)** via `mise` (`aqua:max-sixty/worktrunk`) and its official **`omp` / `Claude Code` plugins**, so `omp` and `Claude Code` get full worktree creation, untracked-file copying, live status tracking, and one-command graceful merge (`wt merge`), while **Devin CLI** operates cleanly on the primary checkout (or any worktree you point it at) without needing custom worktree plugins.

---

## 1. Why Worktrunk (`wt`) + Official Plugins Is the Right Architecture

Instead of maintaining a bespoke TypeScript worktree-merging extension from scratch, **[Worktrunk (`wt`)](https://worktrunk.dev/)** (`aqua:max-sixty/worktrunk`, latest `0.81.0`) is already in the `mise`/`aqua` registry and ships official first-party plugins for **both `oh-my-pi` (`omp`) and `Claude Code`**:

| Capability | How Worktrunk (`wt`) Handles It Out of the Box |
| :--- | :--- |
| **Installation (Rule #4 Compliant)** | Installed declaratively via `dot_config/mise/config.toml.tmpl` (`"aqua:max-sixty/worktrunk" = "{{ .packages.worktrunk }}"`) and pinned in `.chezmoidata.toml`. Cross-platform (Linux, macOS, Windows). |
| **Official `omp` Plugin** | `wt config plugins opi install` installs Worktrunk's official `oh-my-pi` skill (`~/.omp/agent/skills/worktrunk/`) and activity-tracking extension (`~/.omp/agent/extensions/worktrunk-activity.ts`). |
| **Official `Claude Code` Plugin** | `wt config plugins claude install` installs the Claude Code plugin (`worktrunk@worktrunk`), wiring `WorktreeCreate`/`WorktreeRemove` hooks (`claude --worktree` routes through `wt switch --create` and `wt remove`), `/wt-switch-create`, `/wt-diff`, and `PermissionRequest` auto-approval for sibling worktrees. |
| **Devin CLI Compatibility** | Devin CLI runs directly on the primary checkout (non-worktree) while `omp` and `Claude Code` isolate parallel tasks into sibling worktrees—or Devin can be launched inside any `wt switch` directory via shell integration. Because our `command-guard` v2 mirrors `.claude` ↔ `.devin` ↔ `.omp` and Worktrunk's `post-create` hook runs `wt step copy-ignored`, any worktree (and the main checkout) always has synchronized permissions. |
| **Graceful Merge (`wt merge`)** | Single command (`wt merge [target]`) runs the full pipeline:<br>1. Stages & commits any uncommitted changes (or verifies clean state).<br>2. Squashes/rebases branch onto the target branch (`main`); if conflicts occur, leaves rebase open inside the isolated worktree so `main` is never dirtied.<br>3. Runs `[pre-merge]` verification hooks (e.g. `just test-fast`).<br>4. Fast-forwards local target branch **without checking it out in the main worktree**.<br>5. Removes the worktree and deletes the merged branch. |
| **Untracked Context & Cache Sharing** | Built-in `wt step copy-ignored` copies gitignored/untracked files (`.agent-spec.md`, `.claude/settings.local.json`, `.devin/config.local.json`, `.omp/permissions.local.json`, `.env`) into every new worktree automatically via a `[post-create]` hook. |

---

## 2. Prior Art & Ecosystem Catalogue (Reference)

For completeness, here is the full survey of worktree tooling evaluated:

| Tool / Extension | Role & Disposition |
| :--- | :--- |
| **[Worktrunk (`wt`)](https://worktrunk.dev/)** (`aqua:max-sixty/worktrunk`) | **Selected Primary Engine.** Rust CLI + official `omp` (`opi`), `Claude Code`, `Codex`, and `OpenCode` plugins. Provides `wt switch -c`, `wt list`, `wt merge`, `wt remove`, `wt step copy-ignored`, and lifecycle hooks. |
| **`omp` 18.x Built-ins (`worktree.*`, `task.isolation.*`)** | **Complementary.** Keep `session.worktreeScope: repo` enabled in `.chezmoitemplates/omp-managed-config.yml` so `omp --resume` sees sessions across all Worktrunk worktrees of the same repo. |
| **[`@harms-haus/pi-worktrees`](https://github.com/harms-haus/pi-worktrees)** & **[`@pandi-coding-agent/worktree`](https://pi.dev/packages/@pandi-coding-agent/worktree)** | **Superseded by Worktrunk (`wt`).** Community Pi extensions (~150 LOC) that wrap `git worktree add/merge`; unnecessary once `wt` + `wt config plugins opi install` is installed. |

---

## 3. Step-by-Step Implementation Plan for SWE-2

### Phase 1: Pin and Install `worktrunk` via `mise`

1. **`.chezmoidata.toml`**:
   - Add `worktrunk = "0.81.0"` under `[packages]`.
2. **`dot_config/mise/config.toml.tmpl`**:
   - Add `"aqua:max-sixty/worktrunk" = "{{ .packages.worktrunk }}"` under the workstation/non-server `[tools]` block (alongside `just`, `gh`, `delta`, etc.).
3. **`scripts/ci-check.sh`**:
   - Add `worktrunk` to the pin/template verification checks if applicable.

### Phase 2: Declarative Global Worktrunk Config (`dot_config/worktrunk/config.toml`)

Create `dot_config/worktrunk/config.toml` (deployed to `~/.config/worktrunk/config.toml` by chezmoi) so every project gets consistent worktree paths and automatic untracked-config propagation out of the box:

```toml
# Global Worktrunk (wt) configuration managed by chezmoi.
# Docs: https://worktrunk.dev/config/

# Place sibling worktrees next to the repo: ../wt-<repo>-<branch> (or ../wt-<branch>)
worktree-path = "../wt-{{ repo }}-{{ branch | sanitize }}"

[post-create]
# Copy gitignored local agent permissions, specs, and .env files into new worktrees
# so omp, Claude Code, and Devin immediately share local rules and task specs.
copy-ignored = "wt step copy-ignored"

[merge]
# Preserve clean linear history via rebase + fast-forward into target branch,
# then remove the worktree and branch automatically.
squash = false
rebase = true
remove = true
```

Also create a default global `~/.config/worktrunk/.worktreeinclude` (or configure `dot_config/git/ignore`) so `.agent-spec.md`, `.agent-profile.md`, `.claude/settings.local.json`, `.devin/config.local.json`, and `.omp/permissions.local.json` are always included when `wt step copy-ignored` runs.

### Phase 3: Auto-Install Worktrunk Plugins for `omp` and `Claude Code` + Shell Integration

1. **Shell Integration (`dot_config/shell/helpers.sh` & `dot_config/powershell/profile.ps1`)**:
   - Soft-fail initialize `wt` shell wrapper (so `wt switch <branch>` can `cd` the interactive shell directly into the target worktree):
     - Bash/Zsh (`dot_config/shell/helpers.sh`):
       ```sh
       if command -v wt >/dev/null 2>&1; then
           eval "$(wt config shell init "$(basename "${SHELL:-bash}")" 2>/dev/null)" || true
       fi
       ```
     - PowerShell (`dot_config/powershell/profile.ps1`):
       ```powershell
       if (Get-Command wt -ErrorAction SilentlyContinue) {
           # Note: On Windows, guard against Windows Terminal's wt.exe by checking path in mise shims
       }
       ```
     - **Important Windows/WSL Pitfall Guard:** On Windows and WSL (with Windows interop PATH), `wt.exe` is **Windows Terminal** (`%LOCALAPPDATA%\Microsoft\WindowsApps\wt.exe`)!
       - In `dot_config/shell/helpers.sh` and `dot_justfile`, resolve Worktrunk via `${HOME}/.local/share/mise/shims/wt` (or verify `wt --version` output contains `wt ` / `worktrunk` and path is not `/mnt/c/*`) before invoking `wt`!
2. **Plugin Registration (`.chezmoiscripts/run_onchange_after_link-agent-skills.sh.tmpl`)**:
   - In `run_onchange_after_link-agent-skills.sh.tmpl`, after `mise` is available:
     - Resolve the `mise`-managed `wt` binary (`mise which wt`).
     - Run `wt config plugins opi install --yes || true` to install the official `oh-my-pi` (`omp`) Worktrunk skill and activity-marker extension (`~/.omp/agent/extensions/worktrunk-activity.ts` & `~/.omp/agent/skills/worktrunk/`).
     - If `claude` CLI is present on `PATH`, run `wt config plugins claude install --yes || true` to install the Claude Code Worktrunk plugin.

### Phase 4: Route `dot_justfile` Worktree Recipes Through `wt` (with `git worktree` Fallback)

Update `dot_justfile` (`~/.justfile`) so `just -g` recipes use `wt` when available:

1. **`just -g worktree-new <branch> [base]`**:
   - Uses `wt switch --create <branch> ${base:+--base "$base"} --no-cd` (falling back to `git worktree add` + copying `.agent-spec.md`, `.claude/settings.local.json`, `.devin/config.local.json`, `.omp/permissions.local.json`).
2. **`just -g worktree-merge [branch]`** *(New recipe)*:
   - Uses `wt merge ${branch:-} --yes` to rebase onto the target branch, fast-forward the target branch in the primary checkout without checking it out, and remove the worktree + branch.
3. **`just -g worktree-done <branch>`**:
   - Uses `wt remove <branch>` (refusing if dirty).
4. **`just -g omp-wt <branch> *args`** *(New recipe)*:
   - Launches an `omp` session directly inside the worktree via `wt switch --create <branch> -x -- just -g omp-run "$@"`!

### Phase 5: Whitelist `wt` in `command-guard` & Make `workspaceRoots()` Worktree-Aware

1. **`dot_omp/private_agent/permissions.defaults.json` & `normalizer.ts`**:
   - Add `wt` to `SUBCOMMAND_TOOLS` in `normalizer.ts` (and `"wt step"`, `"wt config"` to `THREE_WORD_PREFIXES`).
   - In `permissions.defaults.json`:
     - Add `"wt list"`, `"wt status"`, `"wt step diff"`, `"wt step copy-ignored"`, `"wt config state"` to `allow`.
     - Add `"wt merge"`, `"wt remove"` to `ask` (so merging or removing a worktree prompts once unless pre-approved for the project/session).
2. **`dot_omp/private_agent/extensions/command-guard/rules.ts` (`workspaceRoots` & `isProtectedPath`)**:
   - When an agent runs inside a linked worktree (`../wt-<repo>-<branch>`), `<cwd>/.git` is a file pointing to `<main-repo>/.git/worktrees/<name>`.
   - Update `workspaceRoots()` to resolve `<cwd>/.git` to the shared `<main-repo>/.git` common directory (and allow `wt merge` to fast-forward `<main-repo>`) without false-positive "path outside workspace" blocks, while keeping `<main-repo>/.git/hooks` and `<main-repo>/.git/config` protected in `isProtectedPath()`.
3. **`.chezmoitemplates/omp-managed-config.yml`**:
   - Add `session.worktreeScope: repo` so `omp --resume` displays sessions across all Worktrunk worktrees of the current repository.

---

## 4. Verification & Acceptance Criteria

1. **Tooling & Template Verification (`just test-fast`)**:
   - `.chezmoidata.toml` and `dot_config/mise/config.toml.tmpl` render cleanly with `aqua:max-sixty/worktrunk` pinned to `0.81.0`.
   - `dot_config/worktrunk/config.toml` renders and passes `chezmoi apply --dry-run`.
2. **WSL / Windows `wt.exe` Clash Guard Test**:
   - Verify shell init in `dot_config/shell/helpers.sh` ignores `/mnt/c/.../WindowsApps/wt.exe` (Windows Terminal) and only initializes if `wt` resolves to a POSIX path (`~/.local/share/mise/...`).
3. **`command-guard` Worktrunk & Linked Worktree Tests (`scripts/omp-permissions.test.ts`)**:
   - Verify `commandPrefix` normalizes `wt list` → `"wt list"`, `wt switch --create feat` → `"wt switch"`, `wt step copy-ignored` → `"wt step copy-ignored"`, `wt merge` → `"wt merge"`.
   - Verify `workspaceRoots()` inside a linked worktree includes the common `.git` directory while `isProtectedPath()` still blocks `<common-git-dir>/hooks` and `<common-git-dir>/config`.
4. **End-to-End Worktree Lifecycle Smoke Test**:
   - Run `wt switch --create test-branch --no-cd` (or `just -g worktree-new test-branch`), verify `.claude/settings.local.json` / `.devin/config.local.json` / `.omp/permissions.local.json` are copied via `wt step copy-ignored`, commit a change, and run `wt merge` (`just -g worktree-merge`) to confirm fast-forward merge into base branch and automatic worktree cleanup.
