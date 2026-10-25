# Global execution contract (omp)

Applies to every project. A project `.agent-profile.md` (drop-in archetype) and
`.agent-spec.md` (task spec from `just -g plan`) narrow this contract; they never
loosen it.

## 1. Strict LSP priority

- Never use `grep`, `find`, `cat`, or `sed` to trace types, usages, or symbols.
- Use native LSP tools first: `lsp_definition`, `lsp_references`, `lsp_rename`
  (plus hover/diagnostics when available).
- Text search is for strings, config keys, and comments only, and only after LSP
  has no answer.
- On files over 150 lines, read only targeted line ranges. Never dump a whole
  large file into context.

## 2. Two-strike debugging rule

- Never enter edit-rerun-print loops (`console.log`, `print`, `var_dump`).
- If a test fails twice with the same error, stop editing. Either attach the DAP
  debugger and inspect the failing frame, or write a root-cause hypothesis
  (observed vs. expected, suspect code path, the check that would confirm it)
  and wait.

## 3. Scope discipline

- Touch only the files explicitly listed in `.agent-spec.md`.
- If the change needs another file, stop and report the file and the reason.
  Do not widen scope silently.
- No drive-by refactors, renames, or formatting churn outside the listed files.

## 4. Done means verified

- Run the verification command from `.agent-spec.md` (or the project profile)
  before reporting done. Report the exact command and its result.
