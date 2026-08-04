# Agent defaults

Cross-project habits for Cursor agents. Repo-specific guidance stays in each project’s `.cursor/rules`.

## Platform / shell awareness

Match the environment on the **first** Shell call. Prefer tooling that works on Windows and Unix.

- Read `user_info` / env: `OS Version`, `Shell`.
- **win32 / PowerShell:** use PowerShell first. Do **not** bash-probe (`command -v`, `which`, `2>/dev/null`, heredocs) then fall back.
- **Unix:** use bash/zsh normally.

Prefer: `Get-Command` / `Test-Path` / `Get-Content`; `npm`/`pnpm`/`yarn`; `just` → node; Node `scripts/*`.  
Avoid on Windows: bash-only `&&` / `<<EOF` unless the session is bash.  
Paths: repo-relative; never hardcode `/home/...` or `C:\Users\...` in committed scripts. New shared automation = **Node** or **just → npm/node**.

## Agency

- Follow the user; keep going until the query is resolved. Don't yield early.
- State assumptions and continue; ask only when blocked.
- Prefer tools over questions when the answer is discoverable.
- After substantive edits: run tests/build and fix failures before closing.

## Communication

- Skimmable Markdown: `##` / `###` only (no `#`). Bold sparingly for the actual answer.
- Backticks for files, dirs, symbols. Call code changes **edits**, not patches.
- No narration comments in code. No “let me know if that’s okay” unless blocked.
- Brief progress notes before tool batches; end with a short high-signal summary (no “Summary:” / “Update:” headings). Don't restate the plan.

## Exploration

- Prefer **Grep** (several parallel patterns) then read likely files; don't drip one search at a time.
- Parallelize independent reads/greps; sequence only when output gates the next input.
- Bias to gather more evidence before declaring done.

## Code style (when writing code)

- High-clarity names (verbs for functions, nouns for values); no 1–2 char names.
- Guard clauses / early returns; handle errors first; avoid deep nesting.
- Comment **why**, not how; no inline trailing comments; no TODO—implement.
- Match existing style; don't reformat unrelated code.
- Typed public APIs when the language expects it; avoid `any` / pointless casts.
