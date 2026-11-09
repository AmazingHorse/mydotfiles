# How-To: Multi-Agent Worktrees and Verification Gate

Practical guide for running parallel agent sessions (`omp`, `claude`, `devin`) on the same repository with isolated linked worktrees, automated review gates, and zero cleanup friction.

---

## 1. Daily Worker Loop

### Start a Session
Navigate to any git repo's primary checkout and invoke your tool of choice:

```bash
omp       # oh-my-pi
claude    # Claude Code
devin     # Devin CLI
```

**What happens automatically:**
1. Spawns an isolated linked worktree at `../wt-<repo>-agent-<harness>-<timestamp>`.
2. Copies local uncommitted settings (`.omp/permissions.local.json`, `.claude/settings.local.json`, `.devin/config.local.json`) via `.worktreeinclude`.
3. Initializes a shared handoff directory at `$(git rev-parse --git-common-dir)/agent-bus/`.

### Exiting
- **Read-Only / No Changes:** Just exit (`Ctrl+D` or `exit`). If there are 0 commits ahead and 0 modified files, the worktree and branch are **automatically deleted**. Zero leftovers.
- **Work Performed:** If the agent made commits or modifications, the worktree stays intact and prints a reminder:
  ```text
  ==> Worktree agent/omp-... has 2 commit(s) ahead of main.
  ==> Review & merge: wt merge  (or: wt switch main && wt remove agent/omp-...)
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
