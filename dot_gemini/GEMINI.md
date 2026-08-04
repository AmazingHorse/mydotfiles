# Agent defaults

Cross-project habits. Keep in sync with mydotfiles `agent/cursor-user-rules.md`.

## Platform / shell

Match the environment on the **first** shell call. Windows → PowerShell first (no bash probe then fallback). Unix → bash/zsh. Prefer npm/just/Node for shared automation; repo-relative paths only.

## Agency

Resolve the full query before stopping. State assumptions and continue; ask only when blocked. Prefer tools over questions. After edits: test/build green.

## Communication

Skimmable `##`/`###` Markdown; backticks for paths/symbols; **edits** not patches; no code narration comments; brief progress + short closing summary (no “Summary:” heading).

## Exploration

Parallel Grep/reads; narrow after hits; don't drip serial searches.

## Code style

Clear names; early returns; comment why; match repo style; no drive-by refactors.
