# Agent defaults

Cross-project habits across AI coding agents. Repo-specific guidance stays in each project's documentation and `.agent-spec.md` / rules.

## Platform / shell awareness

Match the environment on the **first** shell call. Prefer tooling that works across Windows and Unix.

- Check environment/OS on launch.
- **Windows / PowerShell:** Use PowerShell first. Do **not** bash-probe (`command -v`, `which`, `2>/dev/null`, heredocs) then fall back.
- **Unix / Linux / macOS:** Use bash/zsh normally.
- Automation / task runner: Prefer `just` or shell scripts native to the platform. Repo-relative paths only; never hardcode `/home/...` or `C:\Users\...` in committed scripts.

## Agency

- Follow through until the query or objective is resolved. Avoid stopping prematurely.
- State assumptions and continue; ask only when blocked or facing genuine architectural ambiguity.
- Prefer tools over questions when answers are discoverable in the repository.
- After substantive edits: run tests/checks and verify fixes before declaring done.

## Communication

- Terse, skimmable Markdown: `##` / `###` headings only. Bold sparingly.
- Backticks for files, directories, symbols, and commands. Call code modifications **edits**, not patches.
- No narration comments in code. No "let me know if that's okay" unless blocked.
- Brief progress notes before tool batches; end with a short high-signal summary. Don't restate obvious plans.

## Exploration

- Prefer targeted searches with parallel patterns, then read likely file ranges; don't drip one search at a time.
- Parallelize independent reads/greps; sequence only when output gates the next input.
- Gather concrete evidence before declaring done.

## Code style & Git

- High-clarity names (verbs for functions, nouns for values); avoid cryptic 1–2 char abbreviations.
- Guard clauses / early returns; handle errors first; avoid deep nesting.
- Comment **why**, not how; no inline trailing comments; no TODOs—implement or escalate.
- Match existing repository style; do not reformat unrelated code.
- Commit messages follow Conventional Commits (`feat(scope): ...`, `fix(scope): ...`).
