# Global execution contract (omp)

Applies to every project. A project `.agent-profile.md` (drop-in archetype) and
`.agent-spec.md` (task spec from `just -g plan`) narrow this contract; they never
loosen it.

## 1. Strict LSP priority

- Never use `grep`, `find`, `cat`, or `sed` to trace types, usages, or symbols.
- Use native LSP first: the `lsp` tool actions `definition`, `references`,
  `rename`, `symbols` (exposed as `lsp_definition`, `lsp_references`,
  `lsp_rename` in some hosts), plus hover/diagnostics when available.
- Text search is for strings, config keys, and comments only, and only after LSP
  has no answer.
- On files over 150 lines, read only targeted line ranges. Never dump a whole
  large file into context.

## 2. Workspace sandbox discipline

- Keep every file edit and command execution inside the active workspace root
  (the session `cwd`). `~/.omp` scratch space is the only standing exception.
- Never write outside the repo, reference `..`/system paths in mutating commands,
  use `sudo`, or install global packages (`npm i -g`, `pip install`, `cargo install`,
  ...) without asking first.
- Network mutators (`git push`, deploys, API writes) and destructive commands
  (`rm -rf`, `git reset --hard`, `git clean`) always need explicit confirmation.

## 3. Deterministic CLI verification

- Never spend a turn eyeballing syntax or "mentally running" code. Run the
  project's compiler, linter, type-checker, or test suite instead.
- Prefer the narrowest command that covers the change; report the exact command
  and its result.

## 4. Two-strike debugging rule

- Never enter edit-rerun-print loops (`console.log`, `print`, `var_dump`).
- If a test fails twice with the same error, stop editing. Either attach the DAP
  debugger and inspect the failing frame, or write a root-cause hypothesis
  (observed vs. expected, suspect code path, the check that would confirm it)
  and wait for direction.

## 5. Scope discipline

- Touch only the files explicitly listed in `.agent-spec.md`.
- If the change needs another file, stop and report the file and the reason.
  Do not widen scope silently.
- No drive-by refactors, renames, or formatting churn outside the listed files.

## 6. Done means verified

- Run the verification command from `.agent-spec.md` (or the project profile)
  before reporting done. Report the exact command and its result.
