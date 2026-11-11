# `wt-session` — Worktree Lifecycle Commands for omp

Slash commands that manage the git worktree an omp session is running in.
Self-contained (`bun:fs`, `bun:path`, `pi.exec`); drop into
`.omp/extensions/wt-session/` in a repo or install globally under
`~/.omp/agent/extensions/wt-session/` (managed by chezmoi).

## Commands

| Command | Effect |
| :--- | :--- |
| `/wt-name <branch>` | Rename the checked-out branch mid-session (`git branch -m`); also renames its `agent-bus` handoff note. Use it to give auto-generated `wt/<ts>` / `agent/*` names a real name before exit. |
| `/wt-switch <branch>` | Check out a different local branch *inside this worktree* (`git switch` in place — `wt` tracks the new mapping automatically). `-c <name>` creates the branch first; unknown names offer to create. |
| `/wt-pull [--copy] [branch\|path]` | Move another worktree's uncommitted work (modified + untracked, gitignored excluded) into this one. Default source is the primary checkout — the Devin → omp handoff. Moves by default (source ends clean); `--copy` keeps the source's changes too. |
| `/wt-merge [target] [-m <msg>]` | Commit pending changes and merge this branch into the default branch — commits with your message (required when dirty; prompted if omitted — wt's `Changes to N files` fallback is never used), then `wt merge --no-commit --no-remove` (rebase → `just -g verify` hook → fast-forward). The worktree is **kept** so the session's cwd survives; drop it on session exit. From a bare shell: `git commit -am <msg>` then `wt merge --branch <branch>` (full cleanup). |
| `/wt-keep` | Keep this worktree on session exit without prompting. |
| `/wt-drop` | Discard this worktree and its branch on session exit. |
| `/wt-status` | Show branch, worktree root, commits ahead of the base branch, dirty count, and active exit policy. |

## How `/wt-pull` moves uncommitted state

`stash push -u` in the source (the `refs/stash` ref is shared across linked
worktrees), then `stash apply` here — a real merge, so a diverged branch gets
proper conflict markers rather than a patch reject. The default **move** drops
the stash entry, leaving the source clean (a clean primary checkout also
unblocks `wt merge`, which refuses to push into a dirty target). `--copy` pops
the stash back instead. If apply conflicts under move, the stash entry is kept
as a backup and named in the warning. The shell-side equivalent is `wtpull`
(same semantics), so the handoff works from plain shells, claude, and devin
too. The reverse direction needs no command: commit in the worktree,
`git switch <branch>` in the root.

## How keep/drop intent travels

`/wt-keep` and `/wt-drop` write a marker file at
`<git-common-dir>/agent-bus/.policy-<worktree-basename>` containing `keep` or
`drop`. The `_wt_agent_epilogue` shell helper (used by the `claude`/`devin`
worktree wrappers) consumes the marker after the session exits and applies it —
then deletes the marker.

For **omp-native** session worktrees (created by `worktree.onStart`), omp's own
`worktree.onExit` policy governs the exit prompt instead; the markers are
harmless no-ops there, though `/wt-name`, `/wt-switch`, and `/wt-status` remain
fully useful.

## Related

- `docs/how-to/multi-agent-worktrees.md` — full lifecycle walkthrough.
- `dot_config/shell/helpers.sh` — `_wt_agent_exec` / `_wt_agent_epilogue`.
- `wt` (worktrunk) — `wt list`, `wt merge`, `wt remove` work on all of these
  worktrees; they are real linked git worktrees.
