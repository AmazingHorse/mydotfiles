# How-To: Multi-Agent Worktrees and Verification Gate

Practical guide for running parallel agent sessions (`omp`, `claude`, `devin`) on the same repository with isolated linked worktrees, automated review gates, and zero cleanup friction.

---

## 1. Daily Worker Loop

### Start a Session
Navigate to any git repo's primary checkout and invoke your tool of choice:

```bash
omp       # oh-my-pi   — native session worktree (worktree.onStart=create)
claude    # Claude Code — wt-wrapped session worktree
devin     # Devin CLI   — wt-wrapped session worktree
```

**omp** manages the lifecycle itself: every fresh interactive session starts in a real linked git worktree on a `wt/<timestamp>` branch (under `~/.omp/wt`, or `worktree.base`). Its clone-first creation carries ignored files *and* build artifacts over, so `.env` and local permissions just work. These are ordinary linked worktrees — `wt list`, `wt merge`, `wt remove`, and `wtr` all operate on them.

**claude / devin** are wrapped by `_wt_agent_exec`, which delegates to `wt switch --create agent/<harness>-<timestamp> -x <harness>`:

1. Spawns a sibling linked worktree at `../wt-<repo>-agent-<harness>-<timestamp>`.
2. Copies local uncommitted settings via `wt step copy-ignored` (`post-create` hook).
3. Initializes a shared handoff directory at `$(git rev-parse --git-common-dir)/agent-bus/`.
4. Runs the harness *inside* the worktree (`-x`), propagating its exit code.

### Targeting an existing branch (claude / devin / wta)

```bash
AGENT_BRANCH=feature-x claude   # resume an existing local branch into a worktree
wta                             # interactive wt picker (worktrees + branches) → omp
wta claude                      # same picker → claude
```

`AGENT_BRANCH`/`OMP_BRANCH` naming a branch that doesn't exist falls back to `--create`. For exotic targets (`pr:<N>`, remote branches, paths) use `wt switch <target> -x omp` directly.

### Exiting
- **omp:** `worktree.onExit=ask` prompts keep/remove on every exit — including Ctrl+C/SIGINT shutdowns, which flow through `session_shutdown`. Pristine worktrees can be dropped with no friction.
- **claude / devin:** the shell epilogue applies after the harness exits *by any means* (Ctrl+D, Ctrl+C — the interactive shell survives the child's signal):
  - **No commits, no tracked modifications:** worktree + branch auto-removed.
  - **Work performed:** prompted `[Enter]=keep  r=rename branch  d=discard worktree+branch`. Rename uses `git branch -m`; the worktree directory keeps its original name. `AGENT_WT_ASK=0` disables the prompt (always keep).
  - **Resumed worktrees** (`AGENT_BRANCH`, `wta`): pristine exits leave the worktree in place rather than removing a pre-existing artifact.

### Mid-session commands (omp — `wt-session` extension)
- `/wt-name <branch>` — rename the checked-out branch (works for `wt/*` and `agent/*` sessions alike).
- `/wt-switch <branch>` — check out another branch **in place** inside the worktree (`-c` to create).
- `/wt-keep` / `/wt-drop` — pre-arm the exit policy via an `agent-bus/.policy-*` marker the shell epilogue consumes (for omp-native worktrees, `onExit` governs instead).
- `/wt` is omp's *built-in* relocation command: moves the live session into a fresh worktree carrying uncommitted changes.
- `/wt-pull [--copy] [branch|path]` — move another worktree's uncommitted work into this one (default source: the primary checkout).
- `/wt-merge [target] [-m <msg>]` — commit pending changes with your message (required when dirty; prompted if omitted, so wt's `Changes to N files` fallback never lands), then `wt merge --no-commit --no-remove` (rebase, verify hooks, fast-forward). Keeps the worktree so the session's cwd survives — drop it on exit. From a bare shell: commit, then `wt merge --branch <branch>` for the same with full cleanup.
- `/wt-status` — branch, root, commits ahead, dirty count, active policy.

### Handing uncommitted work between checkouts

`worktree.onStart` worktrees deliberately start clean at HEAD — uncommitted changes in the root checkout (e.g. left by a Devin Desktop session) do not carry over. To continue that work inside a session worktree:

```bash
wtpull                # shell: move primary checkout's changes into CWD worktree
wtpull --copy         # keep the source checkout's changes instead of moving
wtpull <branch|path>  # pull from a specific worktree instead of the primary
# inside omp: /wt-pull [--copy] [branch|path]
```

It is a **one-way handoff, not sync**: `stash push -u` in the source + `stash apply` in the target (a real merge — diverged bases get conflict markers). The default **move** drops the stash, leaving the source clean — which also keeps `wt merge` unblocked, since it refuses to push into a dirty target checkout. `--copy` pops it back; if apply conflicts under move, the stash is kept as a named backup. Works identically from plain shells, claude, devin (`wtpull`), and omp (`/wt-pull`).

The reverse direction needs no machinery: commit the worktree branch, `git switch <branch>` in the root checkout, and let the next agent continue there.

### Opting out per invocation

```bash
OMP_NO_WT=1 omp        # config overlay: worktree.onStart=off for this run
AGENT_NO_WT=1 claude   # skip the wt wrapper entirely
```

---

## 2. Multi-Agent Coordination

Run multiple sessions in separate terminal tabs simultaneously with zero file conflicts:

```bash
# Terminal 1: Feature A in Claude Code
claude

# Terminal 2: Refactor in Devin (saving tokens locally)
devin

# Terminal 3: Test fix in omp
omp
```

### Dashboard Monitoring
From any terminal in the repo, check on all active agents:

```bash
wt list
```
Displays all worktrees, dirty states, commits ahead/behind (`↑2`), and live status markers (🤖 working / 💬 waiting for input).

### Cross-Agent Handoff Notes (Agent Bus)
Before an agent finishes or hands off, it writes a short discovery note:
```bash
echo "Fixed auth bug; requires DB migration 004" > $(git rev-parse --git-common-dir)/agent-bus/$(git branch --show-current | tr '/' '_').md
```
Sibling agents and reviewers can read this without searching full conversation transcripts.

---

## 3. Review & Verification

### Inspecting a Finished Branch (`wtr`)
When a worker finishes, switch to its branch and review the changes:

```bash
wtr agent/claude-20261108-143000
```

**What it shows:**
1. Recent commits (`git log --oneline`).
2. Touched files (`git diff --stat`).
3. Any handoff note left in `.git/agent-bus/`.

*(Optional: have an AI reviewer critique the diff before merging)*:
```bash
wtr agent/claude-20261108-143000 omp
# Inside omp, invoke /reviewer or /agy-crew-reviewer
```

### Merging with Guaranteed Verification
When approved, run:

```bash
wt merge
```

**The automated gate (`just -g verify`):**
1. **Blocks** if `.agent-spec.md` or `.agent-profile.md` is accidentally tracked in git.
2. Runs the exact test suite in priority order:
   - Command defined in `.agent-spec.md` `## Verification`
   - Project `just check` (or `test-fast` / `test`)
   - Auto-detected manifest (`bun test`, `uv run pytest`, `cargo test`)
3. **If tests pass:** Rebase/fast-forwards into `main`, deletes the worktree folder, deletes the local branch, cleans up the agent-bus note, and returns you to `main`.
4. **If tests fail:** Aborts the merge and keeps the worktree intact so you can fix the issue.

---

## 4. Maintenance & Housekeeping

Commands invoked only when maintaining or inspecting system health:

| Command | Purpose |
|---|---|
| `just -g doctor` | Audits environment, Worktrunk version, installed plugins, and active worktrees. |
| `just -g worktree-gc` | Prunes broken worktree metadata, deletes cleanly merged worktrees, and cleans orphaned bus notes. |
| `just -g verify` | Runs the active repository's verification gate on demand. |
| `wt remove <branch> --yes` | Discards an abandoned or unwanted worker worktree immediately. |

---

## 5. Propagating to New/Existing Repos (Copier SDLC)

1. **New Projects:** Run `just -g new <dir>`. The project is scaffolded with `AGENTS.md` (pre-seeded with `uv`/`bun`/`just check` rules) and pre-seeded baseline permissions for Claude, Devin, and omp.
2. **Existing Projects:** Run `copier update` inside the repo to 3-way merge the updated rules and baseline configs.
3. **Ad-Hoc / Brownfield:** In any non-templated repo, run `just -g seed <typescript-node|python|systems-shell>` to generate an aligned `AGENTS.md`.
